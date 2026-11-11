import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {buildUI} from '../../scripts/build-ui.mjs';

test('portable UI artifacts are reproducible from component sources',()=>{
  assert.doesNotThrow(()=>buildUI({check:true}));
});

test('disabled Jianying shows a visible explanation without actions and preserves sources when switching apps',()=>{
 const dom=new JSDOM(readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  w.eval(readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const item={id:'reference',type:'text',source:{title:'参考'},body:{text:'保留的资料'}};
  const focus={appName:'剪映',bundleId:'com.lemon.lvpro'};
  w.TuotieDesktopLive.setFocus('剪映',focus);
  w.TuotieDesktopLive.apply({items:[item],agent:{phase:'idle',destinationId:'disabled',targetKind:'disabled',targetName:'剪映',focus,unavailableReason:'剪映接入暂未启用，内容包已保留。',actions:[]}});
  w.TuotieDesktopLive.showContent();
  assert.equal(d.querySelector('#intentPanel').hidden,false);
  assert.match(d.querySelector('.direction-status').textContent,/剪映接入暂未启用/);
  assert.equal(d.querySelector('#intentPanel [data-intent], #intentPanel [data-start]'),null);
  assert.deepEqual(Array.from(w.TuotieUI.getState().sourceIds),['reference']);
  assert.equal(messages.some(m=>m.type==='work'),false);
  const next={appName:'备忘录',bundleId:'com.apple.Notes'};w.TuotieDesktopLive.setFocus('备忘录',next);
  w.TuotieDesktopLive.apply({items:[item],agent:{phase:'ready',destinationId:'focused',targetKind:'focused-text',targetName:'备忘录',focus:next,actions:['整理笔记'],plannedSourceIds:['reference']}});
  assert.equal(w.TuotieUI.getState().targetId,'focused');assert.deepEqual(Array.from(w.TuotieUI.getState().sourceIds),['reference']);
 }finally{dom.window.close();}
});

test('shared content cards render five distinct icons and escape titles in catalog and live views',()=>{
  const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  try {
    const w=dom.window,d=w.document,renderCard=w.eval('bundleCard');
    const title='<img src=x onerror="bad()">';
    for(const kind of ['text','image','table','video','document','unknown']) {
      for(const demo of [false,true]) {
        const card=d.createElement('div');
        card.innerHTML=renderCard({id:'safe',kind,title,type:'内容',origin:'来源'},false,demo);
        assert.equal(card.querySelector('.bundle-card-title span').textContent,title);
        assert.equal(card.querySelector('.bundle-card-title img'),null);
        const symbol=card.querySelector('.content-type-icon use').getAttribute('href');
        assert.equal(symbol,`#icon-type-${kind==='unknown'?'document':kind}`);
        assert.ok(d.querySelector(symbol),'the referenced type icon must exist');
      }
    }
  } finally {dom.window.close();}
});

test('quick text adjustment continues the archived task, preserves user input and sends one real request',()=>{
  const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  try {
    const w=dom.window,d=w.document,messages=[];
    w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
    w.eval(readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8'));
    w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
    const ui=w.TuotieUI,live=w.TuotieDesktopLive;
    const item={id:'research',type:'text',source:{title:'访谈资料'},body:{text:'仅有两人样本'}};
    live.apply({items:[item],agent:{destinationId:'office',targetKind:'word-live',phase:'ready',actions:['插入摘要']}});
    live.openOfficePaste({x:100,y:100,exact:true},'word');
    ui.dispatch({type:'direction/choose',index:0});ui.dispatch({type:'generation/finish',text:'已插入摘要。'});
    live.apply({items:[],agent:{destinationId:'office',targetKind:'word-live',phase:'done',taskArchived:true,canUndo:true,result:'已插入摘要。'}});
    assert.ok(d.querySelector('#followupInput'),'adjustment composer opens immediately');
    assert.deepEqual(Array.from(d.querySelectorAll('.adjustment-option'),b=>b.textContent),['更简短','展开一点','与上下文语气一致']);
    assert.equal(d.querySelector('#taskPanel .parameter-panel, #taskPanel input[type=range]'),null);
    ui.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'保留两人样本的限定。'}]});
    const editor=d.querySelector('#followupInput');editor.focus();
    editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
    assert.equal(ui.getState().phase,'done','IME confirmation must not submit');
    live.apply({items:[],agent:{destinationId:'office',targetKind:'word-live',phase:'done',taskArchived:true,canUndo:true,result:'已插入摘要。',step:'写入成功'}});
    assert.equal(d.querySelector('#followupInput'),editor,'polling must retain the active editor');
    const before=messages.filter(m=>m.type==='work').length;
    d.querySelector('[data-adjust-option="0"]').click();
    assert.equal(messages.filter(m=>m.type==='work').length,before);
    d.querySelector('[data-adjust-submit]').click();
    const requests=messages.filter(m=>m.type==='work');
    assert.equal(requests.length,before+1);
    assert.equal(requests.at(-1).continuation,true);
    assert.match(requests.at(-1).instruction,/保留两人样本的限定/);
    assert.match(requests.at(-1).instruction,/缩短/);
    assert.deepEqual(Array.from(requests.at(-1).sourceIds),['research']);
    assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
  } finally {dom.window.close();}
});

test('image and table quick edits expose only operations supported by their targets',()=>{
  const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  try {
    const w=dom.window,d=w.document;
    w.eval(readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8'));
    w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
    for(const [kind,labels,instruction] of [
      ['powerpoint-live',['完整显示','裁切填满'],/contain/],
      ['excel-live',['补全空值','核对公式'],/保留其他已有值、公式/],
    ]) {
      w.TuotieDesktopLive.apply({items:[],agent:{phase:'done',destinationId:'office',targetKind:kind}});
      const options=w.eval('quickAdjustmentOptions()');
      assert.deepEqual(Array.from(options,o=>o.label),labels);
      assert.match(options[0].instruction,instruction);
    }
    const header=d.createElement('div');
    w.TuotieDesktopLive.apply({items:[],agent:{phase:'done',destinationId:'office',targetKind:'word-live',canUndo:true,result:'<img src=x onerror=bad()>。'}});
    header.innerHTML=w.eval('completionHeader()');
    assert.equal(header.querySelector('img'),null);
    assert.ok(header.querySelector('.completion-heading h3'));
    assert.ok(header.querySelector('[data-accept][aria-label="结束本次任务"]'));
  } finally {dom.window.close();}
});
