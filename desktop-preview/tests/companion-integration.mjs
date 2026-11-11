import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../../components-preview.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../desktop-overlay.js',import.meta.url),'utf8');
const live=readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8');
function setup(withLive=false,url='file:///tuotie/components-preview.html') {
  const dom=new JSDOM(html,{url,runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,calls=[];
  w.eval(overlay);
  if(withLive)w.eval(live);
  w.TuotieUI.configure({manualGeneration:true});
  const api=w.TuotieCompanionMotion;
  w.TuotieCompanionMotion={...api,setPose(root,pose,options){
    const controller=api.setPose(root,pose,options);
    if(root.id==='dockOrb')calls.push({pose,...options,controller});
    return controller;
  }};
  const ui=w.TuotieUI;
  return {dom,w,ui,calls,root:w.document.getElementById('dockOrb'),
    start(target='document'){ui.dispatch({type:'source/add',id:'text'});ui.dispatch({type:'target/set',id:target});ui.dispatch({type:'generation/start',instruction:'生成摘要'});},
    finish(text='本轮已完成'){ui.dispatch({type:'generation/finish',text});},
    last:()=>calls.at(-1),
  };
}

test('the real dock and catalog use local Figma character assets at both file locations',()=>{
  for(const url of ['file:///tuotie/components-preview.html','file:///runtime/ui/components-preview.html']) {
    const s=setup(false,url);try{
      assert.equal(s.root.tagName,'DIV');
      assert.equal(s.w.document.querySelector('#bot-shape'),null);
      const urls=[...s.root.querySelectorAll('img')].map(img=>img.src);
      assert.equal(urls.length,15);
      const base=url.includes('/runtime/')?'file:///runtime/ui/assets/companion/':'file:///tuotie/ui/assets/companion/';
      assert.ok(urls.every(src=>src.startsWith(base)));
      for(const src of urls)assert.ok(existsSync(new URL('../../ui/assets/companion/'+src.split('/').at(-1),import.meta.url)));
      assert.equal(s.w.document.querySelector('use[href="#bot-shape"]'),null);
    }finally{s.dom.window.close();}
  }
});

test('real generation switches work to one celebration and polling retains that result controller',()=>{
  const s=setup();try{
    s.start();assert.equal(s.last().pose,'working');
    s.finish();assert.equal(s.last().pose,'success');assert.equal(s.last().animate,true);
    const completed=s.last();
    for(let i=0;i<4;i++)s.w.TuotieCompanionState.refresh();
    assert.equal(s.last().controller,completed.controller);
    s.ui.dispatch({type:'generation/start',instruction:'再简短一些'});
    assert.equal(s.last().pose,'working');
    s.finish('第二版完成');assert.equal(s.last().pose,'success');
    assert.notEqual(s.last().eventKey,completed.eventKey);
    assert.notEqual(s.last().controller,completed.controller);
  }finally{s.dom.window.close();}
});

test('restoring an old result, stopping an adjustment and undoing never animate the retained result',()=>{
  const restored=setup();try{
    restored.w.eval("state.phase='done';state.generated='上次结果';render();");
    assert.equal(restored.last().pose,'success');assert.equal(restored.last().animate,false);
  }finally{restored.dom.window.close();}
  const s=setup();try{
    s.start();s.finish();
    s.ui.dispatch({type:'generation/start',instruction:'修改第二版'});
    s.ui.dispatch({type:'generation/stop'});
    assert.equal(s.ui.getState().phase,'done');assert.equal(s.last().animate,false);
    s.ui.dispatch({type:'generation/start',instruction:'修改第二版'});s.finish('第二版');
    s.ui.dispatch({type:'result/undo'});
    assert.equal(s.ui.getState().phase,'done');assert.equal(s.last().animate,false);
  }finally{s.dom.window.close();}
});

test('real managed-target snapshots block uncertain and failed retained revisions until an actual success',()=>{
  const s=setup(true);try{
    const apply=patch=>s.w.TuotieDesktopLive.apply({items:[],agent:{destinationId:'office',targetKind:'word-live',phase:'done',revision:1,...patch}});
    apply({phase:'running'});s.start('office');s.finish();
    assert.equal(s.last().pose,'idle','a pending host receipt is not success');
    apply({mutationUncertain:true,error:'回执丢失'});
    assert.equal(s.last().pose,'idle');
    apply({error:'生成失败，保留上一版'});
    assert.equal(s.last().pose,'failure','a failed adjustment keeps the old revision but shows a single failure response');
    apply({phase:'ready'});assert.equal(s.last().pose,'idle','a new ready plan is not a generated result');
    apply({revision:2});assert.equal(s.last().pose,'success');assert.equal(s.last().animate,true);
    const success=s.last().controller;apply({revision:2,step:'已写入'});
    assert.equal(s.last().controller,success);
  }finally{s.dom.window.close();}
});

// Real collection state: deletion and duplicate polls must not acknowledge again.
test('only newly added collection IDs nod once, and planning bubbles stop when a recommendation is ready',()=>{
  const s=setup(true);try {
    s.w.TuotieDesktopLive.apply({items:[],agent:{phase:'idle'}});
    s.ui.dispatch({type:'source/add',id:'text'});
    assert.equal(s.last().pose,'nod');const nod=s.last();
    s.w.TuotieCompanionState.refresh();assert.equal(s.last().controller,nod.controller);
    nod.onComplete();assert.equal(s.last().pose,'idle');
    s.ui.dispatch({type:'source/remove',id:'text'});assert.equal(s.last().pose,'idle');
    const item={id:'motion-test',type:'text',body:{text:'隔离素材'}};
    s.w.TuotieDesktopLive.apply({items:[item],agent:{destinationId:'office',targetKind:'word-live',phase:'planning',plannedSourceIds:[item.id]}});
    s.w.TuotieDesktopLive.openWordPaste({x:400,y:100,exact:true});
    assert.equal(s.last().pose,'thinking');
    s.w.TuotieDesktopLive.apply({items:[item],agent:{destinationId:'office',targetKind:'word-live',phase:'ready',plannedSourceIds:[item.id]}});
    assert.equal(s.last().pose,'idle');
  }finally{s.dom.window.close();}
});

test('the first content snapshot restores quietly instead of acknowledging old materials',()=>{
  const s=setup(true);try {
    const items=[{id:'restored-material',type:'text',body:{text:'已有资料'}}];
    s.w.TuotieDesktopLive.apply({items,agent:{phase:'idle'}});
    assert.equal(s.calls.some(call=>call.pose==='nod'),false,'restoration must not act like a new capture');
    s.w.TuotieDesktopLive.apply({items,agent:{phase:'idle'}});
    assert.equal(s.calls.some(call=>call.pose==='nod'),false,'restoration must not act like a new capture');
  }finally{s.dom.window.close();}
});
