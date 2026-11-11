import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClipboardStore} from '../src/clipboard/store';
import {OfficeFile} from '../src/targets/office-file';

const root=process.cwd();
const python=path.join(root,'.local/office-venv/bin/python');
const fixtureRoot=path.join(root,'.local/office-check-fixtures');
const directories:string[]=[];
const available=fs.existsSync(python);
beforeAll(()=>{
 if(!available)return;
 const result=spawnSync(python,['scripts/office-fixtures.py',fixtureRoot],{cwd:root,encoding:'utf8',timeout:60000});
 if(result.status!==0)throw new Error(result.stderr||'Could not make Office fixtures');
},60000);
afterEach(()=>directories.splice(0).forEach(directory=>fs.rmSync(directory,{recursive:true,force:true})));
function target(extension:string){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-office-'));directories.push(directory);
 const filename=path.join(directory,'target.'+extension);fs.copyFileSync(path.join(fixtureRoot,'research.'+extension),filename);
 const store=new ClipboardStore(path.join(directory,'clipboard'));
 const image=store.add({type:'image',source:{title:'参考图片'},body:{dataUrl:'data:image/jpeg;base64,'+fs.readFileSync(path.join(root,'assets/reference/apple.jpg')).toString('base64')}});
 return {file:new OfficeFile(root,filename,store),filename,image};
}

describe.skipIf(!available)('real Office file previews',()=>{
 it('preserves the original through a Word preview, then commits and restores exact original bytes',async()=>{
  const {file,image}=target('docx');const original=file.fingerprint();
  const before=await file.read();expect(before.kind).toBe('document');
  file.begin();
  await file.edit({operations:[{type:'replace_text',find:'来源后，在目标应用',replace:'参考后，在各目标应用'},{type:'insert_paragraph',after:1,text:'新增的研究结论。'},{type:'insert_image',imageId:image.id,widthCm:4}]});
  const preview=await file.read();
  expect(JSON.stringify(preview)).toContain('新增的研究结论');expect(preview.imageCount).toBe(1);
  const format=spawnSync(python,['-c','import sys,json;from docx import Document;p=Document(sys.argv[1]).paragraphs[1];print(json.dumps({"firstBold":p.runs[0].bold,"lastBold":p.runs[-1].bold,"lastText":p.runs[-1].text}))',file.previewPath],{encoding:'utf8'});
  const runs=JSON.parse(format.stdout);expect(runs.firstBold).toBe(true);expect(runs.lastBold).not.toBe(true);expect(runs.lastText).toContain('里得到合适的操作建议');
  expect(file.fingerprint()).toBe(original);
  file.commit();expect(file.fingerprint()).not.toBe(original);
  expect(file.canUndo).toBe(true);file.undo();expect(file.fingerprint()).toBe(original);
 },30000);
 it('does not keep a partial edit if a later operation fails',async()=>{
  const {file}=target('docx');file.begin();const before=await file.read();
  await expect(file.edit({operations:[{type:'insert_paragraph',text:'不得部分保存'},{type:'replace_text',paragraph:999,find:'x',replace:'y'}]})).rejects.toThrow();
  expect((await file.read()).fingerprint).toBe(before.fingerprint);
  const preview=file.previewPath;file.cancel();expect(fs.existsSync(preview)).toBe(false);
 },30000);
 it('refuses to overwrite another application changing the original',async()=>{
  const {file,filename}=target('docx');file.begin();
  await file.edit({operations:[{type:'insert_paragraph',text:'预览内容'}]});
  fs.appendFileSync(filename,'External edit');const changed=file.fingerprint();
  expect(()=>file.commit()).toThrow(/已在其他应用改变/);file.cancel();expect(file.fingerprint()).toBe(changed);
 },30000);
 it('writes actual spreadsheet formulas, formats and a chart with exact undo',async()=>{
  const {file}=target('xlsx');const original=file.fingerprint();
  const before=await file.read();expect(before.savedSelection).toBe('D2');
  file.begin();await file.edit({operations:[
   {type:'write_cells',sheet:'研究计划',startCell:'D2',values:[['=C2/B2'],['=C3/B3'],['=C4/B4']]},
   {type:'format_cells',sheet:'研究计划',range:'D2:D4',numberFormat:'0%'},
   {type:'add_chart',sheet:'研究计划',range:'A1:C4',kind:'bar',title:'研究进度',anchor:'F2'},
  ]});
  const preview=await file.read();expect(JSON.stringify(preview)).toContain('=C2/B2');expect(JSON.stringify(preview)).toContain('0%');
  expect((preview.sheets as {charts:number}[])[0].charts).toBe(1);expect(file.fingerprint()).toBe(original);
  file.commit();file.undo();expect(file.fingerprint()).toBe(original);
 },30000);
 it('edits real slide shapes and adds a slide and source image in bounds',async()=>{
  const {file,image}=target('pptx');const original=file.fingerprint();
  const before=await file.read();const slide=(before.slides as {shapes:{id:number;text?:string}[]}[])[0];
  file.begin();await file.edit({operations:[
   {type:'set_shape_text',slide:0,shapeId:slide.shapes[0].id,text:'复制内容与目标上下文'},
   {type:'add_slide',layoutIndex:1,title:'验证计划',body:'• 复制来源\n\n- 查看推荐\n预览后应用'},
   {type:'insert_image',slide:1,imageId:image.id,leftCm:22,topCm:6,widthCm:6},
  ]});
  const preview=await file.read();expect(preview.slideCount).toBe(2);expect(JSON.stringify(preview)).toContain('复制内容与目标上下文');
  const paragraphs=spawnSync(python,['-c','import sys,json;from pptx import Presentation;p=Presentation(sys.argv[1]);s=p.slides[1].placeholders[1];print(json.dumps({"text":s.text,"bullets":len(s._element.xpath(".//a:buChar"))}))',file.previewPath],{encoding:'utf8'});
  expect(JSON.parse(paragraphs.stdout)).toEqual({text:'复制来源\n查看推荐\n预览后应用',bullets:2});
  expect(file.fingerprint()).toBe(original);file.commit();file.undo();expect(file.fingerprint()).toBe(original);
 },30000);
});
