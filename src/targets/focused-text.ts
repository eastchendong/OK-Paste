import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
import type {AppContext} from '../app-context';
import type {EditableTarget} from './editable-target';

/** Prepares text for an app without pretending to control its unsaved document. */
export class FocusedText implements EditableTarget {
 readonly kind='focused-text';readonly file='';private preview='';private text='';
 constructor(private root:string,readonly focus:AppContext){}
 get name(){return this.focus.appName;}
 get previewPath(){return this.preview;}
 get previewText(){return this.text;}
 get canUndo(){return false;}
 get previewChanged(){return Boolean(this.preview&&this.text.trim());}
 get originalUnchanged(){return true;}
 fingerprint(){return crypto.createHash('sha256').update(JSON.stringify(this.focus)).digest('hex');}
 async read(){return {kind:this.kind,name:this.name,fingerprint:this.fingerprint(),focus:this.focus,preparedText:this.text,capabilities:'只能生成适合当前应用的文字并复制到系统剪贴板，不能声称已发送、提交或写入该应用。没有读到的选区或窗口内容不可虚构。'};}
 begin(){if(this.preview)return;const dir=path.join(this.root,'.local','text-previews',crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});this.preview=path.join(dir,'待粘贴.txt');this.text='';}
 tools(){return [{name:'prepare_text',description:'生成适合当前聚焦应用的待粘贴文字。仅写入预览，用户确认后才复制到系统剪贴板，不发送消息。',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}];}
 async invoke(name:string,args:Record<string,unknown>){if(name!=='prepare_text'||typeof args.text!=='string'||!args.text.trim())throw new Error('请提供待粘贴的文字');this.text=args.text.slice(0,100000);fs.writeFileSync(this.preview,this.text);return {previewText:this.text,applied:false};}
 commit(){const clipboardText=this.text;this.preview='';this.text='';return {clipboardText};}
 undo(){throw new Error('复制到剪贴板的内容没有修改原应用');}
 cancel(){this.preview='';this.text='';}
}
