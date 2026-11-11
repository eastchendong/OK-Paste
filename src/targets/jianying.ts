import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {AppContext} from '../app-context';import type {ClipboardStore} from '../clipboard/store';
import {JianyingClient} from '../jianying-client';import type {EditableTarget} from './editable-target';
const json=(file:string)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const draftHash=(directory:string):string=>{
 const digest=crypto.createHash('sha256');
 const visit=(current:string)=>{for(const entry of fs.readdirSync(current,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(current,entry.name);digest.update(path.relative(directory,file));if(entry.isDirectory())visit(file);else if(entry.isFile())digest.update(fs.readFileSync(file));}};
 visit(directory);return digest.digest('hex');
};
const write=(file:string,value:unknown)=>{const temp=file+'.tuotie-tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);};
const installedVersion=()=>{
 try{return fs.readFileSync('/Applications/VideoFusion-macOS.app/Contents/Info.plist','utf8').match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]||'';}catch{return '';}
};

export class JianyingTarget implements EditableTarget {
 readonly kind='jianying';readonly file='';readonly name='剪映';
 private workspace='';private mcp?:JianyingClient;private definitions:any[]=[];
 private closing:Promise<void>=Promise.resolve();
 private started=false;private created=false;private committed='';private committedHash='';private committedId='';
 readonly draftName='妥帖复刻预览';
 constructor(private root:string,readonly focus:AppContext,private store:ClipboardStore,readonly draftsRoot=path.join(os.homedir(),'Movies/JianyingPro/User Data/Projects/com.lveditor.draft'),private nativeVersion=installedVersion()){}
 private get importIssue(){return this.nativeVersion==='11.6.0'?'当前剪映 11.6.0 无法打开妥帖生成的草稿，暂不能添加；预览和内容包已保留。':'';}
 private projectContext(){
  const index=json(path.join(this.draftsRoot,'root_meta_info.json'));
  const projects=fs.existsSync(this.draftsRoot)?fs.readdirSync(this.draftsRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')).flatMap(entry=>{
   const directory=path.join(this.draftsRoot,entry.name),meta=json(path.join(directory,'draft_meta_info.json'))||(index?.all_draft_store||[]).find((item:any)=>item.draft_fold_path===directory||path.basename(item.draft_fold_path||'')===entry.name);
   if(!meta)return [];return [{name:String(meta.draft_name||entry.name),directory,modified:meta.tm_draft_modified,meta}];
  }):[];
  const current=projects.find(project=>this.focus.documentPath?.startsWith(project.directory+path.sep)||Boolean(this.focus.windowTitle?.includes(project.name)));
  let timeline:any=null;
  if(current)timeline=json(path.join(current.directory,'draft_content.json'))||json(path.join(current.directory,'draft_info.json'));
  return {currentProject:current?{name:current.name,directory:current.directory,readableTimeline:Boolean(timeline),timeline}:null,
   recentProjects:projects.map(({name,modified})=>({name,modified})).slice(0,12),
   media:current?(current.meta.draft_materials||[]).flatMap((group:any)=>(group.value||[]).map((item:any)=>item.file_Path||item.file_path||item.path).filter((value:unknown)=>typeof value==='string'&&path.isAbsolute(value as string))).slice(0,40):[]};
 }
 fingerprint(){return crypto.createHash('sha256').update(JSON.stringify([this.focus,this.projectContext()])).digest('hex');}
 get previewPath(){return this.started?path.join(this.workspace,this.draftName):'';}
 private get content(){return this.created?json(path.join(this.workspace,this.draftName,'draft_content.json')):null;}
 get previewChanged(){return Boolean(this.content?.tracks?.some((track:any)=>track.segments?.length));}
 get originalUnchanged(){return true;}
 get canUndo(){return Boolean(this.committed&&fs.existsSync(this.committed));}
 get previewText(){
  const content=this.content;if(!content)return '';
  const transitions=(content.materials?.transitions||[]).map((item:any)=>item.name);
  const effects=(content.materials?.video_effects||[]).map((item:any)=>item.name);
  return `${content.width||content.canvas_config?.width} × ${content.height||content.canvas_config?.height} · ${((content.duration||0)/1e6).toFixed(2)} 秒\n${(content.tracks||[]).map((track:any)=>`${track.name||track.type}：${track.segments?.length||0} 个片段`).join('\n')}${transitions.length?'\n转场：'+transitions.join('、'):''}${effects.length?'\n特效：'+effects.join('、'):''}`;
 }
 private async client(){
  await this.closing;
  if(!this.mcp){this.workspace=path.join(this.root,'.local/jianying-previews',crypto.randomUUID());this.mcp=new JianyingClient(this.root,this.workspace);await this.mcp.connect();this.definitions=this.mcp.tools;}
  return this.mcp;
 }
 async read(){
  await this.client();const project=this.projectContext();
  return {kind:this.kind,name:this.name,fingerprint:this.fingerprint(),focus:this.focus,...project,
   preview:this.content,previewText:this.previewText,draftName:this.draftName,importIssue:this.importIssue,
   capabilities:this.importIssue?'当前剪映 11.6.0 的原生验收中无法打开生成草稿。可以使用实际资源目录分析参考并准备本地预览，但不能添加到剪映或声称已复刻成功；向用户说明这一限制。':'通过本机剪映 MCP 与真实资源目录新建可编辑复刻草稿，不覆盖当前工程。参考视频应根据实际抽帧观察转场或特效；不能将原参考视频简单导入就声称复刻。先 list_effects 查实际名称，再组合转场、特效或关键帧。原时间线未读取或加密时不能声称读到了播放头、选中片段或已有转场。没有明确目标素材时询问需要作用于哪些素材。应用后只添加新草稿，用户在剪映打开检查。'};
 }
 begin(){this.started=true;}
 tools(){return this.definitions.filter(tool=>!['save_draft'].includes(tool.name)).map(tool=>({name:tool.name,description:tool.description||'',inputSchema:tool.inputSchema}));}
 private allowedMedia(){
  const media=new Set<string>(this.projectContext().media);
  for(const item of this.store.list(true)){
   if(typeof item.body.file==='string')media.add(path.resolve(this.store.directory,'files',item.body.file));
   const cached=path.join(this.root,'.local/reference-media',item.id,'source.mp4');if(fs.existsSync(cached))media.add(cached);
  }
  return media;
 }
 async invoke(name:string,raw:Record<string,unknown>){
  if(!this.started&&!['list_effects','describe_effect'].includes(name))throw new Error('请先建立剪映预览');
  const client=await this.client(),args={...raw};
  if(name==='create_draft'){if(this.created)return {draft:this.draftName,note:'当前预览已创建，请在它上面继续调整'};args.name=this.draftName;args.replace=false;}
  if('draft' in args)args.draft=this.draftName;
  if(['add_video','add_audio'].includes(name)){
   if(typeof args.path!=='string'||!this.allowedMedia().has(path.resolve(args.path)))throw new Error('请使用内容包或当前工程中实际可读取的素材路径');
  }
  const result=await client.call(name,args);
  if(name==='create_draft')this.created=true;
  if(this.created&&!['list_effects','describe_effect','describe_draft'].includes(name))await client.call('save_draft',{draft:this.draftName});
  return {result,...(this.created?{preview:this.content}:{}),applied:false};
 }
 commit(){
  if(this.importIssue)throw new Error(this.importIssue);
  if(!this.previewChanged)throw new Error('剪映预览还没有内容');
  const index=path.join(this.draftsRoot,'root_meta_info.json'),root=json(index);
  if(fs.existsSync(index)&&(!root||!Array.isArray(root.all_draft_store)))throw new Error('剪映草稿索引暂时无法读取，原工程未改动');
  const name=`妥帖复刻-${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}-${crypto.randomUUID().slice(0,4)}`;
  fs.mkdirSync(this.draftsRoot,{recursive:true});const destination=path.join(this.draftsRoot,name);
  fs.cpSync(this.previewPath,destination,{recursive:true});
  // Committed drafts own their media. Clipboard caches and staging may be
  // archived or removed later, and must not be the installed project's source.
  try{
   const contentFile=path.join(destination,'draft_content.json'),content=json(contentFile);
   if(!content)throw new Error('剪映预览内容无法读取');
   const copied=new Map<string,string>(),mediaDirectory=path.join(destination,'materials');
   const relocate=(value:any):any=>{
    if(Array.isArray(value))return value.map(relocate);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,entry])=>{
     if(['path','file_path','file_Path'].includes(key)&&typeof entry==='string'&&path.isAbsolute(entry)){
      if(!this.allowedMedia().has(entry))throw new Error('草稿引用了未授权的素材');
      if(!fs.existsSync(entry))throw new Error('草稿素材已经移动，请重新选择');
      if(!copied.has(entry)){fs.mkdirSync(mediaDirectory,{recursive:true});const file=path.join(mediaDirectory,`${copied.size}-${path.basename(entry)}`);fs.copyFileSync(entry,file);copied.set(entry,file);}
      return [key,copied.get(entry)];
     }
     return [key,relocate(entry)];
    }));
   };
   write(contentFile,relocate(content));
  }catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
  const content=json(path.join(destination,'draft_content.json')),meta=json(path.join(destination,'draft_meta_info.json'))||{};
  this.committedId=content.id||crypto.randomUUID();
  Object.assign(meta,{draft_id:this.committedId,draft_name:name,draft_fold_path:destination,draft_root_path:this.draftsRoot,draft_json_file:path.join(destination,'draft_content.json'),tm_duration:content.duration||0,tm_draft_create:Date.now()*1000,tm_draft_modified:Date.now()*1000});
  write(path.join(destination,'draft_meta_info.json'),meta);
  const nextIndex=root||{all_draft_store:[]};
  nextIndex.all_draft_store=[...nextIndex.all_draft_store,meta];
  if(Array.isArray(nextIndex.draft_ids))nextIndex.draft_ids=[...nextIndex.draft_ids,this.committedId];
  write(index,nextIndex);
  this.committed=destination;this.committedHash=draftHash(destination);
  this.cancel();return {path:destination,directory:destination};
 }
 undo(){
  if(!this.canUndo)throw new Error('没有本次创建的剪映草稿');
  if(draftHash(this.committed)!==this.committedHash)throw new Error('草稿已经在剪映改变，无法覆盖撤销');
  const index=path.join(this.draftsRoot,'root_meta_info.json'),root=json(index);
  if(!root||!Array.isArray(root.all_draft_store))throw new Error('剪映草稿索引暂时无法读取，无法撤销');
  if(root){root.all_draft_store=(root.all_draft_store||[]).filter((item:any)=>item.draft_id!==this.committedId);if(Array.isArray(root.draft_ids))root.draft_ids=root.draft_ids.filter((id:string)=>id!==this.committedId);write(index,root);}
  const archive=path.join(this.root,'.local/jianying-archived');fs.mkdirSync(archive,{recursive:true});fs.renameSync(this.committed,path.join(archive,path.basename(this.committed)));this.committed='';
 }
 cancel(){this.started=false;this.created=false;if(this.mcp)this.closing=this.mcp.close();this.mcp=undefined;}
 async dispose(){this.cancel();await this.closing;}
}
