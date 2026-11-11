import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
export class FigmaClient {
 private client?:Client;private connecting?:Promise<void>;private timer?:ReturnType<typeof setInterval>;
 context:Record<string,any>={connected:false};
 constructor(private root:string,private port=47723){}
 async connect(){
  if(this.client)return;if(this.connecting)return this.connecting;
  this.connecting=this.open().finally(()=>{this.connecting=undefined;});return this.connecting;
 }
 private async open(){
  const client=new Client({name:'tuotie-figma-client',version:'0.1.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',path.join(this.root,'node_modules/tsx/dist/loader.mjs'),path.join(this.root,'scripts/figma-mcp.ts')],cwd:this.root,env:{TUOTIE_FIGMA_PORT:String(this.port)},stderr:'pipe'});
  try{await client.connect(transport);const definitions=await client.listTools();if(!definitions.tools.some(tool=>tool.name==='figma_inspect_preview'))throw new Error('Figma MCP 缺少副本检查工具，请更新本机连接');this.client=client;await this.refresh();this.timer=setInterval(()=>void this.refresh().catch(()=>{this.context={connected:false};}),2000);this.timer.unref();}
  catch(error){this.client=undefined;await client.close().catch(()=>{});throw error;}
 }
 private async refresh(){this.context=await this.call('figma_get_context');}
 async call(name:string,args:Record<string,unknown>={}){
  if(!this.client)throw new Error('Figma MCP 尚未连接');
  const result=await this.client.callTool({name,arguments:args},undefined,{timeout:20000});
  const text=(result.content as any[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
  if(result.isError)throw new Error(text.slice(0,1000)||'Figma MCP 操作失败');return JSON.parse(text);
 }
 async close(){clearInterval(this.timer);const client=this.client;this.client=undefined;await client?.close();}
}
