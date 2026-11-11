import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
const prompt='在 AI 模式下，把参考图交给 Blender，结合场景和落点确认意图，预览后确认加入并支持撤回。';
export class BlenderClient {
  client=new Client({name:'ok-paste',version:'0.1.0'});
  toolDefinitions:any[]=[];tools:string[]=[]; connected=false; private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly root:string){}
  async connect(){
    const transport=new StdioClientTransport({command:path.join(this.root,'.local/mcp-venv/bin/python'),args:['-c','from blender_mcp.server import main; main()','--host','127.0.0.1','--port','9876'],env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'',DISABLE_TELEMETRY:'1',BLENDER_MCP_DISABLE_TELEMETRY:'1'},stderr:'pipe',cwd:this.root});
    const log=fs.createWriteStream(path.join(this.root,'.local/mcp.log'),{flags:'a'});transport.stderr?.pipe(log);
    await this.client.connect(transport);this.toolDefinitions=(await this.client.listTools()).tools;this.tools=this.toolDefinitions.map(t=>t.name);
    if(!this.tools.includes('execute_blender_code')||!this.tools.includes('look'))throw Error('安装的 MCP 缺少执行或截图工具。');
    this.connected=true;return this.tools;
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
  async raw(name:string,args:Record<string,unknown>){
    return this.serial(async()=>{
      if(!this.connected)throw Error('Blender MCP 尚未连接。');
      const result=await this.client.callTool({name,arguments:args},undefined,{timeout:120000});
      if(result.isError)throw Error('Blender MCP 工具返回错误。');return result;
    });
  }
  async op<T=any>(action:string,args:Record<string,unknown>={}):Promise<T>{
    const payload=JSON.stringify({action,args});
    const code=`import json, operations\n_p=json.loads(${JSON.stringify(payload)})\ntry:\n _result=operations.dispatch(_p['action'],_p['args'])\nexcept Exception as _e:\n _result={'__error':str(_e)}\nprint('OKPASTE_JSON:'+json.dumps(_result))`;
    const result=await this.raw('execute_blender_code',{code,user_prompt:prompt});
    const text=(result.content as any[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
    const marker=text.lastIndexOf('OKPASTE_JSON:');
    if(marker<0)throw Error(text.slice(0,1400));const value=JSON.parse(text.slice(marker+13).trim());if(value.__error)throw Error(value.__error);return value;
  }
  async agentOp<T=any>(action:string,args:Record<string,unknown>={}):Promise<T>{
    const code=`import json, agent_scene\n_p=json.loads(${JSON.stringify(JSON.stringify({action,args}))})\ntry:\n _r=getattr(agent_scene,_p['action'])(**_p['args'])\nexcept Exception as _e:\n _r={'__error':str(_e)}\nprint('OKPASTE_JSON:'+json.dumps(_r))`;
    const r=await this.raw('execute_blender_code',{code,user_prompt:prompt});
    const text=(r.content as any[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');const i=text.lastIndexOf('OKPASTE_JSON:');
    if(i<0)throw Error(text.slice(0,1000));const result=JSON.parse(text.slice(i+13).trim());if(result.__error)throw Error(result.__error);return result;
  }
  async look(){
    const r=await this.raw('look',{mode:'viewport',max_size:800,user_prompt:prompt});
    const image=(r.content as any[]).find(x=>x.type==='image');
    if(!image)throw Error('MCP 没有返回视口图片。');return `data:${image.mimeType};base64,${image.data}`;
  }
  async close(){this.connected=false;await this.client.close();}
}
