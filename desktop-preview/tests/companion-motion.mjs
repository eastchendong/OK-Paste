import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

const source=readFileSync(new URL('../../ui/components/companion-motion.js',import.meta.url),'utf8');
function setup({reduced=false,visible=true,io=true,waapi=true}={}) {
  const dom=new JSDOM('<!doctype html><div id="dock" style="transform:translate(240px,120px)"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.companionAssetUrl=name=>'file:///assets/'+name;
  dom.window.eval(readFileSync(new URL('../../ui/components/companion.js',import.meta.url),'utf8'));
  dom.window.document.getElementById('dock').innerHTML=dom.window.companionMarkup();
  const w=dom.window,root=w.document.querySelector('.companion-character'),animations=[],observed=new Set();
  let now=100,hidden=false,change,observeCallback;
  const media={matches:reduced,addEventListener(type,fn){if(type==='change')change=fn;}};
  w.matchMedia=()=>media;
  Object.defineProperty(w.document,'hidden',{get:()=>hidden});
  Object.defineProperty(w.document,'timeline',{value:{get currentTime(){return now;}}});
  if(io)w.IntersectionObserver=class {
    constructor(callback){observeCallback=callback;}
    observe(target){observed.add(target);observeCallback([{target,isIntersecting:visible,intersectionRatio:visible?1:0}]);}
    unobserve(target){observed.delete(target);}
  };
  if(waapi)w.Element.prototype.animate=function(frames,options){
    const animation={element:this,frames,options,currentTime:0,startTime:null,playState:'running',canceled:false,onfinish:null,
      play(){this.playState='running';},pause(){this.playState='paused';},cancel(){this.canceled=true;this.playState='idle';}};
    animations.push(animation);return animation;
  };
  w.eval(source);
  return {dom,w,root,animations,api:w.TuotieCompanionMotion,observed,
    advance(value){now=value;},
    hidden(value){hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));},
    reduced(value){media.matches=value;change?.({matches:value});},
    visible(value){observeCallback?.([{target:root,isIntersecting:value,intersectionRatio:value?1:0}]);},
  };
}

test('working layers share one clock and repeated pose polls retain the same animations and playback position',()=>{
  const s=setup();try{
    const first=s.api.setPose(s.root,'working',{eventKey:'task-1'});
    assert.equal(first.animationCount,5);assert.equal(first.playing,true);
    assert.equal(s.animations.filter(a=>a.options.duration===2400&&a.options.iterations===Infinity).length,3);
    assert.equal(s.animations.filter(a=>a.options.duration===700&&a.options.iterations===1).length,2);
    assert.ok(s.animations.every(a=>a.startTime===100));
    s.animations.forEach(a=>a.currentTime=650);
    assert.equal(s.api.setPose(s.root,'working',{eventKey:'task-1'}),first);
    assert.equal(s.animations.length,5);assert.equal(first.currentTime,650);
    assert.equal(s.root.dataset.companionPose,'working');
  }finally{s.dom.window.close();}
});

test('a new pose cancels all old layers, preserves layout transforms and cannot receive an old success finish',()=>{
  const s=setup();try{
    const outer=s.w.document.getElementById('dock').style.transform;
    const body=s.root.querySelector('.companion-body');body.style.transform='translate(1px,2px)';
    s.api.setPose(s.root,'success',{eventKey:'result-1'});
    const old=[...s.animations],finish=old[0].onfinish;
    const working=s.api.setPose(s.root,'working',{eventKey:'task-2'});
    finish();
    assert.equal(working.playing,true);assert.equal(s.root.dataset.companionPose,'working');
    assert.ok(old.every(a=>a.canceled&&a.onfinish===null));
    assert.equal(s.w.document.getElementById('dock').style.transform,outer);
    assert.equal(body.style.transform,'translate(1px,2px)');
    s.api.dispose(s.root);assert.equal(s.observed.has(s.root),false);
    assert.equal(body.style.transform,'translate(1px,2px)');
  }finally{s.dom.window.close();}
});

