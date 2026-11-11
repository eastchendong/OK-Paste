import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {transform} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]||path.join(root,'.local/figma-plugin'));
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
if(!manifest.id)throw new Error('缺少已注册的开发插件；不创建新插件身份');
const fixture=async function(figma){
 if(figma.root.name!=='妥帖 · Figma 矢量测试 · 1030')throw new Error('仅允许指定独立测试文件');
 const page=figma.currentPage;await page.loadAsync();
 const prefix='1107 · ',existing=page.children.filter(n=>n.name.startsWith(prefix));
 if(existing.length){if(existing.length!==9||existing.some(n=>n.name.endsWith('目标')&&(n.type!=='FRAME'||n.children.length)))throw new Error('已有测试内容不为空，未覆盖');const base=Math.max(0,...page.children.filter(n=>!n.name.startsWith(prefix)).map(n=>n.y+n.height))+160;for(const [row,kind]of ['角色','图标','空状态'].entries())for(const [col,label]of ['风格A','风格B','目标'].entries()){const n=existing.find(n=>n.name===prefix+kind+' · '+label);if(!n||n.getPluginData('tuotie-qa')!=='figma-recommendations-2026-11-07')throw new Error('非本轮测试节点，不移动');n.x=col*340;n.y=base+row*1100;}figma.commitUndo();figma.currentPage.selection=[existing.find(n=>n.name==='1107 · 角色 · 目标')];figma.viewport.scrollAndZoomIntoView(existing);return;}
 const before=page.children.slice(),baseY=Math.max(0,...before.map(n=>n.y+n.height))+160,created=[];
 const wrapper=body=>'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><g stroke="#123e4b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">'+body+'</g></svg>';
 const eyes='<circle cx="128" cy="142" r="5" fill="#123e4b"/><circle cx="170" cy="142" r="5" fill="#123e4b"/><path d="M137 165 Q150 178 163 165" fill="none"/>';
 const samples=[
  ['角色',wrapper('<path d="M120 40 H180 V76 Q210 95 210 126 V238 Q210 250 197 250 H103 Q90 250 90 238 V126 Q90 95 120 76 Z" fill="#acd9b2"/>'+eyes+'<path d="M90 159 L64 190 M210 159 L236 190 M125 250 V274 M175 250 V274" fill="none"/>'),wrapper('<ellipse cx="228" cy="147" rx="30" ry="38" fill="#f2a28d"/><path d="M85 85 H215 V220 Q215 245 190 245 H110 Q85 245 85 220 Z" fill="#f2a28d"/>'+eyes)],
  ['图标',wrapper('<path d="M150 230 L62 143 C10 80 100 28 150 92 C200 28 290 80 238 143 Z" fill="none"/>'),wrapper('<path d="M150 58 V194 M104 150 L150 196 L196 150 M64 200 V242 H236 V200" fill="none"/>')],
  ['空状态',wrapper('<path d="M70 114 H230 V220 H70 Z M70 114 L106 78 H194 L230 114 M70 114 L114 155 H186 L230 114" fill="#c4e1d8"/><path d="M112 94 L134 48 L160 80 L185 46" fill="none"/><circle cx="50" cy="74" r="6" fill="#f2a28d"/>'),wrapper('<path d="M76 78 H224 V224 H76 Z" fill="#c4e1d8"/><path d="M102 115 H198 M102 144 H185 M102 173 H163" fill="none"/><circle cx="245" cy="58" r="7" fill="#f2a28d"/>')],
 ];
 try{
  for(const [row,[kind,a,b]] of samples.entries())for(let col=0;col<3;col++){
   const frame=figma.createFrame();created.push(frame);page.appendChild(frame);frame.name=prefix+kind+' · '+(col===2?'目标':'风格'+(col?'B':'A'));frame.resize(300,300);frame.x=col*340;frame.y=baseY+row*1100;frame.fills=[{type:'SOLID',color:{r:1,g:1,b:1}}];frame.setPluginData('tuotie-qa','figma-recommendations-2026-11-07');
   if(col<2){const node=figma.createNodeFromSvg(col?b:a);frame.appendChild(node);node.x=0;node.y=0;node.name='合成风格参照 · '+kind;}
  }
  page.selection=[created[2]];figma.viewport.scrollAndZoomIntoView(created.slice(0,3));figma.commitUndo();
 }catch(error){for(const node of created)if(!node.removed)node.remove();throw error;}
};
const product=['host.js','fixture.js','code.js'].map(n=>fs.readFileSync(path.join(root,'figma-live',n),'utf8')).join('\n');
const setup='const createRecommendationQaFixture='+fixture.toString()+';\n';
const code=[setup,"if(figma.command==='fixture-recommendations'){createRecommendationQaFixture(figma).then(()=>figma.closePlugin('三个推荐验收场景已建立')).catch(e=>figma.closePlugin(e.message));}else{",product,"}"].join(String.fromCharCode(10));
fs.writeFileSync(path.join(out,'code.js'),(await transform(code,{target:'es2017',format:'iife'})).code);
fs.copyFileSync(path.join(root,'figma-live/ui.html'),path.join(out,'ui.html'));
manifest.menu=manifest.menu.filter(m=>m.command!=='fixture-recommendations');manifest.menu.push({name:'在独立测试稿建立三个推荐验收场景',command:'fixture-recommendations'});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('已更新已注册开发插件，仅新增限定测试文件的验收场景入口');
