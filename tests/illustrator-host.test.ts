import fs from 'node:fs';
import vm from 'node:vm';
import {expect,it} from 'vitest';

// Host contract tests exercise the actual JSX against a small document model.
// They do not substitute for loading the script inside real Illustrator.
function sandbox(){
 let serial=0;
 class Item {
  uuid=`item-${++serial}`;name='shape';opacity=100;hidden=false;locked=false;blendingMode='normal';geometricBounds=[0,100,100,0];
  closed=true;clipping=false;filled=true;fillColor={typename:'RGBColor',red:20,green:100,blue:120};stroked=false;strokeWidth=0;
  pathPoints=[{anchor:[0,0],leftDirection:[0,0],rightDirection:[0,0],pointType:'corner'}];pageItems:Item[]=[];note='';position:number[]=[];
  constructor(public typename:string,public parent:any){parent.pageItems.push(this);}
  duplicate(parent:any){const copy=new Item(this.typename,parent);copy.name=this.name;copy.opacity=this.opacity;for(const child of this.pageItems)child.duplicate(copy);return copy;}
  resize(){}
  remove(){this.parent.pageItems.splice(this.parent.pageItems.indexOf(this),1);}
 }
 class Layer {
  name='layer';pageItems:Item[]=[];groupItems={add:()=>new Item('GroupItem',this)};
  constructor(public doc:Doc){doc.layers.push(this);}
  remove(){this.doc.layers.splice(this.doc.layers.indexOf(this),1);}
 }
 class Doc {
  name='fixture.ai';fullName={absoluteURI:'file:///fixture.ai'};layers:Layer[]&{add?:()=>Layer}=[];active=2;
  artboards:any=Array.from({length:3},(_,i)=>({name:`board-${i}`,artboardRect:[i*340,300,i*340+300,0]}));
  constructor(){
   this.layers.add=()=>new Layer(this);
   this.artboards.getActiveArtboardIndex=()=>this.active;this.artboards.setActiveArtboardIndex=(n:number)=>{this.active=n;};
   new Item('PathItem',new Layer(this)).name='original bottle';new Item('PathItem',new Layer(this)).name='original cup';
  }
  get pageItems(){const output:Item[]=[];const walk=(list:Item[])=>{for(const i of list){output.push(i);walk(i.pageItems);}};for(const l of this.layers)walk(l.pageItems);return output;}
  exportFile(){}activate(){}close(){}
 }
 const doc=new Doc();
 const app={documents:[doc],activeDocument:doc,version:'30.1',userInteractionLevel:'normal',redraw(){},open(){
  const imported=new Doc();imported.layers.splice(0);const layer=new Layer(imported),group=new Item('GroupItem',layer);new Item('PathItem',group);return imported;
 }};
 class Folder {static userData={fsName:'/user-data'};fsName:string;exists=true;constructor(name:string){this.fsName=name;}create(){return true;}}
 class File {fsName:string;name:string;exists=true;encoding='';constructor(name:string){this.fsName=name;this.name=name.split('/').at(-1)!;}open(){return true;}read(){return 'PNG';}close(){}}
 const context=vm.createContext({app,Folder,File,ExportOptionsPNG24:function(){},ExportType:{PNG24:1},UserInteractionLevel:{DONTDISPLAYALERTS:1},ElementPlacement:{PLACEATEND:1},Transformation:{CENTER:1},SaveOptions:{DONOTSAVECHANGES:1}});
 vm.runInContext(fs.readFileSync(new URL('../illustrator-live/illustrator-host.jsx',import.meta.url),'utf8'),context);
 const call=(method:string,args:unknown={})=>JSON.parse(vm.runInContext(`TuotieIllustrator.dispatch(${JSON.stringify(method)},${JSON.stringify(args)})`,context));
 const taskId='abcde000-0000-4000-8000-000000000001';
 const capture=()=>call('capture').result;
 const apply=(snapshot:any)=>call('apply',{anchorId:snapshot.anchorId,expectedVersion:snapshot.version,taskId,svgPath:`/user-data/Tuotie/runtime/.local/illustrator-live/${taskId}.svg`});
 return {doc,app,call,capture,apply,taskId,Item};
}
it('adds only a new result to the original document even when the active document changes',()=>{
 const s=sandbox(),before=s.doc.pageItems.map(i=>[i.uuid,i.name,i.opacity]);const capture=s.capture();
 s.app.activeDocument={name:'another.ai'}as any;
 expect(s.apply(capture)).toMatchObject({ok:true,result:{resultId:s.taskId}});
 expect(s.doc.pageItems.slice(0,2).map(i=>[i.uuid,i.name,i.opacity])).toEqual(before);
 expect(s.call('undo',{anchorId:capture.anchorId,resultId:s.taskId}).ok).toBe(true);
 expect(s.doc.pageItems.map(i=>[i.uuid,i.name,i.opacity])).toEqual(before);
});
it('rejects stale document versions before importing or adding objects',()=>{
 const s=sandbox(),capture=s.capture();s.doc.pageItems[0].opacity=50;
 expect(s.apply(capture)).toMatchObject({ok:false});expect(s.doc.pageItems).toHaveLength(2);
});
it('undo preserves user additions outside the generated group, including additions to its layer',()=>{
 const s=sandbox(),capture=s.capture();expect(s.apply(capture).ok).toBe(true);
 const layer=s.doc.layers.at(-1)!;const userShape=new s.Item('PathItem',layer);userShape.name='user addition';
 expect(s.call('undo',{anchorId:capture.anchorId,resultId:s.taskId}).ok).toBe(true);
 expect(s.doc.pageItems.map(i=>i.name)).toContain('user addition');expect(s.doc.pageItems).toHaveLength(3);
});
it('undo refuses to remove a result whose nested path has been manually edited',()=>{
 const s=sandbox(),capture=s.capture();expect(s.apply(capture).ok).toBe(true);
 const nested=s.doc.pageItems.at(-1)!;nested.opacity=31;
 expect(s.call('undo',{anchorId:capture.anchorId,resultId:s.taskId})).toMatchObject({ok:false});expect(s.doc.pageItems).toHaveLength(5);
});
