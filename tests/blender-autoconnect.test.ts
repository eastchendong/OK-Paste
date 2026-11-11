import {expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';

it('waits for Tuotie, safely reuses the current Blender session, and respects batch mode and manual stops',()=>{
 const result=spawnSync('python3',['tests/blender-autoconnect-check.py'],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);
});

it('installs and removes only its managed startup module without changing Blender preferences or other scripts',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-auto-install-'));
 try{
  const startup=path.join(directory,'scripts/startup');fs.mkdirSync(startup,{recursive:true});
  fs.writeFileSync(path.join(startup,'unrelated.py'),'preserve this');
  const run=(...extra:string[])=>spawnSync(process.execPath,['scripts/setup-blender-auto.mjs','--version','5.2','--blender-user-dir',directory,...extra],{encoding:'utf8'});
  expect(run().status).toBe(0);expect(run().status).toBe(0);
  const target=path.join(startup,'tuotie_autoconnect.py');
  expect(fs.readFileSync(target,'utf8')).toContain('Tuotie managed startup bridge');
  expect(fs.existsSync(path.join(directory,'config/userpref.blend'))).toBe(false);
  expect(run('--disable').status).toBe(0);expect(fs.existsSync(target)).toBe(false);
  fs.writeFileSync(target,'unmanaged personal script');
  expect(run().status).not.toBe(0);expect(run('--disable').status).not.toBe(0);
  expect(fs.readFileSync(target,'utf8')).toBe('unmanaged personal script');
  expect(fs.readFileSync(path.join(startup,'unrelated.py'),'utf8')).toBe('preserve this');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
