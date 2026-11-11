import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const commit='febcd90ece59c3416d7c55fd3723cea46bcaa59d';
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
function run(command,args){execFileSync(command,args,{cwd:root,stdio:'inherit'});}
const source=path.join(root,'.local/mcp-for-blender');
if(!fs.existsSync(source)){
 run('git',['clone','https://github.com/ahujasid/blender-mcp.git',source]);run('git',['-C',source,'checkout','--detach',commit]);
}else{
 const current=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(current!==commit)throw Error('现有 MCP 源码版本不同，请核对后更新；setup 不覆盖已有源码。');
}
const python=path.join(root,'.local/mcp-venv/bin/python');
if(!fs.existsSync(python))run('uv',['venv',path.join(root,'.local/mcp-venv'),'--python','3.11']);
run('uv',['pip','install','--python',python,'-r','requirements-mcp.txt']);
console.log('Blender MCP 与配套插件已准备。未改动其他 AI 客户端配置或 Blender 启动偏好。');
