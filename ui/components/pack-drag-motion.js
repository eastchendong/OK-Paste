// AppKit owns the payload capsule. This controller only moves the existing
// companion and restores its presentation; sources and task state stay intact.
function installPackDragMotion() {
  const dock=document.getElementById('dock');
  const bundle=document.getElementById('bundle');
  const stack=document.getElementById('bundleStack');
  const placementProperties=['left','top','right','bottom','transform','transition'];
  const closed=new Set();
  let current=null,frame=0,arrivalTimer=0,arrivalAnimation=null;
  const reduceMotion=()=>Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const validId=value=>typeof value==='string'&&value.length>0&&value.length<256;
  const point=()=>{const rect=dock.getBoundingClientRect();return {x:rect.left,y:rect.top};};
  const rememberClosed=id=>{closed.add(id);if(closed.size>64)closed.delete(closed.values().next().value);};
  function stopMotion() {
    if(frame)cancelAnimationFrame(frame);
    if(arrivalTimer)clearTimeout(arrivalTimer);
    frame=0;arrivalTimer=0;
    arrivalAnimation?.cancel();arrivalAnimation=null;
  }
  function savePlacement() {
    return Object.fromEntries(placementProperties.map(name=>[name,{value:dock.style.getPropertyValue(name),priority:dock.style.getPropertyPriority(name)}]));
  }
  function restorePlacement(placement) {
    for(const [name,{value,priority}] of Object.entries(placement)) {
      if(value)dock.style.setProperty(name,value,priority);
      else dock.style.removeProperty(name);
    }
  }
  function put({x,y}) {
    dock.style.left=`${x}px`;dock.style.top=`${y}px`;
    dock.style.right='auto';dock.style.bottom='auto';
    dock.style.transform='none';dock.style.transition='none';
  }
  function presentation(stage) {
    if(stage)dock.dataset.packDrag=stage;
    else delete dock.dataset.packDrag;
    document.body.classList.toggle('pack-drag-active',Boolean(stage));
  }
  function finish(session,restoreHome=false) {
    if(current!==session)return;
    stopMotion();
    if(window.TuotieOfficePaste?.open) {
      presentation(null);rememberClosed(session.id);current=null;reportGeometry();return;
    }
    if(restoreHome) {
      restorePlacement(session.home.placement);
      dockMoved=session.home.dockMoved;
    } else {
      const transition=session.home.placement.transition;
      if(transition.value)dock.style.setProperty('transition',transition.value,transition.priority);
      else dock.style.removeProperty('transition');
      dockMoved=true;
    }
    presentation(null);rememberClosed(session.id);current=null;
    // Reuse the normal side-selection and viewport bounds after movement.
    if(!restoreHome)clampDock();
    reportGeometry();
  }
  function fly(session,to,duration,complete,from=point()) {
    stopMotion();
    if(reduceMotion()) {put(to);reportGeometry();complete();return;}
    put(from);
    const started=performance.now();
    const lift=Math.min(52,Math.hypot(to.x-from.x,to.y-from.y)*.12);
    const tick=now=>{
      if(current!==session)return;
      if(window.TuotieOfficePaste?.open) {finish(session);return;}
      const time=Math.min(1,Math.max(0,(now-started)/duration));
      const progress=1-Math.pow(1-time,3);
      put({x:from.x+(to.x-from.x)*progress,y:from.y+(to.y-from.y)*progress-Math.sin(Math.PI*progress)*lift});
      reportGeometry();
      if(time<1)frame=requestAnimationFrame(tick);
      else {frame=0;complete();}
    };
    frame=requestAnimationFrame(tick);
  }
  function revealAtDestination(session,drop) {
    if(current!==session)return;
    // Remove only the source hiding. Keep layout pinned until the short
    // capsule-to-cards expansion has supplied its last native glass bounds.
    presentation('arriving');
    clampDock();
    reportGeometry();
    const rect=bundle.getBoundingClientRect();
    if(reduceMotion()||!bundle.animate||!rect.width||!rect.height) {finish(session);return;}
    const x=drop.x+12-rect.left,y=drop.y-22-rect.top;
    arrivalAnimation=bundle.animate([
      {transformOrigin:'0 0',transform:`translate(${x}px,${y}px) scale(${144/rect.width},${44/rect.height})`},
      {transformOrigin:'0 0',transform:'translate(0,0) scale(1,1)'},
    ],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
    const started=performance.now();
    const sample=()=>{
      if(current!==session)return;
      reportGeometry();
      if(performance.now()-started<240)frame=requestAnimationFrame(sample);
      else {frame=0;finish(session);}
    };
    frame=requestAnimationFrame(sample);
    // Finish even if WebKit pauses rAF while an external application is active.
    arrivalTimer=setTimeout(()=>finish(session),270);
  }
  function destination(x,y) {
    const rect=dock.getBoundingClientRect();
    const parts=[stack,document.getElementById('intentPanel'),document.getElementById('taskPanel')]
      .filter(element=>element&&!element.hidden&&getComputedStyle(element).display!=='none');
    const height=Math.min(innerHeight-24,Math.max(48,...parts.map(element=>element.getBoundingClientRect().bottom-rect.top)));
    return {x:Math.max(12,Math.min(x-24,innerWidth-60)),y:Math.max(12,Math.min(y-24,innerHeight-height-12))};
  }
  function cancel(message={}) {
    if(!current||message.sessionId&&message.sessionId!==current.id||current.stage==='returning')return false;
    if(window.TuotieOfficePaste?.open) {finish(current);return false;}
    const session=current;session.stage='returning';presentation('returning');
    fly(session,session.home.point,320,()=>finish(session,true));
    return true;
  }
  window.TuotiePackDrag=Object.freeze({
    active:()=>Boolean(current),
    begin(message={}) {
      const id=message.sessionId;
      if(!validId(id)||closed.has(id)||current?.id===id||window.TuotieOfficePaste?.open)return false;
      // A new physical drag starts from what is actually visible now, even
      // when it interrupts an earlier flight or return.
      if(current) {
        const displayed=point();rememberClosed(current.id);stopMotion();put(displayed);
      }
      const home={point:point(),placement:savePlacement(),dockMoved};
      current={id,home,stage:'dragging'};
      dock.classList.remove('is-dragging');
      window.TuotieCollection?.hideHover?.();
      presentation('dragging');reportGeometry();return true;
    },
    end(message={}) {
      if(!current||message.sessionId!==current.id||current.stage!=='dragging')return false;
      if(!message.accepted)return cancel(message);
      if(!Number.isFinite(message.x)||!Number.isFinite(message.y))return cancel(message);
      const session=current;
      if(window.TuotieOfficePaste?.open) {finish(session);return false;}
      session.stage='flying';presentation('flying');
      const from=Number.isFinite(message.fromX)&&Number.isFinite(message.fromY)?{x:message.fromX,y:message.fromY}:point();
      fly(session,destination(message.x,message.y),560,()=>revealAtDestination(session,message),from);
      return true;
    },
    cancel,
  });
}
