// Shared task presentation and a declarative library of supported quick edits.
// Each choice sends one ordinary continuation through the existing target adapter.
const quickAdjustments = Object.freeze({
  text: [
    {label:'更简短', instruction:'将本次生成的文字缩短，保留关键事实和必要限定，不增加新段落。'},
    {label:'展开一点', instruction:'适度展开本次生成的文字，补充解释与衔接；仅使用已有资料，不编造事实。'},
    {label:'与上下文语气一致', instruction:'让本次生成的文字与所在文稿上下文的语气、术语和表达方式一致，保留原意。'},
  ],
  table: [
    {label:'补全空值', instruction:'根据已有资料补全本次选区中的空值，保留其他已有值、公式和选区尺寸；依据不足时保留空值。'},
    {label:'核对公式', instruction:'核对并修正本次选区中的公式，保持选区尺寸与其他已有值；不要改动选区外内容。'},
  ],
  image: [
    {label:'完整显示', instruction:'调整本次替换的图片为完整放入 contain，保留完整画面、当前参考图片和原对象位置。'},
    {label:'裁切填满', instruction:'调整本次替换的图片为裁切填满 cover，保留当前参考图片和原对象位置。'},
  ],
  presentation: [
    {label:'文案更简短',instruction:'缩短本次选中文字框的文案，保留关键事实与原有格式；保留本任务此前图片修改，提供完整新版本。'},
    {label:'与上下文语气一致',instruction:'让本次选中文字与整份演示文稿语气一致，保留事实、原有格式和本任务此前图片修改；提供完整新版本。'},
  ],
  scene: [
    {label:'缩小一点', instruction:'将本次修改的对象适度缩小，保持当前位置与其他对象不变。'},
    {label:'放大一点', instruction:'将本次修改的对象适度放大，保持当前位置与其他对象不变。'},
  ],
  vector: [
    {label:'线条更简洁', instruction:'简化本次生成矢量的路径和细节，保留参考物体的主要特征、当前系列描边与原有作品。'},
    {label:'配色贴近参考', instruction:'调整本次生成矢量的填色和描边色，使其与已有系列作品更一致，保留目标画板和原有作品。'},
  ],
});
function quickAdjustmentOptions(demo = false) {
  const profile = demo ? 'text' : window.TuotieDesktopLive?.adjustmentProfile?.() || 'text';
  const recommendations=!demo&&window.TuotieDesktopLive?.followupRecommendations?.();
  const scenes={text:['document-fragment','message','task-brief'],table:['table-create','table-append'],image:['persona-avatars'],presentation:['persona-avatars'],vector:['vector-character','vector-icon','vector-empty-state']};
  if(recommendations&&profile==='vector'&&recommendations.scene&&!scenes.vector.includes(recommendations.scene))return [];
  if(recommendations&&(!recommendations.scene||scenes[profile]?.includes(recommendations.scene))){
    if(recommendations.status!=='ready')return [];
    return (Array.isArray(recommendations.options)?recommendations.options:[])
      .filter(option=>typeof option?.label==='string'&&typeof option?.instruction==='string')
      .slice(0,3);
  }
  return quickAdjustments[profile] || [];
}
function adjustmentParts(index, demo = false) {
  const option=quickAdjustmentOptions(demo)[index];
  return option ? [{kind:'text',value:option.instruction}] : [];
}
function applyQuickAdjustment(index, demo = false) {
  const parts=adjustmentParts(index,demo);
  if(!parts.length || !demo && state.phase!=='done')return;
  const input=document.getElementById(demo?'demoFollowupInput':'followupInput');
  if(!input)return;
  const existing=editorParts(input);
  const hasDraft=Boolean(editorText(input).trim());
  setEditorParts(input, existing.length?[...existing,{kind:'text',value:'\n'},...parts]:parts);
  if(hasDraft)return;
  if(demo){previewGenerationOrigin='done';selectCatalog('assistant','generating');}
  else submitAdjustment();
}
function adjustmentOptions(demo = false) {
  const options=quickAdjustmentOptions(demo);
  return options.length?`<div class="adjustment-options" role="group" aria-label="快捷调整">${options.map((option,index)=>`<button type="button" class="adjustment-option demo-glass" data-adjust-option="${index}" aria-label="${escapeHtml(option.label)}并重新生成" title="${escapeHtml(option.instruction)}">${escapeHtml(option.label)}</button>`).join('')}</div>`:'';
}
function syncAdjustmentSubmit(editor) {
  const button=editor?.closest('.adjustment-section')?.querySelector('[data-adjust-submit]');
  if(button)button.disabled=!editorText(editor).trim();
}
function adjustmentMarkup(demo = false) {
  return `<section class="adjustment-section" aria-label="继续调整本次结果">${adjustmentOptions(demo)}<div class="composer direction-composer adjustment-composer ${demo?'demo-glass':''}">${mentionEditorMarkup(demo?'demo-followup':'followup',demo?'demoFollowupInput':'followupInput','调整要求，可用 @ 引用素材','输入调整要求，@ 引用内容')}<button type="button" class="icon-button send adjustment-submit" data-adjust-submit="true" aria-label="发送调整要求并重新生成" title="发送调整要求并重新生成" disabled>${icon('arrow-up')}</button></div></section>`;
}
function completionHeader(demo = false) {
  const live=!demo&&window.TuotieDesktopLive, phase=live?.resultPhase?.(), preview=phase==='preview';
  const applying=Boolean(live?.applying?.()),blender=Boolean(live?.isBlender?.());
  const title=live?.resultUncertain?.()?'修改结果待确认':preview?'预览已就绪':phase==='done'?live?.resultTitle?.()||'已完成本次修改':'已完成本次修改';
  const raw=live?.resultSummary?.()||(!demo?state.generated:'')||'结果已准备好，可以继续调整。';
  const sentence=raw.trim().split(/(?<=[。！？\n])/)[0].trim();
  const text=sentence.length>100?sentence.slice(0,99)+'…':sentence;
  const attr=name=>demo?`data-demo-${name}="true"`:`data-${name}="true"`;
  if(!demo&&window.TuotieOfficePaste?.open){
    return `<section class="completion-header paste-completion demo-glass" aria-label="本次处理结果"><h3 role="status">${escapeHtml(title)}</h3>${preview||live?.canUndo?.()!==false?`<button type="button" class="secondary" data-undo="true" ${applying?'disabled':''}>${preview?'取消预览':'撤销'}</button>`:''}<button type="button" class="completion-close" data-accept="true" ${applying?'disabled aria-busy="true"':''} aria-label="${preview?'应用预览':blender?'关闭本次任务面板':'结束本次任务'}" title="${preview?'确认后写入原场景':'保留结果，结束任务'}">${applying?'应用中…':preview?'应用':blender?icon('x'):'结束'}</button></section>`;
  }
  const expanded=demo?catalogSelection.variant==='adjustment':state.followupOpen;
  return `<section class="completion-header completion-reply ${!demo&&window.TuotieOfficePaste?.open?'paste-completion demo-glass':demo?'demo-glass':'glass'}" aria-label="本次处理结果"><div class="completion-heading"><h3>${escapeHtml(title)}</h3>${!preview?`<button type="button" class="completion-close" ${attr('accept')} aria-label="结束本次任务" title="保留结果，结束本次任务">${icon('x')}</button>`:''}</div><p class="completion-message" role="status" aria-live="polite">${escapeHtml(text)}</p><div class="task-actions">${preview||demo||live?.canUndo?.()!==false?`<button type="button" class="secondary" ${attr('undo')}>${preview?'取消预览':'撤销'}</button>`:''}${preview?`<button type="button" class="confirm" ${attr('accept')}>${live?.applyLabel?.()||'应用'}</button>`:''}${demo||live?.canAdjust?.()!==false?`<button type="button" class="${preview?'secondary':'confirm'}" ${demo?'data-demo-followup':'data-followup'}="true" aria-expanded="${expanded}">${expanded?'收起调整':'继续调整'}</button>`:''}</div></section>`;
}
const workComposer = (demo = false) => window.TuotieOfficePaste?.open&&!demo
  ? `<div class="composer direction-composer work-composer paste-processing demo-glass" role="status" aria-live="polite"><span>正在加工中</span><button type="button" class="icon-button work-stop" data-stop="true" aria-label="终止加工" title="终止加工">${icon('square')}</button></div>`
  : `<div class="composer direction-composer work-composer ${demo?'demo-glass':''}">${mentionEditorMarkup(demo?'demo-work':'task',demo?'demoWorkInput':'taskInput','补充生成要求','已处理 0 秒')}<button type="button" class="icon-button send work-send" ${demo?'data-demo-work-send="true"':'data-work-send="true"'} aria-label="发送补充要求" hidden>${icon('arrow-up')}</button><button type="button" class="icon-button work-stop" ${demo?'data-demo-stop="true"':'data-stop="true"'} aria-label="停止生成">${icon('square')}</button></div>`;

