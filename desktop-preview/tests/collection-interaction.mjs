import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8');
const liveScript=readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8');
function setup(live=false) {
  const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
  dom.window.eval(overlay);
  if(live)dom.window.eval(liveScript);
  return dom;
}
const item=(id)=>({id,type:'text',source:{title:`笔记 ${id}`,url:`https://example.org/${id}`},body:{text:`内容 ${id}`}});

test('collection offers at most two real ready candidates and keeps their controls stable while polling',()=>{
 const dom=setup(true);
 try {
  const w=dom.window,d=w.document,messages=[];w.matchMedia=()=>({matches:true});
  w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
  const focus={appName:'Blender',bundleId:'org.blenderfoundation.blender'};
  w.TuotieDesktopLive.setFocus('Blender',focus);
  const agent={phase:'ready',destinationId:'blender',focus,actions:['生成参考物体','调整现有物体','第三个方向'],questions:[],plannedSourceIds:['one']};
  const apply=patch=>w.TuotieDesktopLive.apply({items:[item('one')],agent:{...agent,...patch}});
  apply();w.TuotieDesktopLive.showContent();
  const buttons=()=>[...d.querySelectorAll('#intentPanel [data-intent]')];
  assert.equal(d.querySelector('#intentPanel').hidden,false);
  assert.deepEqual(buttons().map(button=>button.textContent),agent.actions.slice(0,2));
  assert.equal(w.getComputedStyle(buttons()[0].parentNode).display,'grid');
  assert.equal(w.getComputedStyle(buttons()[0]).minHeight,'34px');
  const first=buttons()[0];apply({step:'相同推荐的新状态'});
  assert.equal(buttons()[0],first,'an unchanged candidate keeps its DOM and focus');
  assert.equal(messages.some(message=>message.type==='work'),false);
  apply({phase:'planning'});assert.equal(d.querySelector('#intentPanel').hidden,true);
  apply({questions:['要改哪一个？']});assert.equal(d.querySelector('#intentPanel').hidden,true);
  apply({needsClarification:true});assert.equal(d.querySelector('#intentPanel').hidden,true);
  apply();w.TuotieDesktopLive.setFocus('其他应用',{bundleId:'com.example.other'});
  assert.equal(d.querySelector('#intentPanel').hidden,true,'stale focus cannot offer the Blender candidate');
  w.TuotieDesktopLive.setFocus('Blender',focus);apply({plannedSourceIds:['old']});
  assert.equal(d.querySelector('#intentPanel').hidden,true,'stale source plans stay hidden');
  apply();buttons()[1].click();
  const work=messages.filter(message=>message.type==='work');
  assert.equal(work.length,1);assert.equal(work[0].actionIndex,1);
  assert.deepEqual(Array.from(work[0].sourceIds),['one']);
 } finally {dom.window.close();}
});

