import {randomUUID} from 'node:crypto';
import {resultFeedback,type ResultFeedback} from './result-feedback/protocol';
import fs from 'node:fs';
import path from 'node:path';
import {AgentClient,type AgentPlan} from './agent-client';
import{ContextBuilder}from'./agent-core/context-builder';
import{TaskWorkflow}from'./agent-core/task-workflow';
import type {ClipboardStore} from './clipboard/store';
import type {ClipboardItem} from './clipboard/types';
import type {SceneControl,SceneRunRequest} from './scene-runner';
import {OfficeFile} from './targets/office-file';
import type {EditableTarget} from './targets/editable-target';
import {InitialRecommender} from './agent-core/initial-recommendations';
import {DirectExecutor,type DirectResult} from './agent-core/direct-executor';
import {FollowupRecommender,type FollowupRecommendations,type WritingIntent} from './agent-core/followup-recommendations';
import type {AgentInputs} from './agent-core/context-builder';
import {captureFollowupBaseline,followupScope} from './agent-core/followup-scope';

export class FileRunner {
 private resultFeedback:ResultFeedback|null=null;
 private feedbackSerial=0;
 private feedbackGeneration=0;
 private readonly feedbackSession=randomUUID();
 private workflow=new TaskWorkflow();
 get phase(){return this.workflow.phase;}
 private target?:EditableTarget;
 private model?:AgentClient;
 private itemId='';
 private plan?:AgentPlan;
 private context?:{fingerprint:string;[key:string]:unknown};
 private actions:string[]=[];
 private executionSourceIds:string[]=[];
 private error='';
 private result='';
 private step='';
 private changed=false;
 private conversation:{role:string;text:string}[]=[];
 private clarification?:{request:string;question:string};
 private revisions:{result:string;sourceIds?:string[];conversation:{role:string;text:string}[];followups?:FollowupRecommendations}[]=[];
 private followupRecommendations?:FollowupRecommendations;
 private followupAbort?:AbortController;
 private followupVersion=0;
 private followupRecommender?:FollowupRecommender;
 private taskIntent?:WritingIntent;
 private followupBaseline?:Record<string,unknown>;
 private preparedInputs?:AgentInputs;
 private initialImages:string[]=[];
 private supplements:string[]=[];
 private chain:Promise<void>=Promise.resolve();
 private abort?:AbortController;
 private stopping=false;
 private planSignature='';private planRevision=0;private plannedSourceIds:string[]=[];
 private contextBuilder:ContextBuilder;
 private initialRecommendation?:{status:'loading'|'ready'|'unavailable';modelMs?:number};
 private get initialRecommender(){return new InitialRecommender(this.root,this.store);}
 private get directExecutor(){return new DirectExecutor(this.root);}
 private executionMetrics?:{provider:string;readMs:number;inputsMs:number;modelMs:number;prepareMs:number;commitMs:number;totalMs:number;requests:number};
 constructor(private root:string,private store:ClipboardStore,private onApplied:()=>void=()=>{}){this.contextBuilder=new ContextBuilder(root,store);}
 get selected(){return Boolean(this.target);}
 get targetName(){return this.target?.name||'选择文档';}
 async useTarget(target:EditableTarget){
  this.feedbackGeneration++;this.resultFeedback=null;
  if(this.initialRecommender.supports(target)&&!this.store.list().length)throw new Error('内容包没有内容，请先加入资料');
  if(this.phase==='planning'){this.abort?.abort();this.planRevision++;await this.chain;}
  if(['running','preview'].includes(this.phase))throw new Error('请先完成当前任务');
  const context=await target.read() as {fingerprint:string;[key:string]:unknown};
  this.stopFollowups();this.followupRecommendations=undefined;this.taskIntent=undefined;this.preparedInputs=undefined;
  this.followupBaseline=captureFollowupBaseline({...context,kind:target.kind});
  this.initialImages=target.kind==='figma-live'?[...(target.contextImages??[])]:[];
  await this.target?.dispose?.();
  this.target=target;this.context=context;this.initialRecommendation=undefined;this.executionMetrics=undefined;this.clarification=undefined;this.workflow.reset();this.itemId='';this.planSignature='';this.actions=[];this.plan=undefined;this.error='';this.result='';this.changed=false;this.revisions=[];this.conversation=[];this.executionSourceIds=[];
 }
 async select(filename:string){
  if(['running','planning','preview'].includes(this.phase))throw new Error('请先应用或取消当前任务，再更换目标');
  this.feedbackGeneration++;this.resultFeedback=null;
  const target=new OfficeFile(this.root,filename,this.store);
  const context=await target.read();
  this.stopFollowups();this.followupRecommendations=undefined;this.taskIntent=undefined;this.preparedInputs=undefined;
  this.followupBaseline=captureFollowupBaseline({...context,kind:target.kind});
  this.initialImages=[];
  this.target=target;this.context=context;this.initialRecommendation=undefined;this.executionMetrics=undefined;this.clarification=undefined;this.workflow.reset();this.itemId='';this.actions=[];this.plan=undefined;this.error='';this.result='';this.changed=false;this.revisions=[];this.conversation=[];this.executionSourceIds=[];
  return {ok:true,name:this.targetName,path:target.file};
 }
 status(){return {
  resultFeedback:this.resultFeedback,plannedSourceIds:this.plannedSourceIds,executionSourceIds:this.executionSourceIds,phase:this.phase,itemId:this.itemId,destinationId:'office',targetName:this.targetName,targetKind:this.target?.kind,recommendationOnly:this.target?.recommendationOnly,targetLocation:this.target?.locationLabel,adjustmentProfile:this.target?.adjustmentProfile,inputDelivery:this.target?.inputDelivery,
  title:this.plan?.title||'',summary:this.plan?.summary||'',questions:this.plan?.questions||[],needsClarification:this.plan?.needsClarification??false,actions:this.actions,
  error:this.error,result:this.result,step:this.step,executionMetrics:this.executionMetrics,initialRecommendation:this.initialRecommendation,followupRecommendations:this.followupRecommendations,previewPath:this.target?.previewPath||'',targetPath:this.target?.file||'',
  previewText:this.target?.previewText||'',backupPath:this.target?.backupPath||'',
  changes:this.changed?{added:[],removed:[],modified:[this.targetName]}:null,canUndo:this.target?.canUndo||false,revision:this.target?.revision,mutationUncertain:this.target?.mutationUncertain||false,pendingDrop:null,
 };}
 ensurePlanned(){
  if(this.stopping||!this.target||this.target.mutationUncertain||['running','preview'].includes(this.phase)||this.phase==='done'&&this.followupRecommendations)return;
  const items=this.store.list();
  const signature=JSON.stringify([items.map(item=>[item.id,item.body]),this.initialRecommender.supports(this.target)?this.context?.fingerprint:this.target.fingerprint()]);
  if(signature===this.planSignature&&this.phase!=='idle')return;
  this.abort?.abort();const revision=++this.planRevision;this.planSignature=signature;
  if(!items.length){this.actions=[];this.plannedSourceIds=[];this.workflow.move(this.target.kind==='input-live'?'ready':'idle');return;}
  this.workflow.move('planning');this.actions=[];this.abort=new AbortController();const signal=this.abort.signal;
  this.enqueue(async()=>{try{if(revision!==this.planRevision)return;await this.planSources(items,signal,revision);}catch(error){if(revision!==this.planRevision||signal.aborted)return;throw error;}});
 }
 private agent(){return this.model??=new AgentClient(this.root);}
 private enqueue(work:()=>Promise<void>){
  this.chain=this.chain.then(work).catch(error=>{
   this.target?.cancel();this.error=error instanceof Error?error.message:String(error);
   if(!this.restoreCommitted()){this.changed=false;this.workflow.move('error');this.step='';}this.record();
  });return this.chain;
 }
 private async inputs(items:ClipboardItem[]){
  return this.contextBuilder.build(items,this.target);
 }
 private async planSources(items:ClipboardItem[],signal:AbortSignal,revision:number){
  const target=this.target!;this.step='读取目标内容';this.error='';
  if(this.initialRecommender.supports(target)){
   this.initialRecommendation={status:'loading'};this.itemId=items[0].id;this.step='正在理解资料';
   try{
    const result=await this.initialRecommender.suggest(items,target,this.context!,signal,this.initialImages);
    if(signal.aborted||revision!==this.planRevision)return;
    const text=result.recommendation.text;
    this.plan={title:text,summary:text,actions:[text],suggestions:[text],questions:[],needsClarification:false,...(result.recommendation.scene?{writingScene:result.recommendation.scene}:{})};
    this.taskIntent=this.plan;this.actions=[text];this.initialRecommendation={status:'ready',modelMs:result.modelMs};this.step='';
   }catch{
    if(signal.aborted||revision!==this.planRevision)return;
    this.plan=undefined;this.actions=[];this.initialRecommendation={status:'unavailable'};this.step='请输入你的要求';
   }
   this.plannedSourceIds=items.map(item=>item.id);this.workflow.move('ready');this.record();return;
  }
  this.context=await target.read();this.itemId=items[0].id;
  if(signal.aborted||this.stopping||revision!==this.planRevision)return;
  const live=['input-live','word-live','excel-live','powerpoint-live','illustrator-live','figma-live'].includes(target.kind);
  const plan=await this.agent().planTarget({...(live?{recommendationCount:1 as const}:{}),target:target.name,context:this.context,...await this.inputs(items),tools:target.tools(),conversation:[]},signal);
  if(signal.aborted||revision!==this.planRevision)return;
  if(live&&!plan.needsClarification&&!plan.suggestions?.length)throw new Error('模型未返回默认推荐，请重新理解或输入要求');
  if(live&&plan.suggestions)plan.suggestions=plan.suggestions.slice(0,1);
  this.plan=plan;this.plannedSourceIds=items.map(item=>item.id);
  this.taskIntent=plan;
  this.actions=this.plan.suggestions?.length?this.plan.suggestions:this.plan.needsClarification?[]:[this.plan.title];
  this.workflow.move('ready');this.step='';this.record();
 }
 run(input:SceneRunRequest){
  if(!this.target)return {ok:false,error:'请先选择目标文件'};
  if(this.target.recommendationOnly)return {ok:false,error:'当前页面仅提供推荐，暂不执行修改'};
  if(this.target.mutationUncertain)return {ok:false,error:'上次写入结果未确认，请先检查目标文稿并重新建立任务'};
  const interruptPlan=this.phase==='planning' && Boolean(input.instruction?.trim()) && this.target.applyImmediately;
  if(!interruptPlan && !['ready','done','preview','error'].includes(this.phase))return {ok:false,error:'正在处理，请稍候'};
  if(input.dropEventId)return {ok:false,error:'这个目标请点推荐或输入要求开始'};
  const ids=input.itemIds??[input.itemId||this.itemId];
  const items=ids.map(id=>this.store.get(id)).filter((item):item is ClipboardItem=>Boolean(item));
  if(!items.length&&!(this.target.kind==='input-live'&&!ids.some(Boolean)&&input.instruction?.trim()))return {ok:false,error:'请选择已保存的来源内容'};
  const custom=input.instruction?.trim().slice(0,4000)||'';
  const instruction=custom||this.actions[input.actionIndex];
  if(!instruction)return {ok:false,error:'输入要求，或选择一条推荐'};
  if(interruptPlan){this.abort?.abort();this.planRevision++;}
  this.executionSourceIds=items.map(item=>item.id);
  this.stopFollowups();this.followupRecommendations=undefined;
  if(!this.target.previewPath&&!this.target.revision&&!(input.continuation&&this.phase==='done'))this.conversation=[];
  this.feedbackGeneration++;this.resultFeedback=null;this.supplements=[];this.workflow.move('running');this.error='';this.result='';this.step='读取当前目标';this.abort=new AbortController();
  this.enqueue(()=>this.execute(items,instruction,Boolean(custom)));
  return {ok:true,phase:'running'};
 }
 private async execute(items:ClipboardItem[],instruction:string,custom:boolean){
  const target=this.target!,signal=this.abort!.signal;
  const started=performance.now(),direct=this.directExecutor.supports(target.kind);
  this.executionMetrics=undefined;
  const context=await target.read();const readMs=Math.round(performance.now()-started);
  if(!custom&&!target.previewPath&&this.context&&context.fingerprint!==this.context.fingerprint)throw new Error('目标文件已改变，请重新理解后再选方向');
  const conversation=[...this.conversation,...(this.clarification?[{role:'user',text:this.clarification.request},{role:'assistant',text:this.clarification.question}]:[]),{role:'user',text:instruction}];
  const firstId=items[0]?.id??'';
  const sourceChanged=this.itemId!==firstId;
  const inputStarted=performance.now();
  const inputs=await this.inputs(items);this.itemId=firstId;
  const inputsMs=Math.round(performance.now()-inputStarted);
  // Keep only this run's source visuals; refreshed target previews are collected after commit.
  const followupInputs=target.kind==='figma-live'?{...inputs,images:inputs.images.slice(target.contextImages?.length??0)}:inputs;
  let plan:AgentPlan={title:instruction,summary:instruction,actions:[instruction],questions:[],needsClarification:false,...(target.kind==='figma-live'&&this.taskIntent?.writingScene?{writingScene:this.taskIntent.writingScene}:{})};
  if(!direct&&(custom||items.length>1||sourceChanged)){
   this.step='理解来源与目标';
   plan=await this.agent().planTarget({target:target.name,context,...inputs,tools:target.tools(),conversation,...(target.kind==='figma-live'?{intent:this.taskIntent}:{})},signal);
   if(target.kind==='figma-live'&&!plan.writingScene&&this.taskIntent?.writingScene)plan={...plan,writingScene:this.taskIntent.writingScene};
  }
  this.plan=plan;this.context=context;
  if(plan.needsClarification){this.actions=plan.suggestions??[];const question=[plan.summary,...plan.questions].join('\n');if(this.restoreCommitted())this.error=question;else{this.workflow.move(target.previewPath?'preview':'ready');this.result=question;}this.record();return;}
  if(!target.revision)this.taskIntent={...this.taskIntent,...plan};
  if(signal.aborted)return;
  await target.begin(items.map(item=>item.id));this.step=target.applyImmediately?'生成并写入目标':'生成独立预览';
  try{
   const executed:{summary:string;calls:number;question?:string;metrics?:DirectResult['metrics']}=direct
    ?await this.directExecutor.execute({kind:target.kind,instruction,context,...inputs,conversation,tools:target.tools(),invoke:(name,args)=>target.invoke(name,args),signal})
    :await this.agent().executeTarget({target:target.name,plan,context,...inputs,conversation,tools:target.tools(),policy:target.executionPolicy,invoke:(name,args)=>target.invoke(name,args),signal,onStep:step=>{this.step=step;}});
   if(executed.question){
    this.clarification={request:this.clarification?this.clarification.request+'\n补充要求：'+instruction:instruction,question:executed.question};
    target.cancel();
    if(this.restoreCommitted())this.error=executed.question;
    else{this.plan={...plan,needsClarification:true,questions:[executed.question],suggestions:[]};this.actions=[];this.result=executed.question;this.step='请补充要求';this.workflow.move('ready');}
    this.record();return;
   }
   if(signal.aborted){target.cancel();if(!this.restoreCommitted()){this.changed=false;this.workflow.move('ready');}return;}
   const nextConversation=[...conversation,{role:'assistant',text:executed.summary}];
   if(target.revision===undefined)this.conversation=nextConversation;
   const supplement=this.supplements.splice(0).join('\n');
   if(supplement){await this.execute(items,target.revision===undefined?supplement:`${instruction}\n补充要求：${supplement}`,true);return;}
   // Live adapters validate the expected version again inside commit. Avoid another full document export.
   if(!direct)await target.read();
   if(signal.aborted){target.cancel();if(!this.restoreCommitted()){this.changed=false;this.workflow.move('ready');}return;}
   this.changed=target.previewChanged;this.result=executed.summary;
   if(!this.changed){target.cancel();if(!this.restoreCommitted()){this.workflow.move('ready');this.step='本次没有修改目标';}}
   else if(target.applyImmediately){
    const writtenText=target.previewText||'';
    const commitStarted=performance.now();
    const generation=this.feedbackGeneration;
    const applied=await target.commit();if(generation===this.feedbackGeneration&&!signal.aborted)this.resultFeedback=resultFeedback(target.kind,target.resultReceipt,`file:${this.feedbackSession}:${++this.feedbackSerial}:${target.revision??0}`);if(applied?.summary)this.result=applied.summary;
    if(executed.metrics){
     this.executionMetrics={provider:'deepseek-flash',readMs,inputsMs,...executed.metrics,commitMs:Math.round(performance.now()-commitStarted),totalMs:Math.round(performance.now()-started)};
     try{fs.appendFileSync(path.join(this.root,'.local/execution-events.ndjson'),JSON.stringify({at:new Date().toISOString(),kind:target.kind,revision:target.revision,...this.executionMetrics})+'\n');}catch{}
    }
    this.clarification=undefined;this.conversation=nextConversation;
    if(target.revision!==undefined)this.revisions[target.revision-1]={result:this.result,sourceIds:[...this.executionSourceIds],conversation:nextConversation};
    this.workflow.move('done');this.step=this.appliedStep();this.onApplied();
    await this.recommendFollowups(target,followupInputs,writtenText);
   }else{this.preparedInputs=inputs;this.workflow.move('preview');this.step='查看预览，再决定是否应用';}
   this.record({toolCalls:executed.calls,originalUnchanged:target.originalUnchanged,appliedImmediately:Boolean(target.applyImmediately&&this.phase==='done')});
  }catch(error){target.cancel();this.changed=false;if(signal.aborted&&target.canUndo&&this.restoreCommitted())return;if(signal.aborted&&target.originalUnchanged&&!target.mutationUncertain){this.workflow.move('ready');return;}throw error;}
 }
 supplement(instruction:string){
  if(this.phase!=='running'||!instruction.trim())return {ok:false,error:'当前没有生成任务，或补充内容为空'};
  this.supplements.push(instruction.trim().slice(0,4000));return {ok:true};
 }
 async control(action:SceneControl):Promise<{ok:boolean;error?:string;openPath?:string;clipboardText?:string}>{
  if(['cancel','finish','undo'].includes(action)){this.feedbackGeneration++;this.resultFeedback=null;}
  if(action==='cancel'){
   this.abort?.abort();this.target?.cancelPendingWrite?.();this.supplements=[];await this.chain;
   if(this.phase==='done'||this.restoreCommitted()){this.error='';return {ok:true};}
   if(this.target?.mutationUncertain)return {ok:false,error:this.error||'写入结果未确认，请先检查文稿'};
   this.target?.cancel();this.context=await this.target?.read();this.conversation=[];this.workflow.move('ready');this.changed=false;this.error='';this.step='';this.record();return {ok:true};
  }
  if(this.phase==='running'||this.phase==='planning'&&action!=='finish')return {ok:false,error:'正在处理，请稍候'};
  if(action==='finish'){
   if(this.phase==='preview')return {ok:false,error:'请先应用或取消预览'};
   this.initialRecommendation=undefined;this.executionMetrics=undefined;this.clarification=undefined;this.step='';
   this.stopFollowups();this.followupRecommendations=undefined;this.taskIntent=undefined;this.preparedInputs=undefined;this.followupBaseline=undefined;this.initialImages=[];
   const target=this.target;this.target=undefined;this.context=undefined;
   this.abort?.abort();this.planRevision++;await this.chain;
   await target?.dispose?.();
   this.workflow.move('idle');this.result='';this.changed=false;this.conversation=[];this.revisions=[];this.actions=[];this.plan=undefined;this.planSignature='';this.plannedSourceIds=[];this.executionSourceIds=[];this.error='';return {ok:true};
  }
  if(action==='commit'){
   if(this.phase!=='preview')return {ok:false,error:'请先查看预览'};
   const target=this.target!,writtenText=target.previewText||'';
   const generation=this.feedbackGeneration;
   const applied=await target.commit();if(generation===this.feedbackGeneration)this.resultFeedback=resultFeedback(target.kind,target.resultReceipt,`file:${this.feedbackSession}:${++this.feedbackSerial}:${target.revision??0}`);this.workflow.move('done');this.step=this.appliedStep();if(!['word-live','excel-live','powerpoint-live'].includes(target.kind))this.context=await target.read();
   if(this.preparedInputs)await this.recommendFollowups(target,this.preparedInputs,writtenText);
   this.record();return {ok:true,...(target.file?{openPath:target.file}:{}),...(applied||{})};
  }
  if(action==='undo'){
   this.clarification=undefined;
   if(this.phase==='preview')return {ok:false,error:'请先应用或取消当前预览'};
   this.stopFollowups();
   await this.target!.undo();this.error='';
   if(this.target!.revision!==undefined)this.revisions.length=this.target!.revision;
   if(!this.restoreCommitted()){
    this.followupRecommendations=undefined;
    this.workflow.move('idle');this.changed=false;this.result='';this.conversation=[];this.executionSourceIds=[];
    // A live task ends at V0; its owner releases the captured range next.
    if(this.target!.revision===undefined)this.ensurePlanned();
   }
   this.record();return {ok:true,...(this.target!.file?{openPath:this.target!.file}:{})};
  }
  this.workflow.move('idle');this.error='';this.ensurePlanned();return {ok:true};
 }
 async shutdown(){this.stopping=true;this.stopFollowups();this.abort?.abort();await this.chain;this.target?.cancel();await this.target?.dispose?.();}
 private restoreCommitted(){
  const revision=this.target?.revision;if(!revision||!this.target?.canUndo)return false;
  const saved=this.revisions[revision-1];
  this.result=saved?.result||this.target.previewText||'';this.conversation=saved?.conversation||[];
  this.followupRecommendations=saved?.followups;this.executionSourceIds=[...(saved?.sourceIds??this.executionSourceIds)];
  this.changed=true;this.workflow.move('done');this.step=`保留第 ${revision} 版`;return true;
 }
 private setFollowups(value:FollowupRecommendations|undefined){
  this.followupRecommendations=value;
  const revision=this.target?.revision,saved=revision?this.revisions[revision-1]:undefined;
  if(saved)saved.followups=value;
 }
 private stopFollowups(){
  this.followupAbort?.abort();this.followupAbort=undefined;this.followupVersion++;
  if(this.followupRecommendations?.status==='loading')this.setFollowups({...this.followupRecommendations,status:'unavailable'});
 }
 /** Capture in the edit queue; model suggestions never hold it or change content. */
 private async recommendFollowups(target:EditableTarget,inputs:AgentInputs,writtenText:string){
  if(!['word-live','input-live','focused-text','excel-live','powerpoint-live','figma-live'].includes(target.kind))return;
  this.stopFollowups();
  const controller=this.followupAbort=new AbortController(),version=this.followupVersion;
  const revision=target.revision??this.conversation.filter(turn=>turn.role==='user').length;
  const intent={...this.taskIntent},conversation=this.conversation.map(turn=>({...turn}));
  this.setFollowups({revision,status:'loading',scene:null,options:[]});
  const current=()=>!controller.signal.aborted&&version===this.followupVersion&&this.target===target&&this.phase==='done'&&!target.mutationUncertain&&(target.revision===undefined||target.revision===revision);
  try{
   const context:Record<string,unknown>={...await target.read(),kind:target.kind};
   if(!current())return;
   const scope=followupScope(context,this.followupBaseline);
   if(!scope){this.setFollowups(undefined);return;}
   let currentResult=typeof context.currentFragment==='string'?context.currentFragment:typeof context.currentInsertion==='string'?context.currentInsertion:writtenText;
   if(target.kind==='figma-live')currentResult=JSON.stringify(context.currentArtwork);
   if(target.kind==='excel-live')currentResult=JSON.stringify(context.currentUpdate);
   if(target.kind==='powerpoint-live')currentResult=JSON.stringify(context.currentEdit);
   const patch=context.currentInsertion as {blocks?:{type:string;runs?:{text:string}[]}[]}|undefined;
   // A pure image insertion must not receive text-writing suggestions.
   if(Array.isArray(patch?.blocks))currentResult=patch.blocks.filter(block=>block.type==='paragraph').map(block=>block.runs?.map(run=>run.text).join('')||'').join('\n');
   if(!currentResult.trim()){this.setFollowups({revision,status:'ready',scene:null,options:[]});return;}
   let images=target.kind==='powerpoint-live'&&target.contextImage?[target.contextImage,...inputs.images.slice(1)]:inputs.images;
   let imageRoles:string[]|undefined;
   if(target.kind==='figma-live'){
    const currentImage=target.contextImages?.[0];
    if(!currentImage)throw new Error('未读到当前成功版本的画框图片');
    const references=this.initialImages.slice(1);
    images=[currentImage,...references,...inputs.images];
    imageRoles=['current-committed-frame',...references.map(()=>'frozen-reference-frame'),...inputs.images.map(()=>'source')];
   }
   void (this.followupRecommender??=new FollowupRecommender(this.root)).suggest({intent,currentResult,context,...inputs,images,imageRoles,baseline:this.followupBaseline,conversation,tools:target.tools()},controller.signal)
    .then(result=>{if(current())this.setFollowups(!result.scene&&['excel-live','powerpoint-live'].includes(target.kind)?undefined:{revision,status:'ready',...result});})
    .catch(()=>{if(current())this.setFollowups({revision,status:'unavailable',scene:null,options:[]});});
  }catch{if(current())this.setFollowups({revision,status:'unavailable',scene:null,options:[]});}
 }
 private appliedStep(){if(this.target!.kind==='input-live')return this.target!.inputDelivery==='clipboard'?'已复制草稿':'已写入原输入框';return this.target!.kind==='figma-live'?'已加入 Figma 目标画框':this.target!.kind==='illustrator-live'?'已加入 Illustrator 目标画板':this.target!.kind==='focused-text'?'已复制，可去目标位置粘贴':this.target!.kind==='word-live'?'已直接插入 Word 光标位置':this.target!.kind==='excel-live'?'已直接写入 Excel 选区':this.target!.kind==='powerpoint-live'?'已修改 PowerPoint 选中对象':this.target!.kind==='jianying'?'已生成剪映新草稿':'已应用到目标文件';}
 private record(extra:Record<string,unknown>={}){
  fs.mkdirSync(path.join(this.root,'.local'),{recursive:true});
  fs.appendFileSync(path.join(this.root,'.local','office-agent-events.ndjson'),JSON.stringify({...this.status(),...extra,at:new Date().toISOString()})+'\n');
 }
}
