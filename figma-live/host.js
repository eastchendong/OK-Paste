/* Fixed document operations only. The model cannot run Plugin API JavaScript. */
function createTuotieFigmaHost(figma) {
 const anchors=new Map(),results=new Map(),drops=new Map();let serial=0;
 // Native external file drops carry their own nonce. Figma owns hit testing;
 // neither the prior selection nor screen-to-canvas estimates choose a frame.
 if(typeof figma.on==='function')figma.on('drop',event=>{
  const files=event.files||[],match=files.length===1&&/^pack-([0-9a-f-]{36})\.okpaste$/i.exec(files[0].name||'');
  if(!match)return true;
  for(const [id,drop]of drops)if(Date.now()-drop.at>15000)drops.delete(id);
  if(drops.size>=20)drops.delete(drops.keys().next().value);
  if(Number.isFinite(event.absoluteX)&&Number.isFinite(event.absoluteY))drops.set(match[1].toLowerCase(),{node:event.node,page:figma.currentPage,at:Date.now()});
  return false; // Do not import the package as an image, attachment or layer.
 });
 const fields=['x','y','width','height','relativeTransform','rotation','opacity','visible','locked','blendMode','fills','strokes','strokeWeight','strokeAlign','effects','cornerRadius','vectorPaths','characters','fontSize','fontName','textAlignHorizontal','layoutMode','clipsContent','isMask','constraints'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 function hash(value){const text=JSON.stringify(value);let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return `${a>>>0}-${b>>>0}`;}
 function nodes(root){const output=[];function visit(node){if(output.length>=3000)throw new Error('当前页面图层过多，请在较小的测试页面使用');const item={id:node.id,name:node.name,type:node.type,parent:node.parent&&node.parent.id};for(const key of fields)if(key in node&&typeof node[key]!=='symbol'&&node[key]!==undefined)item[key]=clone(node[key]);output.push(item);if('children'in node)for(const child of node.children)visit(child);}visit(root);if(JSON.stringify(output).length>4*1024*1024)throw new Error('当前页面内容过大，请缩小测试范围');return output;}
 function scene(page){const items=nodes(page);return {items,version:hash({name:figma.root.name,items})};}
 function anchor(id){const saved=anchors.get(id);if(!saved||saved.page.removed||saved.frame.removed||saved.frame.parent!==saved.page||saved.frame.locked||saved.frame.layoutMode!=='NONE')throw new Error('目标画框已失效、锁定或开启自动布局，请重新选择后按 ⌥⌘V');return saved;}
 function owned(id,anchorId){const result=results.get(id),saved=anchor(anchorId);if(!result||result.anchorId!==anchorId||result.node.removed||result.node.parent!==saved.frame)throw new Error('找不到本次生成结果，或结果已移动/删除');if(hash(nodes(result.node))!==result.version)throw new Error('生成结果已被手动修改，未覆盖或删除；请先检查图层');return result;}
 async function read(id){
  const saved=anchor(id),{page,frame}=saved;await page.loadAsync();const current=scene(page);
  if(saved.previewVersion!==current.version){
   const distance=node=>Math.hypot(node.x-frame.x,node.y-frame.y);
   const references=page.children.filter(n=>n.type==='FRAME'&&n!==frame&&n.visible&&n.children.length).sort((a,b)=>distance(a)-distance(b)).slice(0,2);
   const previews=[];
   for(const node of [frame,...references]){const bytes=await node.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:Math.min(800,Math.max(1,Math.ceil(node.width)))}});if(bytes.length>2500000)throw new Error('画框预览过大，请缩小画框后重试');previews.push({nodeId:node.id,dataUrl:`data:image/png;base64,${figma.base64Encode(bytes)}`});}
   if(scene(page).version!==current.version)throw new Error('画布正在变化，请稍后重新按 ⌥⌘V');
   saved.previews=previews;saved.previewVersion=current.version;
  }
  return {protocolVersion:2,anchorId:id,version:current.version,document:{name:figma.root.name,page:{id:page.id,name:page.name},pages:figma.root.children.map(p=>({id:p.id,name:p.name})),items:current.items,scope:'current-page'},target:{nodeId:frame.id,name:frame.name,width:frame.width,height:frame.height},previews:saved.previews};
 }
 function validateVector(node){if(!['FRAME','GROUP','VECTOR','ELLIPSE','RECTANGLE','BOOLEAN_OPERATION'].includes(node.type))throw new Error('生成结果含不支持的对象');if('fills'in node&&Array.isArray(node.fills)&&node.fills.some(p=>!['SOLID'].includes(p.type)))throw new Error('当前只支持平涂矢量');if('children'in node)for(const child of node.children)validateVector(child);}
 function validSvg(svg){if(typeof svg!=='string'||svg.length>1000000||!svg.startsWith('<svg ')||/<(?:script|image|foreignObject|text|style)\b|\bhref\s*=|\burl\s*\(/i.test(svg))throw new Error('矢量内容无效');}
 function create(frame,descriptor,index=frame.children.length){
  let node;
  try{
   node=figma.createNodeFromSvg(descriptor.svg);validateVector(node);if(!node.width||!node.height)throw new Error('生成结果尺寸无效');
   const scale=descriptor.placement?.scale??Math.min(frame.width/node.width,frame.height/node.height)*0.82;
   node.rescale(scale);
   frame.insertChild(index,node);node.x=descriptor.placement?.x??(frame.width-node.width)/2;node.y=descriptor.placement?.y??(frame.height-node.height)/2;
   node.name=`妥帖 · ${String(descriptor.summary||'矢量作品').slice(0,60)}`;return {node,scale};
  }catch(error){if(node&&!node.removed)node.remove();throw error;}
 }
 return async function dispatch(method,args={}){
  if(method==='info')return {documentName:figma.root.name,pageName:figma.currentPage.name};
  if(method==='capture'){
   let selected=figma.currentPage.selection;
   if(args.nativeDrop){
    if(args.nativeDrop.host!=='figma'||args.nativeDrop.positioned!==true)throw new Error('没有确认 Figma 实际落点');
    const id=String(args.nativeDrop.id||'').toLowerCase();
    for(let wait=0;!drops.has(id)&&wait<10;wait++)await new Promise(resolve=>setTimeout(resolve,50));
    const drop=drops.get(id);drops.delete(id);
    if(!drop||Date.now()-drop.at>10000||drop.page!==figma.currentPage||drop.node.removed)throw new Error('没有收到本次画布拖放，请保持妥帖插件运行后重试');
    let node=drop.node;while(node.parent&&node.parent!==figma.currentPage)node=node.parent;selected=[node];
   }
   if(selected.length!==1||selected[0].type!=='FRAME'||selected[0].parent!==figma.currentPage)throw new Error('请先选中一个页面顶层画框，再按 ⌥⌘V');
   const frame=selected[0];if(frame.locked||frame.layoutMode!=='NONE')throw new Error('请使用未锁定、未开启自动布局的画框');
   const id=`anchor-${++serial}`;anchors.set(id,{frame,page:figma.currentPage,versions:[],consumed:new Set(),uncertain:false});try{return await read(id);}catch(error){anchors.delete(id);throw error;}
  }
  if(method==='read')return read(args.anchorId);
  if(method==='release'){anchors.delete(args.anchorId);for(const [id,result]of results)if(result.anchorId===args.anchorId)results.delete(id);return {released:true};}
  let mutationStarted=false;
  try{
  if(method==='preview'){
   const saved=anchor(args.anchorId),{frame,page}=saved;validSvg(args.svg);
   if(scene(page).version!==args.expectedVersion)throw new Error('Figma 页面已改变，请重新生成');
   const previous=saved.versions.at(-1);if(previous)owned(previous.id,args.anchorId);
   let scratch;
   try{
    scratch=frame.clone();scratch.x=frame.x+frame.width+10000;
    const index=previous?frame.children.indexOf(previous.node):frame.children.length;
    if(previous)scratch.children[index].remove();
    create(scratch,args,index);
    const bytes=await scratch.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:Math.min(800,Math.max(1,Math.ceil(frame.width)))}});
    if(bytes.length>2500000)throw new Error('作品预览过大，请缩小画框');
    return {image:`data:image/png;base64,${figma.base64Encode(bytes)}`,width:frame.width,height:frame.height};
   }finally{
    if(scratch&&!scratch.removed)scratch.remove();
    if(scene(page).version!==args.expectedVersion)throw new Error('预览期间原画布已改变，未写入新作品');
   }
  }
  if(method==='apply'){
   const saved=anchor(args.anchorId),{frame,page}=saved;
   if(saved.uncertain)throw new Error('上次 Figma 写入结果未确认，请检查画框后重新建立任务');
   if(!/^[0-9a-f-]{36}$/.test(args.taskId))throw new Error('生成任务标识无效');
   if(results.has(args.taskId)){owned(args.taskId,args.anchorId);return {resultId:args.taskId,revision:saved.versions.length,...(results.get(args.taskId).resultReceipt?{resultReceipt:results.get(args.taskId).resultReceipt}:{})};}
   if(saved.consumed.has(args.taskId))throw new Error('该结果已替换或撤回，不能重复写入');
   if(args.expectedRevision!==saved.versions.length)throw new Error('版本已改变，请勿重复应用');
   if(saved.versions.length>=20)throw new Error('本次任务最多保留 20 个版本');
   if(scene(page).version!==args.expectedVersion)throw new Error('Figma 页面已改变，请重新按 ⌥⌘V');
   const previous=saved.versions.at(-1);
   if((previous?.id||'')!==(args.replaceResultId||''))throw new Error('替换对象与当前版本不一致');
   if(previous)owned(previous.id,args.anchorId);validSvg(args.svg);
   const descriptor={id:args.taskId,svg:args.svg,summary:args.summary};
   figma.commitUndo();
   // A failed import cleans up its own temporary node and leaves the previous version intact.
   const {node,scale}=create(frame,descriptor,previous?frame.children.indexOf(previous.node):frame.children.length);
   mutationStarted=true;saved.uncertain=true;
   descriptor.node=node;descriptor.placement={x:node.x,y:node.y,scale};descriptor.version=hash(nodes(node));descriptor.anchorId=args.anchorId;
   if(previous){previous.node.remove();results.delete(previous.id);}
   saved.versions.push(descriptor);saved.consumed.add(args.taskId);results.set(args.taskId,descriptor);
   figma.commitUndo();saved.uncertain=false;
   const viewport=figma.viewport,bounds=viewport?.bounds,render=descriptor.node.absoluteRenderBounds||descriptor.node.absoluteBoundingBox;
   const locators=bounds&&render&&Number.isFinite(viewport.zoom)?[{kind:'surface',size:{width:bounds.width*viewport.zoom,height:bounds.height*viewport.zoom},regions:[{x:(render.x-bounds.x)/bounds.width,y:(render.y-bounds.y)/bounds.height,width:render.width/bounds.width,height:render.height/bounds.height}]}]:[];
   descriptor.resultReceipt={documentId:saved.page.id,revision:saved.versions.length,locators,reason:'画布未提供可核验的可见几何'};
   return {resultId:args.taskId,revision:saved.versions.length,resultReceipt:descriptor.resultReceipt};
  }
  if(method==='undo'){
   const saved=anchor(args.anchorId);if(saved.uncertain)throw new Error('上次 Figma 写入结果未确认，请先检查画框');
   if(args.expectedRevision!==saved.versions.length||saved.versions.at(-1)?.id!==args.resultId)throw new Error('版本已改变，请勿重复撤销');
   const result=owned(args.resultId,args.anchorId),previous=saved.versions.at(-2);figma.commitUndo();
   const restored=previous?create(saved.frame,previous,saved.frame.children.indexOf(result.node)).node:null;
   mutationStarted=true;saved.uncertain=true;
   result.node.remove();results.delete(args.resultId);saved.versions.pop();
   if(previous){previous.node=restored;previous.version=hash(nodes(restored));results.set(previous.id,previous);}
   figma.commitUndo();saved.uncertain=false;return {undone:true,resultId:previous?.id||'',revision:saved.versions.length};
  }
  throw new Error('不支持的 Figma 操作');
  }catch(error){throw Object.assign(error,{mutationStarted});}
 };
}
