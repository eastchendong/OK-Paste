import {afterEach, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startClipboardServer} from '../src/clipboard/server';
import {ClipboardStore} from '../src/clipboard/store';
import {DestinationRegistry} from '../src/destinations/registry';
import {placeableCursor} from '../src/scene-runner';

let directory = '';
const servers: {close(): Promise<void>}[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  if (directory) fs.rmSync(directory, {recursive: true, force: true});
});

describe('drop confirmation', () => {
  it('treats a ray hit as a placeable cursor and ignores a miss', () => {
    expect(placeableCursor({preferredPlacementPoint: [0.1, 0.2, 0.3], worldPoint: [0.1, 0.2, 0.3]})).toBe(true);
    expect(placeableCursor({worldPoint: [1, 2, 3]})).toBe(true);
    expect(placeableCursor({error: 'no-view', preferredPlacementPoint: [1, 2, 3]})).toBe(false);
    expect(placeableCursor({locationRelation: 'unresolved'})).toBe(false);
    expect(placeableCursor(null)).toBe(false);
  });

  it('passes the drop id into the run and can dismiss it first', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-drop-'));
    const runs: Array<{actionIndex: number; dropEventId?: string}> = [];
    const dismissed: Array<string | undefined> = [];
    const server = await startClipboardServer({
      store: new ClipboardStore(directory),
      destinations: new DestinationRegistry(),
      port: 0,
      agent: {
        status: () => ({phase: 'ready', pendingDrop: {eventId: 'drop-1', placeable: true}}),
        run: input => {
          runs.push(input);
          return {ok: true, phase: 'running'};
        },
        dismissDrop: eventId => {
          dismissed.push(eventId);
          return {ok: true};
        },
      },
    });
    servers.push(server);
    const dismissedResponse = await fetch(`${server.url}/v1/agent/drop/dismiss`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({eventId: 'drop-1'}),
    });
    expect(dismissedResponse.status).toBe(200);
    expect(dismissed).toEqual(['drop-1']);
    const started = await fetch(`${server.url}/v1/agent/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({actionIndex: 0, dropEventId: 'drop-1'}),
    });
    expect(started.status).toBe(200);
    expect(runs).toEqual([{actionIndex: 0, dropEventId: 'drop-1'}]);
  });
});
