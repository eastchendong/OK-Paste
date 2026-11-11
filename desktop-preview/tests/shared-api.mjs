import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../../components-preview.html', import.meta.url), 'utf8')
const overlay = readFileSync(new URL('../desktop-overlay.js', import.meta.url), 'utf8')

test('shared desktop API preserves generation, stop, undo and keep transitions', () => {
  const dom = new JSDOM(html, {
    url: 'file:///tuotie/components-preview.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  })
  const messages = []
  dom.window.webkit = { messageHandlers: { tuotie: { postMessage: message => messages.push(message) } } }
  try {
    dom.window.eval(overlay)

  const ui = dom.window.TuotieUI
  assert.equal(ui.version, 1)
  ui.configure({ manualGeneration: true })
  ui.dispatch({ type: 'source/add', id: 'text' })
  ui.dispatch({ type: 'target/set', id: 'document' })
  assert.equal(ui.getState().phase, 'direction')

  ui.dispatch({ type: 'direction/choose', index: 0 })
  assert.equal(ui.getState().phase, 'generating')
  assert.equal(messages.some(message => message.event === 'generationRequested'), true)
  ui.dispatch({ type: 'generation/stop' })
  assert.equal(ui.getState().phase, 'direction')
  assert.equal(ui.getState().collapsed, false)

  ui.dispatch({ type: 'direction/choose', index: 0 })
  ui.dispatch({ type: 'generation/finish', text: '组员提供的结果' })
  assert.equal(ui.getState().phase, 'done')
  assert.equal(ui.getState().generated, '组员提供的结果')
  ui.dispatch({ type: 'result/undo' })
  assert.equal(ui.getState().phase, 'direction')
  assert.equal(ui.getState().collapsed, false)

  ui.dispatch({ type: 'direction/choose', index: 0 })
  ui.dispatch({ type: 'generation/finish', text: '最终保留结果' })
  ui.dispatch({ type: 'result/keep' })
  assert.equal(ui.getState().phase, 'collect')
  assert.equal(ui.getState().acceptedOutputs[0].text, '最终保留结果')
  assert.equal(messages.some(message => message.event === 'resultKept'), true)
  } finally {
    dom.window.close()
  }
})

test('team data can drive the same source and target components', () => {
  const dom = new JSDOM(html, {
    url: 'file:///tuotie/components-preview.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  })
  try {
    dom.window.eval(overlay)
    const ui = dom.window.TuotieUI
    ui.configure({
      sources: [{
        id: 'notes', kind: 'text', title: '采访笔记', type: '文字',
        origin: '项目资料页', sourceKind: 'web', url: '', detail: '采访内容',
      }],
      targetLabels: { section: '第二章节下方' },
      manualGeneration: true,
    })
    ui.dispatch({ type: 'source/add', id: 'notes' })
    ui.dispatch({ type: 'target/set', id: 'section' })
    assert.equal(ui.getState().sourceIds[0], 'notes')
    assert.equal(ui.getState().targetId, 'section')
    assert.match(dom.window.document.body.textContent, /采访笔记/)
    assert.match(dom.window.document.body.textContent, /第二章节下方/)
  } finally {
    dom.window.close()
  }
})

test('direction and bundle stay open until an explicit joint collapse', () => {
  const dom = new JSDOM(html, {
    url: 'file:///tuotie/components-preview.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  })
  try {
    dom.window.eval(overlay)
    const { document, Event } = dom.window
    const ui = dom.window.TuotieUI
    ui.dispatch({ type: 'source/add', id: 'text' })
    ui.dispatch({ type: 'target/set', id: 'document' })
    const dock = document.querySelector('#dock')
    const bundle = document.querySelector('#bundleStack')
    const direction = document.querySelector('#intentPanel')
    const bot = document.querySelector('#dockBot')
    assert.equal(direction.hidden, false)
    assert.equal(bundle.hidden, false)

    dock.dispatchEvent(new Event('pointerleave'))
    assert.equal(dock.classList.contains('direction-collapsed'), false)
    assert.equal(bundle.hidden, false)

    bot.click()
    const actions = document.querySelector('#directionActions')
    assert.equal(actions.hidden, true)
    dock.dispatchEvent(new Event('pointerleave'))
    assert.equal(actions.hidden, true)
    assert.equal(ui.getState().collapsed, true)
    assert.equal(dock.classList.contains('direction-collapsed'), true)
    assert.equal(bundle.hidden, true)
    assert.equal(dom.window.getComputedStyle(direction).display, 'none')

    document.querySelector('#dockPet').dispatchEvent(new Event('pointerenter'))
    assert.equal(dock.classList.contains('controls-open'), false)
    bot.click()
    assert.equal(ui.getState().collapsed, false)
    assert.equal(dock.classList.contains('direction-collapsed'), false)
    assert.equal(bundle.hidden, false)
    assert.notEqual(dom.window.getComputedStyle(direction).display, 'none')
  } finally {
    dom.window.close()
  }
})

test('the HTML component catalog previews the same joint collapse', () => {
  const dom = new JSDOM(html, {
    url: 'file:///tuotie/components-preview.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  })
  try {
    const { document } = dom.window
    document.querySelector('[data-catalog-group="direction"][data-catalog-variant="multiple"]').click()
    const stack = document.querySelector('#previewComponent .demo-direction-stack')
    assert.ok(stack.querySelector('.demo-direction-bundle'))
    stack.querySelector('.demo-bot').click()
    assert.equal(stack.querySelector('[data-demo-direction-actions]').hidden, true)
    stack.dispatchEvent(new dom.window.Event('pointerleave'))
    assert.equal(stack.classList.contains('demo-direction-collapsed'), true)
    assert.equal(dom.window.getComputedStyle(stack.querySelector('.demo-intent')).display, 'none')
    assert.equal(dom.window.getComputedStyle(stack.querySelector('.demo-direction-bundle')).display, 'none')
    stack.querySelector('.demo-bot').click()
    assert.equal(stack.classList.contains('demo-direction-collapsed'), false)
  } finally {
    dom.window.close()
  }
})

test('live scene controls apply and cancel real transactions, keeping the shared component', () => {
  const dom = new JSDOM(html, {url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
  const messages = [];
  dom.window.webkit = {messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  try {
    dom.window.eval(overlay);
    dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
    const ui=dom.window.TuotieUI;
    dom.window.TuotieDesktopLive.apply({items:[{id:'real-image',type:'image',preview:'data:image/png;base64,aGVsbG8=',source:{title:'参考图片'},body:{}}],destinations:[{id:'blender',name:'Blender',connected:true}],agent:{phase:'ready',actions:['添加相同物体'],questions:[]}});
    assert.ok(dom.window.document.querySelector('#bundle img'));
    ui.dispatch({type:'generation/start',instruction:'保留物体，只改变桌面颜色'});
    assert.equal(messages.find(m=>m.type==='work').instruction,'保留物体，只改变桌面颜色');
    dom.window.TuotieDesktopLive.apply({items:[],agent:{phase:'preview',actions:[],changes:{added:['Cube'],modified:[],removed:[]}}});
    ui.dispatch({type:'generation/finish',text:'真实预览已完成'});
    const accept=dom.window.document.querySelector('#taskPanel [data-accept]');
    assert.match(accept.textContent,/应用/); accept.click();
    assert.equal(messages.filter(m=>m.type==='sceneControl').at(-1).action,'commit');
    assert.equal(ui.getState().phase,'done');
    dom.window.TuotieDesktopLive.controlFinished('commit');
    dom.window.document.querySelector('#taskPanel [data-undo]').click();
    assert.equal(messages.filter(m=>m.type==='sceneControl').at(-1).action,'cancel');
  } finally {dom.window.close();}
});

test('focus stays inside the bundle and pet click hides ongoing work without stopping it',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive,ui=dom.window.TuotieUI;
  live.apply({items:[{id:'source-note',type:'text',source:{title:'笔记'},body:{text:'场景参考'}}],agent:{destinationId:'blender',phase:'ready',actions:['调整场景']}});
  live.setFocus('ChatGPT');assert.match(dom.window.document.querySelector('#targetFooter').textContent,/ChatGPT.*正在聚焦/);
  assert.equal(dom.window.document.querySelector('#focusApp'),null);assert.equal(ui.getState().targetId,'blender');
  live.setFocus('Blender');assert.match(dom.window.document.querySelector('#targetFooter').textContent,/Blender.*正在聚焦/);
  ui.dispatch({type:'generation/start',instruction:'调整场景'});
  dom.window.document.querySelector('#dockBot').click();
  assert.equal(ui.getState().phase,'generating');assert.equal(dom.window.document.querySelector('#taskPanel').hidden,true);
  dom.window.document.querySelector('#dockBot').click();
  assert.equal(dom.window.document.querySelector('#taskPanel').hidden,false);assert.equal(ui.getState().phase,'generating');
 }finally{dom.window.close();}
});

test('archived source items leave the active bundle and do not return on the next snapshot',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive,ui=dom.window.TuotieUI;
  live.apply({items:[{id:'source-note',type:'text',source:{title:'笔记'},body:{text:'场景参考'}}],agent:{destinationId:'blender',phase:'ready',actions:['调整场景']}});
  ui.dispatch({type:'generation/start',instruction:'调整场景'});ui.dispatch({type:'generation/finish',text:'预览'});
  live.apply({items:[],agent:{destinationId:'blender',phase:'done',taskArchived:true,actions:[]}});
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
  assert.equal(dom.window.document.querySelector('#followupInput'),null);
  live.apply({items:[],agent:{destinationId:'blender',phase:'done',taskArchived:true,actions:[]}});
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
 }finally{dom.window.close();}
});

test('removing a live card explicitly archives it and a stale snapshot cannot restore it',async()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];dom.window.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive,ui=dom.window.TuotieUI;
  const snapshot={items:[{id:'source-delete',type:'text',source:{title:'待删除笔记'},body:{text:'测试删除'}}],agent:{phase:'idle',actions:[]}};
  live.apply({items:[],agent:{phase:'idle',actions:[]}});
  live.apply(snapshot);await Promise.resolve();
  dom.window.document.querySelector('#bundle').click();
  dom.window.document.querySelector('[data-remove="source-delete"]').click();
  const archiveMessages=messages.filter(message=>message.type==='archiveItems');
  assert.equal(archiveMessages.length,1);assert.equal(archiveMessages[0].itemIds.join(','),'source-delete');
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
  live.apply(snapshot);
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
 }finally{dom.window.close();}
});

test('a saved Office target uses the same recommendations, real preview and apply controls', () => {
  const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
  const messages=[];dom.window.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  try {
    dom.window.eval(overlay);
    dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
    const ui=dom.window.TuotieUI;
    dom.window.TuotieDesktopLive.apply({items:[{id:'source-note',type:'text',source:{title:'访谈笔记'},body:{text:'只有两次探索性访谈'}}],destinations:[{id:'office',name:'目标文档',connected:true},{id:'blender',name:'Blender',connected:true}],agent:{destinationId:'office',targetName:'research.docx',targetKind:'document',phase:'ready',actions:['补充研究发现'],questions:[]}});
    assert.equal(ui.getState().targetId,'office');
    assert.match(dom.window.document.querySelector('#intentPanel').textContent,/补充研究发现/);
    ui.dispatch({type:'generation/start',instruction:'在末尾补充研究发现'});
    assert.equal(messages.find(m=>m.type==='work').destinationId,'office');
    dom.window.TuotieDesktopLive.apply({items:[],agent:{destinationId:'office',targetName:'research.docx',targetKind:'document',phase:'preview',result:'已在副本末尾补充一段研究发现',actions:[]}});
    ui.dispatch({type:'generation/finish',text:'真实文件预览已完成'});
    const open=dom.window.document.querySelector('[data-open-preview]');assert.ok(open);open.click();
    assert.equal(messages.at(-1).type,'openTargetPreview');
    dom.window.document.querySelector('#taskPanel [data-accept]').click();
    assert.equal(messages.filter(m=>m.type==='sceneControl').at(-1).action,'commit');
    dom.window.TuotieDesktopLive.apply({items:[],agent:{destinationId:'office',targetName:'research.docx',targetKind:'document',phase:'done',result:'已在副本末尾补充一段研究发现',actions:[]}});
    assert.match(dom.window.document.querySelector('#taskPanel h3').textContent,/已应用到文档/);
    assert.equal(dom.window.document.querySelector('[data-open-preview]'),null);
  } finally {dom.window.close();}
});

test('a saved Blender target survives a slow startup connection',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];dom.window.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const snapshot={items:[{id:'source-note',type:'text',source:{title:'笔记'},body:{text:'保留场景'}}],destinations:[{id:'blender',name:'Blender',connected:false}],agent:{destinationId:'blender',phase:'idle',actions:[]}};
  dom.window.TuotieDesktopLive.apply(snapshot);
  assert.equal(dom.window.TuotieUI.getState().targetId,'blender');
  assert.equal(messages.some(m=>m.type==='targetSelected'&&m.destinationId==='system'),false);
  dom.window.TuotieDesktopLive.apply({...snapshot,destinations:[{id:'blender',name:'Blender',connected:true}],agent:{destinationId:'blender',phase:'ready',actions:['调整桌面颜色']}});
  assert.match(dom.window.document.querySelector('#intentPanel').textContent,/调整桌面颜色/);
 }finally{dom.window.close();}
});

test('a desktop package drag does not capture the component dock movement',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  dom.window.TuotieDesktopLive.apply({items:[{id:'source-note',type:'text',source:{title:'笔记'},body:{text:'场景参考'}}],agent:{destinationId:'blender',phase:'ready',actions:[]}});
  const header=dom.window.document.querySelector('#bundle .bundle-header');let captures=0;
  header.setPointerCapture=()=>{captures++};
  const down=new dom.window.Event('pointerdown',{bubbles:true});
  Object.defineProperties(down,{isPrimary:{value:true},button:{value:0},pointerId:{value:1},clientX:{value:10},clientY:{value:10}});
  header.dispatchEvent(down);
  assert.equal(captures,0,'the catalog handler must not steal the native package drag');
  assert.equal(dom.window.document.querySelector('#dock').classList.contains('is-dragging'),false);
 }finally{dom.window.close();}
});

