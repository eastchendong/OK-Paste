import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {ClipboardStore} from '../clipboard/store';

const text=z.string();
const index=z.number().int().min(0);
const after=z.number().int().min(-1).optional().describe('段落索引，从 0 开始；-1 为文档开头，省略则追加');
const imageId=text.describe('内容包里实际存在的图片 ID');
const color=text.regex(/^#?[0-9a-fA-F]{6}$/);
const documentOps=[
 z.object({type:z.literal('insert_paragraph'),text,after,style:text.optional()}),
 z.object({type:z.literal('replace_text'),find:text.min(1),replace:text,paragraph:index.optional()}),
 z.object({type:z.literal('insert_image'),imageId,after,widthCm:z.number().positive().optional()}),
 z.object({type:z.literal('insert_table'),after,rows:z.array(z.array(text).min(1)).min(1)}),
] as const;
const spreadsheetOps=[
 z.object({type:z.literal('add_sheet'),name:text.min(1)}),
 z.object({type:z.literal('write_cells'),sheet:text,startCell:text,values:z.array(z.array(z.union([text,z.number(),z.boolean(),z.null()]))).min(1)}),
 z.object({type:z.literal('format_cells'),sheet:text,range:text,numberFormat:text.optional(),bold:z.boolean().optional(),fontColor:color.optional(),fill:color.optional()}),
 z.object({type:z.literal('add_chart'),sheet:text,range:text,kind:z.enum(['bar','line']),title:text,anchor:text.optional()}),
] as const;
const presentationOps=[
 z.object({type:z.literal('set_shape_text'),slide:index,shapeId:index,text}),
 z.object({type:z.literal('set_shape_geometry'),slide:index,shapeId:index,leftCm:z.number().min(0).optional(),topCm:z.number().min(0).optional(),widthCm:z.number().positive().optional(),heightCm:z.number().positive().optional()}),
 z.object({type:z.literal('add_slide'),layoutIndex:index.optional(),title:text,body:text}),
 z.object({type:z.literal('remove_shape'),slide:index,shapeId:index}),
 z.object({type:z.literal('insert_image'),slide:index,imageId,leftCm:z.number().min(0),topCm:z.number().min(0),widthCm:z.number().positive(),heightCm:z.number().positive().optional()}),
] as const;
export type OfficeKind='document'|'spreadsheet'|'presentation';
export interface OfficeContext {
 kind:OfficeKind;
 name:string;
 fingerprint:string;
 [key:string]:unknown;
}
const kinds:Record<string,OfficeKind>={'.docx':'document','.xlsx':'spreadsheet','.pptx':'presentation'};

export class OfficeFile {
 readonly kind:OfficeKind;
 readonly operations;
 readonly file:string;
 private preview='';
 private baseline='';
 private backup='';
 private committedHash='';
 constructor(private root:string,filename:string,private store:ClipboardStore) {
  this.file=path.resolve(filename);
  this.kind=kinds[path.extname(this.file).toLowerCase()];
  if(!this.kind || !fs.statSync(this.file).isFile())throw new Error('请选择已保存的 docx、pptx 或 xlsx 文件');
  this.operations=z.object({operations:z.array(z.union(this.kind==='document'?documentOps:this.kind==='spreadsheet'?spreadsheetOps:presentationOps)).min(1)});
 }
 get name(){return path.basename(this.file);}
 get previewPath(){return this.preview;}
 get originalUnchanged(){return !this.preview||this.fingerprint()===this.baseline;}
 get previewChanged(){return Boolean(this.preview&&this.fingerprint(this.preview)!==this.baseline);}
 get canUndo(){return Boolean(this.backup && fs.existsSync(this.backup));}
 fingerprint(filename=this.file){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');}
 async read(selection:Record<string,unknown>={}) {
  const file=this.preview||this.file;
  const context=await this.python({action:'read',path:file,selection});
  return {...context,name:this.name,fingerprint:this.fingerprint(file)} as OfficeContext;
 }
 begin() {
  if(this.preview)return;
  const directory=path.join(this.root,'.local','office-previews',crypto.randomUUID());
  fs.mkdirSync(directory,{recursive:true});
  this.preview=path.join(directory,`预览-${this.name}`);
  this.baseline=this.fingerprint();
  fs.copyFileSync(this.file,this.preview);
 }
 async edit(raw:unknown) {
  if(!this.preview)throw new Error('请先建立预览');
  const parsed=this.operations.parse(raw);
  const operations=parsed.operations.map(operation=>{
   if(!('imageId' in operation))return operation;
   const source=this.store.get(operation.imageId);
   if(!source || source.type!=='image' || typeof source.body.file!=='string')throw new Error('内容包里没有这张已保存图片');
   return {...operation,imagePath:path.join(this.store.directory,'files',source.body.file)};
  });
  const temporary=path.join(path.dirname(this.preview),`working-${crypto.randomUUID()}${path.extname(this.preview)}`);
  fs.copyFileSync(this.preview,temporary);
  try {
   await this.python({action:'edit',path:temporary,operations});
   fs.renameSync(temporary,this.preview);
  } finally {fs.rmSync(temporary,{force:true});}
  // The bridge saves once and reopens; this read also includes the saved hash.
  return {context:await this.read(),changed:this.fingerprint(this.preview)!==this.baseline};
 }
 commit() {
  if(!this.preview)throw new Error('请先查看预览');
  if(this.fingerprint()!==this.baseline)throw new Error('目标文件已在其他应用改变，请重新读取后再应用');
  const previousBackup=this.backup;
  const nextBackup=path.join(path.dirname(this.preview),`原稿-${this.name}`);
  fs.copyFileSync(this.file,nextBackup);
  this.replaceFrom(this.preview);
  this.backup=nextBackup;
  if(previousBackup&&previousBackup!==nextBackup)fs.rmSync(previousBackup,{force:true});
  this.committedHash=this.fingerprint();
  const directory=path.dirname(this.preview);
  fs.rmSync(this.preview,{force:true});
  this.preview='';
  return {path:this.file,directory};
 }
 cancel() {
  if(!this.preview)return;
  const directory=path.dirname(this.preview);
  fs.rmSync(this.preview,{force:true});
  // A committed backup may share this folder after an incremental edit.
  if(!fs.readdirSync(directory).length)fs.rmdirSync(directory);
  this.preview='';
 }
 undo() {
  if(!this.canUndo)throw new Error('没有可撤回的文件修改');
  if(this.fingerprint()!==this.committedHash)throw new Error('应用后文件已有其他修改，无法覆盖撤回');
  this.replaceFrom(this.backup);
  fs.rmSync(path.dirname(this.backup),{recursive:true,force:true});
  this.backup='';this.committedHash='';
  return {path:this.file};
 }
 tools(){return [
  {name:'read_target',description:'读取实际预览文件。文档可用 start/count 读更多段落；表格用 sheet/range 读精确单元格；幻灯片用 slide（从 0 开始）读取指定页。savedSelection 是文件保存时的选区，不是当前应用中的实时选区。',inputSchema:z.toJSONSchema(z.object({start:index.optional(),count:z.number().int().positive().max(120).optional(),sheet:text.optional(),range:text.optional(),slide:index.optional()}))},
  {name:'edit_target',description:'仅修改独立文件副本，保存并重新读取实际结果。所有索引从 0 开始，图片必须引用内容包 imageId。文档保留段落样式和替换范围外的 run 格式；表格公式用 = 开头，图表区域首行为标题、首列为分类；幻灯片应使用真实 shape ID、页面尺寸与既有版式，避免覆盖已有内容。未提供的功能不能声称完成。',inputSchema:z.toJSONSchema(this.operations)},
 ];}
 async invoke(name:string,args:Record<string,unknown>){
  if(name==='read_target')return this.read(args);
  if(name==='edit_target')return this.edit(args);
  throw new Error('目标没有这个工具');
 }
 private replaceFrom(filename:string){
  const temp=path.join(path.dirname(this.file),`.${path.basename(this.file)}.tuotie-${crypto.randomUUID()}`);
  try {fs.copyFileSync(filename,temp);fs.chmodSync(temp,fs.statSync(this.file).mode);fs.renameSync(temp,this.file);}
  finally {fs.rmSync(temp,{force:true});}
 }
 private python(payload:unknown):Promise<Record<string,unknown>> {
  const python=process.env.OKPASTE_OFFICE_PYTHON||path.join(this.root,'.local','office-venv','bin','python');
  if(!fs.existsSync(python))throw new Error('尚未准备文档工具，请在 prototype 运行 pnpm run setup:office');
  return new Promise((resolve,reject)=>{
   const child=spawn(python,[path.join(this.root,'office/files.py')],{cwd:this.root,stdio:['pipe','pipe','pipe']});
   let output='',error='';
   child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>error+=chunk.toString());
   child.on('error',reject);
   child.on('close',code=>{
    try {const result=JSON.parse(output);if(!result.ok)throw new Error(result.error||'文件工具没有完成');resolve(result.context);}
    catch(cause){reject(cause instanceof SyntaxError?new Error(error.slice(-500)||`文件工具退出 ${code}`):cause);}
   });
   child.stdin.end(JSON.stringify(payload));
  });
 }
}
