(() => {
  if (!window.TuotieUI || window.TuotieDesktopLive) return;
  const hidden = new Set();
  let known = new Set();
  let promptedTarget = false;
  let offeredBlender = false;
  let labelKey = '';
  let agentKey = '';
  let receivedSnapshot = false;
  let receivedAgent = false;
  let agent = {phase: 'idle', actions: [], error: '', summary: '', title: '', pendingDrop: null};
  let armedDrop = '';
  let controlling = false;
  let controlAction='';
  let sceneCommitAcknowledged=false;
  let pendingStop = false;
  let lastNotice = 0;
  let lastTarget = '';
  let focusedName = '';let focusContext={};
  const focusKey=value=>JSON.stringify((function ordered(input){
    if(Array.isArray(input))return input.map(ordered);
    if(input&&typeof input==='object')return Object.fromEntries(Object.keys(input).sort().filter(key=>input[key]!==undefined).map(key=>[key,ordered(input[key])]));
    return input;
  })(value||{}));
  const post = message => window.webkit?.messageHandlers?.tuotie?.postMessage(message);
  const managedTarget = () => ['blender', 'office', 'focused', 'jianying'].includes(state.target);
  const uncertainResult = () => Boolean(agent.mutationUncertain&&agent.phase!=='running'&&!controlling);
  const showUncertainResult = () => {state.phase='done';state.generated=agent.error||'';state.followupOpen=false;state.collapsed=false;};
  const sceneControl = action => {
    if(action==='cancel'||action==='undo')window.TuotieCompanionState?.cancelRun?.();
    if (controlling) return;
    controlling = true;controlAction=action;
    if(action==='commit')renderTask();
    post({type: 'sceneControl', action});
  };

  TuotieUI.configure({
    manualGeneration: true,
    targetLabels: {document: '系统剪贴板', system: '系统剪贴板', hold: '留在妥帖', blender: 'Blender', office: '目标文档'},
  });
  // Restoring yesterday's package should not open a large panel on launch.
  // A newly captured item in this session does reveal the compact stack.
  state.petCollapsed = true;
  render();

  function remember(ids) {
    for (const id of known) {
      if (!ids.has(id) && sources.some(item => item.id === id && item.clipboard)) {hidden.add(id);post({type:'archiveItems',itemIds:[id]});}
    }
    known = ids;
  }

  TuotieUI.subscribe(message => {
    if (!message || !message.state) return;
    remember(new Set(message.state.sourceIds || []));
    const nextTarget = message.state.targetId === 'document' ? 'system' : message.state.targetId;
    if (nextTarget && nextTarget !== lastTarget) {
      lastTarget = nextTarget;
      if (['blender','system','hold'].includes(nextTarget)) post({type:'targetSelected', destinationId:nextTarget});
    }
    if(message.event==='generationStopped'&&managedTarget()){
      pendingStop=true;
      if(['running','done'].includes(agent.phase))sceneControl('cancel');
      syncPasteComposer();
    }
    if (message.event === 'generationSupplemented' && managedTarget()) {
      const instruction = (message.detail?.parts || []).map(part => part.kind === 'text' ? part.value : part.kind === 'source' ? sources.find(source => source.id === part.id)?.title || '' : targetName(part.id)).join('');
      post({type: 'sceneSupplement', instruction});
      return;
    }
    if (message.event === 'resultKept' && ['blender','office','focused','jianying'].includes(agent.destinationId)) {sceneControl('finish');return;}
    if (message.event !== 'generationRequested') return;
    pendingStop=false;sceneCommitAcknowledged=false;
    const destinationId = !message.state.targetId || message.state.targetId === 'document' ? 'system' : message.state.targetId;
    const sourceIds = (message.detail?.sourceIds || []).filter(id => sources.some(item => item.id === id && item.clipboard));
    const dropEventId = agent.destinationId==='blender' ? agent.pendingDrop?.eventId || '' : armedDrop;
    armedDrop = '';
    window.webkit?.messageHandlers?.tuotie?.postMessage({
      type: 'work',
      destinationId,
      sourceIds,
      bundleIds: (message.state.sourceIds || []).filter(id => sources.some(item => item.id === id && item.clipboard)),
      actionIndex: Number.isInteger(message.detail?.intent) ? message.detail.intent : 0,
      instruction: message.detail?.instruction || '',
      dropEventId,
      continuation: message.detail?.continuation === true,
    });
  });

  document.addEventListener('click', event => {
    if(event.target.closest('[data-copy-input-result]')){ post({type:'copyInputResult'});return; }
    const remove=event.target.closest('[data-remove]');
    if(remove){
      const id=remove.dataset.remove;
      if(id&&sources.some(item=>item.id===id&&item.clipboard)){
        // Removing an active card is an explicit persistence action. Send it
        // directly instead of waiting for a later state-diff to infer intent.
        hidden.add(id);known.delete(id);post({type:'archiveItems',itemIds:[id]});
      }
      return;
    }
    if(event.target.closest('[data-clear-edit-anchor]')){event.preventDefault();post({type:'clearEditAnchor'});return;}
    if (!managedTarget()) return;
    if (event.target.closest('.target-reference, .target-chip, a[href="#targetSlot"]')) {
      event.preventDefault(); post({type: 'focusTarget', destinationId: state.target});
    }
    if (event.target.closest('[data-open-preview]')) post({type: 'openTargetPreview'});
    if (event.target.closest('#taskPanel [data-accept]')) {
      if (agent.phase === 'preview') { event.preventDefault(); event.stopImmediatePropagation(); sceneControl('commit'); }
    }
    if (event.target.closest('#taskPanel [data-undo]')) {
      event.preventDefault(); event.stopImmediatePropagation();
      sceneControl(agent.phase === 'preview' ? 'cancel' : 'undo');
    }
    if (event.target.closest('[data-agent-retry]')) sceneControl('retry');
  }, true);

  function kindFor(type) {
    return contentKind(type);
  }

  function labelFor(type) {
    return contentLabel(type);
  }

  function detailFor(item) {
    const body = item.body || {};
    if (typeof body.text === 'string' && body.text.trim()) return body.text.trim();
    const source = item.source || {};
    const bits = [source.title, source.url].filter(value => typeof value === 'string' && value);
    if (typeof body.resourceUrl === 'string' && body.resourceUrl) bits.push(body.resourceUrl);
    return bits.join(' · ') || item.type;
  }

  function toSource(item) {
    const source = item.source || {};
    const pageURL = typeof source.url === 'string' && /^(https?:\/\/|file:\/\/)/i.test(source.url) ? source.url : '';
    const bundle = typeof source.bundleId === 'string' && /^[a-z\d]+(?:[.][a-z\d_-]+)+$/i.test(source.bundleId) ? source.bundleId : '';
    const appLink = !pageURL && bundle ? `tuotie-app://open?bundleId=${encodeURIComponent(bundle)}` : '';
    const text = typeof item.body?.text === 'string' ? item.body.text.trim() : '';
    const title = (typeof source.title === 'string' && source.title.trim()) || text.slice(0, 32) || labelFor(item.type);
    const origin = appLink ? `${source.appName || '来源应用'} · 前往应用` : (typeof source.title === 'string' && source.title.trim()) || pageURL || '来源未提供';
    const next = {
      id: item.id,
      kind: kindFor(item.type),
      title: String(title).slice(0, 80),
      type: labelFor(item.type),
      origin: String(origin).slice(0, 80),
      sourceKind: pageURL ? (pageURL.startsWith('file:') ? 'file' : 'web') : 'app',
      url: pageURL || appLink,
      detail: detailFor(item),
      appName: typeof source.appName==='string' ? source.appName : '',
      appIcon: typeof source.appIcon==='string' ? source.appIcon : '',
      tableRows: Array.isArray(item.body?.rows) ? item.body.rows : undefined,
      preview: typeof item.preview === 'string' ? item.preview : '',
      clipboard: true,
      openType: item.type,
    };
    if (!next.preview) {
      const previous = sources.find(entry => entry.id === item.id);
      if (previous?.preview) next.preview = previous.preview;
    }
    return next;
  }

  function setFocus(name,context={}) {
    const label = typeof name === 'string' ? name.trim() : '';
    document.getElementById('focusApp')?.remove();
    if (label === focusedName&&focusKey(context)===focusKey(focusContext)) return;
    focusedName = label;focusContext=context;
    if(state.phase==='direction')renderIntent();
    const footer=document.getElementById('targetFooter');
    if(footer){footer.hidden=!label&&!state.target;footer.innerHTML=targetFooterBody(state.target);}
  }

  let blenderComposerEvent='';
  function syncDrop() {
    const drop=agent.pendingDrop;
    if(agent.destinationId!=='blender'||!drop?.eventId||state.phase==='generating'||window.TuotiePackDrag?.active())return;
    if(window.TuotieOfficePaste.open&&window.TuotieOfficePaste.host==='blender'){
      if(blenderComposerEvent!==drop.eventId){state.drafts.intent=[];clearEditor(document.getElementById('intentInput'));}
      blenderComposerEvent=drop.eventId;syncPasteComposer();return;
    }
    blenderComposerEvent=drop.eventId;
    const bounds=document.getElementById('dockBot').getBoundingClientRect();
    openOfficePaste({x:bounds.left+64,y:bounds.top,exact:true},'blender');
  }

  function installPackDrag() {
    const bundle = document.querySelector('#bundle');
    if (!bundle || bundle.dataset.packDrag === 'yes') return;
    bundle.dataset.packDrag = 'yes';
    // Native mouse-down/drag events own the drag threshold. A WebKit message
    // sent after pointermove can arrive after mouse-up on a fast drag.
    bundle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest('button,a,input,textarea')) return;
      // Keep the component catalog's "move the whole dock" handler from
      // capturing a package drag before AppKit takes over.
      event.stopPropagation();
    }, true);
    bundle.addEventListener('dragstart', event => event.preventDefault(), true);
  }

  let officeHost,officeClosing=false,officeDockStyle='';
  const officeOriginalParents=new Map();
  window.TuotieOfficePaste={open:false,host:''};
  function restoreOfficePanels(collect=false){
    window.TuotieOfficePaste.open=false;window.TuotieOfficePaste.host='';officeClosing=false;
    const dock=document.getElementById('dock');
    for(const [node,parent] of officeOriginalParents)parent.append(node);
    dock.setAttribute('style',officeDockStyle);
    if(officeHost)officeHost.hidden=true;
    if(collect){
      state.phase='collect';state.collapsed=false;state.petCollapsed=false;
      state.activeItems=[];state.runItems=[];state.generated='';state.followupOpen=false;state.history=[];state.atTarget=false;
      window.TuotieCollection?.setExpanded(true);
    }
    render();
  }
  function setPasteFolded(folded){
    officeHost.classList.toggle('folded', folded);
    const bot=document.getElementById('dockBot');
    bot.setAttribute('aria-expanded',String(!folded));
    if(folded)bot.focus({preventScroll:true});
    else {
      const focusSelector=state.phase==='done'?'#followupInput':state.phase==='generating'?'[data-stop]':'#intentInput';
      officeHost.querySelector(focusSelector)?.focus({preventScroll:true});
    }
  }
  function matchesPasteHost(){
    return window.TuotieOfficePaste.host==='blender'?agent.destinationId==='blender':agent.targetKind===window.TuotieOfficePaste.host+'-live';
  }
  function resumeOfficePaste(){
    if(!window.TuotieOfficePaste.open){
      const host=agent.destinationId==='blender'&&(agent.pendingDrop||['running','preview','done'].includes(agent.phase))?'blender':String(agent.targetKind||'').replace(/-live$/,'');
      if(!['blender','input','word','excel','powerpoint','illustrator','figma'].includes(host)||
         !['planning','ready','running','preview','done','error'].includes(agent.phase))return false;
      const bounds=document.getElementById('dockBot').getBoundingClientRect();
      openOfficePaste({x:bounds.left+64,y:bounds.top,exact:false},host,true);
      return true;
    }
    if(!matchesPasteHost()){
      restoreOfficePanels(true);
      return false;
    }
    setPasteFolded(false);
    return true;
  }
  function closeOfficePaste(){
    if(!window.TuotieOfficePaste.open||controlling)return;
    if(window.TuotieOfficePaste.host==='blender'&&agent.pendingDrop){post({type:'dismissDrop',eventId:agent.pendingDrop.eventId});}
    if(['running','planning','preview'].includes(agent.phase)){officeClosing=true;sceneControl('cancel');}
    else sceneControl('finish');
  }
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape' || !window.TuotieOfficePaste.open || event.isComposing)return;
    if(activeMention || !document.getElementById('detailBackdrop').hidden)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setPasteFolded(true);
  },true);
  function openOfficePaste(point,host='word',restoring=false){
    if(window.TuotieOfficePaste.open&&resumeOfficePaste())return;
    if(!restoring){state.drafts.followup=[];clearEditor(document.getElementById('followupInput'));}
    const dock=document.getElementById('dock');
    if(!officeHost){
      officeHost=document.createElement('section');officeHost.id='officePastePanel';officeHost.setAttribute('role','dialog');document.body.append(officeHost);
      officeOriginalParents.set(dock,dock.parentNode);
      const note=document.createElement('p');note.className='office-placement-note';note.id='officePlacementNote';officeHost.append(note);
    }
    if(!window.TuotieOfficePaste.open)officeDockStyle=dock.getAttribute('style')||'';
    officeHost.classList.remove('folded');
    officeHost.insertBefore(dock,officeHost.firstChild);
    window.TuotieOfficePaste.open=true;window.TuotieOfficePaste.host=host;officeHost.hidden=false;
    officeHost.setAttribute('aria-label',host==='blender'?'在 Blender 目标位置生成':host==='input'?'在当前输入框使用妥帖':host==='figma'?'在 Figma 画框生成':host==='illustrator'?'在 Illustrator 画板生成':host==='powerpoint'?'编辑 PowerPoint 选中对象':host==='excel'?'编辑 Excel 选区':'在 Word 光标处插入');
    officeHost.style.left=`${Math.max(12,Math.min(point.x-64,innerWidth-416))}px`;
    officeHost.style.top=`${Math.max(12,Math.min(point.y,innerHeight-300))}px`;
    officeHost.querySelector('.office-placement-note').textContent=host==='blender'?'生成独立预览，检查后再应用。':host==='input'?(agent.inputDelivery==='clipboard'?'此控件没有提供可定位的光标。生成后请在原输入框按 ⌘V。':agent.anchor?.role==='keyboard-input'?'此输入框使用选区回读，仅支持短单行草稿。保持原聊天和光标，由你发送。':'只修改这段草稿，由你发送。'):point.exact?'':`面板跟随点击位置，操作仍作用于${host==='figma'?'刚才选中的画框':host==='illustrator'?'刚才激活的画板':host==='excel'?'刚才保存的 Excel 选区':host==='powerpoint'?'刚才选中的 PowerPoint 图片':'刚才保存的 Word 光标位置'}`;
    state.target=host==='blender'?'blender':host==='input'?'focused':'office';
    const ownsResult=['running','preview','done'].includes(agent.phase)||agent.canUndo||agent.mutationUncertain;
    const ids=ownsResult?(Array.isArray(agent.executionSourceIds)?agent.executionSourceIds:state.runItems):
      (Array.isArray(agent.plannedSourceIds)?agent.plannedSourceIds:state.items);
    state.petCollapsed=false;state.collapsed=false;state.activeItems=restoring?[...ids]:[...state.items];
    if(restoring)state.runItems=[...state.activeItems];
    state.phase=restoring&&agent.phase==='running'?'generating':restoring&&(['preview','done'].includes(agent.phase)||agent.mutationUncertain)?'done':'direction';
    if(restoring&&state.phase==='done'){state.generated=agent.result||'';state.runItems=[...state.activeItems];state.followupOpen=true;}
    window.TuotieCollection?.setExpanded(true);render();
    document.getElementById(state.phase==='done'?'followupInput':'intentInput')?.focus({preventScroll:true});
  }

  window.TuotieDesktopLive = {
    setFocus,
    openBlenderPaste() {syncDrop();},
    openOfficePaste,
    closeOfficePaste,
    resumeOfficePaste,
    togglePasteFold(){setPasteFolded(!officeHost.classList.contains('folded'));},
    pasteTargetLabel:()=>window.TuotieOfficePaste.host==='blender'?`Blender · ${agent.targetLocation||agent.pendingDrop?.summary||'已固定的位置'}`:agent.recommendationOnly?'当前页推荐 · 暂不执行修改':!matchesPasteHost()?'位置已断开，请在目标位置重新按 ⌥⌘V':agent.targetKind==='word-live'?`插入到：${agent.targetLocation||'已保存的 Word 位置'}`:`目标：${agent.targetName||'已保存的位置'}`,
    pasteTargetDetail:()=>`${agent.targetName||'当前任务'} · 点击其他位置或切换软件不会更改本次目标。换位置请先结束任务，再按 ⌥⌘V。`,
    openWordPaste:point=>openOfficePaste(point,'word'),
    isOfficeFocus:()=>['com.microsoft.Word','com.microsoft.Excel','com.microsoft.Powerpoint','com.adobe.illustrator','com.figma.Desktop'].includes(focusContext.bundleId)||['input-live','word-live','excel-live','powerpoint-live','illustrator-live','figma-live'].includes(agent.targetKind),
    showContent() {if(resumeOfficePaste())return;state.petCollapsed=false;state.collapsed=false;render();},
    toggleContent() {document.getElementById('dockBot')?.click();},
    stopCurrent() {if(state.phase==='generating')TuotieUI.dispatch({type:'generation/stop'});else if(agent.phase==='running')sceneControl('cancel');},
    undoRecent() {if(agent.canUndo&&!['planning','running','preview'].includes(agent.phase))sceneControl('undo');},
    showArchive(items) {
      detailReturnFocus=document.activeElement;
      document.getElementById('detailTitle').textContent='已归档的内容';
      const entries=Array.isArray(items)?items.filter(item=>item.archivedAt):[];
      document.getElementById('detailContent').innerHTML=entries.length ? `<div class="archive-list">${entries.map(item=>{
        const source=toSource(item);
        const preview=source.kind==='image'?bundlePreview(source).replace('aria-hidden="true"','').replace('alt=""',`alt="${escapeHtml(source.title)}"`):bundlePreview(source);
        return `<article class="archive-item bundle-card demo-bundle-card">${preview}<div class="bundle-card-copy">${contentTitle(source)}${sourceMeta(source)}<p>${escapeHtml(source.detail.slice(0,140))}</p><small>${escapeHtml(new Date(item.archivedAt).toLocaleString())}</small></div></article>`;
      }).join('')}</div>` : '<p class="bundle-empty">还没有完成的任务。成功应用后，内容会归档到这里。</p>';
      document.getElementById('detailSource').textContent='仅保存在本机 · 最近 200 条采集记录';
      document.getElementById('detailBackdrop').hidden=false;
      document.getElementById('closeDetail').focus();
    },
    focusLabel: () => focusedName,
    focusMarkup: () => `${agent.anchor?`<span class="target-tag edit-anchor" title="${escapeHtml(agent.anchor.windowTitle||agent.anchor.appName)}"><span class="target-tag-link">${icon('scan')}<span class="target-tag-name">修改这里 · ${escapeHtml(agent.anchor.windowTitle||agent.anchor.appName)}</span></span><button type="button" class="target-remove" data-clear-edit-anchor aria-label="取消标记位置">${icon('x')}</button></span>`:''}${focusedName?`<span class="target-tag focus-location" role="status" aria-label="当前聚焦位置：${escapeHtml(focusedName)}" title="当前聚焦：${escapeHtml(focusedName)}"><span class="target-tag-link">${icon('scan')}<span class="target-tag-name">${escapeHtml(focusedName)}</span><span class="focus-state">正在聚焦</span></span></span>`:''}`,
    applying:()=>controlling&&controlAction==='commit',
    isBlender:()=>agent.destinationId==='blender',
    canAdjust: () => !controlling&&!agent.mutationUncertain&&(['input-live','word-live','excel-live','powerpoint-live','illustrator-live','figma-live'].includes(agent.targetKind)?agent.phase==='done':managedTarget() || !agent.taskArchived),
    canUndo:()=>agent.canUndo!==false,
    adjustmentProfile:()=>agent.adjustmentProfile||(['illustrator-live','figma-live'].includes(agent.targetKind)?'vector':agent.targetKind==='powerpoint-live'?'image':['excel-live','spreadsheet'].includes(agent.targetKind)?'table':agent.destinationId==='blender'?'scene':'text'),
    followupRecommendations:()=>{
      const value=agent.followupRecommendations;
      if(!value)return agent.targetKind==='figma-live'&&agent.phase==='done'?{status:'unavailable',options:[]}:undefined;
      return agent.revision!==undefined&&value.revision!==agent.revision?{status:'unavailable',options:[]}:value;
    },
    applyLabel:()=>agent.targetKind==='powerpoint-live'?'替换图片':agent.targetKind==='word-live'?'插入 Word':agent.targetKind==='excel-live'?'写入 Excel':agent.targetKind==='focused-text'?'复制':'应用',
    resultSummary: () => agent.result || state.generated,
    isScene: () => state.target === 'blender',
    processingHint: elapsed => managedTarget() ? `${agent.step || '正在处理'} · ${elapsed} 秒` : '',
    resultPhase: () => managedTarget() ? agent.phase : '',
    resultUncertain: uncertainResult,
    resultError: () => managedTarget()&&Boolean(agent.error),
    resultTitle: () => agent.targetKind==='input-live'&&!uncertainResult()?(agent.inputDelivery==='clipboard'?'草稿已复制，在原输入框按 ⌘V':`可继续修改 · ${agent.targetName} 草稿`):uncertainResult() ? '修改结果待确认。' : agent.targetKind==='figma-live' ? '已加入 Figma 目标画框。' : agent.targetKind==='illustrator-live' ? '已加入 Illustrator 目标画板。' : agent.targetKind==='powerpoint-live' ? '已修改 PowerPoint 选中对象。' : agent.targetKind==='word-live' ? `可继续调整 · ${agent.targetLocation || '本次 Word 插入片段'}` : agent.targetKind==='excel-live' ? '已写入 Excel 选区。' : agent.targetKind==='jianying' ? '已保存为剪映新草稿。' : agent.targetKind==='focused-text' ? `已复制，去 ${agent.targetName} 粘贴吧。` : state.target === 'blender' ? '已应用到 Blender' : `已应用到${({document:'文档',spreadsheet:'表格',presentation:'幻灯片'})[agent.targetKind] || '目标'}`,
    resultMarkup() {
      if (!managedTarget()) return '';
      if(agent.targetKind==='input-live'&&agent.error&&agent.previewText)return `<p role="alert">${escapeHtml(agent.error)} <button type="button" data-copy-input-result>复制生成文字</button></p>`;
      if(agent.targetKind==='input-live'&&agent.phase==='done'&&agent.previewText)return `<p class="scene-changes"><button type="button" data-copy-input-result>复制生成文字</button></p>${agent.inputDelivery==='clipboard'?`<details class="result-details"><summary>查看生成文字</summary><p>${escapeHtml(agent.previewText)}</p></details>`:''}`;
      if(uncertainResult())return `<p class="scene-changes" role="alert">${escapeHtml(agent.error||'请先检查目标文稿，再建立新任务。')}</p>`;
      if(['input-live','word-live','excel-live','powerpoint-live','illustrator-live','figma-live'].includes(agent.targetKind))return agent.phase==='done'&&agent.error?`<p class="scene-changes" role="status">${escapeHtml(agent.error)} · 已保留上一版</p>`:'';
      if(['jianying','focused-text'].includes(agent.targetKind))return agent.previewText?`<div class="office-result completion-header completion-reply demo-glass"><p>${escapeHtml(agent.previewText)}</p></div>`:'';
      const summary=agent.result||'';
      const detail=summary.trim().split(/(?<=[。！？\n])/).length>1||summary.length>100 ? `<details class="result-details"><summary>查看处理详情</summary><p>${escapeHtml(summary)}</p></details>` : '';
      if (state.target === 'office') return `${agent.phase==='preview'?'<div class="office-result completion-header completion-reply demo-glass"><div class="task-actions"><button type="button" class="secondary" data-open-preview>打开预览</button></div></div>':''}${detail}`;
      const changes = agent.changes || {};
      const parts = [['新增', changes.added], ['修改', changes.modified], ['移除', changes.removed], ['场景设置', changes.scene]]
        .filter(([, list]) => list?.length).map(([label, list]) => `${label} ${list.length} 项`);
      return `<p class="scene-changes">${escapeHtml(parts.join(' · ') || agent.step || '')}</p>${detail}`;
    },
    controlFinished(action) {
      controlling = false;controlAction='';pendingStop=false;
      if(action==='commit'&&agent.destinationId==='blender'){
        sceneCommitAcknowledged=true;agent={...agent,phase:'done',canUndo:true};
        state.phase='done';state.generated=agent.result||state.generated;state.followupOpen=true;
      }
      if(['undo','cancel','finish'].includes(action))sceneCommitAcknowledged=false;
      if(action==='finish'&&window.TuotieOfficePaste.open){
        clearEditor(document.getElementById('intentInput'));clearEditor(document.getElementById('followupInput'));
        state.drafts.intent=[];state.drafts.followup=[];state.drafts.task=[];restoreOfficePanels(true);return;
      }
      if(action==='undo'&&window.TuotieOfficePaste.open){
        if(agent.phase==='done'&&agent.revision>0){state.phase='done';state.generated=agent.result||'';state.followupOpen=true;state.collapsed=false;render();showToast(`已回到第 ${agent.revision} 版`);}
        else{restoreOfficePanels(true);showToast('已撤回本次修改');}return;
      }
      if(action==='cancel'&&officeClosing){sceneControl('finish');return;}
      if(action==='cancel'&&window.TuotieOfficePaste.open){
        if(agent.phase==='done'){state.phase='done';state.generated=agent.result||state.generated;state.followupOpen=true;state.collapsed=false;render();}
        else restoreOfficePanels(true);
        return;
      }
      if(action==='commit'&&agent.targetKind==='powerpoint-live')post({type:'focusTarget',destinationId:'office'});
      if (action === 'cancel' || action === 'undo') {
        if(action==='undo'&&(agent.taskArchived||!state.items.length)){
          state.phase='collect';state.generated='';state.history=[];state.runItems=[];state.activeItems=[];state.collapsed=state.items.length===0;render();
        }else if (state.phase === 'done') TuotieUI.dispatch({type: 'result/undo'});
        else if (state.phase === 'generating') TuotieUI.dispatch({type: 'generation/stop'});
        showToast(action === 'undo' ? '已撤回本次修改' : '已取消，原稿保留');
      }
      if (action === 'commit') { state.petCollapsed=false; state.followupOpen=window.TuotieOfficePaste.host==='blender'; render(); showToast(agent.targetKind==='focused-text'?'已复制，可去目标位置粘贴':agent.targetKind==='jianying'?'复刻草稿已生成，可在剪映打开':'已应用，可撤销或继续调整'); }
      if (action === 'retry') render();
    },
    controlFailed(message) {
      controlling=false;controlAction='';
      renderTask();
      if(pendingStop&&agent.phase==='running'&&window.TuotieOfficePaste.open){state.phase='generating';state.collapsed=true;render();}
      pendingStop=false;
      if(uncertainResult()&&window.TuotieOfficePaste.open){showUncertainResult();render();}
      else syncPasteComposer();
      showToast(message);
    },
    hasInputRecovery:()=>agent.targetKind==='input-live'&&Boolean(agent.error&&agent.previewText),
    defaultRecommendation(){return agent.destinationId==='blender'&&agent.pendingDrop?(['ready','done'].includes(agent.phase)&&!agent.needsClarification?agent.title||'':''):this.directionTexts()[0]||'';},
    collectionCandidates() {
      if(agent.phase!=='ready'||agent.pendingDrop||agent.needsClarification||agent.questions?.length||!managedTarget())return [];
      return this.directionTexts().slice(0,2);
    },
    collectionNotice:()=>agent.destinationId==='disabled'?(agent.unavailableReason||'此应用接入暂未启用，内容包已保留。'):'',
    canSendPaste(custom){
      const available=['ready','error'].includes(agent.phase) || custom && agent.phase==='planning';
      return !agent.recommendationOnly && matchesPasteHost() && state.phase==='direction' && available && !pendingStop && !agent.mutationUncertain && (state.items.length>0 || custom && agent.targetKind==='input-live');
    },
    directionTexts() {
      if(agent.destinationId==='disabled')return [];
      if(!state.items.length)return [];
      if(!agent.anchor&&focusContext.bundleId&&state.target==='blender'&&focusContext.bundleId!=='org.blenderfoundation.blender')return [];
      if(!agent.anchor&&focusContext.bundleId&&agent.focus&&focusKey(agent.focus)!==focusKey(focusContext))return [];
      if(Array.isArray(agent.plannedSourceIds)&&[...state.items].sort().join(',')!==[...agent.plannedSourceIds].sort().join(','))return [];
      if (state.target === 'hold') return ['保留这份内容包'];
      if (state.target && !managedTarget()) return ['复制到系统剪贴板'];
      if (agent.destinationId && agent.destinationId !== state.target) return [];
      if (['error', 'planning'].includes(agent.phase)) return [];
      return Array.isArray(agent.actions) ? agent.actions.filter(text => typeof text === 'string' && text.trim()) : [];
    },
    retryMarkup: () => managedTarget() && agent.phase === 'error' && !agent.mutationUncertain ? '<button type="button" class="secondary" data-agent-retry>重新理解</button>' : '',
    directionHint() {
      if(agent.destinationId==='disabled')return agent.unavailableReason||'此应用接入暂未启用，内容包已保留。';
      if(agent.destinationId==='blender')return agent.error|| (agent.questions||[]).join(' ') || (agent.phase==='planning'?'大模型正在生成推荐，你也可以直接输入要求…':'输入要求，或使用默认推荐…');
      if(agent.initialRecommendation)return agent.phase==='planning'?'正在理解资料…':'请输入你的要求';
      if(agent.targetKind==='input-live')return agent.error || (!state.items.length?'输入写作或改写要求…':'输入要求，或使用默认推荐…');
      if(['illustrator-live','figma-live'].includes(agent.targetKind)&&agent.phase==='error')return agent.error;
      if(['illustrator-live','figma-live'].includes(agent.targetKind)&&agent.phase==='planning')return '正在结合参考照片、已有作品和目标位置生成默认推荐…';
      if(agent.targetKind==='powerpoint-live'&&agent.phase==='error')return agent.error;
      if(agent.targetKind==='powerpoint-live'&&agent.phase==='planning')return '正在结合整份演示文稿、选中图片和内容包生成默认推荐…';
      if(agent.targetKind==='word-live'&&agent.phase==='error')return agent.error;
      if(agent.targetKind==='word-live'&&agent.phase==='planning')return '正在结合插入位置、全文和内容包生成默认推荐…';
      if(agent.targetKind==='excel-live'&&agent.phase==='error')return agent.error;
      if(agent.targetKind==='excel-live'&&agent.phase==='planning')return '正在结合选区、完整工作簿和内容包生成默认推荐…';
      if(agent.anchor)return `参考将用于 ${agent.anchor.windowTitle||agent.anchor.appName} 中标记的位置`;
      if(focusedName&&focusContext.bundleId&&state.target==='blender'&&focusContext.bundleId!=='org.blenderfoundation.blender')return '大模型正在理解资料与目标位置…';
      if (agent.phase === 'error' && agent.error) return agent.error;
      if (agent.phase === 'ready' && !agent.actions?.length) return (agent.questions || []).join(' ') || agent.summary;
      return '大模型正在理解资料与目标位置…';
    },
    apply(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.items)) return;
      const initialSnapshot = !receivedSnapshot;
      let backendRestarted=false;
      receivedSnapshot = true;
      if (snapshot.agent && typeof snapshot.agent === 'object') {
        const previousAgent=agent;
        const restarted=agent.runtimeSessionId&&snapshot.agent.runtimeSessionId&&agent.runtimeSessionId!==snapshot.agent.runtimeSessionId;
        if(restarted){
          backendRestarted=true;
          controlling=false;controlAction='';sceneCommitAcknowledged=false;pendingStop=false;officeClosing=false;
          if(window.TuotieOfficePaste.open)restoreOfficePanels(true);
          state.phase='collect';state.generated='';state.followupOpen=false;state.runItems=[];state.activeItems=[];
          state.drafts.followup=[];state.drafts.task=[];
          clearEditor(document.getElementById('followupInput'));
          showToast('服务已重连。请先检查原稿，再选择位置；旧任务的撤销记录已结束。');
        }
        agent = sceneCommitAcknowledged&&snapshot.agent.destinationId==='blender'&&snapshot.agent.phase==='preview'
          ?{...snapshot.agent,phase:'done',canUndo:true}:snapshot.agent;
        // Re-focus only a result produced during this UI session. Restoring a
        // snapshot, polling or reconnecting must never replay this transition.
        if(receivedAgent&&!restarted&&agent.destinationId==='blender'&&previousAgent.destinationId==='blender'&&
          ((previousAgent.phase==='running'&&['preview','done'].includes(agent.phase))||
           (previousAgent.phase==='preview'&&agent.phase==='done'))&&!agent.error) {
          post({type:'focusTarget',destinationId:'blender'});
        }
        receivedAgent=true;
        if(window.TuotieOfficePaste.open&&!matchesPasteHost()){
          state.drafts.intent=[];state.drafts.task=[];
          restoreOfficePanels(true);
        }
        if(['preview','done'].includes(agent.phase)&&!agent.error&&state.phase==='generating'){state.drafts.followup=[];state.drafts.task=[];}
        // A stop may precede the first running snapshot. Keep it pending until
        // the host has accepted work, so a fast click cannot leave a hidden write.
        if(pendingStop&&['running','done'].includes(agent.phase))sceneControl('cancel');
        if(pendingStop&&agent.phase==='error'){pendingStop=false;if(window.TuotieOfficePaste.open&&!agent.mutationUncertain)restoreOfficePanels(true);}
        if(uncertainResult()&&window.TuotieOfficePaste.open)showUncertainResult();
        if (agent.notice?.id && agent.notice.id !== lastNotice) { lastNotice = agent.notice.id; showToast(agent.notice.text); }
      }
      if(initialSnapshot||backendRestarted)window.TuotieCompanionState?.hydrateItems?.(snapshot.items.map(item=>item.id));
      const nextAgentKey = JSON.stringify([agent.phase, agent.error, agent.actions, agent.questions, agent.needsClarification, agent.pendingDrop?.eventId, agent.step, agent.destinationId, agent.targetName,agent.focus,agent.plannedSourceIds,agent.anchor,agent.targetLocation,agent.adjustmentProfile,agent.revision,agent.mutationUncertain,agent.result,agent.unavailableReason,agent.executionSourceIds,agent.followupRecommendations,agent.initialRecommendation,agent.recommendationOnly,agent.inputDelivery,agent.previewText]);
      const agentChanged = nextAgentKey !== agentKey;
      agentKey = nextAgentKey;
      if(agentChanged)window.TuotieCompanionState?.refresh?.();
      if (state.phase === 'generating' && agent.step) {
        const input = document.querySelector('#taskInput');
        if (input) input.dataset.placeholder = agent.step;
      }
      if (agentChanged && state.phase === 'done' && managedTarget()) renderTask();
      if (!state.items.length) promptedTarget = false;
      const labels = {document: '系统剪贴板'};
      for (const destination of snapshot.destinations || []) {
        if (destination?.id && destination?.name) labels[destination.id] = destination.name;
      }
      if (agent.destinationId === 'focused') labels.focused = agent.targetName || focusedName;
      if (agent.destinationId === 'disabled') labels.disabled = agent.targetName || focusedName;
      if (agent.destinationId === 'jianying') labels.jianying = '剪映';
      if (agent.destinationId === 'office') labels.office = agent.targetName || '目标文档';
      const nextKey = JSON.stringify(labels);
      if (nextKey !== labelKey) {
        labelKey = nextKey;
        TuotieUI.configure({manualGeneration: true, targetLabels: labels});
      }
      document.getElementById('tuotieLink')?.remove();
      let added = 0;
      let changed = false;
      const incomingIds=new Set(snapshot.items.map(item=>item.id));
      const removed=state.items.filter(id=>sources.some(source=>source.id===id&&source.clipboard)&&!incomingIds.has(id));
      if(removed.length){
        const gone=new Set(removed);state.items=state.items.filter(id=>!gone.has(id));
        for(const id of gone)state.selected.delete(id);
        if(!state.items.length&&state.phase==='direction'&&window.TuotieOfficePaste.host!=='input'){state.phase='collect';state.collapsed=true;state.activeItems=[];}
        changed=true;
      }
      for (const item of snapshot.items) {
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id)) continue;
        const source = toSource(item);
        const index = sources.findIndex(entry => entry.id === source.id);
        if (index >= 0) {
          const before = sources[index].preview || '';
          sources[index] = {...sources[index], ...source, preview: source.preview || sources[index].preview};
          if (!before && sources[index].preview) changed = true;
        } else sources.push(source);
        if (hidden.has(source.id) || state.items.includes(source.id)) continue;
        if (['generating', 'done'].includes(state.phase)) continue;
        state.items.push(source.id);
        added += 1;
      }
      if (added && !initialSnapshot) { state.petCollapsed = false; state.collapsed = false; }
      syncDrop();
      const hasReal = state.items.some(id => sources.some(item => item.id === id && item.clipboard));
      const imageInBundle = state.items.some(id => sources.some(item => item.id === id && item.kind === 'image' && item.clipboard));
      const blenderConnected = Boolean((snapshot.destinations || []).some(item => item && item.id === 'blender' && item.connected));
      if(backendRestarted){state.target=agent.destinationId||null;promptedTarget=true;render();return;}
      if((hasReal||agent.targetKind==='input-live')&&['focused','disabled','blender','office'].includes(agent.destinationId)&&state.target!==agent.destinationId&&!['generating','done'].includes(state.phase)){if(state.target)clearTarget();promptedTarget=true;setTarget(agent.destinationId);return;}
      if (!promptedTarget && hasReal && ['blender','office','system','hold','focused','jianying'].includes(agent.destinationId) && !['generating','done'].includes(state.phase)) {
        // Restore the chosen target before a slow connection can trigger clipboard fallback.
        promptedTarget = true;
        offeredBlender = agent.destinationId === 'blender';
        if (state.target && state.target !== agent.destinationId) clearTarget();
        if (state.target !== agent.destinationId) { setTarget(agent.destinationId); return; }
      }
      if (agent.destinationId === 'blender' && agent.pendingDrop && state.target !== 'blender' && !['generating','done'].includes(state.phase)) {
        if (state.target) clearTarget();
        promptedTarget = true; setTarget('blender'); return;
      }
      if (agent.destinationId === 'office' && hasReal && state.target !== 'office' && !['generating', 'done'].includes(state.phase)) {
        if (state.target) clearTarget();
        promptedTarget = true; setTarget('office'); return;
      }
      if (!imageInBundle) offeredBlender = false;
      if (!offeredBlender && blenderConnected && imageInBundle && (!agent.destinationId || agent.destinationId === 'blender') && !['generating', 'done'].includes(state.phase)) {
        offeredBlender = true;
        promptedTarget = true;
        if (state.target && state.target !== 'blender') clearTarget();
        if (state.target !== 'blender') {
          if (added) showToast(added === 1 ? '已保存到妥帖' : `已保存 ${added} 项到妥帖`);
          setTarget('blender');
          return;
        }
      }
      if (!promptedTarget && hasReal && !focusContext.bundleId && !state.target && state.phase === 'collect') {
        promptedTarget = true;
        setTarget('document');
        showToast('已保存。选一个方向，就会贴到系统剪贴板');
        return;
      }
      if (agentChanged && state.phase === 'direction') {
        render();
        return;
      }
      if (!added && !changed) return;
      if (added) state.collapsed = false;
      state.activeItems = state.selected.size ? [...state.selected] : [...state.items];
      render();
      if (added) showToast(added === 1 ? '已保存到妥帖' : `已保存 ${added} 项到妥帖`);
    },
  };
  installPackDrag();
})();