test('drop confirmation names the interpreted plan, independently of quick alternatives',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];dom.window.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  dom.window.TuotieDesktopLive.apply({items:[{id:'source-image',type:'image',source:{title:'图片'},body:{}}],agent:{destinationId:'blender',phase:'ready',title:'在桌面落点新增物体',actions:['修改已有物体颜色'],pendingDrop:{eventId:'drop-1',appName:'Blender',placeable:true,summary:'桌面落点'}}});
  assert.equal(dom.window.document.querySelector('#dropConfirm'),null);
  assert.match(dom.window.document.querySelector('#intentInput').dataset.placeholder,/在桌面落点新增物体/);
  assert.doesNotMatch(dom.window.document.querySelector('#intentInput').dataset.placeholder,/修改已有物体颜色/);
  dom.window.document.querySelector('#intentPanel [data-start]').click();
  assert.equal(messages.find(m=>m.type==='work').dropEventId,'drop-1');
 }finally{dom.window.close();}
});

test('Blender shortcut shares the editable paste composer and retains its frozen target',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try {
  const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
  w.eval(overlay);w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const item={id:'reference',type:'image',source:{title:'参考'},body:{}};
  const agent={destinationId:'blender',phase:'ready',title:'在视口中心创建参考主体',actions:['在视口中心创建参考主体'],pendingDrop:{eventId:'shortcut-frozen-1',appName:'Blender',placeable:true,summary:'视口中心'}};
  w.TuotieDesktopLive.apply({items:[item],agent});
  w.TuotieDesktopLive.openBlenderPaste();
  assert.equal(w.TuotieOfficePaste.open,true);assert.equal(w.TuotieOfficePaste.host,'blender');assert.ok(d.querySelector('#officePastePanel'));
  assert.equal(d.querySelector('#bundleStack').hidden,false);assert.equal(d.querySelector('#dropConfirm'),null);
  assert.match(d.querySelector('#intentInput').dataset.placeholder,/视口中心创建参考主体/);
  d.querySelector('[data-edit-recommendation]').click();
  assert.match(d.querySelector('#intentInput').textContent,/视口中心创建参考主体/);
  assert.equal(messages.some(message=>message.type==='work'),false);
  d.querySelector('[data-end-paste]').click();
  w.TuotieDesktopLive.controlFinished('finish');
  assert.equal(messages.find(message=>message.type==='dismissDrop').eventId,'shortcut-frozen-1');
  assert.equal(messages.some(message=>message.type==='work'),false);
  w.TuotieDesktopLive.apply({items:[item],agent:{...agent,pendingDrop:{...agent.pendingDrop,eventId:'shortcut-frozen-2'}}});
  w.TuotieDesktopLive.openBlenderPaste();d.querySelector('#intentPanel [data-start]').click();
  const work=messages.filter(message=>message.type==='work');assert.equal(work.length,1);assert.equal(work[0].dropEventId,'shortcut-frozen-2');
 } finally {dom.window.close();}
});

