import {z} from 'zod';

const number=z.number().finite().min(-10000).max(10000);
const color=z.string().regex(/^(#[0-9a-fA-F]{6}|none)$/);
const style={fill:color,stroke:color,strokeWidth:z.number().min(0).max(100),opacity:z.number().min(0).max(1)};
const common={name:z.string().min(1).max(60),group:z.string().min(1).max(60),...style};
const Shape=z.discriminatedUnion('type',[
 z.object({...common,type:z.literal('path'),d:z.string().min(1).max(20000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/)}).strict(),
 z.object({...common,type:z.literal('ellipse'),cx:number,cy:number,rx:z.number().positive().max(10000),ry:z.number().positive().max(10000)}).strict(),
 z.object({...common,type:z.literal('rect'),x:number,y:number,width:z.number().positive().max(10000),height:z.number().positive().max(10000),rx:z.number().min(0).max(10000)}).strict(),
]);
// A data-only vector language: the model never supplies XML, scripts, files,
// external images or host commands. Providers can change without changing the host.
export const VectorArtwork=z.object({
 width:z.number().positive().max(4096),height:z.number().positive().max(4096),
 shapes:z.array(Shape).min(1).max(300),
}).strict();
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function compileVectorArtwork(input:unknown){
 const artwork=VectorArtwork.parse(input),groups=new Map<string,string[]>();
 for(const shape of artwork.shapes){
  const attributes=`fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" opacity="${shape.opacity}" stroke-linecap="round" stroke-linejoin="round"`;
  const geometry=shape.type==='path'?`path d="${escape(shape.d)}"`:shape.type==='ellipse'?`ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"`:`rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx}"`;
  const entries=groups.get(shape.group)||[];entries.push(`<${geometry} id="shape-${artwork.shapes.indexOf(shape)}" ${attributes}/>`);groups.set(shape.group,entries);
 }
 return {artwork,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${artwork.width}" height="${artwork.height}" viewBox="0 0 ${artwork.width} ${artwork.height}">${[...groups].map(([name,shapes],i)=>`<g id="group-${i}" data-name="${escape(name)}">${shapes.join('')}</g>`).join('')}</svg>`};
}
