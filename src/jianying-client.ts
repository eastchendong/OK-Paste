import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';import path from 'node:path';
const allowed=new Set(['create_draft','add_track','add_video','add_audio','add_text','add_filter','add_transition','add_animation','add_fade','add_keyframe','list_effects','describe_draft','save_draft','add_video_effect','describe_effect']);
export class JianyingClient {
 readonly client=new Client({name:'tuotie-jianying',version:'0.2.0'});tools:any[]=[];
 private connected=false;private connecting?:Promise<void>;
 constructor(private root:string,readonly workspace:string){}
 connect(){return this.connecting??=this.open();}
 private async open(){
  const python=path.join(this.root,'.local/jianying-venv/bin/python');
  if(!fs.existsSync(python))throw new Error('请先运行 pnpm run setup:jianying 准备剪映 MCP');
  fs.mkdirSync(this.workspace,{recursive:true});
  const transport=new StdioClientTransport({command:python,args:[path.join(this.root,'jianying/mcp_server.py')],cwd:this.root,env:{PATH:process.env.PATH||'/opt/homebrew/bin:/usr/bin:/bin',HOME:process.env.HOME||'',CAPCUT_DRAFTS_DIR:this.workspace},stderr:'pipe'});
  transport.stderr?.pipe(fs.createWriteStream(path.join(this.root,'.local/jianying-mcp.log'),{flags:'a'}));
  await this.client.connect(transport);this.tools=(await this.client.listTools()).tools.filter(tool=>allowed.has(tool.name));this.connected=true;
 }
 async call(name:string,args:Record<string,unknown>){
  await this.connect();if(!allowed.has(name))throw new Error('剪映没有开放这个工具');
  const result=await this.client.callTool({name,arguments:args},undefined,{timeout:90000});
  const content=(result.content as any[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
  if(result.isError)throw new Error(content.slice(0,1200)||'剪映 MCP 执行失败');
  try{return JSON.parse(content);}catch{return {text:content};}
 }
 async close(){if(this.connected){this.connected=false;await this.client.close();}}
}
