import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import {z} from 'zod';
import type {AppContext} from '../app-context';import type {ClipboardStore} from '../clipboard/store';import type {EditableTarget} from './editable-target';
import {FigmaClient} from '../figma/client';import {figmaTools} from '../figma/tools';
export class FigmaTarget implements EditableTarget {
 readonly kind='figma';readonly file='';readonly name='Figma';private preview='';private text='';private started=false;private changed=false;private committed='';private client:FigmaClient;
 private closing:Promise<unknown>=Promise.resolve();
 private ownsClient:boolean;
 constructor(private root:string,readonly focus:AppContext,private store:ClipboardStore,client?:FigmaClient){this.ownsClient=!client;this.client=client??new FigmaClient(root);}
 get previewPath(){return this.preview;}get previewText(){return this.text;}get previewChanged(){return this.started&&this.changed;}get originalUnchanged(){return true;}get canUndo(){return Boolean(this.committed);}
 fingerprint(){return crypto.createHash('sha256').update(JSON.stringify(this.client.context)).digest('hex');}
 async read(){
  await this.closing;
  await this.client.connect();const context=await this.client.call('figma_get_context');this.client.context=context;
  if(this.started){const status=await this.client.call('figma_preview_status');this.changed=Boolean(status.changed);this.text=status.nodes?`独立设计预览 · ${status.nodes.name}`:'';
   if(this.changed){const image=await this.client.call('figma_export_preview');if(!image.data)throw new Error('Figma 没有返回实际预览图片');fs.mkdirSync(path.join(this.root,'.local/figma-previews'),{recursive:true});this.preview=path.join(this.root,'.local/figma-previews',status.id.replaceAll(':','-')+'.png');fs.writeFileSync(this.preview,Buffer.from(image.data,'base64'));}
  }
  return {...context,kind:this.kind,name:this.name,focus:this.focus,fingerprint:this.fingerprint(),previewText:this.text,
   capabilities:context.connected?'通过真实 Figma MCP 与插件读取当前页选区及有限节点树。在独立新画板副本中修改，确认后保留为可编辑新方案，原稿保留；不替换原节点。使用真实节点 ID，先读取再编辑。节点树深度及数量有限，不声称已读取整个文件。可创建容器、形状、文字、放入内容包图片、修改文字颜色与几何。不能声称已接入图像生成或复刻任意复杂效果。':'尚未连接 Figma 插件，请先运行 setup:figma 并在 Figma 中打开「妥帖 MCP」。没有可执行的设计工具。'};
 }
 async begin(){await this.closing;if(this.started)return;if(!this.client.context.connected)throw new Error('请先在 Figma 运行「妥帖 MCP」插件');await this.client.call('figma_begin_preview',this.committed?{sourceId:this.committed}:{});this.started=true;this.changed=false;this.preview='';}
 tools(){return this.client.context.connected?Object.entries(figmaTools).map(([name,tool])=>({name,description:tool.description,inputSchema:z.toJSONSchema(tool.schema)})):[];}
 async invoke(name:string,args:Record<string,unknown>){
  if(!this.started)throw new Error('请先建立 Figma 预览');const tool=figmaTools[name as keyof typeof figmaTools];if(!tool)throw new Error('没有这个 Figma 设计工具');
  const input:Record<string,unknown>=tool.schema.parse(args);
  if(name==='figma_add_image'){const item=this.store.get(String(input.imageId));const bytes=item?.type==='image'?this.store.readContent(item.id):null;if(!bytes)throw new Error('请选择内容包中已保存的图片');input.data=bytes.toString('base64');}
  return this.client.call(name,input);
 }
 async commit(){if(!this.previewChanged)throw new Error('没有可保留的 Figma 预览');const result=await this.client.call('figma_commit_preview');this.committed=result.id;this.started=false;this.changed=false;return {};}
 async undo(){if(!this.committed)throw new Error('没有本次设计');await this.client.call('figma_undo');this.committed='';}
 cancel(){if(this.started)this.closing=this.client.call('figma_cancel_preview').finally(()=>{this.started=false;this.changed=false;});this.closing.catch(()=>{});}
 async dispose(){this.cancel();await this.closing.catch(()=>{});if(this.ownsClient)await this.client.close();}
}
