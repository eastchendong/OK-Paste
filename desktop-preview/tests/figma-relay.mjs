import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

test('Figma relay accepts source-less sandbox replies only for a trusted pending command',()=>{
 const dom=new JSDOM(readFileSync(new URL('../../figma-live/ui.html',import.meta.url),'utf8'),{runScripts:'dangerously',url:'https://www.figma.com/plugin-sandbox'});
 try{
  const w=dom.window,frame=w.document.querySelector('iframe'),toHost=[],toBridge=[];
  w.postMessage=(...args)=>toHost.push(args);frame.contentWindow.postMessage=(...args)=>toBridge.push(args);
  const send=(data,source,origin)=>w.dispatchEvent(new w.MessageEvent('message',{data,source,origin}));
  const command={type:'host-command',id:'probe',method:'info'};
  send(command,frame.contentWindow,'https://foreign.example');assert.equal(toHost.length,0);
  send(command,frame.contentWindow,'https://localhost:47722');assert.equal(toHost.length,1);
  const reply={pluginMessage:{type:'host-result',id:'probe',result:{documentName:'测试'}}};
  send(reply,frame.contentWindow,'https://localhost:47722');assert.equal(toBridge.length,0);
  send(reply,null,'');assert.equal(toBridge.length,1);assert.equal(toBridge[0][1],'https://localhost:47722');
  send(reply,null,'');assert.equal(toBridge.length,1);
 }finally{dom.window.close();}
});

function relayClock(){
 let now=0,tick;
 const dom=new JSDOM(readFileSync(new URL('../../figma-live/ui.html',import.meta.url),'utf8'),{
  runScripts:'dangerously',url:'https://www.figma.com/plugin-sandbox',
  beforeParse(w){w.Date.now=()=>now;w.setInterval=callback=>{tick=callback;return 1;};},
 });
 const w=dom.window,frame=w.document.querySelector('iframe');w.postMessage=()=>{};
 return {dom,frame,advance(ms){now+=ms;tick();},send(data,origin='https://localhost:47722',source=frame.contentWindow){w.dispatchEvent(new w.MessageEvent('message',{data,source,origin}));}};
}

test('Figma retries a failed initial page load but trusts only local iframe heartbeats',()=>{
 const r=relayClock();try{
  assert.equal(r.frame.hidden,true);assert.equal(r.dom.window.document.getElementById('connection').hidden,false);
  r.advance(7000);r.send({type:'bridge-heartbeat'},'https://foreign.example');
  r.advance(2000);assert.match(r.frame.src,/reconnect=9000$/);
  r.send({type:'bridge-heartbeat'});assert.equal(r.frame.hidden,false);assert.equal(r.dom.window.document.getElementById('connection').hidden,true);r.advance(7000);assert.match(r.frame.src,/reconnect=9000$/);
  r.send(null);r.send({type:'bridge-heartbeat'});r.advance(7000);assert.match(r.frame.src,/reconnect=9000$/);
  r.advance(2000);assert.match(r.frame.src,/reconnect=25000$/);assert.equal(r.frame.hidden,true);
 }finally{r.dom.window.close();}
});

test('Figma does not reload a bridge while a host operation is awaiting its result',()=>{
 const r=relayClock();try{
  r.send({type:'host-command',id:'write',method:'apply'});
  r.advance(9000);assert.doesNotMatch(r.frame.src,/reconnect/);
  r.send({pluginMessage:{type:'host-result',id:'write',result:{ok:true}}},'',null);
  r.advance(2000);assert.match(r.frame.src,/reconnect=11000$/);
 }finally{r.dom.window.close();}
});