test('Blender results focus their target once without replaying restored snapshots or backend restarts',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try {
  const w=dom.window,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
  w.eval(overlay);w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const base={destinationId:'blender',runtimeSessionId:'runtime-a',actions:[],changes:{added:['新对象'],modified:[],removed:[]}};
  const apply=(phase,patch={})=>w.TuotieDesktopLive.apply({items:[],agent:{...base,phase,...patch}});
  const count=()=>messages.filter(message=>message.type==='focusTarget').length;
  apply('preview');apply('preview');assert.equal(count(),0,'startup preview is not a new completion');
  apply('running');apply('preview');apply('preview');assert.equal(count(),1);
  apply('done');apply('done');assert.equal(count(),2,'commit focuses once');
  apply('running');apply('preview',{runtimeSessionId:'runtime-b'});assert.equal(count(),2,'restart does not replay a result');
  apply('running',{runtimeSessionId:'runtime-b'});apply('preview',{runtimeSessionId:'runtime-b',error:'失败'});assert.equal(count(),2);
  apply('running',{runtimeSessionId:'runtime-b'});apply('preview',{runtimeSessionId:'runtime-b'});assert.equal(count(),3,'a new run after reconnect may focus normally');
 } finally {dom.window.close();}
});

test('Blender shows scene settings as an applicable result even with no object changes',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try {
  const w=dom.window,d=w.document;w.webkit={messageHandlers:{tuotie:{postMessage:()=>{}}}};
  w.eval(overlay);w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const items=[{id:'scene-ref',type:'text',body:{text:'调整背景和曝光'}}];
  const base={destinationId:'blender',targetKind:'blender-scene',actions:[]};
  w.TuotieDesktopLive.apply({items,agent:{...base,phase:'ready',actions:['调整曝光']}});
  w.TuotieUI.dispatch({type:'generation/start',instruction:'调整曝光'});
  w.TuotieDesktopLive.apply({items,agent:{...base,phase:'preview',previewAvailable:true,
   changes:{added:[],modified:[],removed:[],scene:['相机、环境或渲染设置']}}});
  w.TuotieUI.dispatch({type:'generation/finish',text:'场景设置已生成预览'});
  assert.match(d.querySelector('.scene-changes').textContent,/场景设置 1 项/);
  assert.equal(d.querySelector('#taskPanel [data-accept]').disabled,false);
 }finally{dom.window.close();}
});

