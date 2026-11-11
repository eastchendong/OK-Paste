import path from 'node:path';import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {BlenderClient} from '../src/blender-client';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');fs.mkdirSync(path.join(root,'.local'),{recursive:true});
const client=new BlenderClient(root);
try{const tools=await client.connect();const state=await client.op('snapshot');const shot=await client.look();fs.writeFileSync(path.join(root,'.local/probe.png'),Buffer.from(shot.split(',')[1],'base64'));console.log(JSON.stringify({tools,state,screenshot:'.local/probe.png'},null,2));}finally{await client.close();}
