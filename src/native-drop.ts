import {z} from 'zod';
import type {AppContext} from './app-context';

const Drop=z.object({id:z.uuid(),host:z.enum(['word','excel','powerpoint','figma','input']),
 windowId:z.number().int().positive(),x:z.number().finite().min(-100000).max(100000),y:z.number().finite().min(-100000).max(100000),
 positioned:z.boolean(),capturedAt:z.number().finite(),cellAddress:z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/).optional()}).strict();

/** A native release chooses the position; a previous selection is never a fallback. */
export function nativeDropCapture(focus:AppContext,host:string,now=Date.now()){
 if(focus.nativeDrop===undefined)return {};
 const result=Drop.safeParse(focus.nativeDrop);
 if(!result.success)throw new Error('拖放位置无效，请重新拖入');
 const drop=result.data;
 if(drop.host!==host||drop.capturedAt>now+1000||now-drop.capturedAt>10000)throw new Error('拖放位置已过期或应用不匹配，请重新拖入');
 if(host!=='input'&&!drop.positioned)throw new Error('尚未确认实际落点，未使用原选区');
 if(host==='excel'&&!drop.cellAddress)throw new Error('没有确认实际落点单元格');
 return {nativeDrop:drop};
}

export function inputScreenshot(value:unknown):string|undefined {
 if(value===undefined)return undefined;
 if(typeof value!=='string'||value.length>2_000_000||!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('目标截图无效或过大');
 return value;
}
