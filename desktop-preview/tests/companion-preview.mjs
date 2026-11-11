import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {JSDOM,VirtualConsole} from 'jsdom';

const preview=new URL('../../companion-motion-preview.html',import.meta.url);
const assetDirectory=new URL('../../ui/assets/companion/',import.meta.url);
const originals=new Map(readdirSync(assetDirectory).filter(name=>name.endsWith('.svg')).map(name=>[
  name,readFileSync(new URL(name,assetDirectory)),
]));

async function isolatedPreview({scripts=false}={}) {
  // Only the review HTML travels to this directory: there is no ui/assets tree.
  const directory=mkdtempSync(path.join(os.tmpdir(),'tuotie-companion-preview-'));
  const filename=path.join(directory,'review.html');
  copyFileSync(preview,filename);
  const errors=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(String(error)));
  try {
    const dom=await JSDOM.fromFile(filename,{
      url:pathToFileURL(filename).href,
      runScripts:scripts?'dangerously':'outside-only',
      pretendToBeVisual:true,
      virtualConsole,
      beforeParse(window) {
        window.addEventListener('error',event=>errors.push(String(event.error||event.message)));
        window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
        window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
        window.ResizeObserver=class {observe(){} disconnect(){} unobserve(){}};
        window.IntersectionObserver=class {
          constructor(callback){this.callback=callback;}
          observe(target){this.callback([{target,isIntersecting:true,intersectionRatio:1}]);}
          unobserve(){} disconnect(){}
        };
        // The motion engine owns interpolation; this check only exercises the
        // preview lifecycle and unified seek without scheduling an endless loop.
        window.requestAnimationFrame=()=>1;
        window.cancelAnimationFrame=()=>{};
        window.Element.prototype.animate=function(){
          return {currentTime:0,startTime:null,onfinish:null,
            play(){},pause(){},cancel(){}};
        };
      },
    });
    assert.deepEqual(readdirSync(directory),['review.html']);
    return {dom,errors,close(){dom.window.close();rmSync(directory,{recursive:true,force:true});}};
  }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}

function assertCompleteCharacters(document) {
  for(const id of ['mpLarge','mpActual']) {
    const roots=document.querySelectorAll(`#${id}.companion-character`);
    assert.equal(roots.length,1,`${id} must exist once without script insertion`);
    const images=[...roots[0].querySelectorAll('img')];
    assert.equal(images.length,15,`${id} must include the whole layered character`);
    const seen=new Set();
    for(const image of images) {
      const src=image.getAttribute('src');
      assert.match(src,/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/,'image must travel inside the HTML');
      const bytes=Buffer.from(src.split(',')[1],'base64');
      assert.ok(bytes.length>0,'embedded SVG is nonempty');
      const original=[...originals].find(([,source])=>source.equals(bytes));
      assert.ok(original,'embedded SVG must retain approved source bytes');
      seen.add(original[0]);
    }
    assert.deepEqual([...seen].sort(),[...originals.keys()].sort(),`${id} includes all approved Figma layers`);
  }
}

test('a standalone review HTML shows both complete characters with scripts disabled and no asset folder',async()=>{
  const review=await isolatedPreview();
  try {
    assert.equal(review.dom.window.TuotieMotionPreview,undefined,'scripts really are disabled');
    assertCompleteCharacters(review.dom.window.document);
    assert.deepEqual(review.errors,[]);
  }finally{review.close();}
});

test('the standalone review can initialize, switch to success and seek both characters without script errors',async()=>{
  const review=await isolatedPreview({scripts:true});
  try {
    const window=review.dom.window,api=window.TuotieMotionPreview;
    assert.ok(api,'preview API initializes without nearby assets');
    api.setPose('success');api.seek(400);
    assert.equal(api.state().pose,'success');
    assert.equal(api.state().time,400);
    assert.equal(api.state().playing,false);
    for(const id of ['mpLarge','mpActual']) {
      const root=window.document.getElementById(id);
      assert.equal(root.dataset.companionPose,'success');
      assert.equal(root.dataset.companionMotion,'paused');
    }
    assertCompleteCharacters(window.document);
    assert.deepEqual(review.errors,[]);
  }finally{review.close();}
});
