import {build} from 'esbuild';
await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:'dist/main.cjs'});
await build({entryPoints:['src/preload.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:'dist/preload.cjs'});