test('companion distinguishes idle, collected, working and completion, then offers follow-up',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);
  const ui=dom.window.TuotieUI,doc=dom.window.document,dock=doc.querySelector('#dock');
  ui.configure({manualGeneration:true});
  assert.equal(dock.dataset.assistantState,'idle');
  ui.dispatch({type:'source/add',id:'text'});ui.dispatch({type:'target/set',id:'document'});
  assert.equal(dock.dataset.assistantState,'ready');
  assert.match(doc.querySelector('#petStatus').textContent,/1 项内容/);
  ui.dispatch({type:'direction/choose',index:0});
  assert.equal(dock.dataset.assistantState,'working');
  ui.dispatch({type:'generation/finish',text:'已补充研究发现。其他内容保持原样。'});
  assert.equal(dock.dataset.assistantState,'complete');
  assert.equal(doc.querySelector('.completion-message').textContent,'已补充研究发现。');
  assert.equal(doc.querySelector('#followupInput'),null);
  doc.querySelector('[data-followup]').click();
  assert.ok(doc.querySelector('#followupInput'));
  assert.equal(doc.querySelector('[data-followup]').getAttribute('aria-expanded'),'true');
 }finally{dom.window.close();}
});

test('an archived task can follow up with its prior sources without returning them to the package',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];dom.window.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const ui=dom.window.TuotieUI,live=dom.window.TuotieDesktopLive,doc=dom.window.document;
  const item={id:'task-source',type:'text',source:{title:'研究笔记'},body:{text:'真实资料'}};
  live.apply({items:[item],agent:{destinationId:'blender',phase:'ready',actions:['添加物体']}});
  ui.dispatch({type:'direction/choose',index:0});ui.dispatch({type:'generation/finish',text:'已做好预览。'});
  live.apply({items:[],agent:{destinationId:'blender',phase:'done',taskArchived:true,canUndo:true,result:'已完成这次修改。',actions:[]}});
  live.controlFinished('commit');
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
  assert.match(doc.querySelector('.completion-header').textContent,/撤销/);
  doc.querySelector('[data-followup]').click();
  ui.dispatch({type:'draft/set',role:'followup',parts:[{kind:'text',value:'把刚才那个物体再缩小一点'}]});
  doc.querySelector('[data-adjust-submit]').click();
  const work=messages.filter(m=>m.type==='work').at(-1);
  assert.equal(work.continuation,true);assert.deepEqual(Array.from(work.sourceIds),['task-source']);
  assert.deepEqual(Array.from(ui.getState().sourceIds),[]);
 }finally{dom.window.close();}
});

