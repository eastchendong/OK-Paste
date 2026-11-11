/** Real-model recommendation smoke check using synthetic Office facts only. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {FollowupRecommender,type FollowupInput} from '../src/agent-core/followup-recommendations';
import {captureFollowupBaseline,followupScope,type FollowupScene} from '../src/agent-core/followup-scope';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function range(address:string,cells:unknown[][]){return {address,rowCount:cells.length,columnCount:cells[0].length,formulas:cells,text:cells.map(row=>row.map(v=>v==null?'':String(v))),numberFormat:cells.map(row=>row.map(()=>'General'))};}
const notes='这位同学希望上午参加活动，会携带学生证，愿意在现场协助签到和引导。';
const cells=[['编号','状态','备注'],['001','报名成功',notes],['001','报名成功',notes],['002','已报名','可以上午参加并协助整理物料，下午需要提前离开。']];
const empty=cells.map(row=>row.map(()=>null));
const originalTable={kind:'excel-live',worksheet:'数据',selection:range('数据!B3:D6',empty),workbook:{sheets:[]}};
const originalAppend={kind:'excel-live',worksheet:'数据',selection:range('数据!B3:D4',[[null,null,null],[null,null,null]]),workbook:{sheets:[{name:'数据',usedRange:range('数据!A1:D2',[['组别','姓名','状态','备注'],['原组','原同学','已报名','上午可到场']])}]}};
const originalPage={kind:'powerpoint-live',captureScope:'selection',selection:{shapeIds:['left','right']},currentPage:{shapes:[{id:'reference',name:'原有用户画像头像',type:'Picture'},{id:'left',name:'用户画像空位A',type:'Shape'},{id:'right',name:'用户画像空位B',type:'Shape'}]}};
const appended=[['新同学','报名成功',notes],['另一位','已完成报名','希望下午参加，愿意协助现场的物料核对和图书整理。']];
const page={...originalPage,selection:{shapeIds:['new-left','new-right']},currentEdit:{replacements:[{shapeId:'new-left',imageId:'person-a',fit:'cover'},{shapeId:'new-right',imageId:'person-b',fit:'cover'}],texts:[]}};
const cases:{scene:FollowupScene;request:string;context:Record<string,unknown>;baseline:Record<string,unknown>;result:unknown;source:string;tool:string}[]=[
 {scene:'table-create',request:'将报名资料整理成明细表，保留关键事实，不扩展原表之外的信息。',context:{...originalTable,selection:range('数据!B3:D6',cells),currentUpdate:cells,capabilities:'只改本次4行3列的值/公式，保留数值与格式，不新增行列。'},baseline:captureFollowupBaseline(originalTable),result:cells,source:'原始报名记录含同一编号001的两份完全相同材料及编号002的独立记录。报名成功和已报名表示同一状态。备注保留上午参加、下午需离开等限定。',tool:'prepare_excel_update'},
 {scene:'table-append',request:'按原表头把新报名记录填入本次空行，只改新增两行，保留原表头和旧记录。',context:{...originalAppend,selection:range('数据!B3:D4',appended),currentUpdate:appended,capabilities:'只改本次2行3列的值/公式，不增行列，不改格式。'},baseline:captureFollowupBaseline(originalAppend),result:appended,source:'新同学报名成功，上午到场，带学生证，可协助签到与引导。另一位报名成功，下午参加，协助核对物料和整理图书。',tool:'prepare_excel_update'},
 {scene:'persona-avatars',request:'保留已有头像，用两张来源图片补齐用户画像两个空位，其他内容不变。',context:{...page,capabilities:'只调整本任务两张头像；图片支持 contain/cover，保持 shapeId 与 imageId 对应、位置、大小和其他对象。不支持去背、人脸焦点裁剪。'},baseline:captureFollowupBaseline(originalPage),result:page.currentEdit,source:'两个新画像的头像已按对应人物填入，当前都是 cover；原有参考头像不修改。',tool:'prepare_powerpoint_edit'},
];
const recommender=new FollowupRecommender(process.env.TUOTIE_MODEL_CONFIG_ROOT||root),results=[];
for(const sample of cases){
 const input:FollowupInput={intent:{title:sample.request,writingScene:sample.scene},currentResult:JSON.stringify(sample.result),context:sample.context,baseline:sample.baseline,
  sources:[{id:'synthetic',type:'text',source:{url:'https://example.org/synthetic-records'},body:{text:sample.source}}],images:[],conversation:[{role:'user',text:sample.request}],
  tools:[{name:sample.tool,description:sample.context.capabilities as string,inputSchema:{type:'object'}}]};
 const started=Date.now(),result=await recommender.suggest(input,new AbortController().signal),scope=followupScope(input.context,input.baseline)!;
 if(result.scene!==sample.scene)throw new Error('明确的合成场景未识别：'+sample.scene);
 if(result.options.some(option=>!scope.directions[sample.scene]?.includes(option.direction)))throw new Error('推荐超出实际能力');
 const record={durationMs:Date.now()-started,...result};results.push(record);console.log(JSON.stringify(record));
}
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
fs.writeFileSync(path.join(root,'.local/office-followup-smoke.json'),JSON.stringify({synthetic:true,hostWrites:false,at:new Date().toISOString(),results},null,2));