test('expanded rows show only real content and hover reveals reachable source links without changing collection data',()=>{
 const dom=setup(true);
 try {
  const w=dom.window,d=w.document,timers=new Map(),messages=[];let token=0;
  w.matchMedia=()=>({matches:true});
  w.setTimeout=(fn,delay)=>{timers.set(++token,{fn,delay});return token;};
  w.clearTimeout=id=>timers.delete(id);
  w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  const run=delay=>{for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.fn();}};
  const text='这是采集的正文，而不是应用标题。'.repeat(12)+'<script>unsafe()</script>';
  const data=[{...item('content'),source:{title:'网页标题',url:'https://example.org/article#section',appName:'Google Chrome'},body:{text}},
   {id:'table-real',type:'table',source:{appName:'Microsoft Excel',bundleId:'com.microsoft.Excel',title:'工作簿'},body:{text:'姓名\t数量\n甲\t137\n乙\t222'}},
   {id:'image-real',type:'image',source:{appName:'微信',bundleId:'com.tencent.xinWeChat'},preview:'data:image/png;base64,iVBORw0KGgo=',body:{}}];
  w.TuotieDesktopLive.apply({items:data,agent:{phase:'ready',destinationId:'system'}});
  d.querySelector('#dockBot').click();
  const row=d.querySelector('[data-card="content"]'),panel=d.querySelector('#collectionHover'),body=d.querySelector('#bundleBody');
  assert.equal(row.querySelector('.collection-row-content').textContent,text);
  assert.equal(row.querySelector('.collection-row-content script'),null);
  assert.equal(w.getComputedStyle(row.querySelector('.bundle-card-copy')).display,'none');
  assert.equal(w.getComputedStyle(row.querySelector('.thumb-button')).display,'none');
  assert.equal(w.getComputedStyle(row.querySelector('.collection-preview-text')).textOverflow,'ellipsis');
  assert.ok(d.querySelector('[data-card="table-real"] .collection-preview-table').textContent.includes('137'));
  assert.equal(d.querySelector('[data-card="image-real"] .collection-preview-image').getAttribute('src'),data[2].preview);
  const rect=(x,y,width,height)=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height});
  body.getBoundingClientRect=()=>rect(100,120,340,280);
  row.getBoundingClientRect=()=>rect(100,130,340,34);
  panel.getBoundingClientRect=()=>rect(parseFloat(panel.style.left)||0,parseFloat(panel.style.top)||0,300,230);
  row.dispatchEvent(new w.MouseEvent('pointerover',{bubbles:true}));
  assert.equal(panel.hidden,true);run(220);assert.equal(panel.hidden,false);
  assert.equal(panel.querySelector('.origin-link').getAttribute('href'),'https://example.org/article#section');
  assert.equal(panel.querySelector('.collection-hover-app').textContent,'应用：Google Chrome');
  assert.equal(panel.querySelector('.collection-hover-detail'),null);
  row.click();row.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(d.querySelector('#detailBackdrop').hidden,true);
  assert.equal(panel.hidden,false);
  assert.equal(panel.querySelector('.collection-preview-text').textContent,text);
  const geometry=messages.filter(m=>m.type==='geometry').at(-1);
  assert.ok(geometry.surfaces.some(s=>s.x===452&&s.width===300),'popover has its own glass');
  assert.ok(geometry.regions.some(s=>s.x===452&&s.width===300),'source link is inside a native hit region');
  row.dispatchEvent(new w.MouseEvent('pointerout',{bubbles:true,relatedTarget:panel}));run(180);assert.equal(panel.hidden,false);
  panel.dispatchEvent(new w.MouseEvent('pointerleave'));panel.dispatchEvent(new w.MouseEvent('pointerenter'));run(180);assert.equal(panel.hidden,false);
  w.innerWidth=360;w.dispatchEvent(new w.Event('resize'));
  assert.ok(parseFloat(panel.style.left)>=12&&parseFloat(panel.style.left)+300<=348,'popover stays in narrow screens');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(panel.hidden,true);
  row.dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));run(220);assert.equal(panel.hidden,false);
  body.dispatchEvent(new w.Event('scroll'));assert.equal(panel.hidden,true);
  row.dispatchEvent(new w.MouseEvent('pointerover',{bubbles:true}));run(220);
  d.querySelector('#collapseButton').click();assert.equal(panel.hidden,true);
  assert.equal(w.TuotieUI.getState().sourceIds.length,3);
 } finally {dom.window.close();}
});

