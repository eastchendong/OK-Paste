(() => {
  const collectionMetrics = /* @tuotie:collection-metrics */ {};
  const style = document.createElement('style');
  style.textContent = /* @tuotie:desktop-styles */ '';
  document.head.appendChild(style);
  document.body.classList.remove('catalog-mode');
  document.body.classList.add('flow-mode', 'desktop-overlay-mode');
  if (typeof reset === 'function') reset('source-first');

  // Reuse the catalog's classes while retaining the live IDs, event handlers
  // and native glass backing. Shared sources live under ui/components and ui/styles.
  const componentClasses = [
    ['#bundle', ['demo-bundle','demo-glass']],
    ['#bundle .bundle-header', ['demo-bundle-top']],
    ['#bundle .bundle-card', ['demo-bundle-card']],
    ['#targetFooter', ['demo-target-footer']],
    ['#intentPanel', ['demo-intent']],
    ['#intentPanel .direction-option, #intentPanel .direction-status, #intentPanel .direction-composer', ['demo-glass']],
    ['#taskPanel .work-composer, #taskPanel .completion-header, #taskPanel .adjustment-option, #taskPanel .adjustment-composer', ['demo-glass']],
    ['#dropConfirm, #taskPanel .office-result', ['demo-glass']],
  ];
  function syncComponentClasses() {
    for (const [selector, classes] of componentClasses) {
      for (const element of document.querySelectorAll(selector)) {
        for (const name of classes) if (!element.classList.contains(name)) element.classList.add(name);
      }
    }
    // Tint and native backing share one registry, including dynamically
    // rendered loading, error and completion states.
    for (const element of document.querySelectorAll(materialSelectors.join(','))) {
      if (!element.classList.contains('desktop-native-glass')) element.classList.add('desktop-native-glass');
    }
  }

  const visible = element => {
    if (!element) return false;
    let opacity = 1;
    for (let node = element; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      opacity *= css.opacity === '' ? 1 : Number(css.opacity);
      if (node.hidden || css.display === 'none' || css.visibility === 'hidden' || opacity < .04) return false;
    }
    const rect = rectFor(element);
    return rect.width > 0 && rect.height > 0;
  };
  const collectionClips = new WeakMap();
  const collectionClipPaths = new WeakMap();
  let collectionFade = 0;
  let positionCollectionHover = () => {};
  /* @tuotie:collection-hover */
  function syncCollectionFade() {
    const body = document.querySelector('#bundleBody');
    if (!body) return;
    const remaining = Math.max(0,body.scrollHeight-body.clientHeight-body.scrollTop);
    const fade = body.closest('.collection-list') ? Math.min(collectionMetrics.scrollFade,remaining,body.clientHeight/3) : 0;
    const value = fade.toFixed(3)+'px';
    if(body.style.getPropertyValue('--collection-bottom-fade')!==value)body.style.setProperty('--collection-bottom-fade',value);
    body.classList.toggle('collection-scroll-fade',fade>.1);
    collectionFade=fade;
  }
  function syncCollectionOcclusion() {
    const cards=[...document.querySelectorAll('#dock.collection-mode #bundleBody > .bundle-card')];
    let previousBottom=-Infinity;
    for(const card of cards) {
      const rect=card.getBoundingClientRect();
      if(!rect.height)continue;
      const overlap=Math.max(0,Math.min(rect.height,previousBottom-rect.top));
      const clip=overlap>.1?`inset(${overlap.toFixed(3)}px 0px 0px 0px)`:'none';
      if(collectionClipPaths.get(card)!==clip) {card.style.clipPath=clip;collectionClipPaths.set(card,clip);}
      collectionClips.set(card,overlap);
      previousBottom=Math.max(previousBottom,rect.bottom);
    }
  }
  const rectFor = element => {
    const bounds = element.getBoundingClientRect();
    const inset = collectionClips.get(element)||0;
    const rect = {left:bounds.left,right:bounds.right,top:bounds.top+inset,bottom:bounds.bottom,width:bounds.width,height:Math.max(0,bounds.height-inset)};
    const scrollBody = element.closest('#bundle.collection-list #bundleBody, #taskPanel');
    if(scrollBody && scrollBody !== element && scrollBody.clientHeight>0) {
      const clip = scrollBody.getBoundingClientRect();
      const x = Math.max(rect.left,clip.left), y = Math.max(rect.top,clip.top);
      return {x,y,width:Math.max(0,Math.min(rect.right,clip.right)-x),height:Math.max(0,Math.min(rect.bottom,clip.bottom)-y)};
    }
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  const interactiveSelectors = [
    '#officePastePanel', '#dockBot', '#bundle', '#intentPanel', '#taskPanel', '#directionActions',
    '#selectionMenu', '#mentionMenu', '#detailBackdrop', '#dropConfirm', '#collectionHover'
  ];
  const materialSelectors = [
    '#collectionHover',
    '#bundle:not(.collection-stack):not(.collection-list)', '#bundle.collection-stack .bundle-card', '#bundle.collection-list .bundle-card', '#dock.collection-mode #collapseButton', '#emptyBubble', '#selectionMenu', '#mentionMenu', '#detailBackdrop .detail-card',
    '#intentPanel .direction-option', '#intentPanel .direction-status', '#intentPanel .direction-composer',
    '#taskPanel .work-composer', '#taskPanel .completion-header',
    '#taskPanel .adjustment-option', '#taskPanel .adjustment-composer',
    '#taskPanel .office-result',
    '#directionActions', '#dropConfirm', '#toast'
  ];
  // Layout owns the destination. Only the button travels, including its hit area.
  const pet = document.getElementById('dockBot');
  let lastPetLayout, petFlight, flightFrame;
  function syncPetMotion() {
    if (!pet.animate || !window.DOMMatrixReadOnly) return;
    const direct = pet.closest('.is-dragging') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (direct && petFlight) {
      petFlight.cancel();
      petFlight = null;
    }
    const bounds = pet.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const transform = getComputedStyle(pet).transform;
    const offset = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    const layout = {x:bounds.left - offset.m41, y:bounds.top - offset.m42};
    const moved = lastPetLayout && Math.hypot(layout.x-lastPetLayout.x, layout.y-lastPetLayout.y) > 0.5;
    if (moved && !direct) {
      const dx = lastPetLayout.x + offset.m41 - layout.x;
      const dy = lastPetLayout.y + offset.m42 - layout.y;
      petFlight?.cancel();
      petFlight = pet.animate([
        {transform:`translate(${dx}px, ${dy}px)`}, {transform:'none'}
      ], {id:'pet-travel', duration:Math.min(530, 220 + Math.hypot(dx,dy)*0.32), easing:'cubic-bezier(.35,0,.2,1)'});
    }
    lastPetLayout = layout;
    if (petFlight?.playState === 'running' && !flightFrame) {
      flightFrame = requestAnimationFrame(() => {flightFrame = 0; reportGeometry();});
    }
  }
  function reportGeometry() {
    syncPetMotion();
    positionCollectionHover();
    syncCollectionFade();
    syncCollectionOcclusion();
    syncComponentClasses();
    // The moving companion is temporarily non-interactive in both WebKit and
    // AppKit; it must not swallow clicks intended for the destination app.
    const regions = window.TuotiePackDrag?.active() ? [] : interactiveSelectors.flatMap(selector =>
      [...document.querySelectorAll(selector)].filter(visible).map(rectFor));
    // A result can match both completion-header and office-result. One DOM
    // surface must receive exactly one native backdrop.
    const surfaces = [...document.querySelectorAll(materialSelectors.join(','))]
      .filter(visible).map(element => {
        const rect = rectFor(element);
        const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        const bounds=element.getBoundingClientRect();
        const scrollBody=element.closest('#bundle.collection-list #bundleBody');
        const edge=scrollBody?.getBoundingClientRect().bottom;
        const fadeBottom=collectionFade>0&&edge!==undefined&&bounds.bottom>edge-collectionFade?collectionFade:0;
        return {
          x:bounds.left,y:bounds.top,width:bounds.width,height:bounds.height,radius,
          clipTop:Math.max(0,rect.y-bounds.top),clipBottom:Math.max(0,bounds.bottom-rect.y-rect.height),
          clipLeft:Math.max(0,rect.x-bounds.left),clipRight:Math.max(0,bounds.right-rect.x-rect.width),
          fadeBottom,fadeBottomOffset:fadeBottom?bounds.bottom-edge:0
        };
      });
    const directionButtons = [...document.querySelectorAll('#intentPanel [data-intent]')].filter(visible).map(element => ({
      index: Number(element.dataset.intent),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      ...rectFor(element),
    }));
    const bundle = document.querySelector('#bundle');
    const bundleRect = visible(bundle) ? rectFor(bundle) : null;
    const packDragRegions = visible(bundle) ? [...bundle.querySelectorAll('.bundle-header,.bundle-card')].filter(visible).map(rectFor) : [];
    const packDragExclusions = visible(bundle) ? [...bundle.querySelectorAll('button:not(.thumb-button),a,input,textarea')].filter(visible).map(rectFor) : [];
    const petRect = visible(pet) ? rectFor(pet) : null;
    const dropButtons = [...document.querySelectorAll('#dropConfirm button')].filter(visible).map(element => ({
      action: element.dataset.drop || '',
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      ...rectFor(element),
    }));
    window.webkit?.messageHandlers?.tuotie?.postMessage({ type: 'geometry', regions, surfaces, directionButtons, bundle: bundleRect, pet: petRect, dropButtons, packDragRegions, packDragExclusions });
  }
  const observer = new MutationObserver(reportGeometry);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  window.addEventListener('resize', reportGeometry);
  window.addEventListener('pointermove', reportGeometry, { passive: true });
  document.addEventListener('scroll', reportGeometry, { passive: true, capture: true });
  setInterval(reportGeometry, 200);
  reportGeometry();

  window.TuotieDesktopPreview = {
    reset: () => reset('source-first'),
    addText: () => addSource('text'),
    addAll: () => sources.forEach(item => addSource(item.id)),
    chooseTarget: () => setTarget('document'),
    start: () => { if (state.phase === 'direction') chooseIntent(0); },
    finish: () => finishGeneration(),
    stop: () => stopGeneration(),
    undo: () => undo(),
    keep: () => acceptGeneration(),
    showSelection: () => {
      selection = { kind: 'source', id: 'text' };
      const menu = document.querySelector('#selectionMenu');
      menu.hidden = false;
      menu.style.left = '160px';
      menu.style.top = '160px';
      reportGeometry();
    },
    phase: () => state.phase,
  };

  // A small host API keeps the original renderers and event handlers as the
  // shared implementation. The packaged preview uses demo data; a flow can
  // provide its own sources and complete generation with its own result.
  const listeners = new Set();
  const targetLabels = new Map();
  let manualGeneration = false;
  let lastSnapshot = '';
  const originalTargetName = targetName;
  targetName = id => targetLabels.get(id) || originalTargetName(id);

  function snapshot() {
    return {
      mode: state.mode,
      phase: state.phase,
      sourceIds: [...state.items],
      selectedSourceIds: [...state.selected],
      activeSourceIds: [...state.activeItems],
      runSourceIds: [...state.runItems],
      targetId: state.target,
      collapsed: state.collapsed,
      generated: state.generated,
      drafts: JSON.parse(JSON.stringify(state.drafts)),
      length: state.length,
      tone: state.tone,
      acceptedOutputs: JSON.parse(JSON.stringify(state.acceptedOutputs)),
    };
  }
  function emit(type, detail = {}) {
    const message = { type: 'ui-event', event: type, detail, state: snapshot() };
    listeners.forEach(listener => listener(message));
    window.webkit?.messageHandlers?.tuotie?.postMessage(message);
  }
  function reportState() {
    const current = JSON.stringify(snapshot());
    if (current === lastSnapshot) return;
    lastSnapshot = current;
    emit('stateChanged');
  }

  // Layout is shared across task states; resizing a reply never moves its target.
  function positionTask() {
    if(window.TuotiePackDrag?.active())return;
    const office=window.TuotieOfficePaste?.open&&document.getElementById('officePastePanel');
    if(office) {
      const rect=office.getBoundingClientRect();
      if(rect.width&&rect.height) {
        office.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-rect.width-12))}px`;
        office.style.top=`${Math.max(12,Math.min(rect.top,innerHeight-rect.height-12))}px`;
      }
      return;
    }
    if(!['generating','done'].includes(state.phase))return;
    const panel=document.getElementById('taskPanel');
    if(!panel||panel.hidden)return;
    panel.style.maxHeight=`${Math.max(100,innerHeight-70)}px`;
    const dock=document.getElementById('dock');let rect=dock.getBoundingClientRect();
    // The Figma celebration extends beyond the 48 pt layout box. Keep its
    // visible burst inside the screen without changing drag/flight bounds.
    if(state.phase==='done'&&rect.right>innerWidth-14) {
      dock.style.left=`${Math.max(12,innerWidth-rect.width-14)}px`;dock.style.right='auto';
      rect=dock.getBoundingClientRect();
    }
    const width=panel.getBoundingClientRect().width;
    let x=rect.left+64+width>innerWidth-12?-width-16:64;
    x=Math.max(12-rect.left,Math.min(x,innerWidth-width-12-rect.left));
    panel.style.left=`${x}px`;
    const height=Math.max(48,panel.getBoundingClientRect().height);
    if(rect.top+height>innerHeight-12||rect.top<12) {
      dock.style.top=`${Math.max(12,innerHeight-height-12)}px`;dock.style.bottom='auto';
    }
  }
  if(window.ResizeObserver){const resize=new ResizeObserver(positionTask);for(const id of ['dock','taskPanel','intentPanel','bundleStack'])resize.observe(document.getElementById(id));}
  window.addEventListener('resize',positionTask);
  document.addEventListener('input',event=>{if(event.target.closest('#taskPanel'))positionTask();});

  const originalRender = render;
  render = function (...args) {
    const result = originalRender(...args);
    syncComponentClasses();
    positionTask();
    queueMicrotask(reportState);
    return result;
  };
  const originalStartGeneration = startGeneration;
  startGeneration = function (...args) {
    const result = originalStartGeneration(...args);
    if (state.phase === 'generating' && manualGeneration) {
      clearTimeout(generationTimer);
      generationTimer = null;
      emit('generationRequested', {
        sourceIds: [...state.runItems], targetId: state.target,
        intent: state.intent, instruction: state.extra, continuation: Boolean(state.pendingPrevious),
      });
    }
    return result;
  };
  const originalFinishGeneration = finishGeneration;
  finishGeneration = function (text) {
    if (typeof text !== 'string') return originalFinishGeneration();
    const originalResultText = resultText;
    resultText = () => text;
    try { return originalFinishGeneration(); }
    finally { resultText = originalResultText; }
  };
  const originalSendWorkSupplement = sendWorkSupplement;
  sendWorkSupplement = function (input) {
    const parts = editorParts(input);
    const result = originalSendWorkSupplement(input);
    if (parts.length) emit('generationSupplemented', { parts });
    return result;
  };
  const originalStopGeneration = stopGeneration;
  stopGeneration = function () {
    const wasGenerating = state.phase === 'generating';
    const result = originalStopGeneration();
    if (wasGenerating) emit('generationStopped');
    return result;
  };
  const originalAcceptGeneration = acceptGeneration;
  acceptGeneration = function () {
    const accepted = state.phase === 'done' && state.generated
      ? { targetId: state.target, sourceIds: [...state.runItems], text: state.generated }
      : null;
    const result = originalAcceptGeneration();
    if (accepted) emit('resultKept', accepted);
    return result;
  };
  document.addEventListener('input', event => {
    if (event.target.closest?.('.mention-editor')) queueMicrotask(reportState);
  });

  function dispatch(action) {
    if (!action || typeof action.type !== 'string') throw new TypeError('Action requires a type');
    switch (action.type) {
      case 'reset': return reset(action.mode || 'source-first');
      case 'source/add': return addSource(action.id);
      case 'source/select': return document.querySelector(`[data-select="${CSS.escape(action.id)}"]`)?.click();
      case 'source/remove': return document.querySelector(`[data-remove="${CSS.escape(action.id)}"]`)?.click();
      case 'target/set': return setTarget(action.id);
      case 'target/clear': return clearTarget();
      case 'direction/choose': return chooseIntent(action.index);
      case 'generation/start': return startGeneration(action.instruction || '');
      case 'generation/finish': return finishGeneration(action.text);
      case 'generation/stop': return stopGeneration();
      case 'result/undo': return undo();
      case 'result/keep': return acceptGeneration();
      case 'bundle/toggle': return document.querySelector('#dockBot')?.click();
      case 'selection/show': return window.TuotieDesktopPreview.showSelection();
      case 'draft/set': {
        const editor = document.querySelector(`[data-draft="${CSS.escape(action.role)}"]`);
        if (!editor) return false;
        setEditorParts(editor, action.parts || []);
        reportState();
        return true;
      }
      default: throw new RangeError(`Unknown Tuotie action: ${action.type}`);
    }
  }
  window.TuotieUI = Object.freeze({
    version: 1,
    configure(options = {}) {
      if (Array.isArray(options.sources)) {
        for (const item of options.sources) {
          if (!item || !/^[A-Za-z0-9_-]+$/.test(item.id) ||
              !['text', 'image', 'table', 'video', 'document'].includes(item.kind) ||
              typeof item.title !== 'string' || typeof item.origin !== 'string') {
            throw new TypeError('Each source needs a safe id, kind, title, and origin');
          }
        }
        sources.splice(0, sources.length, ...options.sources);
        reset(state.mode);
      }
      if (options.targetLabels) {
        targetLabels.clear();
        Object.entries(options.targetLabels).forEach(([id, label]) => targetLabels.set(id, label));
        render();
      }
      if (typeof options.manualGeneration === 'boolean') manualGeneration = options.manualGeneration;
      reportState();
    },
    dispatch,
    getState: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  installCollectionInteraction();
  installPackDragMotion();
  reportState();

  /* @tuotie:collection-controller */
  /* @tuotie:pack-drag-motion */
})();
