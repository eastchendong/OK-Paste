import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {test} from 'node:test';import {JSDOM} from 'jsdom';
function setup(kind,phase,revision=0,withSources=true){
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 for(const script of ['desktop-overlay','desktop-live'])w.eval(readFileSync(new URL(`../${script}.js`,import.meta.url),'utf8'));
 const item={id:'reference',type:'text',body:{text:'本任务资料'}};
 const agent={phase,plannedSourceIds:['reference'],executionSourceIds:['running','done'].includes(phase)?['reference']:[],targetKind:kind,destinationId:'office',targetName:'已经捕获的原画框',actions:['按现有风格生成图标'],revision,canUndo:revision>0,result:revision?'图标已写入':''};
 w.TuotieDesktopLive.apply({items:withSources?[item]:[],agent});
 return {dom,w,d,messages};
}
for(const phase of ['ready','planning','running','done'])test('shortcut resumes backend-owned '+phase+' Figma task without a second capture',()=>{
 const {dom,w,d,messages}=setup('figma-live',phase,phase==='done'?1:0);try{
  assert.equal(w.TuotieOfficePaste.open,false);
  assert.equal(w.TuotieDesktopLive.resumeOfficePaste(),true);
  assert.equal(w.TuotieOfficePaste.open,true);assert.equal(w.TuotieOfficePaste.host,'figma');
  assert.equal(d.querySelector('#officePastePanel').hidden,false);
  if(phase==='running')assert.ok(d.querySelector('#officePastePanel [data-stop]'));
  else if(phase==='done')assert.ok(d.querySelector('#officePastePanel [data-undo]'));
  else assert.ok(d.querySelector('#officePastePanel #intentInput'));
  assert.equal(messages.filter(m=>m.type==='work').length,0);
 }finally{dom.window.close();}
});
test('native show-content restores an orphaned task panel at its original target',()=>{
 const {dom,w,d,messages}=setup('figma-live','ready');try{
  w.TuotieDesktopLive.showContent();
  assert.equal(w.TuotieOfficePaste.open,true);assert.ok(d.querySelector('#intentInput'));
  assert.match(d.querySelector('[data-paste-target]').textContent,/已经捕获的原画框/);
  assert.equal(messages.filter(m=>m.type==='work').length,0);
 }finally{dom.window.close();}
});
test('show-content unfolds an existing panel without dropping its actual editor draft',()=>{
 const {dom,w,d}=setup('figma-live','ready');try{
  w.TuotieDesktopLive.resumeOfficePaste();const editor=d.querySelector('#intentInput');
  editor.textContent='保留原描边';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  w.TuotieDesktopLive.showContent();
  assert.equal(d.querySelector('#intentInput'),editor);assert.match(editor.textContent,/保留原描边/);
  assert.equal(d.querySelector('#officePastePanel').classList.contains('folded'),false);
 }finally{dom.window.close();}
});
test('recovered first-round panel can actually submit its default requirement to the saved host',()=>{
 const {dom,w,d,messages}=setup('figma-live','ready');try{
  w.TuotieUI.dispatch({type:'target/clear'});w.TuotieDesktopLive.showContent();d.querySelector('#officePastePanel [data-start]').click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,1);assert.equal(work[0].destinationId,'office');assert.ok(work[0].instruction.includes('按现有风格生成图标'));
 }finally{dom.window.close();}
});
test('recovered result can execute a dynamic continuation rather than asking to select a target again',()=>{
 const {dom,w,d,messages}=setup('figma-live','done',1);try{
  w.TuotieDesktopLive.apply({items:[{id:'reference',type:'text',body:{text:'本任务资料'}}],agent:{phase:'done',targetKind:'figma-live',destinationId:'office',targetName:'已经捕获的原画框',result:'图标已写入',plannedSourceIds:['reference'],executionSourceIds:['reference'],revision:1,canUndo:true,followupRecommendations:{revision:1,status:'ready',scene:'vector-icon',options:[{label:'减少刻度',instruction:'只减少本任务图标刻度，保留其他内容和原目标。'}]}}});
  w.TuotieUI.dispatch({type:'target/clear'});w.TuotieDesktopLive.showContent();d.querySelector('[data-adjust-option="0"]').click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,1);assert.equal(work[0].destinationId,'office');assert.equal(work[0].continuation,true);
 }finally{dom.window.close();}
});
for(const phase of ['running','done'])test('recovery of '+phase+' uses only executed sources through completion and the next adjustment',()=>{
 const {dom,w,d,messages}=setup('figma-live',phase,phase==='done'?1:0);try{
  const items=[{id:'reference',type:'text',body:{text:'实际选用资料'}},{id:'other',type:'text',body:{text:'未选用的其他资料'}}];
  const agent={phase,targetKind:'figma-live',destinationId:'office',targetName:'原画框',plannedSourceIds:['reference','other'],executionSourceIds:['reference'],revision:phase==='done'?1:0,canUndo:phase==='done',result:phase==='done'?'图标已写入':''};
  w.TuotieDesktopLive.apply({items,agent});w.TuotieDesktopLive.showContent();
  w.TuotieDesktopLive.apply({items,agent:{...agent,phase:'done',revision:1,canUndo:true,result:'图标已写入',followupRecommendations:{revision:1,status:'ready',scene:'vector-icon',options:[{label:'减少刻度',instruction:'只减少图标刻度，保留原结果和来源。'}]}}});
  if(phase==='running')w.TuotieUI.dispatch({type:'generation/finish',text:'图标已写入'});
  const button=d.querySelector('[data-adjust-option="0"]');assert.ok(button);button.click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,1);assert.equal(work[0].continuation,true);assert.deepEqual(Array.from(work[0].sourceIds),['reference']);
 }finally{dom.window.close();}
});
test('idle, released and ordinary text targets do not invent a resumable paste task',()=>{
 for(const [kind,phase]of [['figma-live','idle'],['focused-text','ready'],['document','done']]){
  const {dom,w}=setup(kind,phase);try{assert.equal(w.TuotieDesktopLive.resumeOfficePaste(),false);assert.equal(w.TuotieOfficePaste.open,false);}finally{dom.window.close();}
 }
});
