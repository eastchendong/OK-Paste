import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {publicSettings,readAgentConfig} from '../src/app-settings';
import {AgentClient} from '../src/agent-client';
import {DEFAULT_SHORTCUTS,matchesShortcut} from '../src/shortcuts';
const dirs:string[]=[];afterEach(()=>{vi.unstubAllGlobals();dirs.splice(0).forEach(dir=>fs.rmSync(dir,{recursive:true,force:true}));});
describe('personal settings',()=>{
 it('keeps API credentials out of the browser settings and reads replacements',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-settings-'));dirs.push(root);fs.mkdirSync(path.join(root,'.local'));
  const env=path.join(root,'.env.local');fs.writeFileSync(env,'ARK_API_KEY="test-first-key"\n');
  fs.writeFileSync(path.join(root,'.local/settings.json'),JSON.stringify({apiKey:'must-not-leak',shortcuts:{magicCopy:{key:'k',modifiers:['ctrl','shift']},archive:null}}));
  const settings=publicSettings(root);
  expect(JSON.stringify(settings)).not.toMatch(/key"?:"test|must-not-leak|apiKey/);
  expect(settings.shortcuts.magicCopy).toEqual({key:'k',modifiers:['ctrl','shift']});expect(settings.shortcuts.archive).toBeNull();
  expect(readAgentConfig(root).ARK_API_KEY).toBe('test-first-key');fs.writeFileSync(env,'ARK_API_KEY="test-replaced-key"\n');
  expect(readAgentConfig(root).ARK_API_KEY).toBe('test-replaced-key');
 });
 it('reserves command option C for adding content and leaves ordinary copy alone',()=>{
  const event={key:'c',code:'KeyC',altKey:true,metaKey:true,ctrlKey:false,shiftKey:false};
  expect(matchesShortcut(event,DEFAULT_SHORTCUTS.addContent)).toBe(true);
  expect(matchesShortcut({...event,altKey:false},DEFAULT_SHORTCUTS.addContent)).toBe(false);
  expect(matchesShortcut(event,DEFAULT_SHORTCUTS.magicCopy)).toBe(false);
 });
 it('matches custom physical keys even when Option changes the character and honors disabling',()=>{
  const event={key:'ç',code:'KeyC',altKey:true,metaKey:false,ctrlKey:false,shiftKey:false};
  expect(matchesShortcut(event,{key:'c',modifiers:['alt']})).toBe(true);
  expect(matchesShortcut(event,{key:'k',modifiers:['alt']})).toBe(false);expect(matchesShortcut(event,null)).toBe(false);
  expect(matchesShortcut({...event,key:'K',code:'KeyK',altKey:false,ctrlKey:true,shiftKey:true},{key:'k',modifiers:['ctrl','shift']})).toBe(true);
 });
 it('uses a replacement Key on the next model request without restarting the client',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-model-config-'));dirs.push(root);fs.mkdirSync(path.join(root,'.local'));
  const env=path.join(root,'.env.local');
  const write=(key:string)=>fs.writeFileSync(env,`ARK_API_KEY=${key}\nARK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3\nARK_MODEL=glm-5.3-flash\n`);
  write('test-first-key');
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'present_plan',arguments:JSON.stringify({title:'测试计划',summary:'测试',actions:[],questions:[],needsClarification:false})}}]}}]}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const client=new AgentClient(root),input={source:'',sceneImage:'',context:{},conversation:[],assets:[]};
  await client.plan(input);write('test-replaced-key');await client.plan(input);
  expect((fetcher.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer test-first-key');
  expect((fetcher.mock.calls[1] as any)[1].headers.Authorization).toBe('Bearer test-replaced-key');
 });

});
