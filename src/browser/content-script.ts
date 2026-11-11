import {DEFAULT_SHORTCUTS,type Shortcut} from '../shortcuts';
import {CLIPBOARD_ITEMS_PATH, CLIPBOARD_ORIGIN} from '../clipboard/port';
import type {ClipboardDraft} from '../clipboard/types';
import type {AppContext} from '../app-context';
import {attachCopyFrontend,hasMountedCopyFrontend} from './copy-frontend';
import {createRemoteIngest} from './remote-ingest';

type ChromeResponse = {error?: string; item?: unknown; pasteboardError?: string; shortcuts?: Record<string,Shortcut|null>};
type ChromeLike = {
  runtime?: {
    sendMessage?: (message: unknown, callback: (response: ChromeResponse) => void) => void;
    lastError?: {message?: string};
  };
};

const directIngest = createRemoteIngest(CLIPBOARD_ORIGIN);

function extensionChrome(): ChromeLike | undefined {
  return (globalThis as {chrome?: ChromeLike}).chrome;
}

export function ingestCapturedItem(draft: ClipboardDraft) {
  const runtime = extensionChrome()?.runtime;
  if (!runtime?.sendMessage) return directIngest(draft);
  return new Promise((resolve, reject) => {
    runtime.sendMessage?.({kind: 'okpaste', method: 'POST', path: CLIPBOARD_ITEMS_PATH, body: draft}, response => {
      const failure = extensionChrome()?.runtime?.lastError?.message;
      if (failure) reject(new Error(failure));
      else if (!response || response.error) reject(new Error(response?.error || '剪贴板没有写入'));
      else if (response.pasteboardError) reject(new Error(response.pasteboardError));
      else resolve(response.item);
    });
  });
}

if (typeof document !== 'undefined' && (!document.querySelector('okpaste-copy')||hasMountedCopyFrontend(document))) {
  let shortcut:Shortcut|null=DEFAULT_SHORTCUTS.magicCopy;
  const refresh=()=>{
    const runtime=extensionChrome()?.runtime;
    const update=(result:ChromeResponse)=>{if(result?.shortcuts&&'magicCopy' in result.shortcuts)shortcut=result.shortcuts.magicCopy;};
    if(runtime?.sendMessage)runtime.sendMessage({kind:'okpaste',method:'GET',path:'/v1/settings'},update);
    else void fetch(`${CLIPBOARD_ORIGIN}/v1/settings`).then(r=>r.json()).then(update).catch(()=>{});
  };
  refresh();
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  const startFromHere=(focus:AppContext)=>new Promise<void>((resolve,reject)=>{
    const runtime=extensionChrome()?.runtime;
    const done=(response:ChromeResponse)=>{if(response?.error)reject(new Error(response.error));else resolve();};
    if(runtime?.sendMessage)runtime.sendMessage({kind:'okpaste',method:'POST',path:'/v1/agent/anchor',body:{focus}},response=>{
      const error=extensionChrome()?.runtime?.lastError?.message;if(error)reject(new Error(error));else done(response);
    });
    else void fetch(`${CLIPBOARD_ORIGIN}/v1/agent/anchor`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({focus})}).then(async response=>{const body=await response.json();if(!response.ok||body.ok!==true)throw new Error(body.error||'位置没有标记');done(body);}).catch(reject);
  });
  attachCopyFrontend(document, {ingest: ingestCapturedItem,startFromHere,shortcut:()=>shortcut});
}
