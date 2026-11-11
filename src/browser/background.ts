import {CLIPBOARD_ITEMS_PATH, CLIPBOARD_ORIGIN} from '../clipboard/port';

type ChromeResponse = {error?: string; item?: unknown};
type ChromeMessage = {kind?: string; method?: string; path?: string; body?: unknown};
type ChromeRuntime = {
  onMessage: {
    addListener: (listener: (message: ChromeMessage, sender: unknown, sendResponse: (response: ChromeResponse) => void) => boolean) => void;
  };
};

const runtime = (globalThis as unknown as {chrome: {runtime: ChromeRuntime}}).chrome.runtime;

runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.kind !== 'okpaste' || !([CLIPBOARD_ITEMS_PATH,'/v1/agent/anchor'].includes(message.path||'')&&message.method==='POST' || message.path === '/v1/settings' && message.method === 'GET')) return false;
  void fetch(`${CLIPBOARD_ORIGIN}${message.path}`, {
    method: message.method || 'POST',
    headers: {'content-type': 'application/json'},
    body: message.body == null ? undefined : JSON.stringify(message.body),
  }).then(async response => {
    const payload = await response.json().catch(() => ({})) as ChromeResponse;
    sendResponse(response.ok ? payload : {error: payload.error || '剪贴板没有写入'});
  }).catch(() => sendResponse({error: '剪贴板没有就绪，内容没有保存'}));
  return true;
});
