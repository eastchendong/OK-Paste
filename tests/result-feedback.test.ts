import {expect,it} from 'vitest';
import {resultFeedback,type ResultReceipt} from '../src/result-feedback/protocol';
it('does not manufacture an insertion event for a clipboard handoff',()=>{
 expect(resultFeedback('input-live',undefined,'copy')).toBeNull();
});
it('keeps cleared cells locatable but rejects partial or invalid host geometry without failing a committed write',()=>{
 expect(resultFeedback('excel-live',{documentId:'book',revision:2,locators:[{kind:'cell',address:'B3',text:''}]},'clear')?.available).toBe(true);
 for(const bad of [null,{}, {documentId:'x',revision:1,locators:[{kind:'surface',size:{width:900,height:600},regions:[{x:0.9,y:0,width:0.2,height:1}]}]}, {documentId:'x',revision:1,locators:[{kind:'text',text:'actual'}, {kind:'text',text:''}]}]) {
  expect(()=>resultFeedback('word-live',bad as ResultReceipt,'write')).not.toThrow();
  const event=resultFeedback('word-live',bad as ResultReceipt,'write');
  if(event)expect(event).toMatchObject({available:false,receipt:{locators:[]}});
 }
});
it('carries host identities and text context without treating them as pixel coordinates',()=>{
 const event=resultFeedback('word-live',{documentId:'tracked-range',revision:3,locators:[{kind:'text',text:'new',before:'unchanged prefix ',after:' suffix'}]},'task:3');
 expect(event).toMatchObject({id:'task:3',phase:'done',coordinateSpace:'native-result-locators',available:true,receipt:{revision:3}});
 expect(event).not.toHaveProperty('regions');
});
