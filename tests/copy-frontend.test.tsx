// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {attachCopyFrontend} from '../src/browser/copy-frontend';
import {ClipboardStore} from '../src/clipboard/store';
import {ClipboardShelf} from '../src/clipboard-shelf';

let directory = '';
let detach = () => {};
afterEach(async () => {
  detach();
  detach = () => {};
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.title = '';
  document.getSelection()?.removeAllRanges();
  if (directory) fs.rmSync(directory, {recursive: true, force: true});
});

function installOfflineFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
}

async function clickCopy() {
  const popup = document.querySelector('okpaste-copy')?.shadowRoot?.querySelector<HTMLElement>('.popup');
  await vi.waitFor(() => expect(popup?.hidden).toBe(false));
  const button = popup?.querySelector('button.copy');
  expect(button?.textContent).toBe('加入内容包');
  button?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
}

function tempDir() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-copy-'));
  return directory;
}

function box(element: HTMLElement, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({
    x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() { return {}; },
  }) as DOMRect;
}

function pointer(type: 'down' | 'move' | 'up', x: number, y: number, shiftKey = false) {
  const name = typeof PointerEvent === 'function' ? `pointer${type}` : `mouse${type}`;
  const EventType = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  document.dispatchEvent(new EventType(name, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, shiftKey}));
}

async function saved(type?: string) {
  await vi.waitFor(() => {
    const items = new ClipboardStore(directory).list();
    expect(items.some(item => !type || item.type === type)).toBe(true);
  });
  return new ClipboardStore(directory).list();
}

describe('browser copy frontend', () => {
  it('copies a text selection into the persistent store', async () => {
    installOfflineFetch();
    const store = new ClipboardStore(tempDir());
    document.title = '笔记页';
    document.body.innerHTML = '<p id="paragraph">选中的句子</p>';
    detach = attachCopyFrontend(document, {
      ingest: draft => store.add(draft),
      pageSource: () => ({url: 'https://notes.example/page', title: '笔记页', lane: 'browser'}),
    }).detach;
    const paragraph = document.querySelector('#paragraph')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 24, clientY: 24}));
    await clickCopy();

    const items = await saved('text');
    expect(items[0]).toMatchObject({
      type: 'text',
      body: {text: '选中的句子'},
      source: {url: 'https://notes.example/page', title: '笔记页', lane: 'browser', captureMethod: 'selection-popup'},
    });
  });

  it('copies an image from the selection popup', async () => {
    installOfflineFetch();
    const store = new ClipboardStore(tempDir());
    document.body.innerHTML = '<img id="pic" alt="色块" src="https://photos.example/pic.png">';
    detach = attachCopyFrontend(document, {
      ingest: draft => store.add(draft),
      pageSource: () => ({url: 'https://photos.example', title: '照片页'}),
    }).detach;
    document.querySelector('#pic')?.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 12, clientY: 12}));
    await clickCopy();
    const items = await saved('image');
    expect(items[0]).toMatchObject({
      type: 'image',
      body: {resourceUrl: 'https://photos.example/pic.png', alt: '色块'},
      source: {url: 'https://photos.example', title: '照片页', mediaUrl: 'https://photos.example/pic.png'},
    });
  });

  it('does not show the toolbar at an empty caret while target marking is hidden',async()=>{
    const ingest=vi.fn(),mark=vi.fn();
    document.body.innerHTML='<textarea id="editor"></textarea>';
    detach=attachCopyFrontend(document,{ingest,startFromHere:mark}).detach;
    const editor=document.querySelector<HTMLTextAreaElement>('#editor')!;editor.focus();editor.setSelectionRange(0,0);
    editor.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:30,clientY:50}));
    const popup=document.querySelector('okpaste-copy')!.shadowRoot!;
    await vi.waitFor(()=>expect(popup.querySelector<HTMLElement>('.popup')!.hidden).toBe(true));
    expect(popup.querySelector<HTMLButtonElement>('.start')!.hidden).toBe(true);
    popup.querySelector<HTMLButtonElement>('.start')!.click();
    expect(mark).not.toHaveBeenCalled();expect(ingest).not.toHaveBeenCalled();
  });

  it('copies video metadata including the actual reference playback time',async()=>{
    installOfflineFetch();const store=new ClipboardStore(tempDir());
    document.body.innerHTML='<video id="clip" src="https://video.example/a.webm" title="参考"></video>';
    const video=document.querySelector<HTMLVideoElement>('#clip')!;video.currentTime=12.5;
    detach=attachCopyFrontend(document,{ingest:draft=>store.add(draft)}).detach;
    video.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));await clickCopy();
    const items=await saved('video');expect(items[0].body).toMatchObject({currentTime:12.5,resourceUrl:'https://video.example/a.webm'});
  });

  it('does not pretend a copy succeeded when the store rejects it', async () => {
    installOfflineFetch();
    const store = new ClipboardStore(tempDir());
    document.body.innerHTML = '<p id="paragraph">选中的句子</p>';
    detach = attachCopyFrontend(document, {
      ingest: () => { throw new Error('剪贴板没有就绪，内容没有保存'); },
      pageSource: () => ({url: 'https://notes.example', title: '笔记页'}),
    }).detach;
    const paragraph = document.querySelector('#paragraph')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 8, clientY: 8}));
    await clickCopy();
    await vi.waitFor(() => {
      expect(document.querySelector('okpaste-copy')?.shadowRoot?.textContent).toContain('剪贴板没有就绪');
    });
    expect(store.list()).toEqual([]);
    expect(new ClipboardStore(directory).list()).toEqual([]);
  });
});

