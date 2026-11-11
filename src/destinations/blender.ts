import type {ClipboardItem} from '../clipboard/types';
import type {ClipboardStore} from '../clipboard/store';
import {destinationAccepts, type PasteDestination} from './registry';

export interface ImagePasteTarget {
  state: {active: boolean; busy: boolean; stage: string};
  mode(active: boolean): Promise<void>;
  acceptImage(buffer: Buffer, label: string): void;
}

const BLOCKED = new Set(['analyzing', 'intent', 'preparing', 'preview', 'committing']);

export function createBlenderDestination(target: ImagePasteTarget): PasteDestination {
  return {
    id: 'blender',
    name: 'Blender',
    accepts: ['image'],
    async paste(item, store) {
      await pasteImageToBlender(target, item, store);
    },
  };
}

export async function pasteImageToBlender(target: ImagePasteTarget, item: ClipboardItem, store: ClipboardStore) {
  if (!destinationAccepts(['image'], item.type)) throw new Error('这个目的地不接收该类型');
  const bytes = store.readContent(item.id);
  if (!bytes?.length) throw new Error('图片内容没有保存下来，无法粘贴');
  if (target.state.busy || BLOCKED.has(target.state.stage)) throw new Error('请先确认或取消当前预览。');
  if (!target.state.active) await target.mode(true);
  target.acceptImage(bytes, sourceLabel(item));
}

function sourceLabel(item: ClipboardItem) {
  const title = typeof item.source.title === 'string' ? item.source.title : '';
  const url = typeof item.source.url === 'string' ? item.source.url : '';
  if (title && url) return `${title} · ${url}`;
  if (url || title) return url || title;
  return '剪贴板参考 · 来源地址未提供';
}
