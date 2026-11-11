import fs from 'node:fs';
import path from 'node:path';
import {BlenderClient} from '../blender-client';
import type {ClipboardItem} from '../clipboard/types';
import type {ClipboardStore} from '../clipboard/store';
import {pasteImageToBlender, type ImagePasteTarget} from './blender';
import type {PasteDestination} from './registry';

export class BlenderLink implements ImagePasteTarget {
  client: BlenderClient;
  state = {active: false, busy: false, stage: 'idle'};
  connected = false;
  detail = 'Blender 未连接';
  private connecting: Promise<void> | null = null;
  private checkedAt = 0;

  constructor(private readonly root: string) {
    this.client = new BlenderClient(root);
  }

  async connect() {
    if (this.connecting) return this.connecting;
    if (this.connected && Date.now() - this.checkedAt < 5000) return;
    this.connecting = (this.connected ? this.checkConnection() : this.tryConnect()).finally(() => {
      this.checkedAt = Date.now();
      this.connecting = null;
    });
    return this.connecting;
  }

  async mode(active: boolean) {
    if (!this.connected) throw new Error('Blender 未连接');
    await this.client.op('mode', {active});
    this.state.active = active;
    this.state.stage = active ? 'collecting' : 'idle';
  }

  acceptImage(buffer: Buffer, label: string) {
    if (!buffer.length) throw new Error('图片内容没有保存下来，无法粘贴');
    const extension = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg' : 'png';
    const file = path.join(this.root, '.local', `reference.${extension}`);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, buffer);
    this.state.stage = 'collected';
    void label;
  }

  destination(): PasteDestination {
    return {
      id: 'blender',
      name: 'Blender',
      accepts: ['image'],
      describe: () => ({connected: this.connected, detail: this.detail}),
      paste: (item, store) => this.paste(item, store),
    };
  }

  private async tryConnect() {
    const client = new BlenderClient(this.root);
    try {
      await client.connect();
      // An already-open Blender may still have the previous checkout's bridge.
      // Rebind only its runtime folder; keep the user's scene and transaction intact.
      await client.raw('execute_blender_code', {code:`import pathlib, operations\noperations.ROOT=pathlib.Path(${JSON.stringify(this.root)})`,user_prompt:'连接妥帖本机运行目录，不修改场景'});
      // MCP tool discovery can succeed while Blender itself is closed. Require
      // a parsed host response before advertising a working drop destination.
      const mode = await client.op<{active:boolean}>('mode', {active: true});
      if (!mode.active) throw new Error('Blender 拖放接收未启用');
      this.client = client;
      this.connected = true;
      this.detail = 'Blender 已连接';
      this.state.active = true;
      this.state.stage = 'collecting';
    } catch {
      this.connected = false;
      this.detail = 'Blender 未连接';
      this.state.active = false;
      this.state.stage = 'idle';
      await client.close().catch(() => {});
    }
  }

  private async checkConnection() {
    try {
      await this.client.op('status');
    } catch {
      this.connected = false;
      this.detail = 'Blender 未连接';
      this.state.active = false;
      this.state.stage = 'idle';
      await this.client.close().catch(() => {});
    }
  }

  private async paste(item: ClipboardItem, store: ClipboardStore) {
    if (!this.connected) await this.connect();
    if (!this.connected) throw new Error('Blender 未连接');
    await pasteImageToBlender(this, item, store);
  }
}
