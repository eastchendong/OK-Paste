import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8');
const live=readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8');
const item={id:'note',type:'text',source:{title:'测试资料'},body:{text:'合成资料'}};
const agent={phase:'ready',targetKind:'word-live',destinationId:'office',targetName:'测试 Word',plannedSourceIds:['note'],actions:['补充背景']};
function setup(initial=agent){
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};w.eval(overlay);w.eval(live);
 const apply=(next=initial)=>w.TuotieDesktopLive.apply({items:[item],agent:next});
 apply();return {dom,w,d,messages,apply,open:()=>w.TuotieDesktopLive.openWordPaste({x:180,y:220,exact:true})};
}
test('DeepSeek first recommendation uses the original composer and falls back to manual input without retry',()=>{
 const unavailable={...agent,actions:[],initialRecommendation:{status:'unavailable'},step:'请输入你的要求'};
 const {dom,w,d,messages,apply,open}=setup(unavailable);
 try{
  open();assert.equal(d.getElementById('intentInput').dataset.placeholder,'请输入你的要求');
  assert.equal(d.querySelector('[data-agent-retry]'),null);
  assert.equal(d.querySelector('[data-start]').disabled,true);
  const editor=d.getElementById('intentInput');editor.textContent='保留我的草稿';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  apply({...agent,actions:['根据资料补充人员分工。'],initialRecommendation:{status:'ready',modelMs:1000}});
  assert.equal(editor.textContent,'保留我的草稿');
  d.querySelector('[data-start]').click();assert.equal(messages.find(m=>m.type==='work').instruction,'保留我的草稿');
 }finally{dom.window.close();}
});

