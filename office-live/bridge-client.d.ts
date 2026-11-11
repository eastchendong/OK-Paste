export function createBridgeClient(options:{
 token:string;bootstrapPath:string;
 describe:()=>Promise<Record<string,unknown>>;
 execute:(method:string,args:Record<string,unknown>)=>Promise<unknown>;
 onStatus?:(info?:Record<string,unknown>,error?:Error)=>void;
 fetch?:typeof fetch;
 requestTimeoutMs?:number;
}):{pollOnce():Promise<boolean>;run(interval?:number):Promise<never>};
