import type {OfficeBridge} from '../office-live/bridge';
import {VectorLiveTarget} from './vector-live';

export interface IllustratorSnapshot {
 anchorId:string;version:string;document:{name:string;url:string;artboards:{name:string;rect:number[]}[];items:unknown[]};
 target:{artboardIndex:number;name:string;rect:number[]};
 previews:{artboardIndex:number;dataUrl:string}[];
}
export class IllustratorLiveTarget extends VectorLiveTarget {
 constructor(root:string,bridge:OfficeBridge,sessionId:string,name:string,snapshot:IllustratorSnapshot){
  super(root,bridge,sessionId,name,snapshot,{host:'illustrator',label:'Illustrator',tool:'prepare_illustrator_artwork',placement:'captured-artboard'});
 }
}
