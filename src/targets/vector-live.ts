import type {ResultReceipt} from '../result-feedback/protocol';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {OfficeBridge} from '../office-live/bridge';
import {compileVectorArtwork,VectorArtwork} from '../vector-art';
import type {EditableTarget} from './editable-target';

export interface VectorSnapshot {
 protocolVersion?:number;anchorId:string;version:string;document:unknown;target:{name:string};
 previews:{dataUrl:string;artboardIndex?:number;nodeId?:string}[];
}
type Profile={host:'illustrator'|'figma';label:string;tool:string;placement:string;inlineSvg?:boolean};
const Preparation=z.object({artwork:VectorArtwork,summary:z.string().min(1).max(300)}).strict();
const Review=z.object({candidateId:z.string().uuid(),approved:z.boolean(),issues:z.array(z.string().min(1).max(300)).max(10)}).strict();
type Prepared={svgPath:string;svg:string;taskId:string;summary:string;artwork:z.infer<typeof VectorArtwork>;reviewed:boolean};
export class VectorLiveTarget implements EditableTarget {
 resultReceipt?:ResultReceipt;
 readonly kind:string;readonly file='';readonly applyImmediately=true;
 private snapshot:VectorSnapshot;private prepared?:Prepared;private versions:Prepared[]=[];
 private expected='';private resultId='';private uncertain=false;
 constructor(private root:string,private bridge:OfficeBridge,private sessionId:string,readonly name:string,snapshot:VectorSnapshot,private profile:Profile){this.snapshot=snapshot;this.kind=`${profile.host}-live`;}
 get previewPath(){return this.prepared?.svgPath||'';}
 get revision(){return this.profile.host==='figma'?this.versions.length:undefined;}
 get mutationUncertain(){return this.uncertain;}
 get previewText(){return (this.prepared??this.versions.at(-1))?.summary||'';}
 get previewChanged(){return Boolean(this.prepared);}
 get originalUnchanged(){return !this.resultId;}
 get canUndo(){return Boolean(this.resultId)&&!this.uncertain;}
 get contextImages(){return this.snapshot.previews.map(p=>p.dataUrl);}
 fingerprint(){return this.snapshot.version;}
 async read(){
  this.snapshot=await this.bridge.request<VectorSnapshot>(this.sessionId,'read',{anchorId:this.snapshot.anchorId});
  if(this.profile.host==='figma'&&this.snapshot.protocolVersion!==2)throw new Error('请重新打开 Figma 妥帖插件，以启用预览检查和逐级撤销');
  return {fingerprint:this.fingerprint(),kind:this.kind,document:this.snapshot.document,target:this.snapshot.target,
   revision:this.revision,currentArtwork:this.versions.at(-1)?.artwork??null,previewOrder:this.snapshot.previews.map(p=>p.nodeId??p.artboardIndex),capabilities:{addEditableVectors:true,editExistingObjects:false,placement:this.profile.placement,supportedShapes:['path','ellipse','rect'],gradients:false,visualReview:this.profile.host==='figma'}};
 }
 begin(){if(this.uncertain)throw new Error(`${this.profile.label} 上次写入结果未确认，请先检查画板`);if((this.revision??0)>=20)throw new Error('本次任务已保留 20 个版本，请结束任务后再继续');this.expected=this.fingerprint();this.prepared=undefined;}
 tools(){return [{name:this.profile.tool,description:'根据参考与现有画板风格准备完整可编辑矢量作品。所有形状共用 artwork 坐标；group 只组织图层。只替换本任务作品，不修改其他对象。Figma 会返回临时画框的实际渲染图，必须看图并调用 review_figma_artwork；有问题先重新准备完整版本。',inputSchema:z.toJSONSchema(Preparation)},...(this.profile.host==='figma'?[{name:'review_figma_artwork',description:'看过最新候选的实际渲染图后，核对用户要求、参考风格、部件对齐、比例和裁切。无问题则 approved=true、issues=[]；否则 approved=false 并列出问题，再重新准备。只能评价当前 candidateId。',inputSchema:z.toJSONSchema(Review)}]:[])];}
 async invoke(name:string,args:Record<string,unknown>){
  if(name==='review_figma_artwork'&&this.profile.host==='figma'){
   if(this.prepared)this.prepared.reviewed=false;
   const review=Review.parse(args);
   if(!this.prepared||review.candidateId!==this.prepared.taskId)throw new Error('只可检查最新候选，请先准备作品并查看实际预览');
   if(review.approved&&review.issues.length)throw new Error('仍有问题时不能通过检查，请修正作品');
   this.prepared.reviewed=review.approved;return {reviewed:review.approved,readyToCommit:review.approved,summary:this.prepared.summary,issues:review.issues};
  }
  this.prepared=undefined;
  if(name!==this.profile.tool||!this.expected)throw new Error(`请先开始 ${this.profile.label} 生成任务`);
  const {artwork,summary}=Preparation.parse(args),compiled=compileVectorArtwork(artwork),taskId=crypto.randomUUID();
  const directory=path.join(this.root,`.local/${this.kind}`);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const svgPath=path.join(directory,`${taskId}.svg`);fs.writeFileSync(svgPath,compiled.svg,{mode:0o600});
  const rendered=this.profile.host==='figma'?await this.bridge.request<{image:string}>(this.sessionId,'preview',{anchorId:this.snapshot.anchorId,expectedVersion:this.expected,svg:compiled.svg,summary}):undefined;
  if(rendered&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(rendered.image))throw new Error('Figma 没有返回有效预览图');
  this.prepared={svgPath,svg:compiled.svg,taskId,summary,artwork,reviewed:false};
  return {prepared:true,candidateId:taskId,shapeCount:artwork.shapes.length,groups:[...new Set(artwork.shapes.map(s=>s.group))],summary,applied:false,...(rendered?{images:[rendered.image],next:'查看实际渲染图；有问题重新准备，无问题调用 review_figma_artwork'}:{})};
 }
 async commit(){
  if(this.uncertain||!this.prepared)throw new Error(`没有可写入的 ${this.profile.label} 结果`);
  if(this.profile.host==='figma'&&!this.prepared.reviewed)throw new Error('Figma 候选尚未完成实际预览检查，未写入画框');
  const candidate=this.prepared,{svg,svgPath,taskId,summary}=candidate;await this.read();
  if(this.fingerprint()!==this.expected)throw new Error(`${this.profile.label} 文档已改变，请重新按 ⌥⌘V`);
  this.uncertain=true;
  try{
   const result=await this.bridge.request<{resultId:string;resultReceipt?:ResultReceipt}>(this.sessionId,'apply',{anchorId:this.snapshot.anchorId,expectedVersion:this.expected,taskId,summary,...(this.profile.host==='figma'?{expectedRevision:this.revision}:{}),...(this.profile.inlineSvg?{svg}:{svgPath}),replaceResultId:this.resultId});
   this.resultReceipt=result.resultReceipt;this.resultId=result.resultId;if(this.profile.host==='figma')this.versions.push(candidate);this.prepared=undefined;this.uncertain=false;
   return {summary};
  }catch(error){this.writeError(error,'写入');}
 }
 async undo(){
  if(!this.canUndo)throw new Error(`没有可安全撤销的 ${this.profile.label} 结果`);this.uncertain=true;
  try{
   const result=await this.bridge.request<{resultId?:string}>(this.sessionId,'undo',{anchorId:this.snapshot.anchorId,resultId:this.resultId,...(this.profile.host==='figma'?{expectedRevision:this.revision}:{})});
   if(this.profile.host==='figma')this.versions.pop();this.resultId=result.resultId||'';this.prepared=undefined;this.uncertain=false;
  }catch(error){this.writeError(error,'撤销');}
 }
 private writeError(error:unknown,operation:string):never{
  if(error instanceof Error&&(error as Error&{mutationStarted?:boolean}).mutationStarted===false){this.uncertain=false;throw error;}
  throw new Error(`${this.profile.label} ${operation}结果未确认，请先检查画框，勿重复${operation}。${error instanceof Error?error.message:''}`,{cause:error});
 }
 cancel(){this.prepared=undefined;}
 async dispose(){await this.bridge.request(this.sessionId,'release',{anchorId:this.snapshot.anchorId}).catch(()=>{});}
}