test('saved target stays visible across focus changes; repeated opening preserves draft and panel position',()=>{
 const pinned={...agent,targetLocation:'第二节 · 活动安排',anchor:{appName:'Word',bundleId:'com.microsoft.Word',windowTitle:'测试 Word'}};
 const {dom,w,d,messages,apply,open}=setup(pinned);
 try{
  open();const editor=d.getElementById('intentInput');editor.textContent='写一段补充说明';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  const left=d.getElementById('officePastePanel').style.left;
  editor.blur();w.TuotieDesktopLive.setFocus({appName:'其他应用',bundleId:'com.example.other'});
  apply({...pinned,foregroundFocus:{appName:'其他应用',bundleId:'com.example.other'}});
  w.TuotieDesktopLive.openWordPaste({x:500,y:500,exact:true});
  assert.equal(d.getElementById('intentInput'),editor);assert.equal(editor.textContent,'写一段补充说明');
  assert.equal(d.getElementById('officePastePanel').style.left,left);
  assert.match(d.querySelector('[data-paste-target]').textContent,/第二节 · 活动安排/);
  assert.match(d.querySelector('[data-paste-target]').title,/不会更改/);
  d.querySelector('[data-end-paste]').click();assert.ok(messages.some(m=>m.type==='sceneControl'&&m.action==='finish'));
 }finally{dom.window.close();}
});
test('released empty task closes the composer and permits a fresh paste',()=>{
 const {dom,w,d,open}=setup();
 try{
  open();
  w.TuotieDesktopLive.apply({items:[],agent:{phase:'idle',destinationId:'office',actions:[]}});
  assert.equal(w.TuotieOfficePaste.open,false);
  assert.equal(d.getElementById('officePastePanel').hidden,true);
  w.TuotieDesktopLive.apply({items:[{...item,id:'new-note'}],agent:{...agent,plannedSourceIds:['new-note']}});
  open();assert.equal(w.TuotieOfficePaste.open,true);
  assert.equal(d.getElementById('intentInput').dataset.placeholder,'补充背景');
 }finally{dom.window.close();}
});
test('explicit paste moves the same IP and collected rows under one composer; empty send submits its one AI recommendation',()=>{
 const {dom,w,d,messages,open}=setup();
 try {
  assert.equal(d.getElementById('intentPanel').hidden,true);
  const pet=d.getElementById('dockPet'),row=d.querySelector('[data-card="note"]');
  open();
  assert.equal(d.querySelector('#officePastePanel #dockPet'),pet);
  assert.equal(d.querySelector('#officePastePanel [data-card="note"]'),row);
  assert.equal(d.querySelector('#bundle').classList.contains('collection-list'),true);
  assert.equal(d.getElementById('bundleStack').hidden,false);
  assert.equal(d.querySelectorAll('#officePastePanel [data-intent],#officePastePanel [data-voice]').length,0);
  assert.equal(d.getElementById('intentInput').dataset.placeholder,'补充背景');
  assert.equal(d.getElementById('intentInput').textContent,'');
  d.getElementById('intentInput').innerHTML='<br>';
  d.getElementById('intentInput').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.getElementById('intentInput').dataset.empty,'true','deleting typed text restores the visible default');
  d.querySelector('#officePastePanel [data-start]').click();
  const work=messages.find(m=>m.type==='work');
  assert.equal(work.instruction,'补充背景');assert.equal(work.destinationId,'office');
  assert.equal(d.querySelector('#bundleStack').hidden,true);
  assert.equal(d.querySelector('#intentPanel').hidden,true);
  assert.equal(d.querySelector('#taskPanel').textContent,'正在加工中');
  assert.equal(d.querySelector('#taskPanel .mention-editor'),null);
  assert.ok(d.querySelector('#taskPanel [data-stop]'));
 }finally{dom.window.close();}
});
test('ending a task clears its drafts; starting another does not reuse an old adjustment',()=>{
 const {dom,w,d,apply,open}=setup();
 try{
  open();const editor=d.getElementById('intentInput');editor.textContent='上个任务的要求';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-start]').click();apply({...agent,phase:'done',targetLocation:'二、活动安排 · 正文第 5 段',revision:1,canUndo:true,result:'已写入。'});w.TuotieUI.dispatch({type:'generation/finish',text:'已写入。'});
  assert.equal(d.querySelector('.paste-completion h3').textContent,'可继续调整 · 二、活动安排 · 正文第 5 段');
  const followup=d.getElementById('followupInput');followup.textContent='上个任务的调整草稿';followup.dispatchEvent(new w.Event('input',{bubbles:true}));
  apply({...agent,phase:'idle'});w.TuotieDesktopLive.controlFinished('finish');apply(agent);open();
  assert.equal(d.getElementById('intentInput').textContent,'');
  assert.deepEqual(Array.from(w.TuotieUI.getState().drafts.followup),[]);
 }finally{dom.window.close();}
});
test('recommendation updates preserve the draft and IME; loading has no fake default and custom text overrides the recommendation',()=>{
 const {dom,w,d,messages,apply,open}=setup({...agent,phase:'planning',actions:[]});
 try{
  open();const editor=d.getElementById('intentInput');
  assert.equal(d.querySelector('[data-start]').disabled,true);
  editor.textContent='请补充第三节的背景';editor.dispatchEvent(new w.Event('input',{bubbles:true}));editor.focus();
  apply(agent);assert.equal(d.getElementById('intentInput'),editor);assert.equal(editor.textContent,'请补充第三节的背景');
  editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
  assert.equal(messages.filter(m=>m.type==='work').length,0);
  d.querySelector('[data-start]').click();assert.equal(messages.find(m=>m.type==='work').instruction,'请补充第三节的背景');
 }finally{dom.window.close();}
});
test('successful write automatically opens undo, lightweight adjustments and the same source list; a quick edit reuses the task',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  open();d.querySelector('[data-start]').click();
  apply({...agent,phase:'running',mutationUncertain:true,canUndo:false});
  assert.equal(w.TuotieUI.getState().phase,'generating','waiting for a write acknowledgement is still processing');
  assert.equal(d.querySelector('#taskPanel').textContent,'正在加工中');
  apply({...agent,phase:'done',canUndo:true,result:'已写入。'});
  w.TuotieUI.dispatch({type:'generation/finish',text:'已写入。'});
  assert.equal(d.querySelector('#bundleStack').hidden,false);
  assert.equal(d.querySelectorAll('#officePastePanel [data-card]').length,1);
  assert.ok(d.querySelector('#officePastePanel [data-undo]'));
  assert.ok(d.querySelector('#officePastePanel #followupInput'));
  assert.equal(d.querySelector('#officePastePanel [data-followup]'),null);
  assert.deepEqual(Array.from(d.querySelectorAll('.adjustment-option'),b=>b.textContent),['更简短','展开一点','与上下文语气一致']);
  d.querySelector('[data-adjust-option="0"]').click();
  const works=messages.filter(m=>m.type==='work');assert.equal(works.length,2);
  assert.equal(works[1].continuation,true);assert.deepEqual(Array.from(works[1].sourceIds),['note']);
  assert.equal(d.querySelector('#bundleStack').hidden,true);
 }finally{dom.window.close();}
});
test('a pending write receipt keeps processing and clears the submitted adjustment only after success',()=>{
 const {dom,w,d,apply,open}=setup();try{
  open();d.querySelector('[data-start]').click();apply({...agent,phase:'done',revision:1,canUndo:true});w.TuotieUI.dispatch({type:'generation/finish',text:'第一版'});
  const input=d.getElementById('followupInput');input.textContent='把这一段缩短';input.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('[data-adjust-submit]').click();
  apply({...agent,phase:'running',revision:1,mutationUncertain:true,canUndo:false});
  assert.equal(w.TuotieUI.getState().phase,'generating');assert.equal(d.querySelector('#taskPanel').textContent,'正在加工中');
  apply({...agent,phase:'done',revision:2,mutationUncertain:false,canUndo:true});w.TuotieUI.dispatch({type:'generation/finish',text:'第二版'});
  assert.equal(d.getElementById('followupInput').textContent,'');
 }finally{dom.window.close();}
});
test('an undo awaiting its receipt does not show an unknown-outcome warning before the control response',()=>{
 const {dom,w,d,apply,open}=setup();try{
  open();d.querySelector('[data-start]').click();apply({...agent,phase:'done',revision:2,canUndo:true});w.TuotieUI.dispatch({type:'generation/finish',text:'第二版'});
  d.querySelector('[data-undo]').click();apply({...agent,phase:'done',revision:2,mutationUncertain:true,canUndo:false});
  assert.doesNotMatch(d.getElementById('taskPanel').textContent,/结果待确认/);assert.equal(d.getElementById('followupInput'),null);
  apply({...agent,phase:'done',revision:1,mutationUncertain:false,canUndo:true});w.TuotieDesktopLive.controlFinished('undo');
  assert.ok(d.getElementById('followupInput'));assert.ok(d.querySelector('[data-undo]'));
 }finally{dom.window.close();}
});
test('stop returns to the expanded collection without discarding sources or typed requirements',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  open();const editor=d.getElementById('intentInput');editor.textContent='待继续的要求';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-start]').click();apply({...agent,phase:'running'});
  d.querySelector('[data-stop]').click();assert.ok(messages.some(m=>m.type==='sceneControl'&&m.action==='cancel'));
  apply(agent);w.TuotieDesktopLive.controlFinished('cancel');
  assert.equal(d.querySelector('#officePastePanel').hidden,true);
  assert.equal(d.querySelector('#bundleStack').hidden,false);
  assert.equal(d.querySelector('#bundle').classList.contains('collection-list'),true);
  assert.equal(d.querySelector('#taskPanel').hidden,true);
  assert.equal(d.querySelector('#intentPanel').hidden,true);
  assert.deepEqual(Array.from(w.TuotieUI.getState().sourceIds),['note']);
  w.TuotieDesktopLive.setFocus({appName:'其他应用',bundleId:'com.example.other'});
  apply({phase:'idle',targetKind:'focused-text',destinationId:'focused',targetName:'其他应用',actions:[]});
  assert.equal(d.querySelector('[data-paste-target]'),null);
  apply(agent);
  open();assert.equal(d.getElementById('intentInput').textContent,'待继续的要求');
 }finally{dom.window.close();}
});
test('a successful write racing with stop stays visible as completed and undoable',()=>{
 const {dom,w,d,apply,open}=setup();
 try{
  open();d.querySelector('[data-start]').click();apply({...agent,phase:'running'});d.querySelector('[data-stop]').click();
  apply({...agent,phase:'done',canUndo:true,result:'已写入。'});w.TuotieDesktopLive.controlFinished('cancel');
  assert.equal(w.TuotieUI.getState().phase,'done');assert.equal(d.querySelector('#officePastePanel').hidden,false);
  assert.ok(d.querySelector('#taskPanel [data-undo]'));assert.equal(d.querySelector('#bundleStack').hidden,false);
 }finally{dom.window.close();}
});
test('Excel selection shares the single default composer and its saved-range semantics',()=>{
 const {dom,w,d,messages,apply}=setup();
 try{
  apply({...agent,targetKind:'excel-live',targetName:'Sheet1 · B2:C3',actions:['补全同比公式']});
  w.TuotieDesktopLive.openOfficePaste({x:260,y:180,exact:false},'excel');
  assert.equal(d.querySelector('#officePastePanel').getAttribute('aria-label'),'编辑 Excel 选区');
  assert.match(d.querySelector('.office-placement-note').textContent,/Excel 选区/);
  assert.equal(d.querySelector('#intentInput').dataset.placeholder,'补全同比公式');
  d.querySelector('[data-start]').click();assert.equal(messages.find(m=>m.type==='work').instruction,'补全同比公式');
 }finally{dom.window.close();}
});

