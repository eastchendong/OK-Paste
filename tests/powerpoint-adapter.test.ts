import {expect,it} from 'vitest';
import {createPowerPointAdapter} from '../office-live/powerpoint-adapter.js';

function host(){
 let next=10,failAfterInsert=false;let selected=['old','slot','text'];
 const items:any[]=[];
 function add(id:string,type:string,text='',image=''){
  const shape:any={id,type,name:id,left:20,top:30,width:100,height:80,rotation:0,image,
   textFrame:{textRange:{text,load(){},font:{name:'PingFang SC',size:20,bold:false,italic:false,underline:'None',color:'#000000',allCaps:false,doubleStrikethrough:false,smallCaps:false,strikethrough:false,subscript:false,superscript:false,load(){}}}},delete(){items.splice(items.indexOf(shape),1);},setZOrder(){items.splice(items.indexOf(shape),1);items.push(shape);}};
  let textValue=text;
  Object.defineProperty(shape.textFrame.textRange,'text',{get:()=>textValue,set:(value:string)=>{textValue=value;shape.textFrame.textRange.font.name='默认中文字体';},enumerable:true});
  Object.defineProperty(shape,'zOrderPosition',{get:()=>items.indexOf(shape)});items.push(shape);return shape;
 }
 add('kept','Image','','unchanged');add('old','Image','','original');add('slot','GeometricShape');add('text','TextBox','原有标题');
 const shapes={get items(){return items;},load(){},getItem(id:string){const shape=items.find(x=>x.id===id);if(!shape)throw new Error('missing shape');return shape;}};
 const slide={id:'page',shapes,getImageAsBase64(){return {get value(){return Buffer.from(JSON.stringify(items.map(({id,name,type,left,top,width,height,rotation,image,textFrame})=>({id,name,type,left,top,width,height,rotation,image,text:textFrame.textRange.text})))).toString('base64');}};}};
 const slides={items:[slide],load(){},getItem(id:string){if(id!=='page')throw new Error('missing slide');return slide;}};
 const PowerPoint={run:async(work:any)=>work({presentation:{slides,getSelectedSlides:()=>slides,getSelectedShapes:()=>({items:selected.map(id=>shapes.getItem(id)),load(){}}),setSelectedSlides(){}},sync:async()=>{}})};
 const Office={AsyncResultStatus:{Succeeded:'ok'},FileType:{Compressed:'compressed'},CoercionType:{Image:'image'},context:{document:{
  getFileAsync(_type:any,_options:any,done:any){done({status:'ok',value:{size:4,sliceCount:1,getSliceAsync(_index:any,callback:any){callback({status:'ok',value:{data:[80,75,3,4]}});},closeAsync(callback:any){callback({status:'ok'});}}});},
  setSelectedDataAsync(base64:string,options:any,done:any){const shape=add(String(next++),'Image','',base64);Object.assign(shape,{left:options.imageLeft,top:options.imageTop,width:options.imageWidth,height:options.imageHeight});done(failAfterInsert?{status:'failed',error:{message:'receipt lost'}}:{status:'ok'});}
 }}};
 return {execute:createPowerPointAdapter(PowerPoint,Office),items,shapes,setFail:()=>{failAfterInsert=true;},select:(ids:string[])=>{selected=ids;}};
}
const image=(shapeId:string,base64:string,retainOriginal=false)=>({shapeId,name:shapeId,left:20,top:30,width:100,height:80,rotation:0,base64,retainOriginal});