test('compact stack preserves content heights and image provenance remains visible on hover',()=>{
 const dom=setup(true);
 try {
  const w=dom.window,d=w.document,timers=[];w.matchMedia=()=>({matches:true});
  w.setTimeout=(fn,delay)=>{if(delay===220)timers.push(fn);return timers.length;};w.clearTimeout=()=>{};
  const image={id:'image',type:'image',source:{url:'https://example.org/image'},preview:'data:image/png;base64,iVBORw0KGgo=',body:{}};
  w.TuotieDesktopLive.apply({items:[item('text'),image,item('last')],agent:{phase:'ready',destinationId:'system'}});
  d.querySelector('#dockBot').click();d.querySelector('#collapseButton').click();
  const rows=[...d.querySelectorAll('#bundleBody .bundle-card')];
  assert.equal(w.getComputedStyle(rows[0]).height,'34px');
  assert.equal(w.getComputedStyle(rows[1]).height,'62px');
  assert.equal(rows[1].style.getPropertyValue('--card-y'),'-18px','mixed-height layers share their bottom edge');
  assert.equal(w.getComputedStyle(rows[0].querySelector('.bundle-card-copy')).display,'none');
  rows[0].click();assert.equal(d.querySelector('#bundle').getAttribute('aria-expanded'),'false');
  d.querySelector('#collapseButton').click();
  const photo=d.querySelector('[data-card="image"]'),body=d.querySelector('#bundleBody');
  body.getBoundingClientRect=()=>({top:0,bottom:300});
  photo.getBoundingClientRect=()=>({top:40,bottom:102,left:100,right:440});
  photo.dispatchEvent(new w.MouseEvent('pointerover',{bubbles:true}));timers.pop()();
  assert.equal(d.querySelector('.collection-hover-app').textContent,'应用：浏览器（未记录具体应用）');
  assert.equal(d.querySelector('#collectionHover .origin-link').href,'https://example.org/image');
  const icon='data:image/png;base64,iVBORw0KGgo=';
  w.TuotieDesktopLive.apply({items:[{...image,source:{appName:'微信',bundleId:'com.tencent.xinWeChat',appIcon:icon}}],agent:{phase:'ready',destinationId:'system'}});
  const updated=d.querySelector('[data-card="image"]');updated.getBoundingClientRect=photo.getBoundingClientRect;
  updated.dispatchEvent(new w.MouseEvent('pointerover',{bubbles:true}));timers.pop()();
  assert.equal(d.querySelector('.collection-hover-app').textContent,'应用：微信');
  assert.equal(d.querySelector('.collection-app-icon').getAttribute('src'),icon);
  assert.equal(d.querySelector('#collectionHover button'),null);
 } finally {dom.window.close();}
});

test('native hit regions follow the actual collection surface, including controls beyond its wrapper',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document,messages=[];
    w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      const width=this.id==='bundle'?340:this.id==='bundleStack'?300:0;
      return {left:100,top:100,right:100+width,bottom:180,width,height:width?80:0};
    };
    w.TuotieDesktopLive.apply({items:[item('one')],agent:{phase:'ready',destinationId:'system'}});
    d.querySelector('#dockBot').click();
    const report=()=>{w.dispatchEvent(new w.Event('resize'));return messages.filter(m=>m.type==='geometry').at(-1);};
    const coversDelete=geometry=>geometry.regions.some(r=>r.x<=425&&r.x+r.width>=425&&r.y<=130&&r.y+r.height>=130);
    assert.equal(coversDelete(report()),true,'the surface right edge must receive clicks even if its wrapper is smaller');
    d.querySelector('#dockBot').click();
    assert.equal(coversDelete(report()),false,'collapsed content must release clicks to the underlying app');
  } finally {dom.window.close();}
});

test('collection reveal animates the package without reviving the removed composer',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document,calls=[];
    Object.defineProperty(d,'timeline',{value:{currentTime:1200},configurable:true});
    w.HTMLElement.prototype.getAnimations=()=>[];
    w.HTMLElement.prototype.animate=function(frames,options){
      const animation={startTime:null,cancel(){}};calls.push({id:this.id,frames,options,animation});return animation;
    };
    w.TuotieUI.dispatch({type:'source/add',id:'text'});
    assert.deepEqual(calls.map(call=>call.id),['bundleStack']);
    assert.equal(d.querySelector('#intentPanel .direction-composer'),null);
    assert.equal(calls[0].animation.startTime,1200);
    calls.length=0;
    w.TuotieUI.dispatch({type:'source/add',id:'image'});
    assert.equal(calls.length,0,'adding a card should not bounce the whole package independently');
  } finally {dom.window.close();}
});

