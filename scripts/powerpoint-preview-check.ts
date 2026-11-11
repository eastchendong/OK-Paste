/** Static fixture check only; this never impersonates a connected Office session. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PowerPointLiveTarget,type PowerPointSnapshot} from '../src/targets/powerpoint-live';
import {ClipboardStore} from '../src/clipboard/store';

const directory=path.resolve(process.argv[2]||'');
const filename=path.join(directory,'妥帖-PowerPoint-测试.pptx');
if(!fs.existsSync(filename))throw new Error('请提供 scripts/powerpoint-fixture.py 创建的合成测试目录');
const root=path.join(os.homedir(),'Library/Application Support/Tuotie/runtime');
const store=new ClipboardStore(path.join(directory,'test-clipboard'));
const images=['source-a','source-b'].map(name=>store.add({type:'image',body:{dataUrl:'data:image/png;base64,'+fs.readFileSync(path.join(directory,name+'.png')).toString('base64')}}));
const snapshot:PowerPointSnapshot={protocolVersion:2,anchorId:'static-fixture',version:'static-fixture',slideId:'256',slideIndex:0,slideIds:['256'],selectedShapeIds:['4','5'],slideImage:'',fileBase64:fs.readFileSync(filename).toString('base64'),shapes:[]};
const request=async<T>(_:string,method:string):Promise<T>=>{if(method!=='read'&&method!=='release')throw new Error('静态检查不允许应用或撤回');return snapshot as T;};
const target=new PowerPointLiveTarget(root,{request},'static-fixture','合成演示文稿',snapshot,store);
const context=await target.read();target.begin();
await target.invoke('prepare_powerpoint_images',{replacements:[{shapeId:'4',imageId:images[0].id,fit:'cover'},{shapeId:'5',imageId:images[1].id,fit:'contain'}]});
console.log(JSON.stringify({scope:'独立文件预览；没有实时 PowerPoint 读写',slideCount:context.slideCount,previewPath:target.previewPath,backupPath:target.backupPath}));
await target.dispose();