test('undo returns to collection and keeps the reference material available',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  open();d.querySelector('[data-start]').click();apply({...agent,phase:'done',canUndo:true,result:'已写入。'});
  w.TuotieUI.dispatch({type:'generation/finish',text:'已写入。'});
  d.querySelector('[data-undo]').click();assert.ok(messages.some(m=>m.type==='sceneControl'&&m.action==='undo'));
  apply(agent);w.TuotieDesktopLive.controlFinished('undo');
  assert.equal(w.TuotieUI.getState().phase,'collect');assert.equal(d.querySelector('#officePastePanel').hidden,true);
  assert.equal(d.querySelector('#bundleStack').hidden,false);assert.deepEqual(Array.from(w.TuotieUI.getState().sourceIds),['note']);
 }finally{dom.window.close();}
});

for(const host of ['word','excel','figma'])test(`undoing a later ${host} revision keeps the previous result and adjustment controls visible`,()=>{
 const {dom,w,d,apply,open}=setup();
 try{
  apply({...agent,targetKind:`${host}-live`});w.TuotieDesktopLive.openOfficePaste({x:260,y:180,exact:false},host);d.querySelector('[data-start]').click();apply({...agent,targetKind:`${host}-live`,phase:'done',revision:2,canUndo:true,result:'第二版'});
  w.TuotieUI.dispatch({type:'generation/finish',text:'第二版'});
  d.querySelector('[data-undo]').click();
  apply({...agent,targetKind:`${host}-live`,phase:'done',revision:1,canUndo:true,result:'第一版'});w.TuotieDesktopLive.controlFinished('undo');
  assert.equal(w.TuotieUI.getState().phase,'done');assert.equal(d.querySelector('#officePastePanel').hidden,false);
  assert.ok(d.querySelector('[data-undo]'));assert.ok(d.querySelector('#followupInput'));assert.equal(d.querySelector('#bundleStack').hidden,false);
 }finally{dom.window.close();}
});

