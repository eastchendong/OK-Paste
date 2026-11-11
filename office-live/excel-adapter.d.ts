export function createExcelAdapter(Excel: {
  run(first:unknown,second?:unknown):Promise<unknown>;
}): (method:string,args?:Record<string,unknown>)=>Promise<any>;
