import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ClipboardInputError, type CaptureSource, type ClipboardDraft, type ClipboardItem, type PublicClipboardItem} from './types';

const MAX_ITEMS = 200;
const MAX_TEXT = 100_000;
const MAX_BYTES = 8_000_000;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export class ClipboardStore {
  private items: ClipboardItem[] = [];

  constructor(readonly directory: string) {
    fs.mkdirSync(path.join(directory, 'files'), {recursive: true});
    this.load();
  }

  add(draft: ClipboardDraft): ClipboardItem {
    const item = this.materialize(draft);
    const next = [item, ...this.items].slice(0, MAX_ITEMS);
    const dropped = [item, ...this.items].slice(MAX_ITEMS);
    try {
      this.write(next);
    } catch (error) {
      this.deleteManagedFile(item);
      throw error;
    }
    this.items = next;
    for (const old of dropped) this.deleteManagedFile(old);
    return structuredClone(item);
  }

  list(includeArchived = false): ClipboardItem[] {
    return this.items.filter(item => includeArchived || !item.archivedAt).map(item => structuredClone(item));
  }

  archive(ids: string[], task: string = crypto.randomUUID()): string[] {
    const wanted = new Set(ids), archived: string[] = [], at = new Date().toISOString();
    const next = this.items.map(item => {
      if (!wanted.has(item.id) || item.archivedAt) return item;
      archived.push(item.id);
      return {...item, archivedAt: at, archiveTask: task};
    });
    if (archived.length) { this.write(next); this.items = next; }
    return archived;
  }

  get(id: string): ClipboardItem | undefined {
    const item = this.items.find(candidate => candidate.id === id);
    return item ? structuredClone(item) : undefined;
  }

  readContent(id: string): Buffer | undefined {
    const item = this.items.find(candidate => candidate.id === id);
    const filename = item && typeof item.body.file === 'string' ? item.body.file : undefined;
    return filename ? this.readFile(filename) : undefined;
  }

  toPublic(item: ClipboardItem, includePreview = true): PublicClipboardItem {
    const filename = typeof item.body.file === 'string' ? item.body.file : undefined;
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item.body)) {
      if (key !== 'file' && key !== 'dataUrl') body[key] = value;
    }
    body.hasContent = Boolean(filename && this.readFile(filename));
    const mime = typeof item.body.mime === 'string' ? item.body.mime : '';
    const bytes = filename ? this.readFile(filename) : undefined;
    const preview = includePreview && bytes && mime.startsWith('image/')
      ? `data:${mime};base64,${bytes.toString('base64')}`
      : undefined;
    return {
      id: item.id,
      type: item.type,
      createdAt: item.createdAt,
      ...(item.archivedAt ? {archivedAt: item.archivedAt, archiveTask: item.archiveTask} : {}),
      source: structuredClone(item.source),
      body,
      ...(preview ? {preview} : {}),
    };
  }

  publicList(includePreview = true, includeArchived = false): PublicClipboardItem[] {
    return this.list(includeArchived).map(item => this.toPublic(item, includePreview));
  }

  private materialize(draft: ClipboardDraft): ClipboardItem {
    const type = assertType(draft.type);
    const source = sanitizeSource(draft.source ?? {});
    if (draft.body != null && (typeof draft.body !== 'object' || Array.isArray(draft.body))) {
      throw new ClipboardInputError('内容格式无效');
    }
    const raw = draft.body ?? {};
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : undefined;
    const body = sanitizeBody(raw);
    delete body.dataUrl;
    if (type === 'text') {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new ClipboardInputError('没有可保存的文字');
      body.text = text;
    }
    const item: ClipboardItem = {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      source,
      body,
    };
    if (dataUrl) {
      const decoded = decodeDataUrl(dataUrl);
      if (decoded) {
        const filename = `${item.id}.${extensionFor(decoded.mime)}`;
        fs.writeFileSync(path.join(this.directory, 'files', filename), decoded.bytes);
        item.body.file = filename;
        if (typeof item.body.mime !== 'string') item.body.mime = decoded.mime;
        item.body.byteLength = decoded.bytes.length;
      } else if ((type === 'image' || type === 'video') && typeof item.body.resourceUrl !== 'string') {
        throw new ClipboardInputError('媒体内容无法保存');
      }
    }
    if ((type === 'image' || type === 'video') && typeof item.body.resourceUrl !== 'string' && typeof item.body.file !== 'string') {
      throw new ClipboardInputError('没有可保存的媒体地址或内容');
    }
    return item;
  }

  private load() {
    const file = this.recordPath();
    if (!fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {version?: unknown; items?: unknown};
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error('clipboard file version');
      this.items = parsed.items.filter(isStoredItem);
    } catch {
      fs.renameSync(file, `${file}.bad-${Date.now()}`);
      this.items = [];
    }
  }

  private write(items: ClipboardItem[]) {
    const file = this.recordPath();
    const next = `${file}.tmp`;
    fs.writeFileSync(next, JSON.stringify({version: 1, items}, null, 2));
    fs.renameSync(next, file);
  }

  private recordPath() {
    return path.join(this.directory, 'items.json');
  }

  private readFile(filename: string): Buffer | undefined {
    if (!/^[\w.-]+$/.test(filename)) return;
    const root = path.resolve(this.directory, 'files');
    const file = path.resolve(root, filename);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return;
    if (!fs.existsSync(file)) return;
    return fs.readFileSync(file);
  }

  private deleteManagedFile(item: ClipboardItem) {
    const filename = typeof item.body.file === 'string' ? item.body.file : '';
    if (!/^[\w.-]+$/.test(filename)) return;
    const file = path.resolve(this.directory, 'files', filename);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

function assertType(type: unknown): string {
  if (typeof type !== 'string') throw new ClipboardInputError('类型无效');
  const trimmed = type.trim();
  if (!trimmed || trimmed.length > 64 || /[\u0000-\u001f]/.test(trimmed)) throw new ClipboardInputError('类型无效');
  return trimmed;
}

function sanitizeSource(source: CaptureSource): CaptureSource {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) throw new ClipboardInputError('来源格式无效');
  const clean = sanitizeRecord(source);
  if (clean.url != null && typeof clean.url !== 'string') throw new ClipboardInputError('来源地址无效');
  if (clean.title != null && typeof clean.title !== 'string') throw new ClipboardInputError('来源标题无效');
  if (typeof clean.url === 'string') clean.url = clean.url.slice(0, 4000);
  if (typeof clean.title === 'string') clean.title = clean.title.slice(0, 500);
  if (JSON.stringify(clean).length > 16_000) throw new ClipboardInputError('来源信息过长');
  return clean;
}

