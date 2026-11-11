import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
function setup(kind){
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 for(const script of ['desktop-overlay','desktop-live'])w.eval(readFileSync(new URL(`../${script}.js`,import.meta.url),'utf8'));
 const host=kind==='excel-live'?'excel':'powerpoint',item={id:'brief',type:'text',body:{text:'独立表格/头像资料'}};
 const base={targetKind:kind,destinationId:'office',phase:'ready',actions:['执行当前任务'],targetName:'独立测试',revision:1,canUndo:true};
 const apply=extra=>w.TuotieDesktopLive.apply({items:[item],agent:{...base,phase:'done',...extra}});
 w.TuotieDesktopLive.apply({items:[item],agent:base});w.TuotieDesktopLive.openOfficePaste({x:150,y:100,exact:true},host);
 w.TuotieUI.dispatch({type:'direction/choose',index:0});w.TuotieUI.dispatch({type:'generation/finish',text:'已完成'});
 return {dom,w,d,messages,apply};
}
for(const [kind,scene,label,instruction] of [
 ['excel-live','table-create','精简备注','只精简本次选区备注，保留数值、公式和其他内容。'],
 ['excel-live','table-append','与原表写法一致','只调整本次新增记录的文字，保留原记录及表头。'],
 ['powerpoint-live','persona-avatars','完整显示人物','把本任务两张头像切换为 contain，保留图片映射、位置和其他对象。'],
])test(`${scene} displays its dynamic action and sends one scoped continuation`,()=>{
 const {dom,d,messages,apply}=setup(kind);try{
  apply({followupRecommendations:{revision:1,status:'ready',scene,options:[{label,instruction}]}});
  assert.deepEqual(Array.from(d.querySelectorAll('#officePastePanel .adjustment-option'),b=>b.textContent),[label]);
  const before=messages.filter(m=>m.type==='work').length;d.querySelector('[data-adjust-option="0"]').click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,before+1);assert.equal(work.at(-1).instruction,instruction);assert.equal(work.at(-1).continuation,true);
 }finally{dom.window.close();}
});
test('pending or stale table recommendations do not show fixed or previous-version suggestions',()=>{
 const {dom,d,apply}=setup('excel-live');try{
  for(const rec of [{status:'loading',revision:1,scene:null,options:[]},{status:'ready',revision:0,scene:'table-append',options:[{label:'旧建议',instruction:'旧指令'}]}]){
   apply({followupRecommendations:rec});assert.equal(d.querySelectorAll('#officePastePanel .adjustment-option').length,0);assert.ok(d.querySelector('#followupInput'));
  }
 }finally{dom.window.close();}
});
test('undo restores the previous table suggestions while retaining the user draft',()=>{
 const {dom,w,d,apply}=setup('excel-live');try{
  const rec=(revision,label)=>({revision,status:'ready',scene:'table-append',options:[{label,instruction:'只改本次记录。'}]});
  apply({revision:2,followupRecommendations:rec(2,'精简备注')});
  w.TuotieUI.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'保留报名编号'}]});
  const editor=d.querySelector('#followupInput');editor.focus();
  apply({revision:1,followupRecommendations:rec(1,'与原表写法一致')});
  assert.equal(d.querySelector('#followupInput'),editor);assert.match(editor.textContent,/保留报名编号/);
  assert.equal(d.querySelector('[data-adjust-option="0"]').textContent,'与原表写法一致');
 }finally{dom.window.close();}
});