// The recommendation remains separate from the editable draft: an empty send
// explicitly resolves to the currently displayed AI recommendation.
function syncPasteComposer() {
  const editor=document.getElementById('intentInput');
  if(!window.TuotieOfficePaste?.open||!editor)return;
  const live=window.TuotieDesktopLive, recommendation=live?.defaultRecommendation?.()||'';
  const target=document.querySelector('[data-paste-target]');
  if(target){target.textContent=live?.pasteTargetLabel?.()||'已固定插入位置';target.title=live?.pasteTargetDetail?.()||'';}
  const edit=document.querySelector('[data-edit-recommendation]');if(edit)edit.hidden=!recommendation||Boolean(editorText(editor).trim());
  const copy=document.querySelector('[data-paste-copy]');if(copy)copy.hidden=!live?.hasInputRecovery?.();
  editor.dataset.placeholder=recommendation||live?.directionHint?.()||'正在理解内容…';
  editor.title=recommendation;editor.setAttribute('aria-description',recommendation?'留空发送此推荐：'+recommendation:'输入自己的要求，或等待默认推荐');
  const send=editor.closest('.composer')?.querySelector('[data-start]');
  const custom=Boolean(editorText(editor).trim());
  editor.dataset.empty=String(!custom);
  if(send){send.disabled=!live?.canSendPaste?.(custom)||!custom&&!recommendation;send.setAttribute('aria-label',custom?'发送自定义要求':'发送默认推荐');}
}
function editDefaultRecommendation() {
  const editor=document.getElementById('intentInput');
  const value=window.TuotieDesktopLive?.defaultRecommendation?.();
  if(!editor||!value||editorText(editor).trim())return;
  setEditorParts(editor,[{kind:'text',value}]);editor.focus({preventScroll:true});syncPasteComposer();
}
function pasteComposerMarkup() {
  return `<div class="composer direction-composer paste-composer">${mentionEditorMarkup('intent','intentInput','AI 粘贴要求','正在理解内容…')}<button type="button" class="icon-button send" data-start="true" aria-label="发送默认推荐" disabled>${icon('arrow-up')}</button></div><div class="paste-target-row"><span data-paste-target role="status"></span><button type="button" data-edit-recommendation hidden>编辑推荐</button><button type="button" data-paste-copy data-copy-input-result hidden>复制生成文字</button><button type="button" data-end-paste aria-label="结束本次任务，重新选择位置" title="结束任务后可重新选择位置">结束</button></div>`;
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-edit-recommendation]'))editDefaultRecommendation();
  if(event.target.closest('[data-end-paste]'))window.TuotieDesktopLive?.closeOfficePaste?.();
});
