import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';

it('prepares live and optional MCP plugins independently without overwriting registered identities or old installations',()=>{
 const project=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-plugin-install-'));
 try{
  for(const folder of ['scripts','src/figma','figma','figma-live'])fs.mkdirSync(path.join(root,folder),{recursive:true});
  for(const file of ['scripts/setup-figma.ts','scripts/prepare-figma-plugin.mjs'])fs.copyFileSync(path.join(project,file),path.join(root,file));
  for(const folder of ['src/figma','figma','figma-live'])fs.cpSync(path.join(project,folder),path.join(root,folder),{recursive:true});
  fs.symlinkSync(path.join(project,'node_modules'),path.join(root,'node_modules'),'dir');fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  for(const [folder,id]of [['figma-live-plugin','registered-live'],['figma-mcp-plugin','registered-mcp'],['figma-plugin','old-installation']]){
   const directory=path.join(root,'.local',folder);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({id}));
  }
  const run=(args:string[])=>{const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});expect(result.status,result.stderr).toBe(0);};
  run(['scripts/prepare-figma-plugin.mjs']);
  const live=path.join(root,'.local/figma-live-plugin'),liveBefore=['manifest.json','code.js','ui.html'].map(file=>fs.readFileSync(path.join(live,file),'utf8'));
  run(['--import','tsx','scripts/setup-figma.ts']);
  expect(['manifest.json','code.js','ui.html'].map(file=>fs.readFileSync(path.join(live,file),'utf8'))).toEqual(liveBefore);
  const read=(folder:string)=>JSON.parse(fs.readFileSync(path.join(root,'.local',folder,'manifest.json'),'utf8'));
  expect(read('figma-live-plugin').id).toBe('registered-live');expect(read('figma-mcp-plugin').id).toBe('registered-mcp');
  expect(read('figma-plugin')).toEqual({id:'old-installation'});
  expect(read('figma-live-plugin').networkAccess.devAllowedDomains).toContain('https://localhost:47722');
  expect(read('figma-mcp-plugin').networkAccess.devAllowedDomains).toContain('http://localhost:47723');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
