/** Real-model smoke check: synthetic PNGs and facts only, no Figma host writes. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {deflateSync} from 'node:zlib';
import {recommend} from '../src/agent-core/recommendations/core.mjs';
import {deepseekComplete} from '../src/agent-core/recommendations/deepseek.mjs';
import {FollowupRecommender} from '../src/agent-core/followup-recommendations';
import {captureFollowupBaseline} from '../src/agent-core/followup-scope';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),configRoot=process.env.TUOTIE_MODEL_CONFIG_ROOT||root;
const apiKey=JSON.parse(fs.readFileSync(path.join(configRoot,'.local/recommendations-config.json'),'utf8')).apiKey;
// Minimal fixture renderer. These are schematic synthetic illustrations, never claimed as photographs.
function chunk(name:string,data:Buffer){const kind=Buffer.from(name),body=Buffer.concat([kind,data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,checksum]);}
function png(shapes:any[]){
 const size=200,stride=size*3+1,pixels=Buffer.alloc(stride*size,255);
 for(let y=0;y<size;y++){pixels[y*stride]=0;for(let x=0;x<size;x++)for(const s of shapes){
  const ellipse=s.type==='ellipse',inside=ellipse?((x-s.cx)/s.rx)**2+((y-s.cy)/s.ry)**2<=1:x>=s.x&&x<=s.x+s.width&&y>=s.y&&y<=s.y+s.height;
  if(!inside)continue;
  const inset=s.strokeWidth||0,inner=ellipse?((x-s.cx)/Math.max(1,s.rx-inset))**2+((y-s.cy)/Math.max(1,s.ry-inset))**2<=1:x>=s.x+inset&&x<=s.x+s.width-inset&&y>=s.y+inset&&y<=s.y+s.height-inset;
  const color=inner?s.fill:s.stroke;if(!color||color==='none')continue;
  for(let c=0;c<3;c++)pixels[y*stride+1+x*3+c]=parseInt(color.slice(1+c*2,3+c*2),16);
 }}
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const rect=(name:string,x:number,y:number,width:number,height:number,fill='#b7dfd8',stroke='#245858')=>({type:'rect',name,group:name,x,y,width,height,rx:6,fill,stroke,strokeWidth:4,opacity:1});
const oval=(name:string,cx:number,cy:number,rx:number,ry:number,fill='#b7dfd8',stroke='#245858')=>({type:'ellipse',name,group:name,cx,cy,rx,ry,fill,stroke,strokeWidth:4,opacity:1});
const bottle=[rect('瓶身',62,62,76,110),rect('瓶颈',84,34,32,28),rect('瓶塞',80,24,40,16,'#d6b785'),oval('左眼',86,110,3,4,'#245858'),oval('右眼',114,110,3,4,'#245858'),oval('嘴',100,128,8,4,'#245858')];
const icon=[oval('时钟轮廓',100,100,65,65,'none'),rect('时针',96,64,8,38,'#245858'),rect('分针',100,94,32,8,'#245858')];
const empty=[rect('空盒',55,100,90,55),oval('搜索圈',115,74,35,35,'none'),rect('手柄',140,96,12,40,'#245858'),oval('装饰点',40,50,6,6),oval('装饰点',166,54,4,4)];
const samples=[
 {scene:'vector-character' as const,name:'03 新玻璃瓶角色',brief:'将这张玻璃瓶轮廓示意作为主体参考，按旁边瓶子/杯子IP的粗青绿描边、柔和色块和小五官，补一个同系列角色。',reference:'已有瓶子与杯子拟人角色，青绿粗描边，柔和色块，小五官；仅作样式参照。',shapes:bottle,request:'按现有系列生成玻璃瓶角色，保留瓶塞辨识特征，风格与旁边一致。'},
 {scene:'vector-icon' as const,name:'缺少历史记录图标',brief:'功能含义为历史记录，需要补一个图标。沿用现有单色线性图标组，不增加五官。',reference:'已有收藏、下载等单色线性图标，青绿描边、圆润轮廓。',shapes:icon,request:'补一个同风格历史记录图标，保持线性风格和当前尺寸。'},
 {scene:'vector-empty-state' as const,name:'搜索无结果插画',brief:'用户搜索没有匹配结果，需要一张空状态插画，不是断网或错误。不要文案或按钮。',reference:'已有无收藏等空状态插画，以盒子等简单物体、青绿描边和浅绿填色为主。',shapes:empty,request:'生成同产品风格的搜索无结果插画，保持原业务状态，不加文字和按钮。'},
];
const followup=new FollowupRecommender(configRoot),results=[];
for(const sample of samples){
 const referenceImage=png(sample.shapes),currentImage=png(sample.shapes),artwork={width:200,height:200,shapes:sample.shapes};
 const initial=await recommend({sources:[{id:'brief',kind:'text',text:sample.brief},{id:'source-image',kind:'image',title:'合成轮廓示意',image:referenceImage}],target:{app:'Figma',scenario:'vector-artwork',location:sample.name,nearbyText:sample.reference,documentText:sample.reference,screenshot:png([]),referenceImages:[referenceImage],capabilities:['vector']}},{complete:deepseekComplete(apiKey),signal:AbortSignal.timeout(8000)});
 if(initial.recommendation.scene!==sample.scene)throw new Error('首轮目的未识别：'+sample.scene);
 const context={kind:'figma-live',target:{nodeId:'target',name:sample.name,width:200,height:200},document:{scope:'current-page',items:[{name:sample.reference}]},currentArtwork:artwork,revision:1,capabilities:{addEditableVectors:true,editExistingObjects:false,visualReview:true}};
 const start=Date.now(),second=await followup.suggest({intent:{title:initial.recommendation.text,writingScene:initial.recommendation.scene},currentResult:JSON.stringify(artwork),context,baseline:captureFollowupBaseline({...context,currentArtwork:null,revision:0}),sources:[{id:'brief',type:'text',body:{text:sample.brief}}],images:[currentImage,referenceImage],imageRoles:['current-committed-frame','frozen-reference-frame'],conversation:[{role:'user',text:sample.request}],tools:[{name:'prepare_figma_artwork',description:'只改本任务矢量作品',inputSchema:{}},{name:'review_figma_artwork',description:'看图校验',inputSchema:{}}]},new AbortController().signal);
 if(second.scene!==sample.scene)throw new Error('二轮目的未识别：'+sample.scene);
 const result={scene:sample.scene,initial,followupMs:Date.now()-start,followup:second};results.push(result);console.log(JSON.stringify(result));
}
fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.writeFileSync(path.join(root,'.local/figma-recommendation-smoke.json'),JSON.stringify({synthetic:true,hostWrites:false,at:new Date().toISOString(),results},null,2));
