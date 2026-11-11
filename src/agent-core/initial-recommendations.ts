import {deepseekApiKey} from '../model-connection';
import type {ClipboardStore} from '../clipboard/store';
import type {ClipboardItem} from '../clipboard/types';
import type {EditableTarget} from '../targets/editable-target';
import {recommend,type RecommendationInput} from './recommendations/core.mjs';
import {deepseekComplete} from './recommendations/deepseek.mjs';

const string=(value:unknown)=>typeof value==='string'?value:'';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};

/** Maps existing capture capabilities to the standalone recommendation contract. */
export class InitialRecommender {
 constructor(private root:string,private store:ClipboardStore){}
 private key(){return deepseekApiKey(this.root);}
 supports(target:EditableTarget){return ['word-live','input-live','excel-live','powerpoint-live','figma-live'].includes(target.kind)&&Boolean(this.key());}
 async suggest(items:ClipboardItem[],target:EditableTarget,context:Record<string,unknown>,signal:AbortSignal,visuals:readonly string[]=[]){
  const sources:RecommendationInput['sources']=items.map(item=>{
   const title=string(item.source.title);
   if(item.type==='image'){
    const bytes=this.store.readContent(item.id);
    if(!bytes?.length)throw new Error('图片尚未保存');
    return {id:item.id,kind:'image',title,image:'data:'+string(item.body.mime||'image/png')+';base64,'+bytes.toString('base64')};
   }
   if(!['text','table','html','link'].includes(item.type))throw new Error('当前推荐不支持此资料类型');
   const {file,dataUrl,...body}=item.body;
   return {id:item.id,kind:item.type==='table'?'table':'text',title,text:string(body.text)||JSON.stringify(body)};
  });
  const focus=record(context.focus),location=record(context.location),word=target.kind==='word-live';
  const input:RecommendationInput={sources,target:{
   app:word?'Word':string(focus.appName)||target.name,
   location:word?target.locationLabel||string(location.section):string(focus.role),
   nearbyText:word?[string(location.before),string(location.after)].filter(Boolean).join('\n'):string(focus.focusedText),
   documentText:word?string(context.body):'',
   selectedText:word?string(context.selectedText):string(focus.selectedText),
   capabilities:word&&context.blockInsertionAvailable===true?['text','image']:['text'],
   ...(target.contextImage?{screenshot:target.contextImage}:{})
  }};
  if(target.kind==='excel-live')Object.assign(input.target,{
   app:'Excel',scenario:'spreadsheet',location:target.locationLabel,
   nearbyText:JSON.stringify(context.selection??{}),documentText:JSON.stringify(context.workbook??{}),capabilities:['text']
  });
  if(target.kind==='powerpoint-live')Object.assign(input.target,{
   app:'PowerPoint',scenario:'persona-slides',location:target.locationLabel,
   nearbyText:'',documentText:JSON.stringify(context.currentPage??context.selection??{}),
   capabilities:['text','image']
  });
  if(target.kind==='figma-live')Object.assign(input.target,{
   app:'Figma',scenario:'vector-artwork',location:string(record(context.target).name),
   nearbyText:JSON.stringify(context.target??{}),documentText:JSON.stringify(context.document??{}),
   capabilities:['vector'],screenshot:visuals[0],referenceImages:visuals.slice(1,3)
  });
  return recommend(input,{complete:deepseekComplete(this.key()),signal});
 }
}
