  // A compact collection surface, with the existing task, capture and source
  // handlers underneath. No animation dependency or network code at runtime.
  function installCollectionInteraction() {
    const dock = document.querySelector('#dock');
    const bundle = document.querySelector('#bundle');
    const stack = document.querySelector('#bundleStack');
    const body = document.querySelector('#bundleBody');
    const inputPanel = document.querySelector('#intentPanel');
    const bot = document.querySelector('#dockBot');
    const disclosure = document.querySelector('#collapseButton');
    const originalDisclosureMarkup = disclosure.innerHTML;
    const bubble = document.createElement('div');
    bubble.id = 'emptyBubble'; bubble.className = 'collection-bubble demo-glass';
    bubble.setAttribute('role', 'status'); bubble.hidden = true;
    bubble.textContent = '当前还没有内容可以复制'; dock.append(bubble);
    interactiveSelectors.push('#emptyBubble');
    let inspecting = true, bubbleTimer, lastCards = '', lastView = '', previousIds = [], closing = 0;
    let motionUntil = 0, motionFrame = 0;
    const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const css = document.createElement('style');
    css.textContent = /* @tuotie:collection-styles */ '';
    document.head.append(css);
    const hover=installCollectionHover({body,bundle,stack,trackMotion});

    // Sampling a damped spring keeps the motion portable to WKWebView. The
    // native backdrop receives the same live bounds while WebKit moves a card.
    const springFrames = (x, y, scale = .97) => Array.from({length:31}, (_, i) => {
      const t = i / 30;
      const progress = i === 30 ? 1 : 1 - Math.exp(-7.5*t) * (Math.cos(10*t) + .75*Math.sin(10*t));
      return {transform:`translate(${x*(1-progress)}px,${y*(1-progress)}px) scale(${scale+(1-scale)*progress})`, offset:t};
    });
    function trackMotion(duration) {
      motionUntil = Math.max(motionUntil, performance.now()+duration);
      if (motionFrame) return;
      const tick = () => {
        reportGeometry();
        if (performance.now()<motionUntil) motionFrame=requestAnimationFrame(tick);
        else motionFrame=0;
      };
      motionFrame=requestAnimationFrame(tick);
    }
    function arrive(element, delay = 0, x = -12, y = 0) {
      if (reduceMotion() || !element?.animate) return;
      element.getAnimations().forEach(animation => animation.cancel());
      element.animate(springFrames(x,y), {duration:430,delay,easing:'linear',fill:'backwards'});
      trackMotion(460+delay);
    }
    function revealCollection() {
      if(reduceMotion()||!stack.animate)return;
      const frames=springFrames(0,8,1);
      const startTime=document.timeline?.currentTime??null;
      for(const element of [stack]) {
        element.getAnimations().forEach(animation=>animation.cancel());
        const animation=element.animate(frames,{duration:320,easing:'linear'});
        if(startTime!==null)animation.startTime=startTime;
      }
      trackMotion(350);
    }
    function unfoldCards(before, beforeHeight) {
      if(reduceMotion()||!bundle.animate)return;
      const startTime=document.timeline?.currentTime??null;
      const height=bundle.getBoundingClientRect().height;
      if(beforeHeight>0&&height>0&&Math.abs(beforeHeight-height)>1) {
        const animation=bundle.animate([{height:`${beforeHeight}px`},{height:`${height}px`}],{duration:420,fill:'backwards',easing:'cubic-bezier(.22,.8,.22,1)'});
        if(startTime!==null)animation.startTime=startTime;
      }
      for(const card of [...body.children,bundle.querySelector('.bundle-header')]) {
        const next=card.getBoundingClientRect();
        const anchor=[...before.entries()].filter(([id,rect])=>id!=='disclosure'&&rect.width>0).at(-1)?.[1];
        const old=before.get(card.dataset.card||'disclosure')||anchor;
        if(!old||!next.height)continue;
        const final=getComputedStyle(card).transform;
        const animation=card.animate([
          {transform:`translate(${old.left+old.width/2-next.left-next.width/2}px,${old.top-next.top}px) scaleX(${next.width?old.width/next.width:1}) ${final==='none'?'':final}`},
          {transform:final==='none'?'translate(0,0)':final}
        ],{duration:420,fill:'backwards',easing:'cubic-bezier(.22,.8,.22,1)'});
        if(startTime!==null)animation.startTime=startTime;
      }
      reportGeometry();
      trackMotion(450);
    }
    let viewportHeight = null, viewportTarget = null, viewportFrame = 0;
    function resizeCollectionViewport(target) {
      const immediate = viewportHeight===null || stack.hidden || !inspecting || reduceMotion();
      if(target===viewportTarget && !(immediate && viewportFrame))return;
      viewportTarget=target;
      if(viewportFrame)cancelAnimationFrame(viewportFrame);
      viewportFrame=0;
      const writeHeight=value=>{
        viewportHeight=value;
        dock.style.setProperty('--collection-list-height',`${value.toFixed(3)}px`);
      };
      if(immediate){writeHeight(target);return;}
      // Retarget from the displayed height, so another drag or resize never
      // restarts from an obsolete endpoint. Native masks use these same bounds.
      const from=viewportHeight, started=performance.now();
      const tick=now=>{
        const t=Math.min(1,Math.max(0,(now-started)/280));
        writeHeight(from+(target-from)*(1-Math.pow(1-t,3)));
        reportGeometry();
        viewportFrame=t<1?requestAnimationFrame(tick):0;
      };
      viewportFrame=requestAnimationFrame(tick);
    }
    function positionCollection() {
      if (!dock.classList.contains('collection-mode')) return;
      const office=window.TuotieOfficePaste?.open;
      const rect=dock.getBoundingClientRect(), width=Math.min(collectionMetrics.width,Math.max(220,innerWidth-88));
      let x=64;
      if(rect.left+x+width>innerWidth-16) x=-width-16;
      x=Math.max(12-rect.left,Math.min(x,innerWidth-12-width-rect.left));
      dock.style.setProperty('--collection-x',`${x}px`);
      dock.style.setProperty('--collection-width',`${width}px`);
      const suggestionHeight=office||inputPanel.hidden?0:inputPanel.offsetHeight;
      stack.style.top=office?'':`${suggestionHeight?suggestionHeight+10:0}px`;
      const taskHeight=office?Math.max(inputPanel.hidden?0:inputPanel.offsetHeight,document.getElementById('taskPanel').hidden?0:document.getElementById('taskPanel').offsetHeight):0;
      const listHeight=Math.max(60,Math.min(310,innerHeight-(office?taskHeight+80:rect.top+170+suggestionHeight)));
      resizeCollectionViewport(listHeight);
      // Clamp against the destination size, not the still-animating old size;
      // otherwise shrinking the list pushes the entire companion upwards.
      const heightDelta=inspecting?Math.min(body.scrollHeight,listHeight)-body.offsetHeight:0;
      const height = stack.hidden ? 48 : Math.min(470,stack.offsetTop+stack.offsetHeight+heightDelta);
      if(!office&&!window.TuotiePackDrag?.active()&&!dock.classList.contains('is-dragging') && (rect.top+height>innerHeight-16 || rect.top<16)) {
        dock.style.top=`${Math.max(16,innerHeight-height-16)}px`; dock.style.bottom='auto';
      }
    }
    function dismissBubble() { clearTimeout(bubbleTimer); bubble.hidden=true; }
    function showEmpty() {
      dismissBubble(); bubble.hidden=false; positionCollection(); arrive(bubble,0,-8,0);
      bubbleTimer=setTimeout(() => {bubble.hidden=true;reportGeometry();},5000);
      reportGeometry();
    }
    const originalBundle = renderBundle;
    renderBundle = function () {
      // Keep native task transitions and focus footer semantics; retain card
      // nodes when nothing changed so polling cannot restart motion or focus.
      const oldBody = [...body.childNodes];
      const beforeRects = new Map([...body.children,bundle.querySelector('.bundle-header')].map(card=>{
        const rect=card.getBoundingClientRect();
        return [card.dataset.card||'disclosure',{top:rect.top,left:rect.left,width:rect.width}];
      }));
      const beforeHeight = bundle.getBoundingClientRect().height;
      const oldFocus = body.contains(document.activeElement) ? document.activeElement : null;
      const oldKey = lastCards;
      originalBundle();
      const collecting = ['collect','direction'].includes(state.phase)||Boolean(window.TuotieOfficePaste?.open);
      dock.classList.toggle('collection-mode',collecting);
      if (!collecting) {
        hover.hide();
        bundle.classList.remove('collection-stack','collection-list');
        disclosure.classList.remove('desktop-native-glass');
        disclosure.innerHTML=originalDisclosureMarkup;
        bundle.removeAttribute('role'); bundle.removeAttribute('tabindex');
        body.removeAttribute('role');body.removeAttribute('tabindex');body.removeAttribute('aria-label');
        dismissBubble(); lastCards=''; lastView=''; return;
      }
      const items=state.items.map(id=>sources.find(item=>item.id===id)).filter(Boolean);
      if(closing&&items.some(item=>!previousIds.includes(item.id))) {
        closing=0;for(const element of [stack,inputPanel])element.getAnimations?.().forEach(animation=>animation.cancel());
      }
      const open=items.length>0&&!state.collapsed&&!state.petCollapsed&&state.phase!=='generating';
      if(!items.length) inspecting=true;
      if(items.length) dismissBubble();
      bundle.classList.toggle('collection-stack',!inspecting);
      bundle.classList.toggle('collection-list',inspecting);
      const rowHeight=item=>['image','table'].includes(item.kind)?62:34;
      const frontHeight=items.length?rowHeight(items[0]):34;
      body.style.setProperty('--collection-front-height',`${frontHeight}px`);
      const key=JSON.stringify([inspecting,items.map(item=>[item.id,item.title,item.preview,item.detail,item.url,item.origin,item.appName,item.appIcon,item.tableRows]),[...state.selected]]);
      if(key===oldKey) {body.replaceChildren(...oldBody);oldFocus?.focus({preventScroll:true});}
      else {
        hover.hide();
        body.innerHTML=items.map(item=>bundleCard(item,state.selected.has(item.id))).join('');
        [...body.children].forEach((card,index)=>{
          if(!inspecting) {
            card.classList.toggle('collection-front',index===0);
            const depth=Math.min(index,collectionMetrics.visibleCards-1);
            card.style.setProperty('--card-y',`${frontHeight-rowHeight(items[index])+depth*collectionMetrics.cardStep}px`);
            card.style.setProperty('--card-inset',`${depth*collectionMetrics.cardInset}px`);
            card.style.setProperty('--card-z',String(items.length-index));
            if(index>0){card.inert=true;card.setAttribute('aria-hidden','true');}
          }
          if(inspecting||index===0){card.tabIndex=0;card.setAttribute('role','group');card.setAttribute('aria-label',`${contentLabel(items[index].kind)}：${contentText(items[index]).slice(0,120)}`);}
        });
      }
      lastCards=key;
      body.style.setProperty('--collection-depth',String(Math.min(collectionMetrics.visibleCards-1,Math.max(0,items.length-1))));
      bundle.tabIndex=-1;bundle.setAttribute('role','group');
      body.tabIndex=-1;body.removeAttribute('role');body.removeAttribute('aria-label');
      bundle.setAttribute('aria-label',inspecting?'内容包列表':`查看内容包，共 ${items.length} 项内容`);
      bundle.setAttribute('aria-expanded',String(inspecting));
      disclosure.innerHTML=`<span>${items.length} 条内容</span>${icon('chevron-down')}`;
      disclosure.setAttribute('aria-label',inspecting?'收起为卡片堆叠':'展开所有内容');
      disclosure.setAttribute('aria-expanded',String(inspecting));
      disclosure.setAttribute('aria-controls','bundleBody');
      stack.hidden=!open;
      if(!open)hover.hide();
      bot.setAttribute('aria-label',open?'收起内容包':items.length?'展开内容包':'查看内容包');
      bot.setAttribute('aria-expanded',String(open));
      const view=open?(inspecting?'list':'stack'):'closed';
      positionCollection();
      if(open&&(view!==lastView||items.some(item=>!previousIds.includes(item.id)))) {
        if(lastView==='stack'||lastView==='list')unfoldCards(beforeRects,beforeHeight);
      }
      lastView=view; previousIds=items.map(item=>item.id);
    };
    const originalIntent = renderIntent;
    let previousOpen=false, candidateKey='';
    renderIntent = function () {
      if(window.TuotieOfficePaste?.open) {
        candidateKey='';
        // Preserve typed requirements and the IME editor while recommendations arrive.
        const previous=inputPanel.querySelector('.direction-composer');
        const focused=previous?.contains(document.activeElement);
        originalIntent();
        const next=inputPanel.querySelector('.direction-composer');
        if(previous&&next){next.replaceWith(previous);if(focused)previous.querySelector('.mention-editor')?.focus({preventScroll:true});}
        syncPasteComposer();return;
      }
      if(!dock.classList.contains('collection-mode')) return originalIntent();
      // Keep collection hints compact. The explicit paste/drop task owns
      // planning, clarification and the requirements composer.
      const live=window.TuotieDesktopLive;
      const candidates=live?.collectionCandidates?.()||[];
      const notice=live?.collectionNotice?.()||'';
      const nextKey=JSON.stringify([state.target,candidates,notice]);
      const previous=nextKey===candidateKey&&inputPanel.querySelector('.collection-suggestions')?[...inputPanel.childNodes]:null;
      originalIntent();
      inputPanel.querySelector('.direction-composer')?.remove();
      inputPanel.querySelector('.paste-target-row')?.remove();
      if(candidates.length) {
        const list=inputPanel.querySelector('.direction-list');
        list?.classList.add('collection-suggestions');
        list?.setAttribute('aria-label','内容包候选操作');
        [...inputPanel.querySelectorAll('[data-intent]')].slice(candidates.length).forEach(button=>button.remove());
        if(previous?.length)inputPanel.replaceChildren(...previous);
      }
      if(notice)inputPanel.querySelector('.direction-status')?.classList.add('collection-notice');
      candidateKey=nextKey;
      const open=state.items.length>0&&!state.collapsed&&!state.petCollapsed;
      inputPanel.hidden=!open || (live&&(state.phase!=='direction'||(!candidates.length&&!notice))) || live?.isOfficeFocus?.()===true;
      positionCollection();
      if(open&&!previousOpen) revealCollection();
      previousOpen=open;
      bot.setAttribute('aria-label',open?'收起内容包':state.items.length?'展开内容包':'查看内容包');
      bot.setAttribute('aria-expanded',String(open));
    };
    function toggleInspect() {hover.hide();inspecting=!inspecting;render();body.focus({preventScroll:true});}
    bundle.addEventListener('click',event=>{
      if(!dock.classList.contains('collection-mode'))return;
      if(event.target.closest('#collapseButton')) {event.preventDefault();event.stopImmediatePropagation();toggleInspect();return;}
      if(event.target.closest('[data-remove]'))return;
      // Collection rows expose details on hover/focus only. Do not let the
      // shared catalog's click-to-select/detail handlers run underneath.
      event.preventDefault();event.stopImmediatePropagation();
    },true);
    bundle.addEventListener('keydown',event=>{
      if(!dock.classList.contains('collection-mode')||!['Enter',' '].includes(event.key)||event.target.closest('a,button'))return;
      event.preventDefault();event.stopPropagation();
    });
    bot.addEventListener('click',event=>{
      if(window.TuotieOfficePaste?.open){
        event.preventDefault();event.stopImmediatePropagation();
        window.TuotieDesktopLive.togglePasteFold();return;
      }
      if(!state.items.length&&['collect','direction'].includes(state.phase)) {
        event.preventDefault();event.stopImmediatePropagation();showEmpty();
      } else {
        dismissBubble();
        if(!dock.classList.contains('collection-mode')||reduceMotion()||!stack.animate)return;
        if(closing) {
          event.preventDefault();event.stopImmediatePropagation();closing=0;
          for(const element of [stack,inputPanel])element.getAnimations().forEach(animation=>animation.cancel());
          revealCollection();return;
        }
        if(!stack.hidden) {
          event.preventDefault();event.stopImmediatePropagation();
          const token=++closing;
          for(const element of [stack,inputPanel])element.getAnimations().forEach(animation=>animation.cancel());
          const animation=stack.animate([{transform:'none',opacity:1},{transform:'translateY(-5px) scale(.985)',opacity:0}],{duration:150,easing:'ease-in',fill:'forwards'});
          const inputAnimation=inputPanel.animate([{transform:'none',opacity:1},{transform:'translateY(-5px) scale(.985)',opacity:0}],{duration:150,easing:'ease-in',fill:'forwards'});
          if(document.timeline.currentTime!==null) {animation.startTime=document.timeline.currentTime;inputAnimation.startTime=animation.startTime;}
          trackMotion(170);
          animation.finished.then(()=>{
            if(closing!==token)return;
            closing=0;animation.cancel();inputAnimation.cancel();state.petCollapsed=true;state.collapsed=true;
            inspecting=false;render();
          }).catch(()=>{});
        }
      }
    },true);
    document.addEventListener('keydown',event=>{
      if(window.TuotieOfficePaste?.open||window.TuotiePackDrag?.active()||event.key!=='Escape'||!dock.classList.contains('collection-mode')||!document.querySelector('#detailBackdrop').hidden||activeMention)return;
      if(!bubble.hidden){dismissBubble();return;}
      if(inspecting){event.stopImmediatePropagation();toggleInspect();}
      else if(!stack.hidden){state.petCollapsed=true;state.collapsed=true;render();bot.focus({preventScroll:true});}
    },true);
    const originalAddSource=addSource;
    addSource=function(...args){state.petCollapsed=false;return originalAddSource(...args);};
    const originalClamp=clampDock;
    clampDock=function(){if(dock.classList.contains('collection-mode'))positionCollection();else originalClamp();};
    window.addEventListener('resize',positionCollection);
    window.addEventListener('pointermove',()=>{if(dock.classList.contains('is-dragging'))positionCollection();},{passive:true});
    if(window.ResizeObserver){const resize=new ResizeObserver(positionCollection);resize.observe(inputPanel);resize.observe(document.getElementById('taskPanel'));}
    window.TuotieCollection={setExpanded(value){inspecting=Boolean(value);hover.hide();},hideHover(){hover.hide();}};
    state.petCollapsed=false;
    render();
  }
