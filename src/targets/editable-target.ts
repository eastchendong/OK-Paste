import type {ResultReceipt} from '../result-feedback/protocol';
import type{ExecutionPolicy}from'../agent-core/contracts';

export interface EditableTarget {
  readonly resultReceipt?:ResultReceipt;
  readonly name:string;readonly kind:string;readonly file:string;readonly previewPath:string;
  readonly inputDelivery?:'direct'|'clipboard';
  readonly applyImmediately?:boolean;
  readonly recommendationOnly?:boolean;
  readonly executionPolicy?:ExecutionPolicy;
  readonly previewText?:string;readonly canUndo:boolean;readonly previewChanged:boolean;readonly originalUnchanged:boolean;
  readonly contextImage?:string;
  readonly contextImages?:string[];
  readonly backupPath?:string;
  /** Present only for adapters that preserve multiple committed versions. */
  readonly revision?:number;
  readonly mutationUncertain?:boolean;
  /** Captured target description for UI; never derived from the current foreground app. */
  readonly locationLabel?:string;
  readonly adjustmentProfile?:string;
  fingerprint():string;
  read():Promise<{fingerprint:string;[key:string]:unknown}>;
  begin(sourceIds?:readonly string[]):void|Promise<void>;
  tools():{name:string;description:string;inputSchema:unknown}[];
  invoke(name:string,args:Record<string,unknown>):Promise<unknown>;
  commit():void|{clipboardText?:string;path?:string;directory?:string;summary?:string}|Promise<void|{clipboardText?:string;path?:string;directory?:string;summary?:string}>;
  undo():void|{clipboardText?:string;path?:string;directory?:string}|Promise<void|{clipboardText?:string;path?:string;directory?:string}>;
  cancelPendingWrite?():void;
  cancel():void;
  dispose?():Promise<void>;
}