test('archive shows retained content with image previews and no demo menu leakage',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  dom.window.TuotieDesktopLive.showArchive([{id:'image-history',type:'image',source:{title:'参考照片'},body:{},preview:'data:image/png;base64,aGVsbG8=',archivedAt:'2026-10-28T00:00:00Z'}]);
  assert.equal(dom.window.document.querySelector('#detailBackdrop').hidden,false);
  assert.equal(dom.window.document.querySelector('.archive-item img').alt,'参考照片');
  const native=readFileSync(new URL('../Sources/main.swift',import.meta.url),'utf8');
  const menu=native.slice(native.indexOf('private func previewMenu'),native.indexOf('func validateMenuItem'));
  assert.match(menu,/设置…/);assert.match(menu,/查看归档/);
  assert.doesNotMatch(menu,/演示|练习|组件目录|立即完成/);
 }finally{dom.window.close();}
});


test('empty capture state stays quiet even when a target or stale recommendations arrive',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive,ui=dom.window.TuotieUI,doc=dom.window.document;
  live.apply({items:[{id:'old',type:'text',source:{title:'旧任务'},body:{text:'资料'}}],agent:{destinationId:'blender',phase:'ready',actions:['旧建议']}});
  live.apply({items:[],agent:{destinationId:'blender',phase:'ready',actions:['不能再显示的旧建议']}});
  live.showContent();ui.dispatch({type:'target/set',id:'blender'});
  assert.equal(ui.getState().sourceIds.length,0);
  assert.equal(doc.querySelector('#dock').dataset.assistantState,'idle');
  assert.equal(doc.querySelector('#intentPanel').hidden,true);assert.equal(doc.querySelector('#bundleStack').hidden,true);
  assert.equal(live.directionTexts().length,0);
 }finally{dom.window.close();}
});

