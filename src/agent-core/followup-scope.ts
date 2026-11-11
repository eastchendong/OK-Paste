import {VectorArtwork} from '../vector-art';

export const FOLLOWUP_SCENES=['document-fragment','message','task-brief','table-create','table-append','persona-avatars','vector-character','vector-icon','vector-empty-state'] as const;
export type FollowupScene=typeof FOLLOWUP_SCENES[number];
export const FOLLOWUP_DIRECTIONS=['cohesion','structure','emphasis','length','detail','tone','action','scope','criteria','constraints','uncertainty','split-fields','normalize-text','deduplicate','match-existing','cite-source','image-contain','image-cover','vector-shape','vector-expression','vector-simplify','vector-weight','vector-symbol','vector-mood','vector-emphasis'] as const;
type Context=Record<string,unknown>;
const record=(v:unknown):Context=>v&&typeof v==='object'&&!Array.isArray(v)?v as Context:{};
const rows=(v:unknown):unknown[][]=>Array.isArray(v)&&v.every(Array.isArray)?v:[];
const value=(v:unknown):unknown=>typeof v==='object'&&v!==null&&'text' in v?(v as {text:unknown}).text:v;
const blank=(v:unknown)=>value(v)==null||value(v)==='';
const label=(v:unknown)=>typeof value(v)==='string'?String(value(v)).trim():'';
const position=(address:unknown)=>{
 const match=String(address??'').split('!').at(-1)?.replace(/\$/g,'').match(/^([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/i);
 return match?{row:Number(match[2]),column:[...match[1].toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1}:null;
};
function referenceHeaders(context:Context):string[]{
 if(Array.isArray(context.referenceHeaders))return context.referenceHeaders.map(label);
 const selection=record(context.selection),start=position(selection.address);
 const sheets=record(context.workbook).sheets;
 if(!start||!Array.isArray(sheets))return [];
 const sheet=sheets.find(sheet=>record(sheet).name===context.worksheet);
 const used=record(record(sheet).usedRange),origin=position(used.address),header=rows(used.text)[0];
 if(!origin||!header||origin.row>=start.row)return [];
 const offset=start.column-origin.column,count=Number(selection.columnCount);
 return offset>=0&&offset+count<=header.length?header.slice(offset,offset+count).map(label):[];
}
/** Freeze only the original selected range and relevant header/page facts. */
export function captureFollowupBaseline(context:Context):Context{
 if(context.kind==='figma-live')return structuredClone({kind:context.kind,target:context.target,document:context.document,previewOrder:context.previewOrder});
 return structuredClone({kind:context.kind,selection:context.selection,referenceHeaders:referenceHeaders(context),
  currentPage:context.currentPage,captureScope:context.captureScope});
}
export type FollowupScope={scenes:FollowupScene[];directions:Partial<Record<FollowupScene,readonly string[]>>;referenceHeaders?:string[]};
const writing:FollowupScope={scenes:['document-fragment','message','task-brief'],directions:{
 'document-fragment':['cohesion','structure','emphasis','length','detail','tone'],
 message:['structure','emphasis','length','tone','action'],
 'task-brief':['scope','structure','criteria','constraints','uncertainty','length'],
}};
function hasIdenticalRecords(cells:unknown[][]):boolean{
 const column=cells[0]?.findIndex(v=>/^(报名编号|报名ID|记录编号|记录ID|学号|工号|订单号|订单编号|编号|ID)$/i.test(label(v)))??-1;
 if(column<0)return false;
 const seen=new Map<string,{row:string;count:number;conflict:boolean}>();
 for(const row of cells.slice(1)){
  // Identical formula expressions may calculate different values in different rows.
  if(row.some(cell=>typeof cell==='string'&&cell.trimStart().startsWith('=')||
   typeof cell==='object'&&cell!==null&&'formula' in cell)||blank(row[column]))continue;
  const id=JSON.stringify(value(row[column])),text=JSON.stringify(row),previous=seen.get(id);
  if(previous){previous.count++;previous.conflict ||= previous.row!==text;}
  else seen.set(id,{row:text,count:1,conflict:false});
 }
 return [...seen.values()].some(group=>group.count>1&&!group.conflict);
}
/** Eligibility and available operations come from captured facts, never app-name guesses. */
export function followupScope(raw:unknown,rawBaseline?:unknown):FollowupScope|null{
 const context=record(raw),baseline=record(rawBaseline);
 if(['word-live','input-live','focused-text'].includes(String(context.kind)))return writing;
 if(context.kind==='figma-live'){
  const capability=record(context.capabilities),target=record(context.target),original=record(baseline.target);
  if(capability.addEditableVectors!==true||baseline.kind!=='figma-live'||!target.nodeId||target.nodeId!==original.nodeId||
   !VectorArtwork.safeParse(context.currentArtwork).success)return null;
  return {scenes:['vector-character','vector-icon','vector-empty-state'],directions:{
   'vector-character':['vector-shape','vector-expression','vector-simplify'],
   'vector-icon':['vector-simplify','vector-weight','vector-symbol'],
   'vector-empty-state':['vector-simplify','vector-mood','vector-emphasis'],
  }};
 }
 if(context.kind==='excel-live'){
  const original=rows(record(baseline.selection).formulas),cells=rows(context.currentUpdate);
  if(!original.length||!original.every(row=>row.every(blank))||!cells.length)return null;
  const fields=referenceHeaders(baseline),create=['normalize-text','length'],append=['match-existing','length'];
  if(cells[0].some((_,i)=>cells.every(row=>blank(row[i]))))create.push('split-fields');
  if(hasIdenticalRecords(cells))create.push('deduplicate');
  if(fields.some(name=>/来源|备注/.test(name)))append.push('cite-source');
  return {scenes:['table-create','table-append'],referenceHeaders:fields,directions:{'table-create':create,'table-append':append}};
 }
 if(context.kind==='powerpoint-live'){
  const edit=record(context.currentEdit),replacements=Array.isArray(edit.replacements)?edit.replacements.map(record):[];
  const selected=record(context.selection).shapeIds,original=record(baseline.selection).shapeIds;
  const page=record(baseline.currentPage).shapes;
  if(context.captureScope==='page'||replacements.length!==2||!Array.isArray(selected)||selected.length!==2||
   !replacements.every(item=>selected.includes(item.shapeId))||!Array.isArray(original)||original.length!==2||
   !Array.isArray(page)||page.length<3||Array.isArray(edit.texts)&&edit.texts.length)return null;
  const choices=[];
  if(!replacements.every(item=>item.fit==='contain'))choices.push('image-contain');
  if(!replacements.every(item=>!item.fit||item.fit==='cover'))choices.push('image-cover');
  return {scenes:['persona-avatars'],directions:{'persona-avatars':choices}};
 }
 return null;
}
