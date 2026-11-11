import {expect,it} from 'vitest';
import {nativeDropCapture,inputScreenshot} from '../src/native-drop';
import {InputLiveTarget} from '../src/targets/input-live';
import {ContextBuilder} from '../src/agent-core/context-builder';
import type {AppContext,NativeDropContext} from '../src/app-context';

const drop=(extra:Partial<NativeDropContext>={}):NativeDropContext=>({id:crypto.randomUUID(),host:'excel',windowId:123,x:-300,y:250,positioned:true,capturedAt:1000,cellAddress:'B8',...extra});
const focus=(nativeDrop?:NativeDropContext):AppContext=>({appName:'Excel',bundleId:'com.microsoft.Excel',nativeDrop});
it('keeps shortcut capture compatible and accepts finite native coordinates on a negative display',()=>{
 expect(nativeDropCapture(focus(),'excel',1000)).toEqual({});
 const nativeDrop=drop();expect(nativeDropCapture(focus(nativeDrop),'excel',1000)).toEqual({nativeDrop});
});
it('rejects stale, mismatched, unpositioned and malformed drops before a host can capture its old selection',()=>{
 for(const nativeDrop of [drop({capturedAt:-10000}),drop({capturedAt:3000}),drop({host:'word'}),drop({positioned:false}),drop({cellAddress:undefined}),drop({x:NaN}),drop({windowId:0})])
  expect(()=>nativeDropCapture(focus(nativeDrop),'excel',1000)).toThrow();
});
it('allows screenshot-only general drops while still requiring manual text delivery',async()=>{
 const screenshot=inputScreenshot('data:image/jpeg;base64,aGVsbG8=');
 const nativeDrop=drop({host:'input',positioned:false,cellAddress:undefined});
 expect(nativeDropCapture(focus(nativeDrop),'input',1000)).toEqual({nativeDrop});
 let copied='';const target=new InputLiveTarget({id:crypto.randomUUID(),focus:{appName:'微信',bundleId:'com.tencent.xinWeChat',nativeDrop},manual:true,screenshot},text=>{copied=text;});
 const context=await target.read();expect(context.inputDelivery).toBe('clipboard');expect(JSON.stringify(context)).not.toContain('base64');
 const inputs=await new ContextBuilder('/tmp',{} as any).build([],target);expect(inputs.images).toEqual([screenshot]);expect(inputs.sources).toEqual([]);
 target.begin();await target.invoke('prepare_text',{text:'合成文字，不自动发送'});await target.commit();
 expect(copied).toBe('合成文字，不自动发送');expect(target.canUndo).toBe(false);expect(target.exchange(target.capture.id)).toEqual({active:true});
});
it('rejects remote URLs and oversized or malformed target screenshots',()=>{
 for(const value of ['https://example.org/private.png','data:image/svg+xml;base64,abcd','data:image/jpeg;base64,','data:image/jpeg;base64,'+'A'.repeat(2_000_001),{}])expect(()=>inputScreenshot(value)).toThrow();
 expect(inputScreenshot(undefined)).toBeUndefined();
});
