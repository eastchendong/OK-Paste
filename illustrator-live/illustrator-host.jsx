/* ExtendScript / ES3. Only fixed document operations are exposed to CEP. */
var TuotieIllustrator = (function () {
 var anchors={},results={},serial=0;
 var work=new Folder(Folder.userData.fsName+'/Tuotie/runtime/.local/illustrator-live');
 function encode(value){
  if(value===null||value===undefined)return 'null';
  if(typeof value==='string')return '"'+value.replace(/["\\\x00-\x1f\u2028\u2029]/g,function(c){var s=c.charCodeAt(0).toString(16);return '\\u'+('0000'+s).slice(-4);})+'"';
  if(typeof value==='number')return isFinite(value)?String(value):'null';
  if(typeof value==='boolean')return String(value);
  var parts=[],i,key;if(value instanceof Array){for(i=0;i<value.length;i++)parts.push(encode(value[i]));return '['+parts.join(',')+']';}
  for(key in value)if(value.hasOwnProperty(key))parts.push(encode(key)+':'+encode(value[key]));return '{'+parts.join(',')+'}';
 }
 function hash(value){var text=encode(value),n=2166136261,i;for(i=0;i<text.length;i++){n^=text.charCodeAt(i);n+=(n<<1)+(n<<4)+(n<<7)+(n<<8)+(n<<24);}return (n>>>0).toString(16);}
 function array(value){var a=[],i;for(i=0;i<value.length;i++)a.push(value[i]);return a;}
 function rounded(value){return Math.round(Number(value)*10000)/10000;}
 function point(value){return [rounded(value[0]),rounded(value[1])];}
 function color(value){
  if(!value)return null;var o={type:value.typename};
  var keys=['red','green','blue','cyan','magenta','yellow','black','gray','tint','angle','length'];
  for(var i=0;i<keys.length;i++){try{var v=value[keys[i]];if(typeof v==='number')o[keys[i]]=rounded(v);}catch(ignore){}}
  if(value.typename==='SpotColor')o.spot=value.spot.name;
  if(value.typename==='GradientColor'){o.stops=[];for(i=0;i<value.gradient.gradientStops.length;i++){var s=value.gradient.gradientStops[i];o.stops.push({color:color(s.color),ramp:s.rampPoint,opacity:s.opacity});}}
  return o;
 }
 function itemInfo(item){
  var o={id:item.uuid,name:item.name,type:item.typename,bounds:array(item.geometricBounds),opacity:item.opacity,hidden:item.hidden,locked:item.locked,blend:String(item.blendingMode)};
  try{o.parent=item.parent.uuid||item.parent.name;}catch(ignore){}
  if(item.typename==='PathItem'){
   o.closed=item.closed;o.clipping=item.clipping;o.fill=item.filled?color(item.fillColor):null;o.stroke=item.stroked?color(item.strokeColor):null;o.strokeWidth=item.strokeWidth;o.points=[];
   for(var i=0;i<item.pathPoints.length;i++){var p=item.pathPoints[i];o.points.push({anchor:point(p.anchor),left:point(p.leftDirection),right:point(p.rightDirection),type:String(p.pointType)});}
  }else if(item.typename==='TextFrame')o.text=item.contents;
  else if(item.typename==='PlacedItem'){try{o.file=item.file.fsName;}catch(ignore){o.file='unavailable';}}
  return o;
 }
 function collect(items,output,seen){
  for(var i=0;i<items.length;i++){var item=items[i];if(seen[item.uuid])continue;seen[item.uuid]=true;output.push(itemInfo(item));
   if(item.typename==='GroupItem')collect(item.pageItems,output,seen);
   if(item.typename==='CompoundPathItem')collect(item.pathItems,output,seen);
  }
 }
 function scene(doc){
  if(doc.pageItems.length>3000||doc.artboards.length>30)throw Error('第一版支持最多 30 个画板和 3000 个对象，请使用较小的测试稿');
  var boards=[],items=[],points=0,i;
  for(i=0;i<doc.artboards.length;i++)boards.push({name:doc.artboards[i].name,rect:array(doc.artboards[i].artboardRect)});
  collect(doc.pageItems,items,{});
  for(i=0;i<items.length;i++){if(items[i].points)points+=items[i].points.length;if(points>50000)throw Error('文档路径过多，请缩小测试稿');}
  return {name:doc.name,url:documentURL(doc),artboards:boards,items:items};
 }
 function documentURL(doc){try{return doc.fullName.absoluteURI;}catch(ignore){return '';}}
 function getAnchor(id){
  var a=anchors[id];if(!a)throw Error('Illustrator 目标已释放，请重新按 ⌥⌘V');
  try{var board=a.doc.artboards[a.target.artboardIndex];if(board.name!==a.target.name||encode(array(board.artboardRect))!==encode(a.target.rect))throw Error('changed');}
  catch(ignore){throw Error('原文档或目标画板已改变，请重新按 ⌥⌘V');}return a;
 }
 function base64(file){
  file.encoding='BINARY';if(!file.open('r'))throw Error('无法读取画板预览');var data=file.read();file.close();
  if(data.length>2500000)throw Error('画板预览过大');
  var table='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[],i,a,b,c;
  for(i=0;i<data.length;i+=3){a=data.charCodeAt(i);b=data.charCodeAt(i+1);c=data.charCodeAt(i+2);out.push(table.charAt(a>>2)+table.charAt(((a&3)<<4)|(isNaN(b)?0:b>>4))+(isNaN(b)?'=':table.charAt(((b&15)<<2)|(isNaN(c)?0:c>>6)))+(isNaN(c)?'=':table.charAt(c&63)));}return out.join('');
 }
 function previews(a,version,data){
  if(a.previewVersion===version)return a.previews;
  if(!work.exists&&!work.create())throw Error('无法创建本机 Illustrator 工作目录');
  var active=a.doc.artboards.getActiveArtboardIndex(),indices=[a.target.artboardIndex],candidates=[],i,j,output=[];
  for(i=0;i<data.artboards.length;i++)if(i!==a.target.artboardIndex){
   var bounds=data.artboards[i].rect;
   for(j=0;j<data.items.length;j++){var b=data.items[j].bounds;if(!data.items[j].hidden&&b[2]>bounds[0]&&b[0]<bounds[2]&&b[1]>bounds[3]&&b[3]<bounds[1]){candidates.push(i);break;}}
  }
  candidates.sort(function(x,y){return Math.abs(x-a.target.artboardIndex)-Math.abs(y-a.target.artboardIndex);});
  for(i=0;i<candidates.length&&indices.length<3;i++)indices.push(candidates[i]);
  try{for(i=0;i<indices.length;i++){
   var board=a.doc.artboards[indices[i]],r=board.artboardRect,scale=Math.min(100,80000/Math.max(r[2]-r[0],r[1]-r[3]));
   a.doc.artboards.setActiveArtboardIndex(indices[i]);var file=new File(work.fsName+'/'+a.id+'-'+indices[i]+'.png');
   var options=new ExportOptionsPNG24();options.artBoardClipping=true;options.transparency=false;options.horizontalScale=scale;options.verticalScale=scale;
   a.doc.exportFile(file,ExportType.PNG24,options);output.push({artboardIndex:indices[i],dataUrl:'data:image/png;base64,'+base64(file)});
  }}finally{a.doc.artboards.setActiveArtboardIndex(active);}
  a.previewVersion=version;a.previews=output;return output;
 }
 function snapshot(a){var data=scene(a.doc),version=hash(data);return {anchorId:a.id,version:version,document:data,target:a.target,previews:previews(a,version,data)};}
 function capture(){
  if(!app.documents.length)throw Error('请先打开 Illustrator 测试文稿');
  var doc=app.activeDocument,index=doc.artboards.getActiveArtboardIndex(),board=doc.artboards[index];
  var id='anchor-'+new Date().getTime()+'-'+(++serial),a={id:id,doc:doc,target:{artboardIndex:index,name:board.name,rect:array(board.artboardRect)}};
  anchors[id]=a;try{return snapshot(a);}catch(error){delete anchors[id];throw error;}
 }
 function ownInfo(group){var info=[];collect([group],info,{});return hash(info);}
 function retire(result){result.group.remove();try{if(!result.layer.pageItems.length)result.layer.remove();}catch(ignore){}}
 function owned(id,anchorId){var r=results[id];if(!r||r.anchorId!==anchorId)throw Error('结果不属于当前任务');if(ownInfo(r.group)!==r.version)throw Error('生成结果已被手动修改，请保留它并重新开始任务');return r;}
 function ensureVector(doc){
  if(!doc.pageItems.length)throw Error('生成内容没有可编辑对象');
  for(var i=0;i<doc.pageItems.length;i++)if(['PathItem','GroupItem','CompoundPathItem'].join('|').indexOf(doc.pageItems[i].typename)<0)throw Error('生成内容包含不支持的非矢量对象');
 }
 function apply(args){
  var a=getAnchor(args.anchorId);
  if(hash(scene(a.doc))!==args.expectedVersion)throw Error('文档已改变，请重新生成');
  if(!/^[a-f0-9-]{36}$/.test(args.taskId))throw Error('任务编号无效');
  var previous=args.replaceResultId?owned(args.replaceResultId,a.id):null;
  var file=new File(args.svgPath),prefix=work.fsName+'/';
  if(file.fsName.indexOf(prefix)!==0||file.name!==args.taskId+'.svg'||!file.exists)throw Error('矢量文件不属于本机任务');
  var imported=null,layer=null,group=null,oldInteraction=app.userInteractionLevel;
  try{
   app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS;
   imported=app.open(file);ensureVector(imported);
   layer=a.doc.layers.add();layer.name='妥帖 · '+args.taskId;group=layer.groupItems.add();group.name='妥帖生成结果';group.note='tuotie:'+args.taskId;
   for(var i=0;i<imported.layers.length;i++){
    var items=imported.layers[i].pageItems;
    for(var j=0;j<items.length;j++)if(items[j].parent===imported.layers[i])items[j].duplicate(group,ElementPlacement.PLACEATEND);
   }
   var b=group.geometricBounds,r=a.target.rect,w=b[2]-b[0],h=b[1]-b[3];if(w<=0||h<=0)throw Error('矢量作品没有有效尺寸');
   var percent=Math.min((r[2]-r[0])*.82/w,(r[1]-r[3])*.82/h)*100;
   group.resize(percent,percent,true,true,true,true,percent,Transformation.CENTER);
   b=group.geometricBounds;group.position=[r[0]+((r[2]-r[0])-(b[2]-b[0]))/2,r[1]-((r[1]-r[3])-(b[1]-b[3]))/2];
   var result={anchorId:a.id,group:group,layer:layer,version:ownInfo(group)};
   // The old result stays intact until the replacement has imported and fitted.
   if(previous){retire(previous);delete results[args.replaceResultId];}
   results[args.taskId]=result;a.previewVersion='';try{a.doc.activate();app.redraw();}catch(ignore){}return {resultId:args.taskId};
  }catch(error){if(layer)try{layer.remove();}catch(ignore){}throw error;}
  finally{if(imported)try{imported.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}app.userInteractionLevel=oldInteraction;}
 }
 function undo(args){var a=getAnchor(args.anchorId),r=owned(args.resultId,a.id);retire(r);delete results[args.resultId];a.previewVersion='';app.redraw();return {undone:true};}
 function release(args){delete anchors[args.anchorId];for(var id in results)if(results[id].anchorId===args.anchorId)delete results[id];return {released:true};}
 return {dispatch:function(method,args){try{
  args=args||{};var value;
  if(method==='info')value={url:app.documents.length?documentURL(app.activeDocument):'',version:app.version};
  else if(method==='capture')value=capture();
  else if(method==='read')value=snapshot(getAnchor(args.anchorId));
  else if(method==='apply')value=apply(args);
  else if(method==='undo')value=undo(args);
  else if(method==='release')value=release(args);
  else throw Error('没有这个 Illustrator 操作');
  return encode({ok:true,result:value});
 }catch(error){return encode({ok:false,error:error.message||String(error)});}}};
})();
