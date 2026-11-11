/* Figma Plugin API. The model receives named operations, never arbitrary JS. */
figma.showUI(__html__, {width:300,height:140});
let preview=null,edits=0,committed=null,committedVersion='',captured=null,previousView=null;
const color=hex=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
function tree(node,depth=0,budget={left:300}){
 if(--budget.left<0)return {truncated:true};
 const result={id:node.id,name:node.name,type:node.type,x:node.x,y:node.y,width:node.width,height:node.height};
 if('characters' in node)result.text=node.characters.slice(0,8000);
 if(Array.isArray(node.fills))result.fills=node.fills;
 if('fontSize' in node&&typeof node.fontSize==='number')result.fontSize=node.fontSize;
 if(depth<5&&'children' in node)result.children=node.children.map(child=>tree(child,depth+1,budget));
 else if('children' in node&&node.children.length)result.childrenTruncated=true;
 return result;
}
function snapshot(){
 if(preview&&captured)return {...captured,preview:tree(preview),edits};
 return {fileKey:figma.fileKey||'',documentName:figma.root.name,pageId:figma.currentPage.id,pageName:figma.currentPage.name,topLevelCount:figma.currentPage.children.length,selection:figma.currentPage.selection.map(node=>tree(node)),nearby:figma.currentPage.children.filter(node=>!committed||node.id!==committed.id).slice(0,12).map(node=>({id:node.id,name:node.name,type:node.type,x:node.x,y:node.y,width:node.width,height:node.height})),viewport:figma.viewport.center};
}
async function fonts(node){
 if(node.type==='TEXT'){for(const segment of node.getStyledTextSegments(['fontName']))await figma.loadFontAsync(segment.fontName);}
 if('children' in node)for(const child of node.children)await fonts(child);
}
async function within(id){
 if(!preview)throw new Error('请先创建独立预览');
 const node=id?await figma.getNodeByIdAsync(id):preview;
 let parent=node;while(parent&&parent.id!==preview.id)parent=parent.parent;
 if(!parent||!node)throw new Error('只能编辑本次预览内的节点');return node;
}
async function parentFor(id){const parent=await within(id);if(!('appendChild' in parent)||parent.type==='INSTANCE')throw new Error('请选择可添加内容的预览容器');return parent;}
function geometry(node,args){if('width' in args)node.resize(args.width,args.height);node.x=args.x;node.y=args.y;}
async function run(name,args){
 if(preview&&captured&&figma.currentPage.id!==captured.pageId)await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(captured.pageId));
 if(name==='figma_begin_preview'){
  if(preview)return {id:preview.id};captured=snapshot();previousView={center:figma.viewport.center,zoom:figma.viewport.zoom};
  const source=args.sourceId?await figma.getNodeByIdAsync(args.sourceId):figma.currentPage.selection[0];
  if(source&&!('clone' in source))throw new Error('请选择画板或设计节点');
  // Source identity must come from the current selection or our last result.
  if(args.sourceId&&source?.id!==committed?.id&&!figma.currentPage.selection.some(node=>node.id===source?.id))throw new Error('来源不属于当前选区');
  const root=figma.createFrame();root.name='妥帖 · 预览';root.resize(Math.max(100,source?.width||640),Math.max(100,source?.height||480));
  root.x=source?source.absoluteTransform[0][2]+source.width+80:figma.viewport.center.x;root.y=source?source.absoluteTransform[1][2]:figma.viewport.center.y;
  root.fills=[];preview=root;edits=0;
  try{if(source&&'clone' in source){await fonts(source);const copy=source.clone();root.appendChild(copy);copy.x=0;copy.y=0;}}
  catch(error){root.remove();preview=null;captured=null;throw error;}
  return {id:root.id,nodes:tree(root),originalUnchanged:true};
 }
 if(name==='figma_preview_status'||name==='figma_inspect_preview')return {id:preview?.id,changed:Boolean(preview&&edits),nodes:preview?tree(preview):null};
 if(name==='figma_export_preview'){
  if(!preview)throw new Error('没有预览');const bytes=await preview.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:960}});return {data:figma.base64Encode(bytes),mime:'image/png'};
 }
 if(name==='figma_cancel_preview'){if(preview)preview.remove();preview=null;captured=null;edits=0;if(previousView){figma.viewport.center=previousView.center;figma.viewport.zoom=previousView.zoom;}return {ok:true};}
 if(name==='figma_commit_preview'){
  if(!preview&&committed&&!committed.removed)return {id:committed.id,originalUnchanged:true};
  if(!preview||!edits)throw new Error('预览没有设计修改');committed=preview;committed.name='妥帖 · 设计方案';committedVersion=JSON.stringify(tree(committed));preview=null;captured=null;
  figma.currentPage.selection=[committed];figma.viewport.scrollAndZoomIntoView([committed]);return {id:committed.id,originalUnchanged:true};
 }
 if(name==='figma_undo'){
  if(!committed||committed.removed)throw new Error('没有本次设计');if(JSON.stringify(tree(committed))!==committedVersion)throw new Error('结果已被继续编辑，无法覆盖撤销');
  committed.remove();committed=null;if(previousView){figma.viewport.center=previousView.center;figma.viewport.zoom=previousView.zoom;}return {ok:true};
 }
 let node;
 if(['figma_create_frame','figma_create_rectangle','figma_create_text','figma_add_image'].includes(name)){
  const parent=await parentFor(args.parentId);
  if(name==='figma_create_text'){
   const available=await figma.listAvailableFontsAsync();
   const cjk=/[\u2e80-\u9fff\uf900-\ufaff]/.test(args.text);
   const preferred=cjk?['PingFang SC','Noto Sans SC','Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei','Heiti SC']:['Inter'];
   const font=preferred.map(family=>available.find(entry=>entry.fontName.family===family&&['Regular','Normal','Book'].includes(entry.fontName.style))).find(Boolean)||(cjk?available.find(entry=>/CJK|Hans|SC|Hei|黑体|微软雅黑/.test(entry.fontName.family)):available[0]);
   if(!font)throw new Error('没有可用字体');await figma.loadFontAsync(font.fontName);node=figma.createText();node.fontName=font.fontName;node.characters=args.text;node.fontSize=args.fontSize;
   node.resize(args.width,Math.max(1,node.height));node.textAutoResize='HEIGHT';
  }else{node=name==='figma_create_frame'?figma.createFrame():figma.createRectangle();node.resize(args.width,args.height);}
  parent.appendChild(node);node.x=args.x;node.y=args.y;node.name=args.name||args.text.slice(0,40);
  if(args.color)node.fills=[{type:'SOLID',color:color(args.color)}];
  if(typeof args.cornerRadius==='number')node.cornerRadius=args.cornerRadius;
  if(name==='figma_add_image'){const img=figma.createImage(figma.base64Decode(args.data));node.fills=[{type:'IMAGE',imageHash:img.hash,scaleMode:'FIT'}];}
 }else{
  node=await within(args.nodeId);
  if(name==='figma_set_text'){if(node.type!=='TEXT')throw new Error('该节点不是文字');await fonts(node);node.characters=args.text;}
  else if(name==='figma_set_fill'){if(!('fills' in node))throw new Error('该节点不支持填充');node.fills=[{type:'SOLID',color:color(args.color)}];}
  else if(name==='figma_move_resize')geometry(node,args);
  else throw new Error('没有这个 Figma 操作');
 }
 edits++;return {id:node.id,node:tree(node),applied:false};
}
figma.ui.onmessage=async message=>{
 try{const result=message.kind==='snapshot'?snapshot():await run(message.name,message.args||{});figma.ui.postMessage({id:message.id,result});}
 catch(error){figma.ui.postMessage({id:message.id,error:error.message});}
};