for(const host of ['word','excel','powerpoint','figma'])test(`an uncertain ${host} write remains visible and cannot be resent or presented as a successful cancellation`,()=>{
 const {dom,w,d,apply,open}=setup();
 try{
  apply({...agent,targetKind:`${host}-live`});w.TuotieDesktopLive.openOfficePaste({x:260,y:180,exact:false},host);d.querySelector('[data-start]').click();apply({...agent,targetKind:`${host}-live`,phase:'running'});d.querySelector('[data-stop]').click();
  apply({...agent,targetKind:`${host}-live`,phase:'done',mutationUncertain:true,canUndo:false,error:'写入结果未确认，请先检查文稿'});
  assert.equal(d.querySelector('#followupInput'),null,'an in-flight undo cannot expose a resubmittable adjustment');
  apply({...agent,targetKind:`${host}-live`,phase:'error',mutationUncertain:true,canUndo:false,error:'写入结果未确认，请先检查文稿'});
  w.TuotieDesktopLive.controlFailed('写入结果未确认，请先检查文稿');
  assert.equal(d.querySelector('#officePastePanel').hidden,false);assert.match(d.querySelector('#taskPanel').textContent,/结果待确认/);
  assert.match(d.querySelector('[role="alert"]').textContent,/先检查文稿/);assert.equal(w.TuotieDesktopLive.canSendPaste(),false);
  assert.equal(d.querySelector('#followupInput'),null);assert.equal(d.querySelector('[data-agent-retry]'),null);
 }finally{dom.window.close();}
});

