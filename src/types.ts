import type {AgentPlan} from './agent-client';
import type {ClipboardSnapshot} from './clipboard/types';
export type Stage='idle'|'collecting'|'collected'|'analyzing'|'intent'|'preparing'|'preview'|'committing'|'done'|'answer'|'error';
export type State={active:boolean;connected:boolean;stage:Stage;message:string;source?:string;sourceLabel?:string;taskId?:string;sceneImage?:string;previewImage?:string;reason?:string;review?:string;version:number;scale:number;height:number;canUndo:boolean;error?:string;busy:boolean;shortcut:boolean;context?:any;conversation?:{role:string;text:string}[];plan?:AgentPlan;changes?:{added:string[];removed:string[];modified:string[];scene?:string[]};toolSteps?:string[]};
export const initialState=():State=>({active:false,connected:false,stage:'idle',message:'按 ⌘⇧空格进入 AI 模式',version:0,scale:1,height:0,canUndo:false,busy:false,shortcut:false});
export type Action='toggle'|'capture'|'screenshot'|'retry'|'preview'|'commit'|'cancel'|'undo'|'show';
export interface DesktopAPI{state():Promise<State>;action(action:Action):Promise<void>;drag():void;send(text:string):Promise<void>;subscribe(fn:(s:State)=>void):()=>void;clipboard():Promise<ClipboardSnapshot>;paste(itemId:string,destinationId:string):Promise<void>;subscribeClipboard(fn:(snapshot:ClipboardSnapshot)=>void):()=>void;}
