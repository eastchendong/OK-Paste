import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
it('returns read-only Blender geometry in validated normalized window coordinates',()=>{
 const result=spawnSync('python3',['tests/blender-result-geometry-check.py'],{encoding:'utf8'});
 expect(result.status,result.stdout+result.stderr).toBe(0);
});
