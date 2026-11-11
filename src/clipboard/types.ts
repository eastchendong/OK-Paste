export interface CaptureSource {
  url?: string;
  title?: string;
  [key: string]: unknown;
}

export interface ClipboardItem {
  id: string;
  type: string;
  createdAt: string;
  archivedAt?: string;
  archiveTask?: string;
  source: CaptureSource;
  body: Record<string, unknown>;
}

export interface ClipboardDraft {
  type: string;
  source?: CaptureSource;
  body?: Record<string, unknown>;
}

export interface PublicClipboardItem {
  id: string;
  type: string;
  createdAt: string;
  archivedAt?: string;
  archiveTask?: string;
  source: CaptureSource;
  body: Record<string, unknown>;
  preview?: string;
}

export interface DestinationInfo {
  id: string;
  name: string;
  accepts: string[];
  connected?: boolean;
  detail?: string;
}

export interface ClipboardSnapshot {
  generation: number;
  ready: boolean;
  error?: string;
  items: PublicClipboardItem[];
  destinations: DestinationInfo[];
}

export class ClipboardInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipboardInputError';
  }
}

export function itemSummary(item: Pick<PublicClipboardItem, 'type' | 'body'>): string {
  const text = item.body.text;
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 80);
  const resource = item.body.resourceUrl;
  if (typeof resource === 'string' && resource) return resource;
  if (item.body.hasContent === true) return '已保存内容';
  return item.type;
}

export function sourceSummary(source: CaptureSource): string {
  const title = typeof source.title === 'string' ? source.title : '';
  const url = typeof source.url === 'string' ? source.url : '';
  if (title && url) return `${title} · ${url}`;
  return title || url || '来源未提供';
}