test('rear text is occluded in the stack and becomes readable when expanded',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document;
    w.TuotieDesktopLive.apply({items:[item('one'),item('two')],agent:{phase:'ready',destinationId:'system'}});
    d.querySelector('#dockBot').click();d.querySelector('#collapseButton').click();
    const rear=d.querySelectorAll('#bundleBody .bundle-card')[1];
    assert.equal(w.getComputedStyle(rear.querySelector('.bundle-card-copy')).visibility,'hidden');
    d.querySelector('#collapseButton').click();
    w.TuotieDesktopLive.setFocus('文本编辑',{bundleId:'com.apple.TextEdit'});
    assert.equal(w.getComputedStyle(d.querySelector('#targetFooter')).display,'none');
    assert.equal(d.querySelector('#bundle').classList.contains('collection-list'),true);
    assert.notEqual(w.getComputedStyle(d.querySelectorAll('.collection-row-content')[1]).visibility,'hidden');
  } finally {dom.window.close();}
});

test('overlapped rear pixels and native backdrops are cropped without any material opacity animation',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document,calls=[],messages=[];
    Object.defineProperty(d,'timeline',{value:{currentTime:1200},configurable:true});
    w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      if(this.matches('.bundle-card')) {
        const index=['one','two','three','four','five'].indexOf(this.dataset.card);
        const expanded=d.querySelector('#bundle').classList.contains('collection-list');
        const depth=Math.min(index,2);
        const top=100+(expanded?index*66:depth*10),left=expanded?0:depth*10,width=340-left*2;
        return {top,left,right:left+width,bottom:top+60,width,height:60};
      }
      if(this.id==='bundleBody')return {top:100,left:0,right:340,bottom:400,width:340,height:300};
      if(this.id==='bundle') {
        const height=this.classList.contains('collection-list')?360:116;
        return {top:64,left:0,right:340,bottom:64+height,width:340,height};
      }
      return {top:0,left:0,right:0,bottom:0,width:0,height:0};
    };
    w.TuotieDesktopLive.apply({items:[item('one'),item('two'),item('three'),item('four'),item('five')],agent:{phase:'ready',destinationId:'system'}});
    d.querySelector('#dockBot').click();d.querySelector('#collapseButton').click();
    const report=()=>{w.dispatchEvent(new w.Event('resize'));return messages.filter(m=>m.type==='geometry').at(-1);};
    const stack=Array.from(report().surfaces);
    assert.deepEqual(stack.map(s=>[s.y,s.width,s.height,s.clipTop]),[[100,340,60,0],[110,320,60,50],[120,300,60,50]]);
    assert.equal(stack.length,3,'only three native surfaces are visible despite five retained rows');
    const front=d.querySelector('.collection-front'),tint=w.getComputedStyle(front).backgroundColor;
    assert.equal(d.querySelector('.collection-card-coating'),null);
    w.HTMLElement.prototype.animate=function(frames,options){
      const animation={startTime:null,cancel(){}};
      calls.push({element:this,frames,options,animation});return animation;
    };
    d.querySelector('#collapseButton').click();
    assert.equal(d.querySelector('#collapseButton').textContent,'5 条内容');
    assert.equal(d.querySelector('#collapseButton').getAttribute('aria-expanded'),'true');
    assert.deepEqual(calls.filter(c=>c.element.matches('.bundle-card')).map(c=>c.element.dataset.card),['one','two','three','four','five']);
    assert.equal(calls.find(c=>c.element.id==='bundle').frames[1].height,'360px');
    assert.ok(calls.every(c=>c.animation.startTime===1200),'height and rows must share one animation clock');
    assert.ok(calls.filter(c=>['four','five'].includes(c.element.dataset.card)).every(c=>c.frames[0].transform!==c.frames[1].transform),'overflow rows must also travel from the third layer');
    assert.deepEqual(Array.from(report().surfaces,s=>s.height),[60,60,60,60,60]);
    calls.length=0;
    assert.equal(w.getComputedStyle(d.querySelector('.bundle-card')).backgroundColor,tint);
    d.querySelector('#collapseButton').click();
    assert.equal(d.querySelector('#collapseButton').textContent,'5 条内容');
    assert.equal(d.querySelector('#collapseButton').getAttribute('aria-expanded'),'false');
    assert.equal(calls.filter(c=>c.element.matches('.bundle-card')).length,5,'overflow rows remain for the closing motion');
    assert.ok(calls.length>0);
    assert.ok(calls.every(c=>c.frames.every(frame=>!('opacity' in frame)&&!('backgroundColor' in frame))));
  } finally {dom.window.close();}
});

