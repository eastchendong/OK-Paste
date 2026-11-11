import http from 'node:http';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
export const FIGMA_PORT=47723;
export function figmaConnection(root:string){
 const file=path.join(root,'.local/figma-connection.json');
 if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8')) as {token:string};
 fs.mkdirSync(path.dirname(file),{recursive:true});const config={token:crypto.randomBytes(24).toString('hex')};fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});return config;
}
/** The plugin only executes requests from this MCP process, on loopback. */
export class FigmaBridge {
 private server?:http.Server;private queue:{id:string;name:string;args:Record<string,unknown>}[]=[];
 private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private snapshot:Record<string,unknown>={};private seen=0;private session='';
 constructor(readonly token:string){}
 status(){return Date.now()-this.seen<10000?{...this.snapshot,connected:true}:{connected:false,instruction:'请在 Figma 运行「妥帖 MCP」本机插件'};}
 async start(port=FIGMA_PORT){
  this.server=http.createServer(async(req,res)=>{
   const origin=req.headers.origin;
   if(origin&&!['null','https://www.figma.com','https://figma.com'].includes(origin)){res.writeHead(403).end();return;}
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
   res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Tuotie-Token');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
   if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
   const send=(code:number,value:unknown)=>{res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
   if(req.headers['x-tuotie-token']!==this.token){send(403,{error:'插件连接码无效，请重新运行 setup:figma'});return;}
   try{
    let body:any={};if(req.method==='POST'){const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16*1024*1024)throw new Error('插件响应过大');chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString());}
    if(req.method==='POST'&&req.url==='/snapshot'){
     if(typeof body.session!=='string'||!body.context?.pageId)throw new Error('插件上下文无效');
     // Do not let a second Figma file steal an active task's connection.
     if(this.session&&this.session!==body.session&&Date.now()-this.seen<10000){send(409,{error:'已有 Figma 文件连接，请先关闭原文件的妥帖插件'});return;}
     this.session=body.session;this.snapshot=body.context;this.seen=Date.now();send(200,{ok:true});
    }else if(req.method==='GET'&&req.url==='/commands'){send(200,{commands:this.queue.splice(0)});}
    else if(req.method==='POST'&&req.url==='/result'){
     const pending=this.pending.get(body.id);if(pending){clearTimeout(pending.timer);this.pending.delete(body.id);body.error?pending.reject(new Error(String(body.error))):pending.resolve(body.result);}send(200,{ok:true});
    }else send(404,{error:'没有这个接口'});
   }catch(error){send(400,{error:error instanceof Error?error.message:String(error)});}
  });
  await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(port,'127.0.0.1',()=>{this.server!.off('error',reject);resolve();});});
  return (this.server.address() as {port:number}).port;
 }
 request(name:string,args:Record<string,unknown>={}){
  if(!this.status().connected)return Promise.reject(new Error('请先在 Figma 运行「妥帖 MCP」插件'));
  return new Promise<any>((resolve,reject)=>{
   const id=crypto.randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);this.queue=this.queue.filter(command=>command.id!==id);reject(new Error('Figma 操作结果未确认，请检查插件后重试'));},15000);
   this.pending.set(id,{resolve,reject,timer});this.queue.push({id,name,args});
  });
 }
 async close(){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Figma 连接已关闭'));}this.pending.clear();this.queue=[];await new Promise<void>(resolve=>this.server?this.server.close(()=>resolve()):resolve());}
}
