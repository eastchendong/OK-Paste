import {afterAll,beforeAll,expect,it} from 'vitest';
import https from 'node:https';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {WordBridge} from '../src/office-live/bridge';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-bridge-'));
const directory=path.join(root,'.local/office-live');const port=49722,origin=`https://localhost:${port}`;
let bridge:WordBridge,token='',ca:Buffer;
async function request(route:string,body?:unknown,extra:Record<string,string>={}){
 return new Promise<{status:number;body:any}>((resolve,reject)=>{
  const req=https.request({hostname:'127.0.0.1',servername:'localhost',port,path:route,method:body?'POST':'GET',ca,headers:{Host:`localhost:${port}`,Origin:origin,Authorization:`Bearer ${token}`,...extra}},res=>{
   const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode!,body:res.headers['content-type']?.includes('application/json')?JSON.parse(text):text});});
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
beforeAll(async()=>{
 fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(root,'office-live'));
 fs.writeFileSync(path.join(root,'office-live/word.html'),'window.TUOTIE_LOCAL=/*LOCAL_CONFIG*/;');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',path.join(directory,'localhost-key.pem'),'-out',path.join(directory,'localhost-cert.pem')],{stdio:'ignore'});
 ca=fs.readFileSync(path.join(directory,'localhost-cert.pem'));bridge=new WordBridge(root);await bridge.start(port);
 const page=await request('/word.html');token=JSON.parse(page.body.split('=')[1].slice(0,-1)).token;
});
afterAll(async()=>{await bridge?.close();fs.rmSync(root,{recursive:true,force:true});});
it('rejects foreign browser origins, missing tokens and arbitrary resource paths',async()=>{
 expect((await request('/connect',{url:''},{Origin:'https://example.com'})).status).toBe(403);
 expect((await request('/connect',{url:''},{Authorization:'Bearer wrong'})).status).toBe(403);
 expect((await request('/../../.env.local')).status).toBe(403);
});
it('routes a one-time command to one connected document and rejects ambiguous unsaved documents',async()=>{
 const connected=await request('/connect',{host:'word',url:''});const sessionId=connected.body.sessionId;
 expect(bridge.select({appName:'Word',bundleId:'com.microsoft.Word'})).toBe(sessionId);
 const result=bridge.request(sessionId,'capture');
 const poll=await request('/poll',{sessionId});const command=poll.body.commands[0];expect(command.method).toBe('capture');
 expect((await request('/poll',{sessionId})).body.commands).toEqual([]);
 await request('/result',{sessionId,id:command.id,result:{anchorId:'a'}});
 expect(await result).toEqual({anchorId:'a'});
 await request('/connect',{host:'word',url:''});expect(()=>bridge.select({appName:'Word',bundleId:'com.microsoft.Word'})).toThrow('多个 Word');
});
it('matches a Mac Office filesystem path without requiring file URL syntax',async()=>{
 const url='/Users/test/Documents/中文 文件.docx';
 const connected=await request('/connect',{host:'word',url});
 expect(bridge.select({appName:'Word',bundleId:'com.microsoft.Word',documentPath:url})).toBe(connected.body.sessionId);
});
it('preserves explicit pre-mutation rejection information from the authenticated host',async()=>{
 const {body:{sessionId}}=await request('/connect',{host:'word',url:'/isolated/revision-test.docx'});
 const pending=bridge.request(sessionId,'insert',{anchorId:'a'});
 const rejection=expect(pending).rejects.toMatchObject({message:'文档已改变',mutationStarted:false});
 const poll=await request('/poll',{sessionId});
 await request('/result',{sessionId,id:poll.body.commands[0].id,error:'文档已改变',mutationStarted:false});
 await rejection;
});
it('reports a disconnected request that was never queued as a confirmed pre-mutation refusal',async()=>{
 await expect(bridge.request('missing-session','apply',{anchorId:'a'})).rejects.toMatchObject({mutationStarted:false,message:expect.stringContaining('连接已断开')});
});
it('keeps PowerPoint sessions separate from connected Word documents',async()=>{
 const connection=await request('/connect',{host:'powerpoint',url:''});
 expect(connection.status).toBe(200);
 expect(bridge.select({appName:'PowerPoint',bundleId:'com.microsoft.Powerpoint'},'powerpoint')).toBe(connection.body.sessionId);
});
it('serves Illustrator through the same authenticated transport without mixing host sessions',async()=>{
 fs.mkdirSync(path.join(root,'illustrator-live'));
 fs.writeFileSync(path.join(root,'illustrator-live/illustrator.html'),'window.TUOTIE_LOCAL=/*LOCAL_CONFIG*/;');
 expect((await request('/illustrator.html')).status).toBe(200);
 const connection=await request('/connect',{host:'illustrator',url:'file:///fixture.ai'});
 expect(connection.status).toBe(200);
 expect(bridge.select({appName:'Illustrator',bundleId:'com.adobe.illustrator'},'illustrator')).toBe(connection.body.sessionId);
 const pending=bridge.request(connection.body.sessionId,'read',{anchorId:'anchor'});
 const poll=await request('/poll',{sessionId:connection.body.sessionId});
 await request('/result',{sessionId:connection.body.sessionId,id:poll.body.commands[0].id,result:{version:'v1'}});
 expect(await pending).toEqual({version:'v1'});
 expect((await request('/illustrator-host.jsx')).status).toBe(403);
});
it('matches Figma by the focused file name and rejects mismatches and duplicate connected names',async()=>{
 fs.mkdirSync(path.join(root,'figma-live'));fs.writeFileSync(path.join(root,'figma-live/figma.html'),'window.TUOTIE_LOCAL=/*LOCAL_CONFIG*/;');
 expect((await request('/figma.html')).status).toBe(200);
 const connection=await request('/connect',{host:'figma',documentName:'合成角色测试'});
 const focus={appName:'Figma',bundleId:'com.figma.Desktop',windowTitle:'合成角色测试'};
 expect(bridge.select(focus,'figma')).toBe(connection.body.sessionId);
 expect(()=>bridge.select({...focus,windowTitle:'其他文稿'},'figma')).toThrow('请先');
 await request('/connect',{host:'figma',documentName:'合成角色测试'});expect(()=>bridge.select(focus,'figma')).toThrow('多个');
});
