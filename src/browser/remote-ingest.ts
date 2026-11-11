import {CLIPBOARD_ITEMS_PATH, CLIPBOARD_ORIGIN} from '../clipboard/port';
import type {ClipboardDraft} from '../clipboard/types';

export function createRemoteIngest(origin = CLIPBOARD_ORIGIN) {
  return async (draft: ClipboardDraft) => {
    let response: Response;
    try {
      response = await fetch(`${origin}${CLIPBOARD_ITEMS_PATH}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(draft),
      });
    } catch {
      throw new Error('剪贴板没有就绪，内容没有保存');
    }
    const payload = await response.json().catch(() => ({})) as {error?: string; item?: unknown; pasteboardError?: string};
    if (!response.ok) throw new Error(payload.error || '剪贴板没有写入');
    if (payload.pasteboardError) throw new Error(payload.pasteboardError);
    return payload.item;
  };
}
