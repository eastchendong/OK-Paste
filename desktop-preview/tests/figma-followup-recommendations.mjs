import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {test} from 'node:test';import {JSDOM} from 'jsdom';
function setup(open=true){
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 for(const script of ['desktop-overlay','desktop-live'])w.eval(readFileSync(new URL(`../${script}.js`,import.meta.url),'utf8'));
 const item={id:'brief',type:'text',body:{text:'矢量资料'}},base={targetKind:'figma-live',destinationId:'office',phase:'ready',actions:['生成矢量作品'],targetName:'独立画框',revision:1,canUndo:true};
 const apply=extra=>w.TuotieDesktopLive.apply({items:[item],agent:{...base,phase:'done',...extra}});
 w.TuotieDesktopLive.apply({items:[item],agent:base});
 if(open){w.TuotieDesktopLive.openOfficePaste({x:150,y:100,exact:true},'figma');w.TuotieUI.dispatch({type:'direction/choose',index:0});w.TuotieUI.dispatch({type:'generation/finish',text:'已完成'});}
 return {dom,w,d,messages,apply};
}
for(const [scene,label] of [['vector-character','瓶身更圆润'],['vector-icon','减少内部刻度'],['vector-empty-state','弱化失落表情']])test(scene+' displays one real suggestion and sends its complete instruction once',()=>{
 const {dom,d,messages,apply}=setup();try{
  const instruction='只调整本任务作品，保留来源特征、业务语义、系列风格及其他图层。';
  apply({followupRecommendations:{revision:1,status:'ready',scene,options:[{label,instruction}]}});
  assert.deepEqual(Array.from(d.querySelectorAll('#officePastePanel .adjustment-option'),b=>b.textContent),[label]);
  const before=messages.filter(m=>m.type==='work').length;d.querySelector('[data-adjust-option="0"]').click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,before+1);assert.equal(work.at(-1).instruction,instruction);assert.equal(work.at(-1).continuation,true);
 }finally{dom.window.close();}
});
test('Figma pending, unknown, failed, empty and stale results never fabricate fixed vector controls',()=>{
 const {dom,d,apply}=setup();try{
  for(const rec of [{revision:1,status:'loading',scene:null,options:[]},{revision:1,status:'unavailable',scene:null,options:[]},{revision:1,status:'ready',scene:null,options:[]},{revision:1,status:'ready',scene:'vector-icon',options:[]},{revision:0,status:'ready',scene:'vector-icon',options:[{label:'旧建议',instruction:'不应显示'}]}]){
   apply({followupRecommendations:rec});assert.equal(d.querySelectorAll('#officePastePanel .adjustment-option').length,0);assert.ok(d.querySelector('#followupInput'));
  }
 }finally{dom.window.close();}
});
test('late vector suggestions preserve the editor and draft; clicking appends and waits for send',()=>{
 const {dom,w,d,messages,apply}=setup();try{
  apply({followupRecommendations:{revision:1,status:'loading',scene:null,options:[]}});
  w.TuotieUI.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'保留原配色'}]});
  const editor=d.querySelector('#followupInput');editor.focus();
  const instruction='减少本任务图标的次要刻度，保留线宽、语义和其他对象。';
  apply({followupRecommendations:{revision:1,status:'ready',scene:'vector-icon',options:[{label:'减少刻度',instruction}]}});
  assert.equal(d.querySelector('#followupInput'),editor);assert.match(editor.textContent,/保留原配色/);
  const before=messages.filter(m=>m.type==='work').length;d.querySelector('[data-adjust-option="0"]').click();
  assert.equal(messages.filter(m=>m.type==='work').length,before);
  assert.match(editor.textContent,/保留原配色/);assert.ok(editor.textContent.includes(instruction));
 }finally{dom.window.close();}
});
