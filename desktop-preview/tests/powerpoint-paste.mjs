import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8');
const live=readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8');
test('PowerPoint reuses the anchored composer, writes directly, and keeps adjustment controls',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try {
  const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};w.eval(overlay);w.eval(live);
  const item={id:'photo',type:'image',source:{title:'合成人物 A'},body:{text:'测试图片'}};
  const agent={phase:'ready',targetKind:'powerpoint-live',destinationId:'office',targetName:'团队介绍 · 第 1 页',plannedSourceIds:['photo'],actions:['替换第二张头像','将图片完整放入空位','裁切填满头像区域']};
  w.TuotieDesktopLive.apply({items:[item],agent});
  assert.equal(d.getElementById('intentPanel').hidden,true);
  w.TuotieDesktopLive.openOfficePaste({x:180,y:220,exact:false},'powerpoint');
  assert.equal(d.getElementById('officePastePanel').getAttribute('aria-label'),'编辑 PowerPoint 选中对象');
  assert.equal(d.querySelectorAll('#officePastePanel [data-intent]').length,0);
  d.querySelector('#officePastePanel [data-start]').click();
  assert.ok(messages.some(message=>message.type==='work'&&message.destinationId==='office'));
  w.TuotieDesktopLive.apply({items:[item],agent:{...agent,phase:'done',canUndo:true,taskArchived:false,previewPath:'',previewText:'第 1 页 · 已替换 2 张图片'}});
  w.TuotieUI.dispatch({type:'generation/finish',text:'已直接替换 PowerPoint 图片'});
  assert.equal(d.querySelector('#officePastePanel [data-open-preview]'),null);
  assert.equal(d.querySelector('#officePastePanel .office-result'),null);
  assert.ok(d.querySelector('#officePastePanel #followupInput'));
  assert.equal(d.querySelector('#bundleStack').hidden,false);
  w.TuotieDesktopLive.apply({items:[item],agent:{...agent,phase:'done',revision:2,canUndo:true,adjustmentProfile:'presentation',result:'第二版'}});
  assert.deepEqual(Array.from(d.querySelectorAll('.adjustment-option'),button=>button.textContent),['文案更简短','与上下文语气一致']);
  d.querySelector('#officePastePanel [data-undo]').click();assert.equal(messages.at(-1).action,'undo');
  w.TuotieDesktopLive.apply({items:[item],agent:{...agent,phase:'done',revision:1,canUndo:true,result:'第一版'}});w.TuotieDesktopLive.controlFinished('undo');
  assert.equal(w.TuotieUI.getState().phase,'done');assert.ok(d.querySelector('#followupInput'));assert.ok(d.querySelector('[data-undo]'));
 } finally {dom.window.close();}
});

test('current-page recommendation displays its default but cannot send a write',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,d=w.document,messages=[];
  w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};w.eval(overlay);w.eval(live);
  w.TuotieDesktopLive.apply({items:[{id:'portrait',type:'image',source:{title:'人物照片'},body:{text:'测试'}}],agent:{phase:'ready',targetKind:'powerpoint-live',destinationId:'office',recommendationOnly:true,initialRecommendation:{status:'ready'},plannedSourceIds:['portrait'],actions:['参照已有头像补齐两个用户画像。']}});
  w.TuotieDesktopLive.openOfficePaste({x:180,y:220},'powerpoint');
  assert.equal(d.getElementById('intentInput').dataset.placeholder,'参照已有头像补齐两个用户画像。');
  assert.equal(d.querySelector('[data-start]').disabled,true);
  assert.match(d.querySelector('[data-paste-target]').textContent,/当前页推荐/);
  assert.equal(messages.some(m=>m.type==='work'),false);
 }finally{dom.window.close();}
});