test('empty click speaks beside the pet for five seconds and repeated click renews that lifetime',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document;
    const timers=new Map();let next=10000;
    const originalSet=w.setTimeout.bind(w),originalClear=w.clearTimeout.bind(w);
    w.setTimeout=(callback,delay,...args)=>{if(delay!==5000)return originalSet(callback,delay,...args);const id=next++;timers.set(id,callback);return id;};
    w.clearTimeout=id=>{timers.delete(id);originalClear(id);};
    assert.equal(d.querySelector('#bundleStack').hidden,true);
    d.querySelector('#dockBot').click();
    assert.equal(d.querySelector('#emptyBubble').hidden,false);
    assert.equal(d.querySelector('#emptyBubble').textContent,'当前还没有内容可以复制');
    assert.equal(d.querySelector('#intentPanel').hidden,true);
    d.querySelector('#dockBot').click();
    assert.equal(timers.size,1);
    [...timers.values()][0]();
    assert.equal(d.querySelector('#emptyBubble').hidden,true);
  } finally {dom.window.close();}
});

test('startup restores content quietly; a new capture opens the expanded list and dismisses the empty bubble',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document,live=w.TuotieDesktopLive;
    live.apply({items:[item('one')],agent:{phase:'ready',destinationId:'system'}});
    assert.equal(d.querySelector('#bundleStack').hidden,true);
    assert.equal(d.querySelector('#intentPanel').hidden,true);
    live.apply({items:[item('one'),item('two')],agent:{phase:'ready',destinationId:'system'}});
    assert.equal(d.querySelector('#bundleStack').hidden,false);
    assert.equal(d.querySelector('#intentPanel').hidden,true,'new content opens the package without fabricating a clipboard recommendation');
    assert.equal(d.querySelectorAll('#bundle .collection-front').length,0);
    assert.equal(d.querySelector('#collapseButton').getAttribute('aria-expanded'),'true');
    assert.equal(d.querySelector('#bundle').getAttribute('aria-label'),'内容包列表');
  } finally {dom.window.close();}
});

test('stack caps at three progressively narrower layers and disclosure opens compact non-clickable rows',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document;
    w.TuotieDesktopLive.apply({items:Array.from({length:8},(_,i)=>item(`note-${i}`)),agent:{phase:'ready',destinationId:'system'}});
    d.querySelector('#dockBot').click();d.querySelector('#collapseButton').click();
    assert.equal(d.querySelectorAll('#bundleBody .bundle-card').length,8,'retain hidden rows for continuous unfolding');
    assert.deepEqual([...d.querySelectorAll('#bundleBody .bundle-card')].map(card=>card.style.getPropertyValue('--card-inset')),['0px','10px','20px','20px','20px','20px','20px','20px']);
    assert.equal(d.querySelector('.collection-front').dataset.card,'note-0');
    assert.equal(d.querySelectorAll('#bundleBody .bundle-card')[1].style.getPropertyValue('--card-angle'),'');
    assert.equal(d.querySelectorAll('#bundleBody .bundle-card')[1].style.getPropertyValue('--card-x'),'');
    assert.notEqual(w.getComputedStyle(d.querySelector('.bundle-header')).display,'none');
    assert.equal(d.querySelector('#collapseButton').getAttribute('aria-expanded'),'false');
    d.querySelector('#collapseButton').click();
    assert.equal(d.querySelectorAll('#bundleBody .bundle-card').length,8);
    assert.equal(d.querySelector('#bundle').getAttribute('aria-expanded'),'true');
    assert.equal(d.querySelector('#collapseButton').getAttribute('aria-expanded'),'true');
    d.querySelector('[data-card="note-7"] .bundle-card-copy').click();
    assert.equal(d.querySelector('#detailBackdrop').hidden,true,'card clicks must not open details');
    assert.equal(d.querySelectorAll('#bundleBody .bundle-card').length,8);
    d.querySelector('#collapseButton').click();
    assert.equal(d.querySelector('#bundle').classList.contains('collection-stack'),true);
  } finally {dom.window.close();}
});

