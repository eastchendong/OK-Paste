import fs from 'node:fs';
import path from 'node:path';
import {AgentClient} from '../src/agent-client';
import {IllustratorLiveTarget,type IllustratorSnapshot} from '../src/targets/illustrator-live';
import type {OfficeBridge} from '../src/office-live/bridge';

// Explicit, billable generator-only check. No Illustrator session or user
// document is accessed; this does not establish host read/write acceptance.
const [modelRoot,styleImage,referenceImage,output]=process.argv.slice(2);
if(!modelRoot||!styleImage||!referenceImage||!output)throw new Error('用法：tsx scripts/illustrator-generator-check.ts <模型配置目录> <风格图.png> <实物照片.png> <独立输出目录>');
fs.mkdirSync(output,{recursive:true});
const snapshot:IllustratorSnapshot={anchorId:'synthetic-generator-check',version:'synthetic-v1',
 document:{name:'生成器独立检查（不是实时文档）',url:'',items:[],artboards:[{name:'参考画面中的空白画板',rect:[0,300,300,0]}]},
 target:{artboardIndex:0,name:'参考画面中的空白画板',rect:[0,300,300,0]},previews:[]};
const bridge={request:async()=>{throw new Error('生成器检查禁止访问真实 Illustrator');}}as unknown as OfficeBridge;
const target=new IllustratorLiveTarget(output,bridge,'not-a-host-session','Illustrator 矢量生成器独立检查',snapshot);
const images=[styleImage,referenceImage].map(p=>'data:image/png;base64,'+fs.readFileSync(p).toString('base64'));
const context={kind:'illustrator-live',testScope:'generator only; first image is a concept style/target composite, second is a reference photo; no live document has been read',previewOrder:[0],document:snapshot.document,target:snapshot.target};
const sources=[{id:'reference',type:'image',source:{title:'合成测试参考照片'}}];
const instruction='根据实物照片识别新角色主体，沿用参考画面中已有角色的圆润比例、深色描边、简洁表情与四肢，创作同系列的新角色。保留照片主体的主要识别特征，用可编辑平涂路径分组表达。';
const agent=new AgentClient(modelRoot),started=Date.now();
const plan=await agent.planTarget({target:target.name,context,sources,images,tools:target.tools(),conversation:[]});
fs.writeFileSync(path.join(output,'plan.json'),JSON.stringify(plan,null,2));
console.log(JSON.stringify({stage:'planned',suggestions:plan.suggestions}));
target.begin();
const result=await agent.executeTarget({target:target.name,context,sources,images,tools:target.tools(),plan:{...plan,title:instruction,summary:instruction,actions:[instruction],needsClarification:false},conversation:[{role:'user',text:instruction}],
 invoke:(name,args)=>target.invoke(name,args),onStep:step=>console.log(JSON.stringify({stage:step}))});
if(!target.previewChanged)throw new Error('模型未生成可编辑矢量');
fs.copyFileSync(target.previewPath,path.join(output,'generated.svg'));
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({scope:'generator-only; Illustrator not accessed',durationMs:Date.now()-started,...result},null,2));
console.log(JSON.stringify({generated:path.join(output,'generated.svg'),durationMs:Date.now()-started,calls:result.calls}));
