export type VectorScene='vector-character'|'vector-icon'|'vector-empty-state';
export interface RecommendationInput {sources: {id:string;kind:'text'|'image'|'table';text?:string;title?:string;image?:string}[];target:{app:string;scenario?:'spreadsheet'|'persona-slides'|'vector-artwork';location?:string;nearbyText?:string;documentText?:string;selectedText?:string;screenshot?:string;referenceImages?:string[];capabilities:('text'|'image'|'vector')[]}}
export type Complete=(messages:unknown[],signal?:AbortSignal)=>Promise<string>;
export function recommend(input:RecommendationInput,options:{complete:Complete;signal?:AbortSignal}):Promise<{recommendation:{text:string;sourceIds:string[];output:'text'|'image'|'mixed'|'vector';scene?:VectorScene};modelMs:number}>;