test('polls do not revive the removed collection editor or reset collapsed preference',()=>{
 const dom=setup(true);
 try {
  const w=dom.window,d=w.document;
  const snapshot={items:[item('one')],agent:{phase:'ready',destinationId:'system'}};
  w.TuotieDesktopLive.apply(snapshot);d.querySelector('#dockBot').click();
  assert.equal(d.querySelector('#intentPanel .direction-composer'),null);
  d.querySelector('#dockBot').click();
  w.TuotieDesktopLive.apply(snapshot);
  assert.equal(d.querySelector('#bundleStack').hidden,true);
  assert.equal(d.querySelector('#intentPanel .direction-composer'),null);
 } finally {dom.window.close();}
});

test('only the disclosure opens the stack; card activation never opens a modal and Escape closes the list',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document;
    w.TuotieUI.dispatch({type:'source/add',id:'text'});
    const key=element=>element.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    key(d.querySelector('[data-card="text"]'));
    assert.equal(d.querySelector('#detailBackdrop').hidden,true);
    const escape=()=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    escape();assert.equal(d.querySelector('#bundle').classList.contains('collection-stack'),true);
    escape();assert.equal(d.querySelector('#bundleStack').hidden,true);
  } finally {dom.window.close();}
});

test('removing the last item returns to the ball; the next click gives empty feedback',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document;
    w.TuotieUI.dispatch({type:'source/add',id:'text'});d.querySelector('#collapseButton').click();
    d.querySelector('[data-remove="text"]').click();
    assert.equal(w.TuotieUI.getState().sourceIds.length,0);
    assert.equal(d.querySelector('#bundleStack').hidden,true);
    assert.equal(d.querySelector('#intentPanel').hidden,true);
    d.querySelector('#dockBot').click();assert.equal(d.querySelector('#emptyBubble').hidden,false);
  } finally {dom.window.close();}
});

test('reduced motion skips spring playback and geometry follows the side with available room',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document;let animations=0;
    w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.animate=()=>{animations++;};
    d.querySelector('#dock').getBoundingClientRect=()=>({left:900,top:100,width:48,height:48,bottom:148,right:948});
    w.TuotieUI.dispatch({type:'source/add',id:'text'});
    assert.equal(animations,0);
    assert.equal(d.querySelector('#dock').style.getPropertyValue('--collection-x'),'-356px');
  } finally {dom.window.close();}
});

test('moving near the screen bottom eases viewport and native fade together, including interrupted moves',()=>{
  const dom=setup(true);
  try {
    const w=dom.window,d=w.document,dock=d.querySelector('#dock'),body=d.querySelector('#bundleBody');
    const frames=new Map(),messages=[];let time=0,sequence=0,top=200;
    w.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence;};
    w.cancelAnimationFrame=id=>frames.delete(id);
    w.performance.now=()=>time;
    w.innerHeight=800;
    w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
    const height=()=>parseFloat(dock.style.getPropertyValue('--collection-list-height'));
    Object.defineProperties(body,{scrollHeight:{get:()=>400},clientHeight:{get:height},offsetHeight:{get:height}});
    const rect=(y,h)=>({left:80,right:420,top:y,bottom:y+h,width:340,height:h});
    dock.getBoundingClientRect=()=>rect(top,48);
    body.getBoundingClientRect=()=>rect(top+92,height());
    w.TuotieDesktopLive.apply({items:['one','two','three','four','five'].map(item),agent:{phase:'ready',destinationId:'system'}});
    d.querySelector('#dockBot').click();
    for(const [index,card] of [...body.children].entries())card.getBoundingClientRect=()=>rect(top+92+index*66,60);
    const step=ms=>{
      time=ms;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(time));
    };
    assert.equal(height(),310);
    top=450;w.dispatchEvent(new w.Event('resize'));
    assert.equal(height(),310,'resizing must not jump to the shorter viewport');
    step(70);
    const first=height();assert.ok(first>180&&first<310);
    const surface=messages.filter(m=>m.type==='geometry').at(-1).surfaces.find(s=>s.fadeBottom>0);
    assert.ok(surface,'native glass must follow every intermediate frame');
    assert.ok(Math.abs(surface.y+surface.height-surface.fadeBottomOffset-(top+92+first))<.01);
    assert.equal(body.style.getPropertyValue('--collection-bottom-fade'),'32.000px');
    top=350;w.dispatchEvent(new w.Event('resize'));
    assert.equal(height(),first,'an interrupted resize starts at its current displayed height');
    step(210);assert.ok(height()>first&&height()<280);
    step(350);assert.equal(height(),280);
    dock.classList.add('is-dragging');top=470;w.dispatchEvent(new w.Event('pointermove'));
    assert.equal(height(),280);
    step(420);assert.ok(height()>160&&height()<280,'dragging updates the viewport before pointer release');
    w.matchMedia=()=>({matches:true});w.dispatchEvent(new w.Event('resize'));
    assert.equal(height(),160,'reduced motion settles immediately');
    assert.equal(frames.size,0);
  } finally {dom.window.close();}
});

