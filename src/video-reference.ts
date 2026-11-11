import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import fs from 'node:fs';import path from 'node:path';
import type {ClipboardItem} from './clipboard/types';import type {ClipboardStore} from './clipboard/store';
const run=promisify(execFile);
export async function observeVideo(root:string,store:ClipboardStore,item:ClipboardItem) {
 const directory=path.join(root,'.local/reference-media',item.id),media=path.join(directory,'source.mp4'),sheet=path.join(directory,'contact.jpg');
 const currentTime=typeof item.body.currentTime==='number'?Math.max(0,item.body.currentTime):0;
 const start=Math.max(0,currentTime-1.5);
 try{
  if(!fs.existsSync(media)||!fs.existsSync(sheet)){
   fs.mkdirSync(directory,{recursive:true});
   const local=typeof item.body.file==='string'?path.resolve(store.directory,'files',item.body.file):'';
   const remote=typeof item.body.resourceUrl==='string'?item.body.resourceUrl:'';
   const input=local||(/^https?:\/\//.test(remote)?remote:'');
   if(!input)throw new Error('no-readable-video');
   await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',input,'-t','4','-an','-vf','scale=960:-2:force_original_aspect_ratio=decrease','-c:v','libx264','-preset','ultrafast','-crf','24','-movflags','+faststart',media],{timeout:30000,maxBuffer:300000});
   await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',media,'-vf','fps=2,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=4x2:nb_frames=8:padding=4:margin=4','-frames:v','1',sheet],{timeout:15000,maxBuffer:300000});
  }
  const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',media],{timeout:10000});
  const duration=Number(JSON.parse(stdout).format.duration);
  return {image:`data:image/jpeg;base64,${fs.readFileSync(sheet).toString('base64')}`,observation:{localReferenceClip:media,sourceStartSeconds:start,durationSeconds:duration,frameTimes:Array.from({length:Math.min(8,Math.max(1,Math.ceil(duration*2)))},(_,index)=>start+index/2),layout:'实际视频抽帧，4 列 2 行，按从左到右、从上到下的时间顺序；它是转场与特效的参考，不等于目标工程素材。'}};
 }catch{return {image:'',observation:{readable:false,error:'暂时无法读取这个视频片段，不能声称已经观察其转场或特效。请使用可下载片段或视频文件。'}};}
}
