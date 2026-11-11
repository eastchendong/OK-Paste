import{observeVideo}from'../video-reference';
import type{ClipboardStore}from'../clipboard/store';
import type{ClipboardItem}from'../clipboard/types';

type TargetVisualContext={contextImage?:string;contextImages?:string[]};
export type AgentInputs={sources:Record<string,unknown>[];images:string[]};

/** Builds model context from immutable source records and target-owned visuals. */
export class ContextBuilder{
 constructor(private root:string,private store:ClipboardStore){}
 async build(items:ClipboardItem[],target?:TargetVisualContext):Promise<AgentInputs>{
  const sources:Record<string,unknown>[]=items.map(item=>{const{file,dataUrl,...body}=item.body;return{id:item.id,type:item.type,source:item.source,body};});
  const images=items.filter(item=>item.type==='image').flatMap(item=>{
   const bytes=this.store.readContent(item.id);
   return bytes?.length?[`data:${item.body.mime||'image/jpeg'};base64,${bytes.toString('base64')}`]:[];
  });
  for(const item of items.filter(item=>item.type==='video')){
   const video=await observeVideo(this.root,this.store,item);
   const source=sources.find(candidate=>candidate.id===item.id);
   if(source)source.videoObservation=video.observation;
   if(video.image)images.push(video.image);
  }
  if(target?.contextImages)images.unshift(...target.contextImages);
  else if(target?.contextImage)images.unshift(target.contextImage);
  return{sources,images};
 }
}