test('an immediate stop survives the interval before the host reports running',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  open();d.querySelector('[data-start]').click();d.querySelector('[data-stop]').click();
  assert.equal(messages.some(m=>m.type==='sceneControl'&&m.action==='cancel'),false);
  assert.equal(d.querySelector('[data-start]').disabled,true,'cannot submit another task while stop is pending');
  apply({...agent,phase:'running'});
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='cancel').length,1);
  apply(agent);w.TuotieDesktopLive.controlFinished('cancel');
  assert.equal(w.TuotieUI.getState().phase,'collect');assert.equal(d.querySelector('#bundleStack').hidden,false);
 }finally{dom.window.close();}
});
test('backend restart ends the stale target and undo UI without resending an old task',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  apply({...agent,runtimeSessionId:'old'});open();d.querySelector('[data-start]').click();
  apply({...agent,runtimeSessionId:'old',phase:'done',revision:1,canUndo:true,result:'第一版'});
  const sent=messages.filter(message=>message.type==='work').length;
  apply({...agent,runtimeSessionId:'new',phase:'idle',targetKind:'focused-text',destinationId:'focused',revision:undefined,canUndo:false});
  assert.equal(d.querySelector('#officePastePanel').hidden,true);assert.equal(w.TuotieUI.getState().phase,'collect');
  assert.equal(d.querySelector('#followupInput'),null);assert.equal(messages.filter(message=>message.type==='work').length,sent);
 }finally{dom.window.close();}
});

test('drag and fold a pending task, submit a custom draft during planning, then resume its result',()=>{
 const {dom,w,d,messages,apply,open}=setup({...agent,phase:'planning',actions:[]});
 try{
  open();
  const host=d.getElementById('officePastePanel'),bot=d.getElementById('dockBot'),editor=d.getElementById('intentInput');
  bot.setPointerCapture=()=>{};bot.hasPointerCapture=()=>false;
  const pointer=(type,x,y)=>bot.dispatchEvent(Object.assign(new w.MouseEvent(type,{bubbles:true,clientX:x,clientY:y}),{isPrimary:true,pointerId:1}));
  pointer('pointerdown',20,20);pointer('pointermove',280,240);pointer('pointerup',280,240);bot.click();
  assert.equal(host.style.left,'260px');assert.equal(host.classList.contains('folded'),false);
  editor.textContent='自定义任务';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  const fold=()=>editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  fold();assert.ok(host.classList.contains('folded'));bot.click();
  assert.equal(editor.textContent,'自定义任务');assert.equal(host.classList.contains('folded'),false);
  d.querySelector('[data-start]').click();
  assert.equal(messages.filter(m=>m.type==='work').length,1);
  fold();apply({...agent,phase:'done',revision:1,canUndo:true,result:'已写入'});
  w.TuotieUI.dispatch({type:'generation/finish',text:'已写入'});
  assert.ok(host.classList.contains('folded'));open();
  assert.equal(host.style.left,'260px');assert.equal(host.classList.contains('folded'),false);
  assert.ok(d.querySelector('[data-undo]'));assert.ok(!messages.some(m=>m.type==='sceneControl'));
 }finally{dom.window.close();}
});

