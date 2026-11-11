import {expect,it,vi} from 'vitest';
import {Window} from 'happy-dom';
import {prepareWordPatch,prepareWordText} from '../src/targets/word-patch';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
it('compiles formatted paragraphs and an embedded image into a self-contained Word package',()=>{
 const image=vi.fn(()=>png),prepared=prepareWordPatch({blocks:[
  {type:'paragraph',align:'center',runs:[{text:'A<&>\n第二行',bold:true,fontSizePt:18,color:'163868'}]},
  {type:'image',imageId:'source-a',widthPt:120,alt:'照片'},
 ]},image);
 expect(image).toHaveBeenCalledExactlyOnceWith('source-a');
 const window=new Window(),xml=new window.DOMParser().parseFromString(prepared.ooxml!,'application/xml');
 expect(xml.querySelector('parsererror')).toBeNull();
 expect(prepared.ooxml).toContain('A&lt;&amp;&gt;');expect(prepared.ooxml).toContain('<w:br/>');expect(prepared.ooxml).toContain('<w:sz w:val="36"/>');
 expect(prepared.ooxml).toContain('cx="1524000" cy="1524000"');
 expect(prepared.ooxml).toContain('Target="media/image1.png"');expect(prepared.ooxml).toContain(png.toString('base64'));
 expect(prepared.ooxml).toContain('<w:p/></w:body>'); // Keeps following original text out of the image paragraph.
 expect(prepared.text).toContain('[图片：照片]');window.close();
});
it('rejects arbitrary markup, malformed formats, unsupported images and oversized combined text before any host write',()=>{
 const image=vi.fn(()=>Buffer.from('not-an-image'));
 expect(()=>prepareWordPatch({blocks:[{type:'script',code:'anything'}]},image)).toThrow();
 expect(()=>prepareWordPatch({blocks:[{type:'paragraph',runs:[{text:'x',fontSizePt:900}]}]},image)).toThrow();
 expect(()=>prepareWordPatch({blocks:[{type:'image',imageId:'x'}]},image)).toThrow('PNG / JPEG');
 expect(()=>prepareWordPatch({blocks:[{type:'paragraph',runs:[{text:'x'.repeat(60000)},{text:'y'.repeat(60000)}]}]},image)).toThrow('总长度');
 expect(()=>prepareWordText('bad\x00')).toThrow('控制字符');
});
