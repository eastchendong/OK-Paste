import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
for(const host of ['illustrator','figma'])test(`${host} reuses the captured-target popup and exposes vector adjustments`,()=>{
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,d=w.document;
  w.eval(readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8'));
  w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const item={id:'reference',type:'text',source:{title:'风格参考'},body:{text:'粗描边，圆润角色'}};
  const agent={phase:'planning',targetKind:`${host}-live`,destinationId:'office',targetName:'第三画板'};
  w.TuotieDesktopLive.apply({items:[item],agent});
  w.TuotieDesktopLive.openOfficePaste({x:150,y:100,exact:false},host);
  assert.equal(d.querySelector('#officePastePanel').getAttribute('aria-label'),host==='figma'?'在 Figma 画框生成':'在 Illustrator 画板生成');
  assert.match(d.querySelector('.office-placement-note').textContent,host==='figma'?/刚才选中的画框/:/刚才激活的画板/);
  w.TuotieDesktopLive.apply({items:[item],agent:{...agent,phase:'done',canUndo:true,result:'已生成新的矢量角色。'}});
  assert.equal(w.TuotieDesktopLive.adjustmentProfile(),'vector');
  assert.equal(w.TuotieDesktopLive.resultTitle(),host==='figma'?'已加入 Figma 目标画框。':'已加入 Illustrator 目标画板。');
  assert.deepEqual(Array.from(w.eval('quickAdjustmentOptions()'),v=>v.label),host==='figma'?[]:['线条更简洁','配色贴近参考']);
 }finally{dom.window.close();}
});
