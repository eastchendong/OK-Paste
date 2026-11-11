import {expect,it,vi} from 'vitest';
import {createBridgeClient} from '../office-live/bridge-client.js';
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>String(body)})as Response;
function setup(){
 const queue:any[]=[];const deliveries:any[]=[];let failDelivery=false,failPoll=false,reset=false,rotate=false;
 const fetch=vi.fn(async(url:any,options:any)=>{
  if(options?.method!=='POST')return response('window.TUOTIE_LOCAL={"token":"new-token"};');
  const body=JSON.parse(options.body);
  if(rotate){rotate=false;return response({},403);}
  if(url==='/connect')return response({sessionId:'session'});
  if(url==='/poll'){if(reset){reset=false;return response({error:'请重新连接'},409);}if(failPoll){failPoll=false;throw new Error('offline');}return response({commands:queue.splice(0)});}
  deliveries.push(body);if(failDelivery){failDelivery=false;throw new Error('lost acknowledgement');}return response({ok:true});
 })as unknown as typeof globalThis.fetch;
 const execute=vi.fn(async()=>({ok:true})),client=createBridgeClient({token:'old-token',bootstrapPath:'/word.html',describe:async()=>({host:'word',url:'fixture'}),execute,fetch});
 const command=(id:string)=>({id,method:'insert',args:{text:id},expiresAt:Date.now()+15000});
 return {client,execute,fetch,queue,deliveries,command,loseDelivery:()=>failDelivery=true,losePoll:()=>failPoll=true,reset:()=>reset=true,rotate:()=>rotate=true};
}
it('retries only delivery after a lost acknowledgement and preserves the rest of a polled batch',async()=>{
 const s=setup();s.queue.push(s.command('one'),s.command('two'));s.loseDelivery();
 expect(await s.client.pollOnce()).toBe(false);expect(s.execute).toHaveBeenCalledTimes(1);
 expect(await s.client.pollOnce()).toBe(true);expect(s.execute).toHaveBeenCalledTimes(2);
 expect(s.deliveries.map(d=>d.id)).toEqual(['one','one','two']);
 expect((s.fetch as any).mock.calls.filter(([url]:any)=>url==='/connect')).toHaveLength(1);
});
it('retains the same session across a transient polling failure',async()=>{
 const s=setup();await s.client.pollOnce();s.losePoll();await s.client.pollOnce();await s.client.pollOnce();
 expect((s.fetch as any).mock.calls.filter(([url]:any)=>url==='/connect')).toHaveLength(1);
});
it('refreshes transport credentials without reloading or reconstructing the editor adapter',async()=>{
 const s=setup();await s.client.pollOnce();s.rotate();expect(await s.client.pollOnce()).toBe(false);await s.client.pollOnce();
 expect((s.fetch as any).mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer new-token');
 expect((s.fetch as any).mock.calls.filter(([url]:any)=>url==='/connect')).toHaveLength(1);expect(s.execute).not.toHaveBeenCalled();
});
it('discards old commands when a backend session was lost, without replaying a completed write',async()=>{
 const s=setup();s.queue.push(s.command('one'));s.loseDelivery();await s.client.pollOnce();
 const original=s.fetch as any;original.mockImplementationOnce(async()=>response({error:'会话失效'},409));
 await s.client.pollOnce();await s.client.pollOnce();expect(s.execute).toHaveBeenCalledTimes(1);
 expect((s.fetch as any).mock.calls.filter(([url]:any)=>url==='/connect')).toHaveLength(2);
});
it('rejects a queued command whose execution deadline has passed before touching the document',async()=>{
 const s=setup();s.queue.push({...s.command('late'),expiresAt:Date.now()-1});await s.client.pollOnce();
 expect(s.execute).not.toHaveBeenCalled();expect(s.deliveries[0]).toMatchObject({id:'late',mutationStarted:false,error:expect.stringContaining('过期')});
});

it('automatically connects a Figma client after startup while the local service was offline',async()=>{
 let online=false;const calls:string[]=[];
 const fetch=vi.fn(async(url:any)=>{calls.push(url);if(!online)throw new Error('offline');return response(url==='/connect'?{sessionId:'figma-session'}:{commands:[]});}) as typeof globalThis.fetch;
 const execute=vi.fn(),onStatus=vi.fn();
 const client=createBridgeClient({token:'local',bootstrapPath:'/figma.html',describe:async()=>({host:'figma',documentName:'测试稿'}),execute,onStatus,fetch});
 expect(await client.pollOnce()).toBe(false);
 online=true;expect(await client.pollOnce()).toBe(true);
 expect(calls).toEqual(['/connect','/connect','/poll']);expect(execute).not.toHaveBeenCalled();
 expect(onStatus).toHaveBeenLastCalledWith({host:'figma',documentName:'测试稿'});
});

it('times out a hung result acknowledgement and reconnects without repeating the host edit',async()=>{
 vi.useFakeTimers();
 try{
  let hung=true,queued=true;const execute=vi.fn(async()=>({ok:true}));let signal:AbortSignal|undefined;
  const fetch=vi.fn(async(url:any,options:any)=>{
   if(url==='/connect')return response({sessionId:'figma-session'});
   if(url==='/poll'){const commands=queued?[{id:'edit-once',method:'apply',args:{}}]:[];queued=false;return response({commands});}
   if(hung){signal=options.signal;return new Promise<Response>(()=>{});}
   return response({ok:true});
  }) as typeof globalThis.fetch;
  const client=createBridgeClient({token:'local',bootstrapPath:'/figma.html',describe:async()=>({host:'figma'}),execute,fetch,requestTimeoutMs:100});
  const pending=client.pollOnce();await vi.advanceTimersByTimeAsync(101);
  expect(await pending).toBe(false);expect(signal?.aborted).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
  hung=false;expect(await client.pollOnce()).toBe(true);expect(execute).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
