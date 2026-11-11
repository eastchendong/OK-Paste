import {afterEach,expect,it,vi} from 'vitest';
import {Window} from 'happy-dom';
import {createWordAdapter,wordImageLocators} from '../office-live/word-adapter.js';
const xml=(text:string)=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
const windows:Window[]=[];afterEach(()=>{vi.unstubAllGlobals();for(const w of windows.splice(0))w.close();});
function setup(){
 const window=new Window();windows.push(window);vi.stubGlobal('DOMParser',window.DOMParser);
 let owned='',outside='原文',writes=0,failWrite=false,failSync=false;
 const tracked=new Set<Range>(),marked=new Set<Range>();
 let selected:Range;
 class Range{
  isEmpty=true;text='';load(){if(this!==range)this.text=owned.replace(/<[^>]*>/g,'');}track(){tracked.add(this);}untrack(){tracked.delete(this);}
  highlight(){marked.add(this);}removeHighlight(){marked.delete(this);}
  getRange(){return this;}expandTo(){return this;}getOoxml(){return {value:owned};}
  insertText(text:string,location:string){return this.insertOoxml(xml(text),location);}
  insertOoxml(content:string,location:string){expect(['Before','Replace']).toContain(location);writes++;owned=content;if(failWrite)failSync=true;return new Range();}
  delete(){writes++;owned='';}
 }
 const range=new Range(),body={text:outside,paragraphs:{items:[{text:outside,style:'Normal'}],load(){}},load(){},getRange:()=>range,getOoxml:()=>({value:xml(outside)+owned})};
 // Use one well-formed package for the full body and a separate owned-range XML.
 body.getOoxml=()=>({value:xml(outside+owned.replace(/<[^>]*>/g,''))});
 selected=range;
 const context={document:{body,getSelection:()=>selected},sync:async()=>{if(failSync){failSync=false;throw new Error('Word sync failed');}}};
 const execute=createWordAdapter({run:async(first:any,second?:any)=>(second||first)(context)});
 return {execute,tracked,marked,moveCaret:()=>selected=new Range(),get owned(){return owned;},get writes(){return writes;},get outside(){return outside;},editOwned:(value:string)=>{owned=xml(value);},editOutside:()=>{outside='用户改了别处';},setPrefix:(value:string)=>{range.text=value;},fail:()=>{failWrite=true;}};
}
it('replaces only the owned range and undoes V2 → V1 → V0, preserving edits elsewhere',async()=>{
 const h=setup(),capture=await h.execute('capture'),anchorId=capture.anchorId;
 await h.execute('insert',{anchorId,expectedRevision:0,expectedOoxml:capture.bodyOoxml,text:'第一版'});
 const first=h.owned;const current=await h.execute('read',{anchorId});
 await h.execute('insert',{anchorId,expectedRevision:1,expectedOoxml:current.bodyOoxml,text:'第二版'});
 expect(h.writes).toBe(2);h.editOutside();
 await h.execute('undo',{anchorId,expectedRevision:2});expect(h.owned).toBe(first);expect(h.outside).toBe('用户改了别处');
 await h.execute('undo',{anchorId,expectedRevision:1});expect(h.owned).toBe('');expect(h.outside).toBe('用户改了别处');
 await h.execute('release',{anchorId});expect(h.tracked.size).toBe(0);
});
it('rejects stale whole-document versions, duplicate commands and manual edits to the owned range before writing',async()=>{
 const h=setup(),capture=await h.execute('capture'),anchorId=capture.anchorId;
 const command={anchorId,expectedRevision:0,expectedOoxml:capture.bodyOoxml,text:'第一版'};
 await h.execute('insert',command);await expect(h.execute('insert',command)).rejects.toMatchObject({mutationStarted:false});
 const before=await h.execute('read',{anchorId});h.editOutside();
 await expect(h.execute('insert',{...command,expectedRevision:1,expectedOoxml:before.bodyOoxml})).rejects.toThrow('文档内容或格式');
 h.editOwned('手工修改');const current=await h.execute('read',{anchorId});
 await expect(h.execute('insert',{...command,expectedRevision:1,expectedOoxml:current.bodyOoxml})).rejects.toThrow('不能覆盖');
 await expect(h.execute('undo',{anchorId,expectedRevision:1})).rejects.toThrow('继续编辑');expect(h.writes).toBe(1);
});
it('freezes an uncertain mutation instead of retrying it or reporting the old version as intact',async()=>{
 const h=setup(),capture=await h.execute('capture'),anchorId=capture.anchorId;
 const command={anchorId,expectedRevision:0,expectedOoxml:capture.bodyOoxml,text:'候选'};h.fail();
 await expect(h.execute('insert',command)).rejects.toMatchObject({mutationStarted:true});
 await expect(h.execute('insert',command)).rejects.toThrow('未确认');expect(h.writes).toBe(1);
});
it('checks the actual owned-range start before rich replacement, protecting a newly prepended paragraph prefix',async()=>{
 const h=setup(),before=await h.execute('capture'),anchorId=before.anchorId;
 await h.execute('insert',{anchorId,expectedRevision:0,expectedOoxml:before.bodyOoxml,text:'标题',ooxml:xml('标题')});
 h.setPrefix('手动加在同一段前面的内容');const fresh=await h.execute('read',{anchorId});
 await expect(h.execute('insert',{anchorId,expectedRevision:1,expectedOoxml:fresh.bodyOoxml,text:'新版标题',ooxml:xml('新版标题')})).rejects.toMatchObject({mutationStarted:false});
 expect(h.writes).toBe(1);
});