test('recommendations clear immediately on focus and package changes, with an explicit anchored target exception',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive;
  const blender={appName:'Blender',bundleId:'org.blenderfoundation.blender'},chat={appName:'ChatGPT',bundleId:'com.openai.chat'};
  const item={id:'source-1',type:'text',source:{title:'参考'},body:{text:'参考内容'}};
  const agent={phase:'ready',destinationId:'blender',focus:blender,plannedSourceIds:['source-1'],actions:['修改三维场景']};
  live.setFocus('Blender',blender);live.apply({items:[item],destinations:[],agent});
  assert.deepEqual([...live.directionTexts()],['修改三维场景']);
  live.setFocus('ChatGPT',chat);assert.deepEqual([...live.directionTexts()],[]);
  live.apply({items:[item],destinations:[],agent:{...agent,anchor:{...blender,editAnchor:{markedAt:'now'}}}});
  assert.deepEqual([...live.directionTexts()],['修改三维场景']);
  assert.match(live.focusMarkup(),/修改这里/);assert.match(live.focusMarkup(),/ChatGPT/);
  live.apply({items:[item,{...item,id:'source-2'}],destinations:[],agent});assert.deepEqual([...live.directionTexts()],[]);
  live.apply({items:[],destinations:[],agent});assert.deepEqual([...live.directionTexts()],[]);
  assert.equal(dom.window.document.querySelector('#bundleStack').hidden,true);
 }finally{dom.window.close();}
});

test('ready recommendations survive different JSON key ordering between native focus and backend focus',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive;
  const nativeFocus={accessibility:false,appName:'ChatGPT',bundleId:'com.openai.codex',windowTitle:'研究方法'};
  const backendFocus={windowTitle:'研究方法',bundleId:'com.openai.codex',appName:'ChatGPT',accessibility:false};
  live.setFocus('ChatGPT',nativeFocus);
  live.apply({items:[{id:'actual-source',type:'text',source:{title:'参考资料'},body:{text:'具体资料内容'}}],destinations:[],agent:{phase:'ready',destinationId:'focused',targetName:'ChatGPT',focus:backendFocus,plannedSourceIds:['actual-source'],actions:['整理为对话提问']}});
  assert.deepEqual([...live.directionTexts()],['整理为对话提问']);
 }finally{dom.window.close();}
});

