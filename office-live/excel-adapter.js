/* Office.js owns reads, conflict checks, writes and the acknowledged revision chain. */
export function createExcelAdapter(Excel) {
 const anchors=new Map(),clone=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const plainRange=range=>({address:range.address,rowCount:range.rowCount,columnCount:range.columnCount,formulas:range.formulas,text:range.text,numberFormat:range.numberFormat});
 const owned=selection=>({address:selection.address,formulas:selection.formulas,formulaMask:selection.formulaMask,numberFormat:selection.numberFormat});
 const intersects=(a,b)=>a.rowIndex<b.rowIndex+b.rowCount&&b.rowIndex<a.rowIndex+a.rowCount&&a.columnIndex<b.columnIndex+b.columnCount&&b.columnIndex<a.columnIndex+a.columnCount;
 async function safety(context,range){
  const protection=range.worksheet.protection,tables=range.getTables(false),used=range.worksheet.getUsedRangeOrNullObject();
  range.load('rowIndex,columnIndex,rowCount,columnCount,hasSpill,savedAsArray');protection.load('protected');tables.load('items/id');used.load('isNullObject');await context.sync();
  if(protection.protected)throw new Error('暂不修改受保护工作表，请先解除保护');
  if(range.hasSpill!==false||range.savedAsArray!==false)throw new Error('选区包含数组或溢出公式，暂不修改');
  if(tables.items.length)throw new Error('暂不修改结构化表，避免公式自动填充到选区外');
  // Query the full used area: a selection can intersect a merge without containing its top-left cell.
  if(!used.isNullObject){
   const merged=used.getMergedAreasOrNullObject();merged.load('isNullObject');await context.sync();
   if(!merged.isNullObject){merged.areas.load('items/rowIndex,items/columnIndex,items/rowCount,items/columnCount');await context.sync();if(merged.areas.items.some(area=>intersects(range,area)))throw new Error('选区与合并单元格相交，暂不修改');}
  }
 }
 async function snapshot(context,entry){
  const worksheets=context.workbook.worksheets;worksheets.load('items/name');
  entry.range.load('address,rowIndex,columnIndex,rowCount,columnCount,formulas,text,numberFormat,valueTypes');await context.sync();
  if(entry.range.rowCount*entry.range.columnCount>10000)throw new Error('一次最多编辑 1 万个选中单元格');
  const used=worksheets.items.map(sheet=>{const range=sheet.getUsedRangeOrNullObject(true);range.load('address,rowCount,columnCount,formulas,text,numberFormat,isNullObject');return {sheet,range};});
  const formulas=entry.range.getSpecialCellsOrNullObject('Formulas');formulas.load('isNullObject');await context.sync();
  if(used.reduce((sum,item)=>sum+(item.range.isNullObject?0:item.range.rowCount*item.range.columnCount),0)>50000)throw new Error('当前工作簿有效单元格超过 5 万格，暂不生成建议；没有截取部分表格冒充完整工作簿');
  if(!formulas.isNullObject){formulas.areas.load('items/rowIndex,items/columnIndex,items/rowCount,items/columnCount');await context.sync();}
  const selection=plainRange(entry.range);
  selection.formulaMask=Array.from({length:selection.rowCount},(_,r)=>Array.from({length:selection.columnCount},(_,c)=>!formulas.isNullObject&&formulas.areas.items.some(area=>intersects({rowIndex:entry.range.rowIndex+r,columnIndex:entry.range.columnIndex+c,rowCount:1,columnCount:1},area))));
  const sheets=used.map(({sheet,range})=>({name:sheet.name,usedRange:range.isNullObject?null:plainRange(range)}));
  const version=JSON.stringify({sheets:sheets.map(sheet=>({name:sheet.name,address:sheet.usedRange?.address,formulas:sheet.usedRange?.formulas,numberFormat:sheet.usedRange?.numberFormat})),selection:owned(selection)});
  return {protocolVersion:2,anchorId:entry.id,version,worksheet:entry.worksheetName,selection,workbook:{name:entry.workbookName,sheets}};
 }
 function encoded(cells,rows,columns){
  if(!Array.isArray(cells)||cells.length!==rows||cells.some(row=>!Array.isArray(row)||row.length!==columns))throw new Error('待写入矩阵与选区尺寸不一致');
  return cells.map(row=>row.map(cell=>{
   if(cell===null)return '';
   if(typeof cell==='number'&&Number.isFinite(cell)||typeof cell==='boolean')return cell;
   if(typeof cell==='string'){if(cell.length>32767)throw new Error('单元格文字过长');if(cell.startsWith('=')&&(cell.length<2||cell.length>8192))throw new Error('公式长度无效');return cell.startsWith('=')?cell:`'${cell}`;}
   if(cell&&typeof cell==='object'&&Object.keys(cell).length===1){
    if(typeof cell.text==='string'&&cell.text.length<=32767)return `'${cell.text}`;
    if(typeof cell.formula==='string'&&cell.formula.startsWith('=')&&cell.formula.length>1&&cell.formula.length<=8192)return cell.formula;
   }
   throw new Error('单元格必须是值、{text:纯文字} 或 {formula:公式}');
  }));
 }
 const restore=selection=>selection.formulas.map((row,r)=>row.map((cell,c)=>selection.formulaMask[r][c]?cell:typeof cell==='string'?`'${cell}`:cell===null?'':cell));
 return async function execute(method,args={}){
  let mutationStarted=false;
  try{
   if(method==='capture')return await Excel.run(async context=>{
    const range=context.workbook.getSelectedRange(),worksheet=range.worksheet;worksheet.load('name');range.load('address');await context.sync();
    if(args.nativeDrop){
     const actual=range.address.split('!').at(-1).replace(/\$/g,'');
     if(args.nativeDrop.host!=='excel'||args.nativeDrop.positioned!==true||actual!==args.nativeDrop.cellAddress)throw new Error('落点单元格已变化，未使用原选区；请重新拖入');
    }
    context.trackedObjects.add(range);
    const entry={id:crypto.randomUUID(),range,worksheetName:worksheet.name,workbookName:args.documentUrl||'当前工作簿',original:null,versions:[],uncertain:false};
    try{await safety(context,range);const result=await snapshot(context,entry);entry.original=clone(result.selection);anchors.set(entry.id,entry);return result;}
    catch(error){context.trackedObjects.remove(range);await context.sync();throw error;}
   });
   const entry=anchors.get(args.anchorId);if(!entry)throw new Error('选区已失效，请回到 Excel 重新选择单元格并按 ⌥⌘V');
   return await Excel.run(entry.range,async context=>{
    if(method==='read')return snapshot(context,entry);
    if(method==='release'){context.trackedObjects.remove(entry.range);await context.sync();anchors.delete(entry.id);return {ok:true};}
    if(!['apply','undo'].includes(method))throw new Error('没有这个 Excel 操作');
    if(entry.uncertain)throw new Error('上次 Excel 写入结果未确认，请检查选区后重新建立任务');
    if(args.expectedRevision!==entry.versions.length)throw new Error('版本已改变，请勿重复应用或撤销');
    await safety(context,entry.range);
    const current=await snapshot(context,entry),previous=entry.versions.at(-1);
    if(previous&&!same(owned(current.selection),owned(previous)))throw new Error('选区已被继续编辑，无法安全覆盖或撤回；请先检查表格');
    let cells;
    if(method==='apply'){
     if(entry.versions.length>=20)throw new Error('本次任务最多保留 20 个版本');
     if(current.version!==args.expectedVersion)throw new Error('工作簿内容、公式或格式已改变，请重新理解后生成');
     cells=encoded(args.cells,entry.range.rowCount,entry.range.columnCount);
    }else{
     if(!previous)throw new Error('没有本次 Excel 修改可撤回');
     const destination=entry.versions.at(-2)||entry.original;
     if(destination.address!==current.selection.address)throw new Error('选区位置已改变，无法安全撤回');
     cells=restore(destination);
    }
    mutationStarted=true;entry.uncertain=true;entry.range.formulas=cells;await context.sync();
    const actual=await snapshot(context,entry);
    if(method==='apply')entry.versions.push(clone(actual.selection));else entry.versions.pop();
    entry.uncertain=false;
    const errors=[];
    for(let r=0;r<entry.range.rowCount;r++)for(let c=0;c<entry.range.columnCount;c++)if(entry.range.valueTypes[r][c]==='Error')errors.push(actual.selection.text[r][c]);
    const column=n=>{let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
    const locators=[];
    for(let r=0;r<entry.range.rowCount;r++)for(let c=0;c<entry.range.columnCount;c++){
     if(JSON.stringify(current.selection.formulas[r][c])!==JSON.stringify(actual.selection.formulas[r][c]))
      locators.push({kind:'cell',address:column(entry.range.columnIndex+c)+(entry.range.rowIndex+r+1),text:actual.selection.text[r][c]});
    }
    return {ok:true,resultReceipt:{documentId:entry.id,revision:entry.versions.length,locators,reason:locators.length?'':'本次没有可见单元格变化'},revision:entry.versions.length,address:actual.selection.address,warnings:errors.length?[`选区中 ${errors.length} 格显示计算错误（${[...new Set(errors)].slice(0,3).join('、')}），可调整或撤销`]:[]};
   });
  }catch(error){throw Object.assign(error,{mutationStarted});}
 };
}
