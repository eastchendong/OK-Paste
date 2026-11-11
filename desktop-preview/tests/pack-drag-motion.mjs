import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8');
const rect=(x,y,width,height)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height});

function setup({reduced=true}={}) {
  const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,messages=[],frames=new Map(),timers=new Map(),animations=[];
  let now=0,token=0,motionReduced=true;
  w.matchMedia=()=>({matches:motionReduced});
  w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
  w.setInterval=()=>0;
  w.eval(overlay);
  w.TuotieUI.configure({manualGeneration:true,sources:[
    {id:'notes',kind:'text',title:'采访笔记',origin:'项目资料',sourceKind:'app',detail:'第一份原始资料'},
    {id:'photo',kind:'image',title:'交通标志参考',origin:'网页',sourceKind:'web',detail:'图片参考'},
  ]});
  w.TuotieUI.dispatch({type:'source/add',id:'notes'});
  w.TuotieUI.dispatch({type:'source/add',id:'photo'});
  const dock=w.document.getElementById('dock'),bundle=w.document.getElementById('bundle'),stack=w.document.getElementById('bundleStack');
  dock.style.left='37px';dock.style.top='181px';dock.style.bottom='auto';
  const origin={x:37,y:181};
  dock.getBoundingClientRect=()=>rect(Number.parseFloat(dock.style.left)||origin.x,Number.parseFloat(dock.style.top)||origin.y,48,48);
  const relative=(x,y,width,height)=>()=>{const home=dock.getBoundingClientRect();return rect(home.left+x,home.top+y,width,height);};
  w.document.getElementById('dockPet').getBoundingClientRect=relative(0,0,48,48);
  w.document.getElementById('dockBot').getBoundingClientRect=relative(0,0,48,48);
  bundle.getBoundingClientRect=relative(64,0,340,62);
  stack.getBoundingClientRect=relative(64,0,340,100);
  w.document.getElementById('intentPanel').getBoundingClientRect=relative(64,110,340,40);
  for(const card of bundle.querySelectorAll('.bundle-card'))card.getBoundingClientRect=relative(64,0,340,34);
  w.requestAnimationFrame=callback=>{frames.set(++token,callback);return token;};
  w.cancelAnimationFrame=id=>frames.delete(id);
  w.setTimeout=(callback,delay=0)=>{timers.set(++token,{callback,at:now+delay});return token;};
  w.clearTimeout=id=>timers.delete(id);
  Object.defineProperty(w.performance,'now',{value:()=>now});
  w.HTMLElement.prototype.animate=function(keyframes,options){
    const animation={keyframes,options,canceled:false,cancel(){this.canceled=true;}};
    animations.push(animation);return animation;
  };
  motionReduced=reduced;
  function advance(milliseconds) {
    now+=milliseconds;
    const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));
    for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
  }
  return {dom,w,dock,bundle,stack,messages,animations,advance,api:w.TuotiePackDrag,ui:w.TuotieUI,reduce(value){motionReduced=value;}};
}

test('successful drop moves the companion, preserves all business data and reveals the same collection',()=>{
  const s=setup();
  try {
    const before=JSON.stringify(s.ui.getState());
    assert.equal(s.api.begin({sessionId:'drag-1',x:101,y:181,width:340,height:62}),true);
    assert.equal(s.api.active(),true);
    assert.equal(s.w.getComputedStyle(s.stack).visibility,'hidden');
    assert.equal(s.api.end({sessionId:'drag-1',accepted:true,x:460,y:330}),true);
    assert.equal(s.api.active(),false);
    assert.equal(s.dock.style.left,'436px');assert.equal(s.dock.style.top,'306px');
    assert.notEqual(s.w.getComputedStyle(s.stack).visibility,'hidden');
    assert.equal(JSON.stringify(s.ui.getState()),before);
    assert.equal(s.messages.some(message=>message.type==='work'||message.type==='archiveItems'||message.event==='generationRequested'),false);
  } finally {s.dom.window.close();}
});

test('canceled drop restores exact original placement and expanded state without choosing a fixed edge',()=>{
  const s=setup();
  try {
    s.dock.style.setProperty('left','37px','important');s.dock.style.top='';s.dock.style.bottom='27px';s.dock.style.transform='translateX(2px)';
    const placement=s.dock.getAttribute('style'),before=JSON.stringify(s.ui.getState());
    s.api.begin({sessionId:'cancel-1'});
    s.api.end({sessionId:'cancel-1',accepted:false,x:900,y:600});
    assert.equal(s.dock.getAttribute('style'),placement);
    assert.equal(s.dock.style.getPropertyPriority('left'),'important');
    assert.equal(JSON.stringify(s.ui.getState()),before);assert.equal(s.api.active(),false);
    assert.equal(s.dock.hasAttribute('data-pack-drag'),false);
  } finally {s.dom.window.close();}
});

