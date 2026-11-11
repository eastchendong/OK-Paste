import {CLIPBOARD_ITEMS_PATH, CLIPBOARD_ORIGIN, CLIPBOARD_PORT} from './port';
import {startClipboardServer, type ClipboardServer, type PasteboardWriter} from './server';
import {ClipboardStore} from './store';
import type {ClipboardSnapshot, DestinationInfo, PublicClipboardItem} from './types';
import {DestinationRegistry} from '../destinations/registry';

export class ClipboardHost {
  readonly store: ClipboardStore;
  readonly destinations = new DestinationRegistry();
  private generation = 0;
  private server?: ClipboardServer;
  private serverError?: string;
  private onChange?: () => void;

  constructor(directory: string, private readonly pasteboard?: PasteboardWriter) {
    this.store = new ClipboardStore(directory);
  }

  get listening() {
    return Boolean(this.server);
  }

  setOnChange(listener: () => void) {
    this.onChange = listener;
  }

  async snapshot(): Promise<ClipboardSnapshot> {
    this.generation += 1;
    if (this.server) {
      return {
        generation: this.generation,
        ready: true,
        items: this.store.publicList(),
        destinations: this.destinations.list(),
      };
    }
    const remote = await this.remoteSnapshot().catch(() => undefined);
    if (remote) return {generation: this.generation, ready: true, ...remote};
    return {
      generation: this.generation,
      ready: false,
      error: this.serverError,
      items: this.store.publicList(),
      destinations: this.destinations.list(),
    };
  }

  async start(port = CLIPBOARD_PORT) {
    try {
      this.server = await startClipboardServer({
        store: this.store,
        destinations: this.destinations,
        port,
        onChange: () => this.onChange?.(),
        pasteboard: this.pasteboard,
      });
      this.serverError = undefined;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.serverError = /EADDRINUSE/i.test(message)
        ? `本机 ${port} 端口已由妥帖桌面应用占用，当前窗口改为读取那一份剪贴板。`
        : message;
      return false;
    }
  }

  async paste(itemId: string, destinationId: string) {
    if (!this.server) {
      const response = await fetch(`${CLIPBOARD_ORIGIN}/v1/clipboard/paste`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({itemId, destinationId}),
      });
      const payload = await response.json().catch(() => ({})) as {error?: string};
      if (!response.ok) throw new Error(payload.error || '没有贴到目的地');
      this.onChange?.();
      return;
    }
    const item = this.store.get(itemId);
    if (!item) throw new Error('剪贴板没有这项');
    await this.destinations.paste(destinationId, item, this.store);
    this.onChange?.();
  }

  close() {
    return this.server?.close() ?? Promise.resolve();
  }

  private async remoteSnapshot(): Promise<{items: PublicClipboardItem[]; destinations: DestinationInfo[]} | undefined> {
    const [itemsResponse, destinationsResponse] = await Promise.all([
      fetch(`${CLIPBOARD_ORIGIN}${CLIPBOARD_ITEMS_PATH}`),
      fetch(`${CLIPBOARD_ORIGIN}/v1/clipboard/destinations`),
    ]);
    if (!itemsResponse.ok || !destinationsResponse.ok) return;
    const itemsPayload = await itemsResponse.json() as {items?: PublicClipboardItem[]};
    const destinationsPayload = await destinationsResponse.json() as {destinations?: DestinationInfo[]};
    if (!Array.isArray(itemsPayload.items) || !Array.isArray(destinationsPayload.destinations)) return;
    return {items: itemsPayload.items, destinations: destinationsPayload.destinations};
  }
}
