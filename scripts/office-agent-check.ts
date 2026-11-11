import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ClipboardStore} from '../src/clipboard/store';
import {FileRunner} from '../src/file-runner';
import {OfficeFile} from '../src/targets/office-file';

const root=process.cwd();
const directory=path.join(root,'.local','office-agent-check-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const python=path.join(root,'.local/office-venv/bin/python');
const fixture=spawnSync(python,['scripts/office-fixtures.py',directory],{cwd:root,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
const store=new ClipboardStore(path.join(directory,'clipboard'));
const source=store.add({type:'text',source:{title:'两次探索性访谈笔记'},body:{text:'两次探索性访谈发现：用户希望复制来源后，结合目标文档的内容得到简短、可执行的建议；执行前需要查看预览，并可以撤回。样本有限，不能推广为所有用户的结论。研究计划数据：原型访谈计划 8 人次，已完成 2；交互测试计划 6，已完成 3；场景验证计划 4，已完成 1。'}});
const evidence=[];
fs.writeFileSync(path.join(root,'.local/office-agent-check-latest.json'),JSON.stringify({directory,resultPath:path.join(directory,'result.json')},null,2));
for(const [extension,instruction] of [
 ['docx','参考来源中的用户观察，在现有文档末尾追加一段研究发现。保留已有全部文字和标题，说明只有两次探索性访谈，不要把计划人次误写成访谈样本。'],
 ['xlsx','结合来源和当前表头，为已有三项任务补全完成率公式和百分比格式。保留原始任务名称与数字，公式引用现有单元格，不新增工作表或图表。'],
 ['pptx','保留现有第一页全部内容，参考来源新增一页研究发现，标题与正文分开，沿用现有版式。说明是两次探索性访谈，结论不能推广为所有用户。'],
]){
 if(process.argv[2]&&process.argv[2]!==extension)continue;
 console.log('START',extension);
 const filename=path.join(directory,`research.${extension}`);
 const target=new OfficeFile(root,filename,store);const before=await target.read();const original=target.fingerprint();
 const runner=new FileRunner(root,store);
 try{
  await runner.select(filename);runner.ensurePlanned();
  const planningDeadline=Date.now()+120000;
  while(runner.status().phase==='planning'&&Date.now()<planningDeadline)await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(runner.status().phase,'ready',runner.status().error||'目标规划未完成');
  assert(runner.run({itemIds:[source.id],actionIndex:0,instruction}).ok);
  const deadline=Date.now()+300000;
  while(runner.status().phase==='running'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,500));
  const status=runner.status();assert.equal(status.phase,'preview',status.error||status.summary);
  assert.equal(target.fingerprint(),original,'preview must not touch original');
  const preview=new OfficeFile(root,status.previewPath,store);const after=await preview.read();
  if(extension==='docx'){
   const old=before.paragraphs as {text:string}[],current=after.paragraphs as {text:string}[];
   assert(current.length>old.length);assert.deepEqual(current.slice(0,old.length).map(p=>p.text),old.map(p=>p.text));
  }
  if(extension==='xlsx'){
   const cells=after.cells as {cell:string;value:unknown;numberFormat:string}[];
   for(let row=2;row<=4;row++){
    const cell=cells.find(c=>c.cell===`D${row}`)!;assert.equal(typeof cell.value,'string');
    assert(String(cell.value).startsWith('='));assert(String(cell.value).includes(`B${row}`));assert(String(cell.value).includes(`C${row}`));assert(cell.numberFormat.includes('%'));
   }
   const old=(before.cells as {cell:string;value:unknown}[]).filter(c=>!c.cell.startsWith('D'));
   const current=cells.filter(c=>!c.cell.startsWith('D'));assert.deepEqual(current.map(c=>[c.cell,c.value]),old.map(c=>[c.cell,c.value]));
  }
  if(extension==='pptx'){
   assert.equal(after.slideCount,2);assert.deepEqual((after.slides as unknown[])[0],(before.slides as unknown[])[0]);
  }
  const kept=path.join(directory,`verified-preview.${extension}`);fs.copyFileSync(status.previewPath,kept);
  await runner.control('commit');assert.notEqual(target.fingerprint(),original);
  await runner.control('undo');assert.equal(target.fingerprint(),original);
  evidence.push({extension,sourceType:'text',instruction,plan:status.title,summary:status.result,originalUnchangedDuringPreview:true,applied:true,undoRestored:true,before,preview:after,previewFile:kept});
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),scope:'real Agent Plan + saved Office files; native foreground UI pending',evidence},null,2));
  console.log('PASS',extension,'preview, apply and exact undo');
 }finally{await runner.shutdown();}
}
const result={checkedAt:new Date().toISOString(),scope:'real Agent Plan + saved Office files; native foreground UI pending',evidence};
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(root,'.local/office-agent-check-latest.json'),JSON.stringify({directory,resultPath:path.join(directory,'result.json')},null,2));
console.log('EVIDENCE',path.join(directory,'result.json'));
