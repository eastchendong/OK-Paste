// The character's layers share one clock. App task/drag state stays outside
// this renderer; seek() uses the exact same tracks as live playback.
(() => {
  if (window.TuotieCompanionMotion) return;
  const durations=Object.freeze({idle:5600,nod:760,received:800,thinking:1800,working:2400,success:1450,failure:1000});
  const loops=new Set(['idle','thinking','working']);
  const poses=new Set(Object.keys(durations));
  const states=new WeakMap(),live=new Set();
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced=()=>Boolean(media?.matches);
  const ease='cubic-bezier(.45,0,.25,1)';
  const make=(offset,transform,opacity)=>({offset,transform,easing:ease,...(opacity===undefined?{}:{opacity})});
  const rest='translate(0px,0px) rotate(0deg) scale(1,1)';
  const bodyFrames={
    idle:[make(0,rest),make(.5,'translate(0px,-.5px) rotate(0deg) scale(1,1)'),make(1,rest)],
    nod:[make(0,rest),make(.26,'translate(0px,3px) rotate(4deg) scale(1.025,.94)'),make(.55,'translate(0px,-.8px) rotate(-1deg) scale(.99,1.015)'),make(.8,'translate(0px,.4px) rotate(.5deg) scale(1,1)'),make(1,rest)],
    received:[make(0,rest),make(.22,'translate(0px,-1px) rotate(-5deg) scale(1,1)'),make(.66,'translate(0px,-1px) rotate(-5deg) scale(1,1)'),make(1,rest)],
    thinking:[make(0,rest),make(.5,'translate(0px,-.8px) rotate(-1deg) scale(1,1)'),make(1,rest)],
    working:[make(0,rest),make(.46,'translate(.3px,-.6px) rotate(1deg) scale(1,1)'),make(.82,rest),make(1,rest)],
    success:[make(0,rest),make(.083,'translate(0px,1.7px) rotate(-3deg) scale(1.05,.92)'),make(.248,'translate(-1px,-6px) rotate(-9deg) scale(.97,1.04)'),make(.386,'translate(0px,.7px) rotate(6deg) scale(1.04,.96)'),make(.52,'translate(1px,-2px) rotate(8deg) scale(.99,1.02)'),make(.69,'translate(0px,0px) rotate(-4deg) scale(1,1)'),make(.86,rest),make(1,rest)],
    failure:[make(0,'translate(0px,-2px) rotate(-2deg) scale(1,1.035)'),make(.5,'translate(0px,2px) rotate(2deg) scale(1,.97)'),make(1,rest)],
  };
  function definition(pose,intro) {
    const tracks=[{selector:'.companion-body',origin:'50% 80%',frames:bodyFrames[pose]}];
    if(pose==='idle')tracks.push({selector:'.companion-eyes',origin:'15px 20px',frames:[make(0,rest),make(.72,rest),make(.737,'scale(1,.08)'),make(.755,rest),make(1,rest)]});
    if(pose==='thinking')tracks.push({selector:'.companion-bubble',origin:'50% 50%',frames:index=>{
      const d=index*.1;
      return [make(0,'translate(0px,2px) scale(.65)',.25),make(.15+d,'translate(0px,0px) scale(1)',1),make(.5+d,'translate(0px,-2px) scale(.96)',.85),make(.75+d,'translate(0px,-3px) scale(.8)',.2),make(1,'translate(0px,2px) scale(.65)',.25)];
    }});
    if(pose==='working') {
      tracks.push({selector:'.companion-gaze',origin:'15px 25px',frames:[make(0,rest),make(.16,rest),make(.55,'translate(10px,-12px) rotate(-5deg) scale(1,1)'),make(.7,'translate(10px,-12px) rotate(-5deg) scale(1,1)'),make(.86,rest),make(1,rest)]});
      tracks.push({selector:'.companion-tool',origin:'12px 16px',frames:[make(0,rest),make(.16,'translate(0px,.4px) rotate(-3deg) scale(1,1)'),make(.45,'translate(1px,-.7px) rotate(7deg) scale(1,1)'),make(.7,'translate(0px,0px) rotate(-4deg) scale(1,1)'),make(.9,rest),make(1,rest)]});
      // A new task acknowledges once; these short tracks never repeat with work.
      if(intro)tracks.push({selector:'.companion-wink',duration:700,iterations:1,origin:'50% 80%',frames:[make(0,rest,1),make(.18,'rotate(-4deg)',1),make(.72,'rotate(-4deg)',1),make(1,rest,0)]});
      if(intro)tracks.push({selector:'.companion-base',duration:700,iterations:1,origin:'50% 80%',frames:[make(0,rest,0),make(.72,rest,0),make(1,rest,1)]});
    }
    if(pose==='success')tracks.push({selector:'.companion-sparkle',origin:'50% 50%',frames:index=>{
      const delay=index*.04,x=[1,-2,3][index%3],y=[-3,-1,2][index%3];
      return [make(0,'translate(0px,0px) scale(.4) rotate(-20deg)',0),make(.1+delay,'translate(0px,0px) scale(.4) rotate(-20deg)',0),make(.28+delay,`translate(${x}px,${y}px) scale(1.1) rotate(8deg)`,1),make(.55+delay,`translate(${x*1.5}px,${y*1.5}px) scale(.9) rotate(20deg)`,1),make(.78+delay,`translate(${x*2}px,${y*2}px) scale(.5) rotate(30deg)`,0),make(1,'scale(.5)',0)];
    }});
    return {duration:durations[pose],iterations:loops.has(pose)?Infinity:1,tracks};
  }
  function notifyComplete(state) {
    if(state.notified||state.disposed)return;
    state.notified=true;
    if(typeof state.onComplete==='function')queueMicrotask(()=>{if(!state.disposed)state.onComplete();});
  }
  const clock=()=>{
    const value=document.timeline?.currentTime;
    return typeof value==='number'&&Number.isFinite(value)?value:0;
  };
  function time(state) {
    const value=state.animations[0]?.currentTime;
    return typeof value==='number'&&Number.isFinite(value)?value:state.time;
  }
  function presentation(state) {
    state.root.dataset.companionPose=state.pose;
    state.root.dataset.companionMotion=state.running?'running':state.finished?'complete':state.animations.length?'paused':'static';
  }
  function pauseTracks(state) {
    const current=time(state);
    state.time=current;
    for(const animation of state.animations) {
      try {animation.pause();animation.currentTime=current;} catch {}
    }
    state.running=false;presentation(state);
  }
  function cancelTracks(state) {
    for(const animation of state.animations) {
      animation.onfinish=null;
      try {animation.cancel();} catch {}
    }
    state.animations=[];state.running=false;
  }
  function buildTracks(state) {
    if(state.animations.length||state.failed||!observer||reduced())return;
    try {
      const data=definition(state.pose,state.intro);
      for(const track of data.tracks) {
        [...state.root.querySelectorAll(track.selector)].forEach((element,index)=>{
          if(typeof element.animate!=='function')throw new Error('WAAPI unavailable');
          const frames=(typeof track.frames==='function'?track.frames(index):track.frames).map(frame=>({...frame,transformOrigin:track.origin}));
          const animation=element.animate(frames,{duration:track.duration||data.duration,iterations:track.iterations??data.iterations,fill:'both',easing:'linear'});
          state.animations.push(animation);
          animation.pause();animation.currentTime=state.time;
        });
      }
      const lead=state.animations[0];
      if(lead&&!loops.has(state.pose))lead.onfinish=()=>{
        if(state.disposed||states.get(state.root)!==state||loops.has(state.pose))return;
        state.time=durations[state.pose];state.finished=true;
        for(const animation of state.animations){try{animation.pause();animation.currentTime=state.time;}catch{}}
        state.running=false;presentation(state);notifyComplete(state);
      };
    } catch {
      cancelTracks(state);state.failed=true;
    }
  }
  function sync(state) {
    if(state.disposed)return;
    if(reduced()) {
      state.time=time(state);cancelTracks(state);
      if(!loops.has(state.pose)){state.time=durations[state.pose];state.finished=true;notifyComplete(state);}
      presentation(state);return;
    }
    if(state.animateRequested&&!state.finished)buildTracks(state);
    if(state.failed||!observer){if(!loops.has(state.pose)&&state.animateRequested){state.finished=true;notifyComplete(state);}}
    if(!state.animateRequested||state.manualPaused||document.hidden||!state.inView||state.finished||!state.animations.length) {
      pauseTracks(state);return;
    }
    if(state.running)return;
    const started=clock()-state.time;
    for(const animation of state.animations) {
      try {animation.play();animation.startTime=started;} catch {cancelTracks(state);state.failed=true;break;}
    }
    state.running=state.animations.length>0;presentation(state);
  }
  let observer;
  if(typeof window.IntersectionObserver==='function') {
    try {
      observer=new IntersectionObserver(entries=>{
        for(const entry of entries) {
          const state=states.get(entry.target);
          if(!state)continue;
          state.inView=Boolean(entry.isIntersecting)&&entry.intersectionRatio>=.25;
          sync(state);
        }
      },{threshold:[0,.25]});
    }catch{}
  }
  function dispose(root) {
    const state=states.get(root);if(!state)return false;
    state.disposed=true;cancelTracks(state);live.delete(state);states.delete(root);
    try{observer?.unobserve(root);}catch{}
    delete root.dataset.companionMotion;
    // The component retains its complete static pose when its controller ends.
    return true;
  }
  function setPose(root,pose,{eventKey='',animate=true,onComplete,intro=true}={}) {
    if(!root?.querySelectorAll||!root.dataset)return null;
    pose=poses.has(pose)?pose:'idle';
    const key=typeof eventKey==='string'||typeof eventKey==='number'?String(eventKey):'';
    const existing=states.get(root);
    if(existing&&existing.pose===pose&&existing.eventKey===key)return existing.controller;
    if(existing)dispose(root);
    const state={root,pose,eventKey:key,onComplete,intro,notified:false,animateRequested:animate!==false,manualPaused:false,inView:false,animations:[],time:0,running:false,finished:false,failed:false,disposed:false,wasConnected:Boolean(root.isConnected)};
    state.controller=Object.freeze({
      get pose(){return state.pose;},get eventKey(){return state.eventKey;},
      get currentTime(){return time(state);},get playing(){return state.running;},
      get animationCount(){return state.animations.length;},
      pause:()=>pause(root),resume:()=>resume(root),seek:value=>seek(root,state.pose,value),dispose:()=>dispose(root),
    });
    states.set(root,state);live.add(state);presentation(state);
    try{observer?.observe(root);}catch{state.failed=true;}
    sync(state);return state.controller;
  }
  function seek(root,pose,timeMs) {
    pose=poses.has(pose)?pose:'idle';
    let state=states.get(root);
    if(!state||state.pose!==pose){setPose(root,pose,{eventKey:'preview',animate:false,intro:false});state=states.get(root);}
    if(!state)return null;
    const input=Number(timeMs),duration=durations[pose];
    const value=Number.isFinite(input)?Math.max(0,input):0;
    state.time=loops.has(pose)?value%duration:Math.min(value,duration);
    state.manualPaused=true;state.finished=!loops.has(pose)&&state.time>=duration;
    if(reduced()) {sync(state);return state.controller;}
    buildTracks(state);
    for(const animation of state.animations){try{animation.pause();animation.currentTime=state.time;}catch{}}
    state.running=false;presentation(state);return state.controller;
  }
  function pause(root) {
    const state=states.get(root);if(!state)return null;
    state.manualPaused=true;pauseTracks(state);return state.controller;
  }
  function resume(root) {
    const state=states.get(root);if(!state)return null;
    state.manualPaused=false;state.animateRequested=true;sync(state);return state.controller;
  }
  document.addEventListener('visibilitychange',()=>{for(const state of live)sync(state);});
  const changed=()=>{for(const state of live)sync(state);};
  if(media?.addEventListener)media.addEventListener('change',changed);
  else media?.addListener?.(changed);
  if(typeof window.MutationObserver==='function'&&document.documentElement) {
    new MutationObserver(()=>{
      for(const state of live) {
        if(state.wasConnected&&!state.root.isConnected)dispose(state.root);
        else if(state.root.isConnected)state.wasConnected=true;
      }
    }).observe(document.documentElement,{subtree:true,childList:true});
  }
  window.TuotieCompanionMotion=Object.freeze({durations,isLoop:pose=>loops.has(pose),setPose,seek,pause,resume,dispose});
})();
