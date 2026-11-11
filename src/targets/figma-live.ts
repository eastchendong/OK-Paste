import type {OfficeBridge} from '../office-live/bridge';
import {VectorLiveTarget} from './vector-live';

export interface FigmaSnapshot {
 protocolVersion?:number;anchorId:string;version:string;
 document:{name:string;page:{id:string;name:string};pages:{id:string;name:string}[];items:unknown[];scope:'current-page'};
 target:{nodeId:string;name:string;width:number;height:number};
 previews:{nodeId:string;dataUrl:string}[];
}
export class FigmaLiveTarget extends VectorLiveTarget {
 constructor(root:string,bridge:OfficeBridge,sessionId:string,name:string,snapshot:FigmaSnapshot){
  super(root,bridge,sessionId,name,snapshot,{host:'figma',label:'Figma',tool:'prepare_figma_artwork',placement:'captured-frame',inlineSvg:true});
 }
}
