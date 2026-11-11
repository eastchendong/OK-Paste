import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
const html=()=>readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
function setup(){
 const dom=new JSDOM(html(),{runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];
 w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 for(const script of ['desktop-overlay','desktop-live'])w.eval(readFileSync(new URL(`../${script}.js`,import.meta.url),'utf8'));
 const live=w.TuotieDesktopLive,ui=w.TuotieUI;
 const item={id:'brief',type:'text',body:{text:'周六活动要求'},source:{title:'活动资料'}};
 const base={destinationId:'office',targetKind:'word-live',revision:1,canUndo:true,phase:'done',result:'活动安排已写入'};
 const apply=value=>live.apply({items:[item],agent:{...base,...value}});
 live.apply({items:[item],agent:{...base,phase:'ready',actions:['补充活动安排']}});
 live.openOfficePaste({x:100,y:100,exact:true},'word');
 ui.dispatch({type:'direction/choose',index:0});ui.dispatch({type:'generation/finish',text:'活动安排已写入'});
 const option={label:'准备事项分点',instruction:'保留全部活动事实，将准备事项改为分点，不新增要求。',direction:'structure'};
 const followups=(status='ready',revision=1)=>({status,revision,scene:'message',options:status==='ready'?[option]:[]});
 return {dom,w,d,messages,ui,live,apply,option,followups};
}
test('late dynamic options update only the suggestion row and preserve the focused draft',()=>{
 const {dom,d,ui,apply,followups}=setup();try{
  apply({followupRecommendations:followups('loading')});
  assert.equal(d.querySelectorAll('#officePastePanel .adjustment-option').length,0);
  const editor=d.querySelector('#followupInput');assert.ok(editor);
  ui.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'保留报名链接'}]});editor.focus();
  apply({followupRecommendations:followups()});
  assert.equal(d.querySelector('#followupInput'),editor);
  assert.equal(d.activeElement,editor);assert.match(editor.textContent,/保留报名链接/);
  assert.equal(d.querySelector('#officePastePanel .adjustment-option').textContent,'准备事项分点');
  assert.ok(d.querySelector('.adjustment-options').compareDocumentPosition(editor)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 }finally{dom.window.close();}
});
test('a dynamic suggestion sends its full instruction once through the ordinary continuation',()=>{
 const {dom,d,messages,apply,followups,option}=setup();try{
  apply({followupRecommendations:followups()});const before=messages.filter(m=>m.type==='work').length;
  d.querySelector('[data-adjust-option="0"]').click();
  const work=messages.filter(m=>m.type==='work');assert.equal(work.length,before+1);
  assert.equal(work.at(-1).instruction,option.instruction);assert.equal(work.at(-1).continuation,true);
 }finally{dom.window.close();}
});
test('with a draft, choosing an option appends it and waits for explicit send',()=>{
 const {dom,d,messages,ui,apply,followups}=setup();try{
  apply({followupRecommendations:followups()});
  ui.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'保留报名链接'}]});
  const before=messages.filter(m=>m.type==='work').length;d.querySelector('[data-adjust-option="0"]').click();
  assert.equal(messages.filter(m=>m.type==='work').length,before);
  d.querySelector('[data-adjust-submit]').click();const work=messages.filter(m=>m.type==='work');assert.equal(work.length,before+1);
  assert.match(work.at(-1).instruction,/保留报名链接/);assert.match(work.at(-1).instruction,/改为分点/);
 }finally{dom.window.close();}
});
test('unavailable, empty or stale recommendations leave free input without fabricated fixed options',()=>{
 const {dom,d,apply,followups}=setup();try{
  for(const value of [followups('unavailable'),{...followups(),options:[]},followups('ready',2)]){
   apply({followupRecommendations:value});assert.equal(d.querySelectorAll('#officePastePanel .adjustment-option').length,0);
   assert.ok(d.querySelector('#followupInput'));
  }
 }finally{dom.window.close();}
});
test('labels and instructions are escaped and non-text quick edits keep their own library',()=>{
 const {dom,d,w,apply,followups}=setup();try{
  const value=followups();value.options[0]={label:'<img src=x onerror=bad()>',instruction:'" onclick="bad()'};
  apply({followupRecommendations:value});const button=d.querySelector('[data-adjust-option="0"]');
  assert.equal(button.textContent,value.options[0].label);assert.equal(button.title,value.options[0].instruction);
  assert.equal(button.querySelector('img'),null);assert.equal(button.getAttribute('onclick'),null);
  apply({targetKind:'excel-live',followupRecommendations:followups()});
  assert.deepEqual(Array.from(w.eval('quickAdjustmentOptions()'),o=>o.label),['补全空值','核对公式']);
 }finally{dom.window.close();}
});
