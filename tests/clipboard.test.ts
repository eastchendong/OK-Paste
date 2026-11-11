import {afterEach, describe, expect, it, vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeSystemPasteboard} from '../src/clipboard/system-pasteboard';
import {ClipboardStore} from '../src/clipboard/store';
import {startClipboardServer} from '../src/clipboard/server';
import {CLIPBOARD_ITEMS_PATH} from '../src/clipboard/port';
import {DestinationRegistry} from '../src/destinations/registry';
import {createBlenderDestination} from '../src/destinations/blender';
import {classifyGesture, regionHits} from '../src/browser/geometry';
import {createRemoteIngest} from '../src/browser/remote-ingest';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;
let directory = '';
const servers: {close(): Promise<void>}[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  if (directory) fs.rmSync(directory, {recursive: true, force: true});
});

function tempStore() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-clipboard-'));
  return new ClipboardStore(directory);
}

describe('persistent clipboard', () => {
  it('archives a completed bundle without deleting content or a later capture',()=>{
    const store=tempStore();const image=store.add({type:'image',body:{dataUrl:PNG_URL}});
    const later=store.add({type:'text',body:{text:'下一次任务'}});
    expect(store.archive([image.id],'task-1')).toEqual([image.id]);
    const reopened=new ClipboardStore(directory);
    expect(reopened.list().map(item=>item.id)).toEqual([later.id]);
    expect(reopened.publicList(false,true).find(item=>item.id===image.id)).toMatchObject({archiveTask:'task-1',archivedAt:expect.any(String)});
    expect(reopened.readContent(image.id)).toEqual(PNG);
    expect(reopened.archive([image.id],'again')).toEqual([]);
  });

  it('exposes active items separately from archived history over HTTP',async()=>{
    const store=tempStore();const item=store.add({type:'text',body:{text:'本次资料'}});
    const server=await startClipboardServer({store,destinations:new DestinationRegistry(),port:0});servers.push(server);
    const result=await fetch(server.url+'/v1/clipboard/archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({itemIds:[item.id]})}).then(r=>r.json());
    expect(result.archived).toEqual([item.id]);
    expect((await fetch(server.url+CLIPBOARD_ITEMS_PATH).then(r=>r.json())).items).toEqual([]);
    expect((await fetch(server.url+CLIPBOARD_ITEMS_PATH+'?includeArchived=1').then(r=>r.json())).items[0].id).toBe(item.id);
  });
  it('keeps text, image, video and a later type after the store is reopened', () => {
    const store = tempStore();
    store.add({type: 'text', source: {url: 'https://notes.example/a', title: '笔记', lane: 'browser'}, body: {text: '甲'.repeat(9000)}});
    store.add({type: 'image', source: {url: 'https://photos.example/a', title: '照片', mediaUrl: 'https://photos.example/a.png'}, body: {resourceUrl: 'https://photos.example/a.png', dataUrl: PNG_URL, alt: '色块'}});
    store.add({type: 'video', source: {url: 'https://video.example/a', title: '影像'}, body: {resourceUrl: 'https://video.example/a.webm', name: '示例'}});
    store.add({type: 'note', source: {url: 'https://notes.example/b', title: '笔记', marker: 'later'}, body: {text: '新类型', marker: 1}});

    const reopened = new ClipboardStore(directory);
    const items = reopened.list();
    expect(items.map(item => item.type)).toEqual(['note', 'video', 'image', 'text']);
    const text = items.find(item => item.type === 'text');
    expect(text?.body.text).toBe('甲'.repeat(9000));
    expect(text?.source).toMatchObject({url: 'https://notes.example/a', title: '笔记', lane: 'browser'});
    const image = items.find(item => item.type === 'image');
    expect(reopened.readContent(image?.id ?? '')).toEqual(PNG);
    expect(image?.body.file).toEqual(expect.any(String));
    expect(reopened.toPublic(image!).body.file).toBeUndefined();
    expect(reopened.toPublic(image!).body.hasContent).toBe(true);
    expect(reopened.toPublic(image!).preview).toContain('data:image/png');
    expect(items.find(item => item.type === 'video')?.body).toMatchObject({resourceUrl: 'https://video.example/a.webm', name: '示例'});
    const note = items.find(item => item.type === 'note');
    expect(note?.source.marker).toBe('later');
    expect(note?.body).toMatchObject({text: '新类型', marker: 1});
  });

  it('rejects an empty capture and does not leave a record', () => {
    const store = tempStore();
    expect(() => store.add({type: ' ', body: {text: 'x'}})).toThrow(/类型无效/);
    expect(() => store.add({type: 'text', body: {text: '   '}})).toThrow(/没有可保存的文字/);
    expect(() => store.add({type: 'image', body: {}})).toThrow(/没有可保存的媒体/);
    expect(new ClipboardStore(directory).list()).toEqual([]);
  });

  it('keeps an image preview above 400 KB after reopening, and can omit it in polling', () => {
    const store = tempStore();
    const bytes = Buffer.concat([PNG, Buffer.alloc(576_216 - PNG.length)]);
    const item = store.add({type: 'image', source: {title: '大图'}, body: {dataUrl: `data:image/png;base64,${bytes.toString('base64')}`}});
    const reopened = new ClipboardStore(directory);
    expect(reopened.toPublic(reopened.get(item.id)!).preview).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    expect(reopened.publicList(false)[0].preview).toBeUndefined();
  });

  it('writes a browser capture through the local clipboard and reads it back', async () => {
    const store = tempStore();
    const server = await startClipboardServer({store, destinations: new DestinationRegistry(), port: 0});
    servers.push(server);
    await createRemoteIngest(server.url)({type: 'text', source: {url: 'https://notes.example/page', title: '笔记', lane: 'browser'}, body: {text: '远端写入'}});
    await server.close();
    servers.pop();
    const reopened = new ClipboardStore(directory);
    expect(reopened.list()[0]).toMatchObject({type: 'text', body: {text: '远端写入'}, source: {url: 'https://notes.example/page', title: '笔记', lane: 'browser'}});
  });

  it('serves the same records after the clipboard server restarts', async () => {
    const store = tempStore();
    const destinations = new DestinationRegistry();
    const seen: string[] = [];
    destinations.register({id: 'archive', name: 'Archive', accepts: ['*'], paste(item) { seen.push(item.id); }});
    const server = await startClipboardServer({store, destinations, port: 0});
    servers.push(server);
    const created = await fetch(`${server.url}${CLIPBOARD_ITEMS_PATH}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({type: 'video', source: {url: 'https://video.example/watch', title: '影像', cut: 'a'}, body: {resourceUrl: 'https://video.example/watch.mp4'}}),
    });
    expect(created.status).toBe(201);
    const item = (await created.json()).item;
    await server.close();
    servers.pop();

    const restarted = await startClipboardServer({store: new ClipboardStore(directory), destinations, port: 0});
    servers.push(restarted);
    const listed = await fetch(`${restarted.url}${CLIPBOARD_ITEMS_PATH}`).then(response => response.json());
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({id: item.id, type: 'video', source: {url: 'https://video.example/watch', title: '影像', cut: 'a'}});
    const pasted = await fetch(`${restarted.url}/v1/clipboard/paste`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({itemId: item.id, destinationId: 'archive'}),
    });
    expect(pasted.status).toBe(200);
    expect(seen).toEqual([item.id]);
  });
});

describe('paste destinations', () => {
  it('lets a destination read saved bytes and keeps Blender as one image destination', async () => {
    const store = tempStore();
    const image = store.add({type: 'image', source: {url: 'https://photos.example/a', title: '照片'}, body: {dataUrl: PNG_URL, resourceUrl: 'https://photos.example/a.png'}});
    const text = store.add({type: 'text', source: {url: 'https://notes.example/a', title: '笔记'}, body: {text: '一段话'}});
    const reopened = new ClipboardStore(directory);
    const target = {state: {active: false, busy: false, stage: 'idle'}, mode: vi.fn(async (active: boolean) => { target.state.active = active; }), acceptImage: vi.fn()};
    const registry = new DestinationRegistry();
    registry.register(createBlenderDestination(target));
    registry.register({id: 'notes', name: 'Notes', accepts: ['text', 'note'], paste: vi.fn()});

    await registry.paste('blender', reopened.get(image.id)!, reopened);
    expect(target.mode).toHaveBeenCalledWith(true);
    expect(target.acceptImage).toHaveBeenCalledWith(PNG, '照片 · https://photos.example/a');
    await expect(registry.paste('blender', reopened.get(text.id)!, reopened)).rejects.toThrow(/不接收该类型/);
    expect(registry.list().map(destination => destination.id)).toEqual(['blender', 'notes']);
    expect(registry.list().find(destination => destination.id === 'blender')?.accepts).toEqual(['image']);

    target.state.stage = 'preview';
    target.acceptImage.mockClear();
    await expect(registry.paste('blender', reopened.get(image.id)!, reopened)).rejects.toThrow(/确认或取消/);
    expect(target.acceptImage).not.toHaveBeenCalled();
  });
});

describe('system pasteboard', () => {
  it('puts saved text on the macOS clipboard and restores whatever was there', () => {
    if (process.platform !== 'darwin') return;
    const previous = spawnSync('/usr/bin/pbpaste', {encoding: 'utf8'}).stdout;
    const marker = `妥帖剪贴板探测 ${Date.now()}`;
    try {
      writeSystemPasteboard({id: 'probe', type: 'text', createdAt: new Date().toISOString(), source: {title: '探测'}, body: {text: marker}});
      expect(spawnSync('/usr/bin/pbpaste', {encoding: 'utf8'}).stdout).toBe(marker);
    } finally {
      spawnSync('/usr/bin/pbcopy', {input: previous});
    }
  });
});

describe('selection geometry', () => {
  it('distinguishes a drag rectangle from a circle', () => {
    const drag = classifyGesture([{x: 10, y: 10}, {x: 80, y: 40}], false);
    expect(drag?.kind).toBe('drag');
    if (drag?.kind === 'drag') {
      expect(regionHits(drag, {x: 20, y: 20, width: 30, height: 10})).toBe(true);
      expect(regionHits(drag, {x: 200, y: 200, width: 10, height: 10})).toBe(false);
    }
    const circle = classifyGesture([{x: 100, y: 100}, {x: 140, y: 100}], true);
    expect(circle?.kind).toBe('circle');
    if (circle?.kind === 'circle') {
      expect(regionHits(circle, {x: 110, y: 90, width: 10, height: 10})).toBe(true);
      expect(regionHits(circle, {x: 400, y: 400, width: 20, height: 20})).toBe(false);
    }
    const loop = Array.from({length: 13}, (_, index) => ({
      x: 100 + 40 * Math.cos((index / 12) * Math.PI * 2),
      y: 100 + 40 * Math.sin((index / 12) * Math.PI * 2),
    }));
    const lasso = classifyGesture(loop, false);
    expect(lasso?.kind).toBe('circle');
    if (lasso?.kind === 'circle') {
      expect(regionHits(lasso, {x: 90, y: 90, width: 20, height: 20})).toBe(true);
      expect(regionHits(lasso, {x: 0, y: 0, width: 10, height: 10})).toBe(false);
    }
  });
});

it('accepts both installed Word host generations while refusing browser initiated captures',async()=>{
 const beginWordPaste=vi.fn(async()=>({ok:true}));
 const host=await startClipboardServer({store:tempStore(),destinations:new DestinationRegistry(),agent:{status:()=>({targetKind:'word-live'}),run:()=>({ok:true}),beginWordPaste}});servers.push(host);
 const focus={appName:'Word',bundleId:'com.microsoft.Word'};
 for(const header of ['word-paste','office-paste']){
  const response=await fetch(host.url+'/v1/agent/word-paste',{method:'POST',headers:{'Content-Type':'application/json','X-Tuotie-Native':header},body:JSON.stringify(focus)});
  expect(response.status).toBe(200);
 }
 const browser=await fetch(host.url+'/v1/agent/word-paste',{method:'POST',headers:{'Content-Type':'application/json','X-Tuotie-Native':'office-paste',Origin:'https://example.com'},body:JSON.stringify(focus)});
 expect(browser.status).toBe(403);expect(beginWordPaste).toHaveBeenCalledTimes(2);
});

it('protects Blender shortcut capture with the native header and Blender foreground identity',async()=>{
 const beginBlenderPaste=vi.fn(async()=>({ok:true}));
 const host=await startClipboardServer({store:tempStore(),destinations:new DestinationRegistry(),agent:{status:()=>({}),run:()=>({ok:true}),beginBlenderPaste}});servers.push(host);
 const focus={appName:'Blender',bundleId:'org.blenderfoundation.blender'};
 const post=(body:unknown,headers:Record<string,string>={})=>fetch(host.url+'/v1/agent/blender-paste',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 expect((await post(focus)).status).toBe(403);
 expect((await post(focus,{'X-Tuotie-Native':'office-paste',Origin:'https://example.com'})).status).toBe(403);
 expect((await post({...focus,bundleId:'com.other.app'},{'X-Tuotie-Native':'office-paste'})).status).toBe(400);
 expect((await post(focus,{'X-Tuotie-Native':'office-paste'})).status).toBe(200);
 expect(beginBlenderPaste).toHaveBeenCalledExactlyOnceWith(focus);
});