function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : undefined;
  const clean = sanitizeRecord(body);
  if (text !== undefined) clean.text = text;
  if (typeof clean.resourceUrl === 'string') clean.resourceUrl = clean.resourceUrl.slice(0, 4000);
  return clean;
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 40)) {
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const sanitized = sanitizeValue(value[key], 0);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null) return null;
  if (typeof value === 'string') return value.length > 8000 ? value.slice(0, 8000) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') return sanitizeRecord(value as Record<string, unknown>);
  return undefined;
}

function decodeDataUrl(value: string): {mime: string; bytes: Buffer} | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) return;
  const mime = match[1] || 'application/octet-stream';
  const bytes = match[2] ? Buffer.from(match[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(match[3] ?? ''), 'utf8');
  if (!bytes.length || bytes.length > MAX_BYTES) return;
  return {mime, bytes};
}

function extensionFor(mime: string) {
  return EXTENSIONS[mime] ?? 'bin';
}

function isStoredItem(value: unknown): value is ClipboardItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ClipboardItem>;
  return typeof item.id === 'string' && typeof item.type === 'string' && typeof item.createdAt === 'string'
    && !!item.source && typeof item.source === 'object' && !Array.isArray(item.source)
    && !!item.body && typeof item.body === 'object' && !Array.isArray(item.body);
}