test('expanded cards each get their own native backdrop and scroll clipping leaves no glass outside the list',()=>{
  const dom=setup();
  try {
    const w=dom.window,d=w.document,messages=[];let scroll=0;
    w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
    w.HTMLElement.prototype.getBoundingClientRect=function(){
      const ids=['text','image','table','video'];
      let y=-1,height=0;
      if(this.matches('.direction-composer')){y=20;height=40;}
      if(this.id==='bundle'){y=50;height=400;}
      if(this.id==='bundleBody'){y=100;height=146;}
      if(this.matches('.bundle-card')){y=100+ids.indexOf(this.dataset.card)*78-scroll;height=68;}
      return {left:80,right:420,top:y,bottom:y+height,width:340,height};
    };
    for(const id of ['text','image','table','video'])w.TuotieUI.dispatch({type:'source/add',id});
    const body=d.querySelector('#bundleBody');
    Object.defineProperties(body,{
      scrollHeight:{get:()=>302},clientHeight:{get:()=>146},scrollTop:{get:()=>scroll}
    });
    const report=()=>{d.querySelector('#bundleBody').dispatchEvent(new w.Event('scroll'));return messages.filter(m=>m.type==='geometry').at(-1);};
    assert.deepEqual(Array.from(report().surfaces,s=>s.y).sort((a,b)=>a-b),[100,178]);
    assert.equal(body.style.getPropertyValue('--collection-bottom-fade'),'32.000px');
    assert.deepEqual(Array.from(report().surfaces,s=>[s.y,s.fadeBottom,s.fadeBottomOffset]).sort((a,b)=>a[0]-b[0]),[[100,0,0],[178,32,0]]);
    scroll=39;
    const surfaces=Array.from(report().surfaces,s=>({...s,y:s.y+s.clipTop,height:s.height-s.clipTop-s.clipBottom})).sort((a,b)=>a.y-b.y);
    assert.deepEqual(surfaces.map(s=>s.y),[100,139,217]);
    assert.deepEqual(surfaces.map(s=>s.height),[29,68,29]);
    assert.deepEqual(surfaces.map(s=>s.fadeBottom),[0,0,32]);
    assert.equal(surfaces.at(-1).fadeBottomOffset,39,'native fade shares the viewport edge despite partial clipping');
    scroll=146; report();
    assert.equal(body.style.getPropertyValue('--collection-bottom-fade'),'10.000px','fade shrinks continuously near the end');
    scroll=156;
    assert.ok(Array.from(report().surfaces).every(s=>s.fadeBottom===0));
    assert.equal(body.classList.contains('collection-scroll-fade'),false,'last card must be completely readable at the end');
    scroll=0; report();
    d.querySelector('#collapseButton').click(); report();
    assert.equal(body.classList.contains('collection-scroll-fade'),false,'stack never inherits a scroll fade');
  } finally {dom.window.close();}
});
