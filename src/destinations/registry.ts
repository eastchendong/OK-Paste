import type {ClipboardStore} from '../clipboard/store';
import type {ClipboardItem, DestinationInfo} from '../clipboard/types';

export interface PasteDestination {
  id: string;
  name: string;
  accepts: readonly string[];
  describe?: () => {connected?: boolean; detail?: string};
  paste(item: ClipboardItem, store: ClipboardStore): Promise<void> | void;
}

export function destinationAccepts(accepts: readonly string[], type: string) {
  return accepts.includes('*') || accepts.includes(type);
}

export class DestinationRegistry {
  private readonly byId = new Map<string, PasteDestination>();

  register(destination: PasteDestination) {
    if (!destination.id.trim() || !destination.name.trim()) throw new Error('目的地缺少名称');
    if (this.byId.has(destination.id)) throw new Error(`目的地已存在：${destination.id}`);
    this.byId.set(destination.id, destination);
  }

  list(): DestinationInfo[] {
    return [...this.byId.values()].map(destination => ({
      id: destination.id,
      name: destination.name,
      accepts: [...destination.accepts],
      ...destination.describe?.(),
    }));
  }

  async paste(id: string, item: ClipboardItem, store: ClipboardStore) {
    const destination = this.byId.get(id);
    if (!destination) throw new Error('没有这个目的地');
    if (!destinationAccepts(destination.accepts, item.type)) throw new Error('这个目的地不接收该类型');
    await destination.paste(item, store);
  }
}
