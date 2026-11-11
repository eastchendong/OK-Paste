import {expect,it,vi} from 'vitest';
import {Readable} from 'node:stream';
import type http from 'node:http';
import {handleClipboard,type ClipboardServerOptions} from '../src/clipboard/server';

async function request(headers:Record<string,string|undefined>,prepare=vi.fn(async()=>({ok:true}))){
 const req=Object.assign(Readable.from(['{}']),{method:'POST',url:'/v1/agent/pack-drag',headers}) as unknown as http.IncomingMessage;
 let status=0,body='';
 const res={writeHead:(code:number)=>{status=code;},end:(value:string)=>{body=value;}} as http.ServerResponse;
 await handleClipboard(req,res,{agent:{status:()=>({phase:'ready'}),preparePackDrag:prepare}} as unknown as ClipboardServerOptions);
 return {status,body:JSON.parse(body),prepare};
}
it('permits only the native drag route to release a captured position',async()=>{
 const accepted=await request({'x-tuotie-native':'pack-drag'});
 expect(accepted.status).toBe(200);expect(accepted.body).toEqual({ok:true});expect(accepted.prepare).toHaveBeenCalledOnce();
 for(const headers of [{},{origin:'https://example.org'},{origin:'https://example.org','x-tuotie-native':'pack-drag'},{'x-tuotie-native':'input-paste'}]){
  const denied=await request(headers);expect(denied.status).toBe(403);expect(denied.prepare).not.toHaveBeenCalled();
 }
});
it('returns the backend task-preservation reason to the native drag gesture',async()=>{
 const prepare=vi.fn(async()=>({ok:false,error:'请先结束当前任务'}));
 const result=await request({'x-tuotie-native':'pack-drag'},prepare);
 expect(result.body).toEqual({ok:false,error:'请先结束当前任务'});
});
it('requires the native header, no browser origin and a valid nonce to cancel a late drop capture',async()=>{
 const cancelNativeDrop=vi.fn(async()=>({ok:true}));
 for(const [headers,id,expected]of [
  [{},crypto.randomUUID(),403],
  [{'x-tuotie-native':'pack-drag',origin:'https://example.org'},crypto.randomUUID(),403],
  [{'x-tuotie-native':'pack-drag'},'bad',400],
  [{'x-tuotie-native':'pack-drag'},crypto.randomUUID(),200],
 ]as const){
  const req=Object.assign(Readable.from([JSON.stringify({id})]),{method:'POST',url:'/v1/agent/pack-drop-cancel',headers}) as unknown as http.IncomingMessage;
  let status=0;const res={writeHead:(code:number)=>{status=code;},end(){}} as unknown as http.ServerResponse;
  await handleClipboard(req,res,{agent:{status:()=>({phase:'ready'}),cancelNativeDrop}} as unknown as ClipboardServerOptions);
  expect(status).toBe(expected);
 }
 expect(cancelNativeDrop).toHaveBeenCalledOnce();
});