describe('clipboard shelf', () => {
  it('reads the saved snapshot and asks a destination to paste', async () => {
    const calls: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const view = createRoot(root);
    await act(async () => {
      view.render(<ClipboardShelf snapshot={{
        generation: 1,
        ready: true,
        items: [{id: 'item-1', type: 'text', createdAt: '2026-10-27T00:00:00.000Z', source: {url: 'https://notes.example', title: '笔记'}, body: {text: '已保存'}}],
        destinations: [{id: 'notes', name: 'Notes', accepts: ['text']}, {id: 'blender', name: 'Blender', accepts: ['image']}],
      }} onPaste={(itemId, destinationId) => calls.push(`${itemId}:${destinationId}`)} />);
    });
    const select = root.querySelector('select');
    expect(select?.textContent).toContain('Notes');
    expect(select?.textContent).not.toContain('Blender');
    await act(async () => {
      if (!select) throw new Error('missing paste control');
      select.value = 'notes';
      select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    expect(calls).toEqual(['item-1:notes']);
    view.unmount();
  });
});

it('copies the current selection with a customized shortcut and respects a cleared shortcut',async()=>{
 let shortcut:{key:string;modifiers:string[]}|null={key:'k',modifiers:['ctrl','shift']};
 const ingest=vi.fn();document.body.innerHTML='<textarea id="editor">当前选区</textarea>';
 detach=attachCopyFrontend(document,{ingest,shortcut:()=>shortcut}).detach;
 const editor=document.querySelector<HTMLTextAreaElement>('#editor')!;editor.focus();editor.setSelectionRange(0,4);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',altKey:true,bubbles:true,cancelable:true}));expect(ingest).not.toHaveBeenCalled();
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'K',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(ingest).toHaveBeenCalledTimes(1));
 shortcut=null;document.dispatchEvent(new KeyboardEvent('keydown',{key:'K',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
 expect(ingest).toHaveBeenCalledTimes(1);
});

it('replaces an installed toolbar and its listeners instead of retaining a stale popup',async()=>{
 const oldIngest=vi.fn(),newIngest=vi.fn();
 const first=attachCopyFrontend(document,{ingest:oldIngest});
 detach=attachCopyFrontend(document,{ingest:newIngest}).detach;
 expect(document.querySelectorAll('okpaste-copy')).toHaveLength(1);
 const host=document.querySelector('okpaste-copy')!;
 expect(host.getAttribute('data-okpaste-version')).toBe('0.3.4');
 expect([...host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')].filter(button=>!button.hidden).map(button=>button.textContent)).toEqual(['加入内容包']);
 document.body.insertAdjacentHTML('afterbegin','<p id="replacement-source">替换后的参考文本</p>');
 const range=document.createRange();range.selectNodeContents(document.querySelector('#replacement-source')!);document.getSelection()!.addRange(range);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',altKey:true,bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(newIngest).toHaveBeenCalledTimes(1));
 expect(oldIngest).not.toHaveBeenCalled();first.detach();
 expect(document.querySelectorAll('okpaste-copy')).toHaveLength(1);
});

it('shows a keyboard selection but leaves ordinary copy outside the content pack',async()=>{
 const ingest=vi.fn(async(_draft:unknown)=>{});detach=attachCopyFrontend(document,{ingest}).detach;
 document.body.insertAdjacentHTML('afterbegin','<p id="news">一段新闻原文</p>');
 const range=document.createRange();range.selectNodeContents(document.querySelector('#news')!);document.getSelection()!.addRange(range);
 document.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));
 const popup=document.querySelector('okpaste-copy')!.shadowRoot!.querySelector<HTMLElement>('.popup')!;
 await vi.waitFor(()=>expect(popup.hidden).toBe(false));
 const event=new Event('copy',{bubbles:true,cancelable:true});document.dispatchEvent(event);
 await new Promise(resolve=>setTimeout(resolve,0));expect(ingest).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(false);
});

it.each([
  {name:'a single line',top:180,height:24,bottomEdge:false},
  {name:'a tall multiline selection',top:100,height:260,bottomEdge:false},
  {name:'a selection at the bottom edge',top:0,height:24,bottomEdge:true},
])('places the toolbar below $name, flipping only when necessary',async({top,height,bottomEdge})=>{
  installOfflineFetch();
  document.body.innerHTML='<p id="position-selection">用于检查位置的选中文字</p>';
  const range=document.createRange();range.selectNodeContents(document.querySelector('#position-selection')!);
  document.getSelection()?.addRange(range);
  const selectedRange=document.getSelection()!.getRangeAt(0);
  const selectionTop=bottomEdge?(window.innerHeight||600)-36:top;
  vi.spyOn(selectedRange,'getBoundingClientRect').mockReturnValue(new DOMRect(160,selectionTop,240,height));
  detach=attachCopyFrontend(document,{ingest:()=>undefined}).detach;
  document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:200,clientY:selectionTop+height}));
  const popup=document.querySelector('okpaste-copy')!.shadowRoot!.querySelector<HTMLElement>('.popup')!;
  await vi.waitFor(()=>expect(popup.hidden).toBe(false));
  expect(Number.parseFloat(popup.style.top)).toBe(bottomEdge?selectionTop-32-6:selectionTop+height+6);
});