test('success is a single complete celebration and polling does not replay the same result',()=>{
  const s=setup();try{
    const controller=s.api.setPose(s.root,'success',{eventKey:'result-1'});
    assert.ok(s.animations.length>=4);
    assert.ok(s.animations.every(a=>a.options.duration===1450&&a.options.iterations===1));
    s.animations[0].onfinish();
    assert.equal(controller.playing,false);assert.equal(controller.currentTime,1450);
    assert.equal(s.root.dataset.companionMotion,'complete');
    const count=s.animations.length;s.api.setPose(s.root,'success',{eventKey:'result-1'});s.api.resume(s.root);
    assert.equal(s.animations.length,count);assert.equal(controller.playing,false);
    s.api.setPose(s.root,'success',{eventKey:'result-2'});
    assert.ok(s.animations.length>count);
  }finally{s.dom.window.close();}
});

test('seek freezes all layers reproducibly and resume uses the sampled time without catching up',()=>{
  const s=setup();try{
    const controller=s.api.seek(s.root,'working',720);
    assert.equal(controller.playing,false);assert.ok(s.animations.every(a=>a.currentTime===720&&a.playState==='paused'));
    const frames=JSON.stringify(s.animations.map(a=>a.frames));
    s.api.seek(s.root,'working',720);assert.equal(JSON.stringify(s.animations.map(a=>a.frames)),frames);
    s.advance(10000);s.api.resume(s.root);
    assert.ok(s.animations.every(a=>a.startTime===9280));
    s.api.seek(s.root,'success',Infinity);assert.equal(s.root.dataset.companionPose,'success');
    assert.ok(s.animations.filter(a=>!a.canceled).every(a=>a.currentTime===0));
  }finally{s.dom.window.close();}
});

test('hidden and offscreen work pauses the shared clock, then resumes from the same pose',()=>{
  const s=setup();try{
    const controller=s.api.setPose(s.root,'working');
    s.animations.forEach(a=>a.currentTime=390);s.hidden(true);
    assert.equal(controller.playing,false);assert.ok(s.animations.every(a=>a.playState==='paused'&&a.currentTime===390));
    s.advance(20000);s.hidden(false);assert.ok(s.animations.every(a=>a.startTime===19610));
    s.visible(false);assert.equal(controller.playing,false);
    s.advance(30000);s.visible(true);assert.ok(s.animations.every(a=>a.startTime===29610));
    s.api.pause(s.root);s.hidden(true);s.hidden(false);assert.equal(controller.playing,false,'visibility cannot override a deliberate pause');
  }finally{s.dom.window.close();}
});

test('reduced motion gives complete static poses and changing the preference never replays an old celebration',()=>{
  const s=setup({reduced:true});try{
    const work=s.api.setPose(s.root,'working');
    assert.equal(work.animationCount,0);assert.equal(s.root.dataset.companionPose,'working');
    s.reduced(false);assert.equal(work.animationCount,5);assert.equal(work.playing,true);
    s.animations.forEach(a=>a.currentTime=800);s.reduced(true);
    assert.equal(work.animationCount,0);assert.equal(work.playing,false);
    const success=s.api.setPose(s.root,'success',{eventKey:'result'});
    assert.equal(success.animationCount,0);assert.equal(success.currentTime,1450);
    s.reduced(false);assert.equal(success.animationCount,0);assert.equal(success.playing,false);
  }finally{s.dom.window.close();}
});

test('missing visibility/animation support and failed WAAPI all retain a static, complete pose',()=>{
  for(const options of [{io:false},{waapi:false}]) {
    const s=setup(options);try{
      const controller=s.api.setPose(s.root,'working');
      assert.equal(controller.animationCount,0);assert.equal(controller.playing,false);
      assert.equal(s.root.dataset.companionPose,'working');
    }finally{s.dom.window.close();}
  }
  const s=setup();try{
    s.root.querySelector('.companion-tool').animate=()=>{throw new Error('cannot animate');};
    const controller=s.api.setPose(s.root,'working');
    assert.equal(controller.animationCount,0);assert.equal(controller.playing,false);
    assert.ok(s.animations.every(a=>a.canceled));
  }finally{s.dom.window.close();}
});

test('static restoration does not animate on later polling and removed roots release their layers',async()=>{
  const s=setup();try{
    s.api.setPose(s.root,'success',{eventKey:'old-result',animate:false});
    s.api.setPose(s.root,'success',{eventKey:'old-result',animate:true});
    assert.equal(s.animations.length,0);
    const controller=s.api.setPose(s.root,'working',{eventKey:'new-task'});
    s.root.remove();await Promise.resolve();
    assert.ok(s.animations.every(a=>a.canceled));assert.equal(controller.playing,false);
  }finally{s.dom.window.close();}
});