it('captures the current page without selecting objects, but never grants page-wide write access',async()=>{
 const h=host();h.select([]);
 const state=await h.execute('capture');
 expect(state).toMatchObject({captureScope:'page',selectedShapeIds:[],slideId:'page'});
 expect(state.shapes).toHaveLength(4);
 await expect(h.execute('apply',{anchorId:state.anchorId,expectedRevision:0,expectedVersion:state.version,images:[image('old','A')]})).rejects.toMatchObject({mutationStarted:false});
 expect(h.shapes.getItem('old').image).toBe('original');
});
it('host replaces two image revisions and text, remaps recreated IDs, and restores V1 then V0',async()=>{
 const h=host(),initial=await h.execute('capture'),anchorId=initial.anchorId;
 const first=await h.execute('apply',{anchorId,expectedVersion:initial.version,expectedRevision:0,images:[image('old','A'),image('slot','B',true)],texts:[{shapeId:'text',text:'第一版标题'}]});
 expect(first.revision).toBe(1);expect(h.shapes.getItem('kept').image).toBe('unchanged');
 const a=first.mappings[0].newId,b=first.mappings[1].newId;
 const current=await h.execute('read',{anchorId});
 h.select(['kept']);
 await h.execute('apply',{anchorId,expectedVersion:current.version,expectedRevision:1,images:[image(a,'A2'),image(b,'B2')],texts:[{shapeId:'text',text:'第二版标题'}]});
 expect(h.shapes.getItem('text').textFrame.textRange.text).toBe('第二版标题');
 const restored=await h.execute('undo',{anchorId,expectedRevision:2,images:[image(a,'A'),image(b,'B')]});
 expect(restored.revision).toBe(1);expect(h.shapes.getItem('text').textFrame.textRange.text).toBe('第一版标题');
 expect(restored.mappings.map((m:any)=>h.shapes.getItem(m.newId).image)).toEqual(['A','B']);
 await h.execute('undo',{anchorId,expectedRevision:1,images:[image('old','original')]});
 expect(h.items.map(x=>x.type)).toEqual(['Image','Image','GeometricShape','TextBox']);
 expect(h.items.map(x=>x.textFrame.textRange.text)).toEqual(['','','','原有标题']);
 expect(h.items[0].id).toBe('kept');expect(h.items[1].image).toBe('original');expect(h.items[2].id).toBe('slot');
 expect(h.shapes.getItem('text').textFrame.textRange.font.name).toBe('PingFang SC');
});

it('pre-write conflicts, duplicate revision and manual editing are rejected without mutating',async()=>{
 const h=host(),initial=await h.execute('capture'),anchorId=initial.anchorId;
 await expect(h.execute('apply',{anchorId,expectedVersion:'stale',expectedRevision:0,images:[image('old','A')]})).rejects.toMatchObject({mutationStarted:false});
 await h.execute('apply',{anchorId,expectedVersion:initial.version,expectedRevision:0,images:[],texts:[{shapeId:'text',text:'第一版'}]});
 await expect(h.execute('apply',{anchorId,expectedVersion:initial.version,expectedRevision:0,images:[image('old','A')]})).rejects.toMatchObject({mutationStarted:false});
 h.shapes.getItem('text').textFrame.textRange.text='用户手动修改';
 await expect(h.execute('undo',{anchorId,expectedRevision:1,images:[]})).rejects.toMatchObject({mutationStarted:false});
 expect(h.shapes.getItem('text').textFrame.textRange.text).toBe('用户手动修改');
});

it('a lost insertion receipt freezes the host and cannot be replayed',async()=>{
 const h=host(),initial=await h.execute('capture'),anchorId=initial.anchorId;h.setFail();
 await expect(h.execute('apply',{anchorId,expectedVersion:initial.version,expectedRevision:0,images:[image('old','A')]})).rejects.toMatchObject({mutationStarted:true});
 const count=h.items.length;
 await expect(h.execute('apply',{anchorId,expectedVersion:initial.version,expectedRevision:0,images:[image('old','A')]})).rejects.toMatchObject({mutationStarted:false});
 expect(h.items.length).toBe(count);expect(h.shapes.getItem('old').image).toBe('original');
});
it('rejects mixed live fonts before writing instead of flattening them',async()=>{
 const h=host();h.shapes.getItem('text').textFrame.textRange.font.name=null;
 const initial=await h.execute('capture');
 await expect(h.execute('apply',{anchorId:initial.anchorId,expectedRevision:0,expectedVersion:initial.version,texts:[{shapeId:'text',text:'不能破坏字体'}]})).rejects.toMatchObject({mutationStarted:false});
 expect(h.shapes.getItem('text').textFrame.textRange.text).toBe('原有标题');
});