test('a generic focus snapshot cannot submit a live paste or resume a stale popup',()=>{
 const {dom,w,d,messages,apply,open}=setup();
 try{
  open();
  apply({...agent,destinationId:'focused',targetKind:'focused-text'});
  assert.equal(w.TuotieOfficePaste.open,false);
  assert.equal(d.querySelector('[data-start]'),null);
  assert.equal(messages.filter(m=>m.type==='work').length,0);
  assert.equal(w.TuotieDesktopLive.resumeOfficePaste(),false);
  assert.equal(d.getElementById('officePastePanel').hidden,true);
 }finally{dom.window.close();}
});
test('@ chooses an existing row in place and inserts a typed chip without sending the draft',()=>{
 const {dom,w,d,open,messages}=setup();
 try{
  const second={...item,id:'second',body:{text:'这是第二条很长的收集内容'}};
  w.TuotieDesktopLive.apply({items:[item,second],agent});open();
  const editor=d.getElementById('intentInput');
  function typeAt(){
   editor.focus();editor.textContent='把@写短';
   w.getSelection().collapse(editor.firstChild,2);
   editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  }
  typeAt();
  const rows=[...d.querySelectorAll('#bundleBody [data-card]')];
  assert.equal(rows.length,2);assert.ok(rows[0].hasAttribute('data-mention-active'));
  w.TuotieDesktopLive.apply({items:[item,second],agent:{...agent,actions:['新推荐']}});
  rows[1].dispatchEvent(new w.Event('pointerover',{bubbles:true}));
  assert.ok(!rows[0].hasAttribute('data-mention-active'));assert.ok(rows[1].hasAttribute('data-mention-active'));
  rows[1].click();
  assert.equal(editor.querySelector('.mention-token').dataset.mentionId,rows[1].dataset.card);
  assert.equal(editor.firstChild.textContent,'把');assert.ok(editor.textContent.endsWith('写短'));
  typeAt();const key=k=>editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
  key('ArrowDown');key('Enter');
  assert.equal(editor.querySelector('.mention-token').dataset.mentionId,rows[1].dataset.card);
  assert.ok(editor.querySelector('.mention-token use[href="#icon-type-text"]'));
  if(rows[1].dataset.card==='second')assert.equal(editor.querySelector('.mention-token-link span').textContent,'这是第二条很长…');
  assert.equal(messages.filter(m=>m.type==='work').length,0);
  assert.equal(d.querySelector('[data-mention-active]'),null);
  d.querySelector('[data-start]').click();
  assert.ok(messages.some(m=>m.type==='work'&&m.instruction.includes(rows[1].dataset.card)));
 }finally{dom.window.close();}
});

test('an arbitrary input accepts a prompt with an empty pack and labels revision as editing its draft',()=>{
 const initial={...agent,destinationId:'focused',targetKind:'input-live',targetName:'微信',inputDelivery:'direct',plannedSourceIds:[],actions:[]};
 const {dom,w,d,messages}=setup(initial);
 try{
  w.TuotieDesktopLive.apply({items:[],agent:initial});w.TuotieDesktopLive.openOfficePaste({x:120,y:120,exact:false},'input');
  assert.match(d.getElementById('officePastePanel').getAttribute('aria-label'),/输入框/);
  assert.doesNotMatch(d.getElementById('officePlacementNote').textContent,/Word/);
  const editor=d.getElementById('intentInput');editor.textContent='写一个问候';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('[data-start]').disabled,false);d.querySelector('[data-start]').click();
  assert.ok(messages.some(m=>m.type==='work'&&m.destinationId==='focused'&&m.instruction==='写一个问候'&&m.sourceIds.length===0));
 }finally{dom.window.close();}
});
