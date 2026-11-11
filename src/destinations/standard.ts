import path from 'node:path';
import {writeSystemPasteboard} from '../clipboard/system-pasteboard';
import type {ClipboardStore} from '../clipboard/store';
import type {ClipboardItem} from '../clipboard/types';
import {createBlenderDestination, type ImagePasteTarget} from './blender';
import {type PasteDestination, type DestinationRegistry} from './registry';

export const BLENDER_BRIDGE_PORT = 47722;
export const BLENDER_BRIDGE_ORIGIN = `http://127.0.0.1:${BLENDER_BRIDGE_PORT}`;

export function registerClipboardDestinations(registry: DestinationRegistry, blender?: ImagePasteTarget | 'remote' | 'later') {
  registry.register({
    id: 'system',
    name: '系统剪贴板',
    accepts: ['*'],
    paste(item, store) {
      writeSystemPasteboard(item, store.readContent(item.id), savedFile(store, item));
    },
  });
  registry.register({
    id: 'hold',
    name: '留在妥帖',
    accepts: ['*'],
    paste() {},
  });
  if (blender === 'later') return;
  registry.register(blender && blender !== 'remote' ? createBlenderDestination(blender) : remoteBlenderDestination());
}

function savedFile(store: ClipboardStore, item: ClipboardItem) {
  const filename = typeof item.body.file === 'string' ? item.body.file : '';
  return filename ? path.join(store.directory, 'files', filename) : undefined;
}

function remoteBlenderDestination(): PasteDestination {
  return {
    id: 'blender',
    name: 'Blender',
    accepts: ['image'],
    async paste(item) {
      let response: Response;
      try {
        response = await fetch(`${BLENDER_BRIDGE_ORIGIN}/v1/paste`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({itemId: item.id}),
        });
      } catch {
        throw new Error('Blender 还没接上。先在 prototype 里运行 pnpm start，再把图片贴到 Blender。');
      }
      const payload = await response.json().catch(() => ({})) as {error?: string};
      if (!response.ok) throw new Error(payload.error || '没有贴进 Blender');
    },
  };
}
