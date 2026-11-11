import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

function setup(){
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,d=w.document,messages=[];
 w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 for(const script of ['desktop-overlay','desktop-live'])w.eval(readFileSync(new URL(`../${script}.js`,import.meta.url),'utf8'));
 const ready={phase:'ready',targetKind:'input-live',destinationId:'focused',targetName:'微信',inputDelivery:'direct',plannedSourceIds:[],actions:['整理邮件']};
 const apply=agent=>w.TuotieDesktopLive.apply({items:[],agent:{...ready,...agent}});
 apply(ready);w.TuotieDesktopLive.openOfficePaste({x:120,y:120,exact:false},'input');
 return {dom,w,d,messages,apply};
}

test('a copied long email shows its entire result, a repeat-copy button and accurate delivery label',()=>{
 const {dom,w,d,messages,apply}=setup();try{
  const text='你好：\n'+'项目说明🙂\n'.repeat(600)+'末尾<script>不可执行</script>';
  const editor=d.querySelector('#intentInput');editor.textContent='整理完整邮件';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-start]').click();
  apply({phase:'done',inputDelivery:'clipboard',previewText:text,result:'已复制文字，请在原输入框按 ⌘V',revision:1,canUndo:false});
  w.TuotieUI.dispatch({type:'generation/finish',text:'已复制文字，请在原输入框按 ⌘V'});
  assert.match(d.querySelector('.paste-completion h3').textContent,/已复制.*⌘V/);
  assert.equal(d.querySelector('.result-details p').textContent,text);
  assert.equal(d.querySelector('.result-details script'),null);
  assert.equal(d.querySelector('.paste-completion [data-undo]'),null);
  const button=d.querySelector('#taskPanel [data-copy-input-result]');assert.ok(button);button.click();
  assert.equal(messages.filter(m=>m.type==='copyInputResult').length,1);
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='commit').length,0);
 }finally{dom.window.close();}
});

test('a rejected native write still offers explicit copy recovery',()=>{
 const {dom,d,messages,apply}=setup();try{
  d.querySelector('[data-start]').click();
  apply({phase:'error',error:'应用未确认文字，请检查草稿',previewText:'完整正文\n第二段',mutationUncertain:true,canUndo:false});
  const button=d.querySelector('[data-copy-input-result]:not([hidden])');assert.ok(button);button.click();
  assert.equal(messages.filter(m=>m.type==='copyInputResult').length,1);
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='commit').length,0);
 }finally{dom.window.close();}
});
