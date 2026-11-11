/** Host-confirmed identities, never model-estimated screen coordinates. */
export type ResultLocator =
 | {kind:'text';text:string;before?:string;after?:string}
 | {kind:'cell';address:string;text:string}
 | {kind:'element';name:string}
 | {kind:'rendered-surface';scope?:'document';image:string;regions:{x:number;y:number;width:number;height:number}[]}
 | {kind:'surface';size:{width:number;height:number};regions:{x:number;y:number;width:number;height:number}[]};
export interface ResultReceipt {documentId:string;revision:number;locators:ResultLocator[];reason?:string}
export interface ResultFeedback {id:string;phase:'done';available:boolean;capturedAt:number;coordinateSpace:'native-result-locators';targetKind:string;receipt:ResultReceipt;reason?:string}
function valid(value:unknown):value is ResultLocator {
 if(!value||typeof value!=='object')return false;
 const l=value as ResultLocator;
 if(l.kind==='text')return typeof l.text==='string'&&Boolean(l.text.trim())&&l.text.length<=100000&&[l.before,l.after].every(v=>v===undefined||typeof v==='string'&&v.length<=100000);
 if(l.kind==='cell')return typeof l.address==='string'&&/^\$?[A-Z]+\$?[1-9][0-9]*$/i.test(l.address)&&typeof l.text==='string';
 if(l.kind==='element')return typeof l.name==='string'&&Boolean(l.name.trim());
 if(l.kind==='rendered-surface')return (l.scope===undefined||l.scope==='document')&&typeof l.image==='string'&&l.image.length<8000000&&/^[A-Za-z0-9+/=]+$/.test(l.image)&&Array.isArray(l.regions)&&l.regions.length>0&&l.regions.length<=100&&l.regions.every(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1&&r.y+r.height<=1);
 return l.kind==='surface'&&l.size&&Number.isFinite(l.size.width)&&l.size.width>0&&Number.isFinite(l.size.height)&&l.size.height>0&&Array.isArray(l.regions)&&l.regions.length>0&&l.regions.length<=100&&l.regions.every(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1&&r.y+r.height<=1);
}
/** Rendering metadata must never turn an acknowledged successful write into an error. */
export function resultFeedback(kind:string,receipt:ResultReceipt|undefined,id:string):ResultFeedback|null {
 if(!receipt)return null;
 const usable=typeof receipt.documentId==='string'&&Boolean(receipt.documentId)&&Number.isInteger(receipt.revision)&&receipt.revision>=0&&Array.isArray(receipt.locators)&&receipt.locators.length>0&&receipt.locators.length<=100&&receipt.locators.every(valid);
 const safe:ResultReceipt={documentId:typeof receipt.documentId==='string'?receipt.documentId:'',revision:Number.isInteger(receipt.revision)?receipt.revision:0,locators:usable?receipt.locators:[]};
 return {id,phase:'done',available:Boolean(usable),capturedAt:Date.now(),coordinateSpace:'native-result-locators',targetKind:kind,receipt:safe,...(!usable?{reason:receipt.reason||'目标已更新，暂未取得可核验的可见结果范围'}:{})};
}
