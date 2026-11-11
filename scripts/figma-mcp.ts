import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {FigmaBridge,figmaConnection} from '../src/figma/bridge';import {figmaTools,figmaControlSchemas} from '../src/figma/tools';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bridge=new FigmaBridge(figmaConnection(root).token);await bridge.start(Number(process.env.TUOTIE_FIGMA_PORT||47723));
const server=new McpServer({name:'tuotie-figma',version:'0.1.0'});
const output=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
server.registerTool('figma_get_context',{description:'读取真实插件连接、当前文件／页面／选区和节点树。',inputSchema:z.object({})},async()=>output(bridge.status()));
for(const [name,tool] of Object.entries(figmaTools)){
 const schema=name==='figma_add_image'?tool.schema.extend({data:z.string().min(1)}):tool.schema;
 server.registerTool(name,{description:tool.description,inputSchema:schema},async(args:Record<string,unknown>)=>output(await bridge.request(name,args)));
}
for(const [name,schema] of Object.entries(figmaControlSchemas))server.registerTool(name,{inputSchema:schema},async(args:Record<string,unknown>)=>output(await bridge.request(name,args)));
const transport=new StdioServerTransport();await server.connect(transport);
let stopping=false;async function stop(){if(stopping)return;stopping=true;await bridge.close();await server.close();}
process.stdin.on('end',()=>void stop());process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
