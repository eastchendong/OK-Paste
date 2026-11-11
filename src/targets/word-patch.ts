import {z} from 'zod';

// The model describes content, never HTML, OOXML, file paths or executable code.
const Run=z.strictObject({
 text:z.string().min(1).max(100000),bold:z.boolean().optional(),italic:z.boolean().optional(),
 underline:z.boolean().optional(),fontSizePt:z.number().min(6).max(72).optional(),
 color:z.string().regex(/^[0-9a-fA-F]{6}$/).optional(),
});
export const WordPatchSchema=z.strictObject({blocks:z.array(z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('paragraph'),runs:z.array(Run).min(1).max(200),align:z.enum(['left','center','right','justify']).optional()}),
 z.strictObject({type:z.literal('image'),imageId:z.string().min(1).max(200),widthPt:z.number().min(12).max(468).optional(),alt:z.string().max(500).optional()}),
])).min(1).max(500)});
export type WordPatch=z.infer<typeof WordPatchSchema>;
export type PreparedWordContent={text:string;ooxml?:string;patch?:WordPatch};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function clean(value:string){if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value))throw new Error('文字包含 Word 不支持的控制字符');return value;}
export function prepareWordText(text:unknown):PreparedWordContent{
 if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('请提供 1–100000 字符的待插入文字');
 return {text:clean(text)};
}

/** Read actual pixel dimensions; never trust a supplied MIME or model aspect ratio. */
function imageInfo(bytes:Buffer){
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  return {extension:'png',mime:'image/png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 }
 if(bytes.length>=4&&bytes.readUInt16BE(0)===0xffd8){
  let i=2;
  while(i+4<=bytes.length){
   if(bytes[i++]!==0xff)break;
   while(bytes[i]===0xff)i++;
   const marker=bytes[i++];if(marker===0xda||marker===0xd9)break;
   if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
   if(i+2>bytes.length)break;const size=bytes.readUInt16BE(i);
   if(size<2||i+size>bytes.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=8)
    return {extension:'jpeg',mime:'image/jpeg',width:bytes.readUInt16BE(i+5),height:bytes.readUInt16BE(i+3)};
   i+=size;
  }
 }
 throw new Error('Word 图文插入目前支持 PNG / JPEG，请先转换这张图片');
}

/** Compile one complete candidate locally, before touching the host document. */
export function prepareWordPatch(value:unknown,resolveImage:(id:string)=>Buffer):PreparedWordContent{
 const patch=WordPatchSchema.parse(value),text=patch.blocks.map(block=>block.type==='image'?`[图片：${block.alt||'内容包图片'}]`:block.runs.map(run=>run.text).join('')).join('\n');
 if(!text.trim()||text.length>100000)throw new Error('图文内容总长度必须为 1–100000 字符');
 const ns='http://schemas.openxmlformats.org';
 const part=(name:string,type:string,xml:string)=>`<pkg:part pkg:name="${name}" pkg:contentType="${type}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
 const relationships:string[]=[],media:string[]=[];let totalBytes=0;
 const paragraphs=patch.blocks.map(block=>{
  if(block.type==='paragraph'){
   const runs=block.runs.map(run=>{
    const format=[run.bold===undefined?'':`<w:b w:val="${Number(run.bold)}"/>`,run.italic===undefined?'':`<w:i w:val="${Number(run.italic)}"/>`,run.underline===undefined?'':`<w:u w:val="${run.underline?'single':'none'}"/>`,run.fontSizePt?`<w:sz w:val="${Math.round(run.fontSizePt*2)}"/><w:szCs w:val="${Math.round(run.fontSizePt*2)}"/>`:'',run.color?`<w:color w:val="${run.color}"/>`:''].join('');
    const content=clean(run.text).split(/(\r\n|\r|\n|\t)/).map(s=>s==='\t'?'<w:tab/>':/^[\r\n]+$/.test(s)?'<w:br/>':`<w:t xml:space="preserve">${escape(s)}</w:t>`).join('');
    return `<w:r>${format?`<w:rPr>${format}</w:rPr>`:''}${content}</w:r>`;
   }).join('');
   return `<w:p>${block.align?`<w:pPr><w:jc w:val="${block.align==='justify'?'both':block.align}"/></w:pPr>`:''}${runs}</w:p>`;
  }
  const number=media.length+1;if(number>8)throw new Error('单次最多插入 8 张图片');
  const bytes=resolveImage(block.imageId);totalBytes+=bytes.length;
  if(totalBytes>12*1024*1024)throw new Error('单次图片总大小不能超过 12 MB');
  const info=imageInfo(bytes);if(!info.width||!info.height||info.width>100000||info.height>100000)throw new Error('图片尺寸无效');
  const width=block.widthPt??Math.min(360,info.width*0.75),height=width*info.height/info.width,scale=Math.min(1,648/height);
  const cx=Math.round(width*scale*12700),cy=Math.round(height*scale*12700),id=`image${number}`,filename=`${id}.${info.extension}`;
  relationships.push(`<Relationship Id="${id}" Type="${ns}/officeDocument/2006/relationships/image" Target="media/${filename}"/>`);
  media.push(`<pkg:part pkg:name="/word/media/${filename}" pkg:contentType="${info.mime}"><pkg:binaryData>${bytes.toString('base64')}</pkg:binaryData></pkg:part>`);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="${id}" descr="${escape(clean(block.alt||''))}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${ns}/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${number}" name="${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
 }).join('')+'<w:p/>'; // Word consumes the final paragraph marker on range insertion.
 const rels=(items:string)=>`<Relationships xmlns="${ns}/package/2006/relationships">${items}</Relationships>`;
 const ooxml=`<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">${part('/_rels/.rels','application/vnd.openxmlformats-package.relationships+xml',rels(`<Relationship Id="document" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`))}${part('/word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',`<w:document xmlns:w="${ns}/wordprocessingml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships" xmlns:wp="${ns}/drawingml/2006/wordprocessingDrawing" xmlns:a="${ns}/drawingml/2006/main" xmlns:pic="${ns}/drawingml/2006/picture"><w:body>${paragraphs}</w:body></w:document>`)}${relationships.length?part('/word/_rels/document.xml.rels','application/vnd.openxmlformats-package.relationships+xml',rels(relationships.join(''))):''}${media.join('')}</pkg:package>`;
 return {text,ooxml,patch};
}