it('keeps revisions on the owned insertion without drawing product feedback inside Word',async()=>{
 const h=setup(),capture=await h.execute('capture'),anchorId=capture.anchorId;
 const insert=async(text:string,revision:number)=>h.execute('insert',{anchorId,expectedRevision:revision,expectedOoxml:(await h.execute('read',{anchorId})).bodyOoxml,text});
 await insert('第二节中的完整活动安排',0);
 expect(h.marked.size).toBe(0);
 h.moveCaret();
 await insert('活动安排',1);
 expect(h.marked.size).toBe(0);expect(h.owned).toBe(xml('活动安排'));
 await h.execute('undo',{anchorId,expectedRevision:2});
 expect(h.marked.size).toBe(0);expect(h.owned).toBe(xml('第二节中的完整活动安排'));
 await h.execute('release',{anchorId});
 expect(h.marked.size).toBe(0);expect(h.tracked.size).toBe(0);
});

it('reports the actual changed text and context for first write, refinement and surrogate pairs',async()=>{
 const h=setup(),capture=await h.execute('capture'),anchorId=capture.anchorId;
 const insert=async(text:string,revision:number)=>h.execute('insert',{anchorId,expectedRevision:revision,expectedOoxml:(await h.execute('read',{anchorId})).bodyOoxml,text});
 const first=await insert('你好😀，欢迎参加活动。',0);
 expect(first.resultReceipt).toMatchObject({documentId:anchorId,revision:1,locators:[{kind:'text',text:'你好😀，欢迎参加活动。',before:'',after:''}]});
 const second=await insert('你好😁，欢迎参加活动。',1);
 expect(second.resultReceipt.locators).toEqual([{kind:'text',text:'😁',before:'你好',after:'，欢迎参加活动。'}]);
 const unchanged=await insert('你好😁，欢迎参加活动。',2);
 expect(unchanged.resultReceipt.locators).toEqual([]);
});
it('uses host-exported embedded image bytes rather than model labels as positioning templates',()=>{
 setup();
 const source='<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png"><pkg:binaryData>YWJj\nZA==</pkg:binaryData></pkg:part></pkg:package>';
 expect(wordImageLocators(source)).toEqual([{kind:'rendered-surface',scope:'document',image:'YWJjZA==',regions:[{x:0,y:0,width:1,height:1}]}]);
 expect(wordImageLocators('<broken>')).toEqual([]);
});
