export function wordContentVersion(xml:string,Parser?:typeof DOMParser):string;
export function wordImageLocators(xml:string,Parser?:typeof DOMParser):import('../src/result-feedback/protocol').ResultLocator[];
export function createWordAdapter(Word:{run(first:unknown,second?:unknown):Promise<unknown>}):
 (method:string,args?:Record<string,unknown>)=>Promise<any>;