test('flight follows an arc, reports moving native geometry and only unfolds cards after arrival',()=>{
  const s=setup({reduced:false});
  try {
    s.api.begin({sessionId:'flight-1'});s.api.end({sessionId:'flight-1',accepted:true,x:460,y:330});
    s.advance(280);
    const halfway=s.dock.getBoundingClientRect();
    assert.ok(halfway.left>37&&halfway.left<436);
    assert.ok(halfway.top<181+(306-181)*.875,'flight has a slight upward arc');
    assert.equal(s.w.getComputedStyle(s.stack).visibility,'hidden');
    const geometry=s.messages.filter(message=>message.type==='geometry').at(-1);
    assert.equal(geometry.pet.x,halfway.left);assert.equal(geometry.pet.y,halfway.top);
    assert.equal(geometry.regions.length,0,'moving UI must not intercept destination-app clicks');
    s.advance(280);
    assert.equal(s.dock.dataset.packDrag,'arriving');
    assert.notEqual(s.w.getComputedStyle(s.stack).visibility,'hidden');
    assert.ok(s.animations.some(animation=>animation.options.duration===240&&animation.keyframes[0].transform.includes('scale(')));
    s.advance(240);assert.equal(s.api.active(),false);
    assert.equal(s.dock.style.left,'436px');assert.equal(s.dock.style.top,'306px');
  } finally {s.dom.window.close();}
});

test('new drag snapshots the displayed mid-flight position and ignores stale native callbacks',()=>{
  const s=setup({reduced:false});
  try {
    s.api.begin({sessionId:'old'});s.api.end({sessionId:'old',accepted:true,x:460,y:330});s.advance(170);
    const home=s.dock.getBoundingClientRect();
    assert.equal(s.api.begin({sessionId:'new'}),true);
    assert.equal(s.api.end({sessionId:'old',accepted:false}),false);
    assert.equal(s.api.begin({sessionId:'new'}),false);
    assert.equal(s.api.end({sessionId:'new',accepted:false}),true);
    s.advance(320);
    assert.equal(s.dock.getBoundingClientRect().left,home.left);assert.equal(s.dock.getBoundingClientRect().top,home.top);
    assert.equal(s.api.begin({sessionId:'old'}),false);
    assert.equal(s.api.end({sessionId:'new',accepted:true,x:900,y:600}),false);
  } finally {s.dom.window.close();}
});

test('Escape during native drag leaves collection disclosure unchanged until native cancel returns home',()=>{
  const s=setup({reduced:false});
  try {
    const before=JSON.stringify(s.ui.getState());
    s.api.begin({sessionId:'escape'});
    s.w.document.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(JSON.stringify(s.ui.getState()),before);
    s.api.end({sessionId:'escape',accepted:false});s.advance(319);
    assert.equal(s.api.active(),true);assert.equal(s.w.getComputedStyle(s.stack).visibility,'hidden');
    s.advance(1);assert.equal(s.api.active(),false);
    assert.equal(s.dock.style.left,'37px');assert.equal(s.dock.style.top,'181px');
    assert.equal(JSON.stringify(s.ui.getState()),before);
  } finally {s.dom.window.close();}
});

test('screen edges clamp the destination, while cross-screen source coordinates may start outside the viewport',()=>{
  const s=setup({reduced:false});
  try {
    s.api.begin({sessionId:'cross-screen'});
    s.api.end({sessionId:'cross-screen',accepted:true,x:5000,y:5000,fromX:-400,fromY:200});
    assert.equal(s.dock.style.left,'-400px');assert.equal(s.dock.style.top,'200px');
    s.advance(560);s.advance(240);
    assert.ok(Number.parseFloat(s.dock.style.left)<=s.w.innerWidth-60);
    assert.ok(Number.parseFloat(s.dock.style.top)<=s.w.innerHeight-60);
    assert.equal(s.api.active(),false);
  } finally {s.dom.window.close();}
});

test('Office fixed placement is untouched and malformed drops cannot leave a stuck drag state',()=>{
  const s=setup();
  try {
    const placement=s.dock.getAttribute('style');s.w.TuotieOfficePaste={open:true};
    assert.equal(s.api.begin({sessionId:'office'}),false);assert.equal(s.dock.getAttribute('style'),placement);
    s.w.TuotieOfficePaste.open=false;
    s.api.begin({sessionId:'invalid'});s.api.end({sessionId:'invalid',accepted:true,x:NaN,y:50});
    assert.equal(s.api.active(),false);assert.equal(s.dock.getAttribute('style'),placement);
  } finally {s.dom.window.close();}
});

test('an Office fixed panel opening during a flight takes ownership of placement immediately',()=>{
  const s=setup({reduced:false});
  try {
    s.api.begin({sessionId:'interrupted-office'});s.api.end({sessionId:'interrupted-office',accepted:true,x:460,y:330});s.advance(100);
    s.w.TuotieOfficePaste={open:true};s.dock.style.left='0px';s.dock.style.top='0px';
    const anchored=s.dock.getAttribute('style');s.advance(100);
    assert.equal(s.dock.getAttribute('style'),anchored);assert.equal(s.api.active(),false);
  } finally {s.dom.window.close();}
});