test('shortcut and extension web sources are links, and native sources explicitly navigate to their app',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  dom.window.TuotieDesktopLive.apply({items:[
   {id:'web-shortcut',type:'text',source:{title:'快捷键网页',url:'https://example.org/article?a=1#part',captureMethod:'global-shortcut',bundleId:'com.google.Chrome'},body:{text:'参考正文'}},
   {id:'web-extension',type:'image',source:{title:'插件网页',url:'https://example.org/photo',captureMethod:'image-context-menu'},body:{}},
   {id:'native-shortcut',type:'text',source:{title:'微信窗口',appName:'微信',bundleId:'com.tencent.xinWeChat',captureMethod:'global-shortcut'},body:{text:'参考文字'}},
   {id:'unknown',type:'text',source:{title:'没有地址'},body:{text:'参考文字'}},
  ],agent:{phase:'idle',actions:[]}});
  const doc=dom.window.document;
  assert.equal(doc.querySelector('[data-card="web-shortcut"] .origin-link')?.getAttribute('href'),'https://example.org/article?a=1#part');
  assert.equal(doc.querySelector('[data-card="web-extension"] .origin-link')?.getAttribute('href'),'https://example.org/photo');
  const native=doc.querySelector('[data-card="native-shortcut"] .origin-link');
  assert.equal(native?.getAttribute('href'),'tuotie-app://open?bundleId=com.tencent.xinWeChat');
  assert.match(native.textContent,/微信.*前往应用/);
  assert.equal(doc.querySelector('[data-card="unknown"] .origin-link'),null);
 }finally{dom.window.close();}
});

test('compact collection backs the front card and disclosure pill without the removed composer',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];
 dom.window.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
 try{
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
   const y=this.matches('#intentPanel .direction-status')?20:this.matches('#intentPanel .direction-composer')?90:this.matches('#bundle .collection-front')?160:this.matches('#collapseButton')?250:-1;
   return {x:10,y,left:10,top:y,right:310,bottom:y+49,width:y<0?0:300,height:y<0?0:49};
  };
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  dom.window.TuotieDesktopLive.setFocus('文本编辑',{appName:'文本编辑',bundleId:'com.apple.TextEdit'});
  dom.window.TuotieDesktopLive.apply({items:[{id:'reference',type:'text',source:{title:'参考'},body:{text:'真实内容'}}],agent:{destinationId:'focused',phase:'planning',actions:[]}});
  dom.window.document.querySelector('#dockBot').click();
  dom.window.document.querySelector('#collapseButton').click();
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(dom.window.document.querySelector('#intentPanel .direction-composer'),null);
  const geometry=messages.filter(message=>message.type==='geometry').at(-1);
  assert.deepEqual(Array.from(geometry.surfaces,surface=>surface.y).sort((a,b)=>a-b),[160,250]);
 }finally{dom.window.close();}
});

test('native toast backing appears with a notice and disappears when hidden',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];
 dom.window.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
 try{
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
   return {left:10,top:20,width:this.id==='toast'?180:0,height:this.id==='toast'?34:0};
  };
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const report=()=>{dom.window.dispatchEvent(new dom.window.Event('resize'));return messages.filter(m=>m.type==='geometry').at(-1);};
  assert.equal(report().surfaces.length,0);
  dom.window.TuotieDesktopLive.apply({items:[],agent:{phase:'idle',notice:{id:'capture-notice',text:'已加入内容包'}}});
  assert.equal(report().surfaces.length,1);
  dom.window.document.querySelector('#toast').hidden=true;
  assert.equal(report().surfaces.length,0);
 }finally{dom.window.close();}
});

