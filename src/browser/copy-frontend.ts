import {SELECTION_TOOLBAR_MARKUP,SELECTION_TOOLBAR_STYLES} from './selection-component.generated';
import {DEFAULT_SHORTCUTS,matchesShortcut,type Shortcut} from '../shortcuts';
import type {AppContext} from '../app-context';
import type {CaptureSource, ClipboardDraft} from '../clipboard/types';
import {imageDraft, textDraft, videoDraft} from './capture';

export interface CopyFrontendOptions {
  ingest: (draft: ClipboardDraft) => Promise<unknown> | unknown;
  startFromHere?: (context:AppContext) => Promise<unknown> | unknown;
  pageSource?: () => CaptureSource;
  shortcut?: () => Shortcut | null;
}
export interface CopyFrontend {detach():void}
type MountedDocument=Document&{__okpasteCopyFrontend?:CopyFrontend};
export const hasMountedCopyFrontend=(doc:Document)=>Boolean((doc as MountedDocument).__okpasteCopyFrontend);

/** Optional DOM/media enhancement. Native macOS text selection needs no extension. */
export function attachCopyFrontend(doc:Document,options:CopyFrontendOptions):CopyFrontend {
 const mounted=doc as MountedDocument;mounted.__okpasteCopyFrontend?.detach();
 const view=doc.defaultView??window,host=doc.createElement('okpaste-copy');host.setAttribute('data-okpaste-ui','');
 host.setAttribute('data-okpaste-version','0.3.4');
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML=TEMPLATE;doc.documentElement.append(host);
 const popup=shadow.querySelector<HTMLElement>('.popup')!,copy=shadow.querySelector<HTMLButtonElement>('.copy')!,start=shadow.querySelector<HTMLButtonElement>('.start')!,note=shadow.querySelector<HTMLElement>('.note')!;
 let pending:ClipboardDraft|null=null,anchor:AppContext|null=null,revision=0,busy=false,lastPointer={x:24,y:72},timer:ReturnType<typeof setTimeout>|undefined;
 const source=()=>({...pageSource(doc),...options.pageSource?.()});
 function status(text:string){note.textContent=text;note.hidden=!text;}
 function place(x:number,y:number,selectionTop?:number){
  popup.hidden=false;const bounds=popup.getBoundingClientRect(),width=bounds.width||214,height=bounds.height||32;
  const viewportHeight=view.innerHeight||600;
  const above=selectionTop!==undefined?selectionTop-height-6:undefined;
  const top=y+height<=viewportHeight-8?y:above!==undefined&&above>=8?above:y;
  popup.style.left=`${Math.max(8,Math.min(x,(view.innerWidth||800)-width-8))}px`;
  popup.style.top=`${Math.max(8,Math.min(top,(view.innerHeight||600)-height-8))}px`;
 }
 function hide(){revision++;popup.hidden=true;status('');}
 async function prepare(target:EventTarget|null){
  const token=++revision;
  if(isSecure(target)){pending=null;anchor=null;hide();return;}
  const selected=fieldText(target)||selectionText(doc),element=target instanceof Element?target:null;
  const editable=element?.closest('textarea,input:not([type=password]),[contenteditable=true],[contenteditable=""]');
  const current=source(),selection=doc.getSelection(),field=editable instanceof HTMLInputElement||editable instanceof HTMLTextAreaElement?editable:null;
  anchor=selected||editable?{appName:typeof current.appName==='string'?current.appName:'Chrome',bundleId:typeof current.bundleId==='string'?current.bundleId:'com.google.Chrome',windowTitle:String(current.title||doc.title),selectedText:selected,role:editable?'AXTextArea':'AXWebArea',editAnchor:{markedAt:new Date().toISOString(),...(typeof current.url==='string'?{url:current.url}:{}),...(field?{range:{location:field.selectionStart??0,length:(field.selectionEnd??0)-(field.selectionStart??0)}}:selection?.rangeCount?{range:{location:selection.getRangeAt(0).startOffset,length:selected.length}}:{})}}:null;
  try{
   const media=element?.closest('img,video');
   const draft=selected?await textDraft(selected,current,'selection-popup'):media instanceof HTMLImageElement?await imageDraft(media,current,'selection-popup'):media instanceof HTMLVideoElement?await videoDraft(media,current,'selection-popup'):null;
   if(token!==revision)return;pending=draft;
   if(!draft&&(start.hidden||!anchor)){hide();return;}
   status('');copy.disabled=!pending;start.disabled=!anchor||!options.startFromHere;
   const rect=selectionRect(doc)||editable?.getBoundingClientRect();place(rect?rect.left-2:lastPointer.x,(rect?.bottom??lastPointer.y)+6,rect?.top);
  }catch(error){if(token===revision){status(error instanceof Error?error.message:'内容暂时无法读取');place(lastPointer.x,lastPointer.y+8);}}
 }
 async function perform(action:'copy'|'anchor'){
  if(busy||action==='copy'&&!pending||action==='anchor'&&(start.hidden||!anchor||!options.startFromHere))return;
  busy=true;copy.disabled=start.disabled=true;
  try{
   if(action==='copy')await options.ingest(pending!);else await options.startFromHere!(anchor!);
   status(action==='copy'?'已复制到妥帖':'已标记修改位置，去找参考吧');
   pending=null;anchor=null;clearTimeout(timer);timer=setTimeout(hide,950);
  }catch(error){status(error instanceof Error?error.message:'操作没有完成，请重试');copy.disabled=!pending;start.disabled=!anchor||!options.startFromHere;}
  finally{busy=false;}
 }
 function onMouseUp(event:MouseEvent){if(event.button!==0||insideUi(event))return;lastPointer={x:event.clientX,y:event.clientY};void prepare(event.target);}
 function onKey(event:KeyboardEvent){
  if(event.key==='Escape'){hide();return;}
  if(event.repeat||!matchesShortcut(event,options.shortcut?options.shortcut():DEFAULT_SHORTCUTS.magicCopy))return;
  event.preventDefault();void prepare(doc.activeElement).then(()=>perform('copy'));
 }
 function onKeyUp(event:KeyboardEvent){
  if(insideUi(event))return;
  if(event.key==='Shift'||event.key.startsWith('Arrow')||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'))void prepare(doc.activeElement);
 }
 popup.addEventListener('pointerdown',event=>event.preventDefault());
 copy.addEventListener('click',event=>{event.preventDefault();void perform('copy');});
 start.addEventListener('click',event=>{event.preventDefault();void perform('anchor');});
 // Ordinary Copy stays with the source app. The global shortcut owns its
 // one ingest, so a synthetic ⌘C must not trigger a second browser ingest.
 doc.addEventListener('mouseup',onMouseUp,true);doc.addEventListener('keydown',onKey,true);doc.addEventListener('keyup',onKeyUp,true);
 const frontend:CopyFrontend={detach(){revision++;clearTimeout(timer);host.remove();doc.removeEventListener('mouseup',onMouseUp,true);doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('keyup',onKeyUp,true);if(mounted.__okpasteCopyFrontend===frontend)delete mounted.__okpasteCopyFrontend;}};
 mounted.__okpasteCopyFrontend=frontend;return frontend;
}
function pageSource(doc:Document):CaptureSource {
 const source:CaptureSource={};try{const href=doc.defaultView?.location.href;if(href&&href!=='about:blank')source.url=href;}catch{}
 if(doc.title.trim())source.title=doc.title.trim();return source;
}
function selectionText(doc:Document){const selection=doc.getSelection();return !selection||selection.isCollapsed?'':selection.toString();}
function selectionRect(doc:Document){const selection=doc.getSelection();if(!selection?.rangeCount)return null;const rect=selection.getRangeAt(0).getBoundingClientRect();return rect.width||rect.height?rect:null;}
function isSecure(target:EventTarget|null){return target instanceof HTMLInputElement&&target.type==='password';}
function fieldText(target:EventTarget|null){if(!(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)||isSecure(target))return '';return target.value.slice(target.selectionStart??0,target.selectionEnd??0);}
function insideUi(event:Event){return event.composedPath().some(node=>node instanceof Element&&node.localName==='okpaste-copy');}
const TEMPLATE=`
<style>
${SELECTION_TOOLBAR_STYLES}
</style>
${SELECTION_TOOLBAR_MARKUP}`;
