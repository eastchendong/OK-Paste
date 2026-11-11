import type {CaptureSource, ClipboardDraft} from '../clipboard/types';
import {regionHits, type Box, type SelectionRegion} from './geometry';

const MEDIA_LIMIT = 6_000_000;
const VIDEO_LIMIT = 4_000_000;

export async function textDraft(text: string, source: CaptureSource, captureMethod: string): Promise<ClipboardDraft> {
  return {type: 'text', source: {...source, captureMethod}, body: {text}};
}

export async function imageDraft(image: HTMLImageElement, source: CaptureSource, captureMethod: string): Promise<ClipboardDraft | null> {
  const resourceUrl = image.currentSrc || image.src;
  if (!resourceUrl) return null;
  const body: Record<string, unknown> = {resourceUrl};
  if (image.alt) body.alt = image.alt;
  const inline = await inlineResource(resourceUrl, image.ownerDocument, MEDIA_LIMIT);
  if (inline) {
    body.dataUrl = inline.dataUrl;
    body.mime = inline.mime;
  }
  return {type: 'image', source: {...source, captureMethod, mediaUrl: resourceUrl}, body};
}

export async function videoDraft(video: HTMLVideoElement, source: CaptureSource, captureMethod: string): Promise<ClipboardDraft | null> {
  const resourceUrl = video.currentSrc || video.src;
  if (!resourceUrl) return null;
  const body: Record<string, unknown> = {resourceUrl,currentTime:video.currentTime||0};
  if (video.poster) body.poster = video.poster;
  if (Number.isFinite(video.duration)) body.duration = video.duration;
  const title = video.getAttribute('title');
  if (title) body.name = title;
  const inline = await inlineResource(resourceUrl, video.ownerDocument, VIDEO_LIMIT, true);
  if (inline) {
    body.dataUrl = inline.dataUrl;
    body.mime = inline.mime;
  }
  return {type: 'video', source: {...source, captureMethod, mediaUrl: resourceUrl}, body};
}

export async function draftsFromRegion(doc: Document, region: SelectionRegion, source: CaptureSource): Promise<ClipboardDraft[]> {
  const drafts: ClipboardDraft[] = [];
  const elements = doc.body ? [...doc.body.querySelectorAll('*')] : [];
  for (const element of elements) {
    if (isIgnored(element) || !regionHits(region, boxOf(element))) continue;
    const declared = element.getAttribute('data-okpaste-type')?.trim();
    if (declared) {
      drafts.push(declaredDraft(element, declared, source, region.kind === 'circle' ? 'circle-select' : 'drag-select'));
      continue;
    }
    if (element instanceof HTMLImageElement) {
      const draft = await imageDraft(element, source, region.kind === 'circle' ? 'circle-select' : 'drag-select');
      if (draft) drafts.push(draft);
      continue;
    }
    if (element instanceof HTMLVideoElement) {
      const draft = await videoDraft(element, source, region.kind === 'circle' ? 'circle-select' : 'drag-select');
      if (draft) drafts.push(draft);
      continue;
    }
    const text = ownText(element);
    if (text) drafts.push({type: 'text', source: {...source, captureMethod: region.kind === 'circle' ? 'circle-select' : 'drag-select'}, body: {text}});
  }
  return drafts;
}

function declaredDraft(element: Element, type: string, source: CaptureSource, captureMethod: string): ClipboardDraft {
  const body: Record<string, unknown> = {};
  const text = ownText(element) || element.textContent?.replace(/\s+/g, ' ').trim();
  if (text) body.text = text;
  const payload = element.getAttribute('data-okpaste-payload');
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(body, parsed);
    } catch { /* extra payload is optional */ }
  }
  return {type, source: {...source, captureMethod, element: element.tagName.toLowerCase()}, body};
}

function ownText(element: Element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function isIgnored(element: Element) {
  const tag = element.tagName;
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || element.closest('okpaste-copy') != null;
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return {x: rect.left, y: rect.top, width: rect.width, height: rect.height};
}

async function inlineResource(url: string, doc: Document, limit: number, video = false): Promise<{dataUrl: string; mime: string} | undefined> {
  try {
    if (url.startsWith('data:')) {
      const mime = url.slice(5, url.indexOf(';')) || 'application/octet-stream';
      return url.length < limit * 1.4 ? {dataUrl: url, mime} : undefined;
    }
    const absolute = new URL(url, doc.baseURI).href;
    if (video) {
      const head = await fetch(absolute, {method: 'HEAD'});
      const length = Number(head.headers.get('content-length') || 0);
      if (!head.ok || !length || length > limit) return;
    }
    const response = await fetch(absolute);
    if (!response.ok) return;
    const blob = await response.blob();
    if (!blob.size || blob.size > limit) return;
    const dataUrl = await blobToDataUrl(blob);
    return {dataUrl, mime: blob.type || 'application/octet-stream'};
  } catch {
    return;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}
