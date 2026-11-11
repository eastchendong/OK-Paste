/** Synthetic provider benchmark. No Office/native input writes or clipboard changes. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {z} from 'zod';
import {DirectExecutor} from '../src/agent-core/direct-executor';
import {WordPatchSchema} from '../src/targets/word-patch';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configRoot=process.env.TUOTIE_MODEL_CONFIG_ROOT||root;
const executor=new DirectExecutor(configRoot);
const text=z.object({text:z.string().min(1),layout:z.enum(['paragraph','inline']).optional()});
const cells=z.object({cells:z.array(z.array(z.union([z.string(),z.number(),z.boolean(),z.null(),z.object({formula:z.string()}),z.object({text:z.string()})])))});
const ppt=z.object({replacements:z.array(z.object({shapeId:z.string(),imageId:z.string(),fit:z.enum(['cover','contain']).optional()})),texts:z.array(z.object({shapeId:z.string(),text:z.string()})).optional()});
const samples:{kind:string;instruction:string;context:Record<string,unknown>;sources:Record<string,unknown>[];schemas:Record<string,z.ZodType>}[]=[
 {kind:'word-live',instruction:'根据两份资料，在第二节补充一段人员分工说明，最多80字。不重复标题。',context:{kind:'word-live',body:'一、活动背景：校园服务日。\n二、人员安排\n三、注意事项',location:{before:'二、人员安排',after:'三、注意事项'},blockInsertionAvailable:true},sources:[{id:'a',type:'text',body:{text:'签到岗：林同学和陈同学，上午九点到场。'}},{id:'b',type:'text',body:{text:'引导岗：王同学、李同学和周同学，带学生证，八点五十到场。'}}],schemas:{prepare_word_insertion:text,prepare_word_patch:WordPatchSchema}},
 {kind:'input-live',instruction:'整理成发给同学的简短消息，保留时间与携带要求，不要承诺代发。',context:{kind:'input-live',focus:{appName:'合成聊天输入框'},currentFragment:''},sources:[{id:'a',type:'text',body:{text:'活动周六9:00开始，8:50到东门集合，带学生证；下雨则改到图书馆一楼。'}}],schemas:{prepare_text:text}},
 {kind:'excel-live',instruction:'按原表头把两份报名资料填入已选两行，缺少的信息留空。',context:{kind:'excel-live',selection:{address:'Sheet1!A2:C3',rowCount:2,columnCount:3,formulas:[[null,null,null],[null,null,null]]},workbook:{sheets:[{name:'Sheet1',usedRange:{values:[['姓名','状态','备注']]}}]}},sources:[{id:'a',type:'text',body:{text:'林同学已报名，上午到场，带学生证。'}},{id:'b',type:'text',body:{text:'陈同学已报名，下午参加。'}}],schemas:{prepare_excel_update:cells}},
 {kind:'powerpoint-live',instruction:'将标明姓名的两张来源头像放入对应空位，完整显示，不改原头像或任何文字。',context:{kind:'powerpoint-live',captureScope:'selection',selection:{shapeIds:['left','right']},currentPage:{shapes:[{id:'reference',name:'已有头像：周同学'},{id:'left',name:'林同学头像空位'},{id:'right',name:'陈同学头像空位'}]}},sources:[{id:'person-lin',type:'image',source:{title:'林同学头像'}},{id:'person-chen',type:'image',source:{title:'陈同学头像'}}],schemas:{prepare_powerpoint_edit:ppt}},
];
const results:Record<string,unknown>[]=[];
for(let repeat=0;repeat<3;repeat++)for(const sample of samples){
 const schemas=sample.schemas;
 const started=performance.now();let candidate:unknown;
 try{
  const result=await executor.execute({kind:sample.kind,instruction:sample.instruction,context:sample.context,sources:sample.sources,images:[],conversation:[],
   tools:Object.entries(schemas).map(([name,schema])=>({name,description:'准备当前固定范围的完整修改候选',inputSchema:z.toJSONSchema(schema)})),
   invoke:async(name,args)=>{candidate=schemas[name].parse(args);if(sample.kind==='excel-live'){const matrix=(candidate as z.infer<typeof cells>).cells;if(matrix.length!==2||matrix.some(row=>row.length!==3))throw new Error('必须提供2行3列');}if(sample.kind==='powerpoint-live'){const edit=candidate as z.infer<typeof ppt>;if(edit.replacements.length!==2||edit.replacements.some(item=>!['left','right'].includes(item.shapeId)||!['person-lin','person-chen'].includes(item.imageId)))throw new Error('只能补齐两张头像');}return {prepared:true};},signal:new AbortController().signal});
  const row={kind:sample.kind,repeat,durationMs:Math.round(performance.now()-started),...result.metrics,valid:!result.question,candidate,question:result.question};results.push(row);console.log(JSON.stringify(row));
 }catch(error){const row={kind:sample.kind,repeat,durationMs:Math.round(performance.now()-started),valid:false,error:error instanceof Error?error.message:'failed'};results.push(row);console.log(JSON.stringify(row));}
}
const report={at:new Date().toISOString(),synthetic:true,hostWrites:false,imagesIncluded:false,model:'deepseek-flash',results};
fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.writeFileSync(path.join(root,'.local/direct-execution-smoke.json'),JSON.stringify(report,null,2));
if(results.some(row=>!row.valid))process.exitCode=1;