test('focused text result receives one backdrop, without ghosts from a transparent task container',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 const messages=[];
 dom.window.webkit={messageHandlers:{tuotie:{postMessage:message=>messages.push(message)}}};
 try{
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
   return {left:10,top:20,width:this.matches('.office-result')?300:0,height:this.matches('.office-result')?100:0};
  };
  dom.window.eval(overlay);dom.window.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const live=dom.window.TuotieDesktopLive,ui=dom.window.TuotieUI;
  live.setFocus('文本编辑',{appName:'文本编辑',bundleId:'com.apple.TextEdit'});
  live.apply({items:[{id:'reference',type:'text',source:{title:'参考'},body:{text:'资料'}}],agent:{destinationId:'focused',targetKind:'focused-text',phase:'ready',actions:['整理文字']}});
  ui.dispatch({type:'direction/choose',index:0});ui.dispatch({type:'generation/finish',text:'已完成'});
  live.apply({items:[],agent:{destinationId:'focused',targetKind:'focused-text',phase:'preview',previewText:'生成的正文',actions:[]}});
  const result=dom.window.document.querySelector('.office-result.completion-header');
  assert.ok(result);
  const report=()=>{dom.window.dispatchEvent(new dom.window.Event('resize'));return messages.filter(m=>m.type==='geometry').at(-1);};
  assert.equal(report().surfaces.length,1);
  dom.window.document.querySelector('#taskPanel').style.opacity='0';
  assert.equal(report().surfaces.length,0);
 }finally{dom.window.close();}
});

test('Blender loading composer permits an explicit prompt and protects it from late recommendations',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,d=w.document,messages=[];w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  w.eval(overlay);w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const items=[{id:'blender-ref',type:'text',body:{text:'只保留真实资料'}}];
  const agent={destinationId:'blender',phase:'planning',actions:[],pendingDrop:{eventId:'frozen',summary:'桌面落点',placeable:true}};
  w.TuotieDesktopLive.apply({items,agent});
  const editor=d.querySelector('#intentInput');editor.textContent='生成绿色立方体';editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.TuotieDesktopLive.apply({items,agent:{...agent,phase:'ready',title:'不同的默认要求',actions:['不同的默认要求']}});
  assert.equal(d.querySelector('#intentInput').textContent,'生成绿色立方体');
  d.querySelector('#intentPanel [data-start]').click();
  const work=messages.find(m=>m.type==='work');assert.equal(work.instruction,'生成绿色立方体');assert.equal(work.dropEventId,'frozen');
  assert.equal(messages.filter(m=>m.type==='work').length,1);
 }finally{dom.window.close();}
});

test('one Blender apply click commits once and shows undo without a second confirmation',()=>{
 const dom=new JSDOM(html,{url:'file:///tuotie/components-preview.html',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,d=w.document,messages=[];let confirmations=0;
  w.confirm=()=>{confirmations++;return true;};w.webkit={messageHandlers:{tuotie:{postMessage:m=>messages.push(m)}}};
  w.eval(overlay);w.eval(readFileSync(new URL('../desktop-live.js',import.meta.url),'utf8'));
  const items=[{id:'apply-source',type:'text',body:{text:'隔离场景参考'}}];
  const base={destinationId:'blender',targetKind:'blender-scene',phase:'ready',title:'在落点生成物体',actions:['在落点生成物体'],pendingDrop:{eventId:'apply-frozen',placeable:true}};
  const live=w.TuotieDesktopLive;live.apply({items,agent:base});
  d.querySelector('#intentPanel [data-start]').click();
  const preview={...base,phase:'preview',pendingDrop:null,result:'已生成独立预览',canUndo:false};
  live.apply({items,agent:preview});w.TuotieUI.dispatch({type:'generation/finish',text:'已生成独立预览'});
  d.querySelector('#taskPanel [data-accept]').click();
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='commit').length,1);
  assert.equal(d.querySelector('#taskPanel [data-accept]').disabled,true);
  d.querySelector('#taskPanel [data-accept]').click();
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='commit').length,1);
  live.controlFinished('commit');
  assert.match(d.querySelector('.completion-header').textContent,/已应用到 Blender.*撤销/);
  assert.doesNotMatch(d.querySelector('.completion-header').textContent,/取消预览|应用中|确认|结束/);
  assert.equal(d.querySelector('#taskPanel [data-accept]').getAttribute('aria-label'),'关闭本次任务面板');
  // A preview snapshot queued before the acknowledgement cannot revive Apply.
  live.apply({items,agent:preview});
  assert.match(d.querySelector('.completion-header').textContent,/已应用到 Blender.*撤销/);
  assert.equal(confirmations,0);
  d.querySelector('#taskPanel [data-undo]').click();
  assert.equal(messages.filter(m=>m.type==='sceneControl'&&m.action==='undo').length,1);
 }finally{dom.window.close();}
});
