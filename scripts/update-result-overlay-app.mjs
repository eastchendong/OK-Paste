import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runScopedDesktopUpdate} from './update-text-drag-app.mjs';

// Host-confirmed receipts and the shared native renderer. Never copy Blender transactions.
export const patches=[
 'src/result-feedback/protocol.ts','src/targets/editable-target.ts','src/file-runner.ts',
 'src/targets/input-live.ts','src/targets/word-live.ts','src/targets/excel-live.ts',
 'src/targets/powerpoint-live.ts','src/targets/vector-live.ts',
 'office-live/word-adapter.js','office-live/excel-adapter.js','office-live/powerpoint-adapter.js',
 'office-live/word.js','office-live/excel.js','office-live/powerpoint.js',
 'office-live/word.html','office-live/excel.html','office-live/powerpoint.html','figma-live/host.js'
].map(file=>[file,file]);
const release={name:'result-overlay',files:patches,label:'跨 App 结果反馈'};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runScopedDesktopUpdate(release,process.argv[2]);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
