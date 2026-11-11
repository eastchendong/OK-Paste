import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import type {AppContext} from '../app-context';

export interface WordSnapshot {
 protocolVersion?:number;
 anchorId:string; body:string; bodyOoxml:string;
 paragraphs:{text:string;style:string}[];
 location:{paragraphIndex:number;before:string;after:string;section:string};
}
export type OfficeHost='word'|'excel'|'powerpoint';
export type DocumentHost=OfficeHost|'illustrator'|'figma';
export type ExcelCell=string|number|boolean|null;
export type ExcelInputCell=ExcelCell|{text:string}|{formula:string};
export interface ExcelRangeSnapshot {
 address:string;rowCount:number;columnCount:number;
 formulas:ExcelCell[][];text:string[][];numberFormat:string[][];formulaMask?:boolean[][];
}
export interface ExcelSnapshot {
 protocolVersion?:number;anchorId:string;version:string;worksheet:string;selection:ExcelRangeSnapshot;
 workbook:{name:string;sheets:{name:string;usedRange:ExcelRangeSnapshot|null}[]};
}
type Command={id:string;method:string;args:Record<string,unknown>;expiresAt:number};
type Session={id:string;host:DocumentHost;url:string;documentName:string;seen:number;queue:Command[]};
type Pending={sessionId:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};

/** Local authenticated transport only; each host owns its document operations. */
export class OfficeBridge {
 private sessions=new Map<string,Session>();private pending=new Map<string,Pending>();
 private token=crypto.randomBytes(32).toString('hex');private server?:https.Server;
 constructor(private root:string){}
 async start(port=47722){
  const directory=path.join(this.root,'.local/office-live');
  if(!fs.existsSync(path.join(directory,'localhost-key.pem')))return false;
  const origin=`https://localhost:${port}`;
  this.server=https.createServer({key:fs.readFileSync(path.join(directory,'localhost-key.pem')),cert:fs.readFileSync(path.join(directory,'localhost-cert.pem'))},(req,res)=>{
   const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   void (async()=>{
    if(req.headers.host!==`localhost:${port}`)return send(403,{error:'Host 无效'});
    const url=new URL(req.url||'/',origin);
    if(req.method==='GET'&&['/word.html','/word.js','/word-adapter.js','/excel.html','/excel.js','/excel-adapter.js','/powerpoint.html','/powerpoint.js','/powerpoint-adapter.js','/bridge-client.js','/illustrator.html','/illustrator.js','/figma.html','/figma.js'].includes(url.pathname)){
     const name=url.pathname.slice(1);let data=fs.readFileSync(path.join(this.root,name.startsWith('figma.')?'figma-live':name.startsWith('illustrator.')?'illustrator-live':'office-live',name),'utf8');
     if(name.endsWith('.html'))data=data.replace('/*LOCAL_CONFIG*/',JSON.stringify({token:this.token}));
     res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return;
    }
    if(req.method!=='POST'||req.headers.origin!==origin||req.headers.authorization!==`Bearer ${this.token}`)return send(403,{error:'连接未经授权'});
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)return send(413,{error:'文档超过本地接口大小限制，请缩小文档后重试'});chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(url.pathname==='/connect'){
     for(const [id,session] of this.sessions)if(Date.now()-session.seen>60000)this.sessions.delete(id);
     if(!['word','excel','powerpoint','illustrator','figma'].includes(body.host))return send(400,{error:'文档宿主无效'});
     const id=crypto.randomUUID();this.sessions.set(id,{id,host:body.host,url:typeof body.url==='string'?body.url:'',documentName:typeof body.documentName==='string'?body.documentName:'',seen:Date.now(),queue:[]});return send(200,{sessionId:id});
    }
    const session=this.sessions.get(body.sessionId);if(!session)return send(409,{error:'请重新连接妥帖'});session.seen=Date.now();
    if(url.pathname==='/poll'){if(typeof body.url==='string')session.url=body.url;if(typeof body.documentName==='string')session.documentName=body.documentName;const commands=session.queue.splice(0);return send(200,{commands});}
    if(url.pathname==='/result'){
     const pending=this.pending.get(body.id);
     if(pending?.sessionId===session.id){
      clearTimeout(pending.timer);this.pending.delete(body.id);
      if(body.error)pending.reject(Object.assign(new Error(String(body.error)),typeof body.mutationStarted==='boolean'?{mutationStarted:body.mutationStarted}:{}));
      else pending.resolve(body.result);
     }
     return send(200,{ok:true});
    }
    send(404,{error:'没有这个接口'});
   })().catch(error=>{if(!res.headersSent)send(400,{error:error instanceof Error?error.message:'Office 请求无效'});});
  });
  await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(port,'127.0.0.1',resolve);});return true;
 }
 select(focus:AppContext,host:DocumentHost='word'){
  const live=[...this.sessions.values()].filter(s=>s.host===host&&Date.now()-s.seen<5000);
  // Office on Mac may return a filesystem path instead of a file: URL.
  const localPath=(value:string)=>{try{return (value.startsWith('/')?path.normalize(value):decodeURIComponent(new URL(value).pathname)).normalize('NFC');}catch{return '';}};
  const matches=host==='figma'?live.filter(s=>s.documentName===focus.windowTitle?.replace(/ [–—-] Figma$/, '').trim()):focus.documentPath?live.filter(s=>localPath(s.url)===localPath(focus.documentPath!)):host==='illustrator'?live:live.filter(s=>!s.url);
  const app={word:'Word',excel:'Excel',powerpoint:'PowerPoint',illustrator:'Illustrator',figma:'Figma'}[host];
  const label={word:'Word 文稿',excel:'Excel 工作簿',powerpoint:'PowerPoint 演示文稿',illustrator:'Illustrator 文档',figma:'Figma 文件'}[host];
  if(matches.length!==1)throw new Error(matches.length?`多个 ${label} 已连接，无法确定当前目标，请只保留当前文件的妥帖加载项`:`请先在当前 ${label} 中打开「妥帖 · ${app}」加载项`);
  return matches[0].id;
 }
 request<T=unknown>(sessionId:string,method:string,args:Record<string,unknown>={}):Promise<T>{
  const session=this.sessions.get(sessionId);
  if(!session||Date.now()-session.seen>5000)return Promise.reject(Object.assign(new Error('Office 连接已断开，请重新打开加载项并按 ⌥⌘V'),{mutationStarted:false}));
  return new Promise((resolve,reject)=>{
   const id=crypto.randomUUID();
   const mutating=['insert','apply','undo'].includes(method);
   const timeout=mutating?15000:30000;
   const timer=setTimeout(()=>{this.pending.delete(id);session.queue=session.queue.filter(c=>c.id!==id);reject(new Error(mutating?'Office 写入结果未确认，请先检查文件，勿重复应用':'Office 没有及时响应，请返回文件重试'));},timeout);
   this.pending.set(id,{sessionId,resolve,reject,timer});session.queue.push({id,method,args,expiresAt:Date.now()+timeout});
  });
 }
 async close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Office 服务已关闭'));}this.pending.clear();await new Promise<void>(resolve=>this.server?this.server.close(()=>resolve()):resolve());}
}
// Keep the existing import name stable while Word and Excel share one bridge.
export {OfficeBridge as WordBridge};
