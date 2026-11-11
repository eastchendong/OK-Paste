import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentClient, type AgentPlan} from '../src/agent-client';
import type {BlenderClient} from '../src/blender-client';
import type {BlenderLink} from '../src/destinations/blender-link';
import {ClipboardStore} from '../src/clipboard/store';
import {listLocalModels} from '../src/model-assets';
import {SceneRunner} from '../src/scene-runner';

const directories: string[] = [];
const image = 'data:image/png;base64,iVBORw0KGgo=';
const cursor = {worldPoint: [1, 2, 0], preferredPlacementPoint: [1, 2, 0], hitObject: {name: 'Ground'}};
const plan: AgentPlan = {title: '在落点建参考标志牌', summary: '按参考程序化建模，保留原场景', actions: ['创建模型'], suggestions: ['在落点建参考标志牌'], questions: [], needsClarification: false};
afterEach(() => {vi.restoreAllMocks(); directories.splice(0).forEach(directory => fs.rmSync(directory, {recursive: true, force: true}));});
function root() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tuotie-blender-flex-'));
  directories.push(directory); fs.mkdirSync(path.join(directory, '.local'));
  return directory;
}
function tool(name: string, args: unknown = {}) {
  return {content: null, tool_calls: [{id: name, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
}

describe('Blender procedural modeling without matching assets', () => {
  for (const scenario of [
    {name: 'traffic barrier with only an unrelated apple asset', asset: true, primitive: 'primitive_cone_add'},
    {name: 'traffic barrier with an empty asset library', asset: false, primitive: 'primitive_cone_add'},
    {name: 'apple when its GLB is absent', asset: false, primitive: 'primitive_uv_sphere_add'},
  ]) it(scenario.name, async () => {
    const directory = root();
    if (scenario.asset) {
      fs.mkdirSync(path.join(directory, 'assets/models'), {recursive: true});
      fs.writeFileSync(path.join(directory, 'assets/models/apple.glb'), 'listing-only fixture');
    }
    const assets = listLocalModels(directory), model = new AgentClient(directory);
    const code = `import bpy\nbpy.ops.mesh.${scenario.primitive}(location=(1, 2, 0))\nbpy.context.object['okpaste_asset_kind'] = 'reference-subject'`;
    const request = vi.spyOn(model as any, 'request')
      .mockResolvedValueOnce(tool('present_plan', plan))
      .mockResolvedValueOnce(tool('execute_blender_code', {code}))
      .mockResolvedValueOnce(tool('look', {mode: 'viewport'}))
      .mockResolvedValueOnce({content: '参考模型已在独立预览中创建，请检查。'});
    const agentOp = vi.fn(async () => ({version: 1, changes: {added: ['ReferenceModel'], removed: [], modified: []}}));
    const raw = vi.fn(async () => ({content: [{type: 'image', mimeType: 'image/png', data: 'actual-preview-image'}]}));
    const client = {toolDefinitions: ['get_scene_info', 'look', 'execute_blender_code'].map(name => ({name, description: name, inputSchema: {type: 'object'}})), agentOp, raw} as unknown as BlenderClient;
    const context = {cursor, cursorOrigin: 'user-drop'};
    const conversation = [{role: 'user', text: `按参考创建模型：${scenario.name}`}];
    const planned = await model.plan({source: image, sceneImage: image, context, conversation, assets});
    const result = await model.execute({taskId: 'preview-task', plan: planned, context, source: image, sceneImage: image, assets, conversation, client, onStep: () => {}});
    expect(result.calls).toBe(2);
    expect(agentOp).toHaveBeenCalledExactlyOnceWith('run_code', {task: 'preview-task', code});
    expect(raw).toHaveBeenCalledWith('look', expect.objectContaining({mode: 'viewport'}));
    const planningMessages = request.mock.calls[0][0] as any[];
    expect(JSON.parse(planningMessages[1].content[0].text).availableAssets).toHaveLength(scenario.asset ? 1 : 0);
    const finalHistory = request.mock.calls.at(-1)![0] as any[];
    expect(finalHistory.some(message => Array.isArray(message.content) && message.content.some((part: any) => part.image_url?.url === 'data:image/png;base64,actual-preview-image'))).toBe(true);
  });
});

function dropSetup(needsClarification = false) {
  const directory = root(), store = new ClipboardStore(path.join(directory, 'clipboard'));
  const item = store.add({type: 'image', body: {dataUrl: image}});
  const context = {sceneFingerprint: 'unchanged', sceneSessionId: 'same-scene', scene: {objects: [{name: 'Ground'}]}};
  const agentOp = vi.fn(async (action: string) => action === 'status'
    ? {version: 1, changes: {added: ['ReferenceModel'], removed: [], modified: []}, originalUnchanged: true}
    : {ok: true});
  const blender = {connected: true, client: {op: vi.fn(async () => context), look: vi.fn(async () => image), agentOp}} as unknown as BlenderLink;
  const planner = vi.spyOn(AgentClient.prototype, 'plan').mockResolvedValue(needsClarification
    ? {...plan, suggestions: [], needsClarification: true, questions: ['两处互相冲突的目标，选哪个？']}
    : plan);
  const executor = vi.spyOn(AgentClient.prototype, 'execute').mockResolvedValue({summary: '已创建参考模型预览', calls: 2});
  const runner = new SceneRunner(directory, blender, store);
  fs.writeFileSync(path.join(directory, '.local/drop-event.json'), JSON.stringify({eventId: 'new-drop', context: {cursor}}));
  return {runner, planner, executor, agentOp, item};
}

it('keeps the reference-drop intent and exact cursor through focus updates, confirmation, preview and cancel', async () => {
  const {runner, planner, executor, agentOp, item} = dropSetup();
  try {
    (runner as any).ingestDrop(); await (runner as any).chain;
    expect(planner.mock.calls[0][0]).toMatchObject({context: {cursor, cursorOrigin: 'user-drop'}, conversation: [{role: 'user', text: expect.stringContaining('参考图片')}], assets: []});
    expect(agentOp).not.toHaveBeenCalled();
    runner.updateFocusContext({appName: 'Blender', bundleId: 'org.blenderfoundation.blender'});
    runner.ensurePlanned(); await (runner as any).chain;
    expect(planner).toHaveBeenCalledTimes(1);
    expect(runner.status().pendingDrop?.eventId).toBe('new-drop');
    expect(runner.run({itemId: item.id, actionIndex: 0, dropEventId: 'new-drop'}).ok).toBe(true);
    await (runner as any).chain;
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({context: expect.objectContaining({cursor, cursorOrigin: 'user-drop'}), assets: [], plan}));
    expect(runner.status()).toMatchObject({phase: 'preview', changes: {added: ['ReferenceModel']}});
    expect(agentOp.mock.calls.some(([action]) => action === 'commit')).toBe(false);
    await runner.control('cancel');
    expect(agentOp).toHaveBeenLastCalledWith('cancel', expect.objectContaining({task: expect.any(String)}));
    expect(runner.status().previewAvailable).toBe(false);
  } finally {runner.dispose();}
});

it('retains genuine clarification instead of overriding an ambiguous plan on drop confirmation', async () => {
  const {runner, executor, agentOp, item} = dropSetup(true);
  try {
    (runner as any).ingestDrop(); await (runner as any).chain;
    runner.run({itemId: item.id, actionIndex: 0, dropEventId: 'new-drop'});
    await (runner as any).chain;
    expect(executor).not.toHaveBeenCalled(); expect(agentOp).not.toHaveBeenCalled();
    expect(runner.status()).toMatchObject({phase: 'ready', questions: ['两处互相冲突的目标，选哪个？']});
  } finally {runner.dispose();}
});

it('retries a failed drop plan at the original cursor without losing its confirmation', async () => {
  const {runner, planner, agentOp} = dropSetup();
  planner.mockRejectedValueOnce(new Error('temporary model failure'));
  try {
    (runner as any).ingestDrop(); await (runner as any).chain;
    expect(runner.status()).toMatchObject({phase: 'error', pendingDrop: {eventId: 'new-drop'}});
    await runner.control('retry'); await (runner as any).chain;
    expect(planner).toHaveBeenCalledTimes(2);
    expect(planner.mock.calls[1][0].context).toMatchObject({cursor, cursorOrigin: 'user-drop'});
    expect(runner.status()).toMatchObject({phase: 'ready', pendingDrop: {eventId: 'new-drop'}});
    expect(agentOp).not.toHaveBeenCalled();
  } finally {runner.dispose();}
});

it('resumes a drop plan canceled by a focus transition without substituting the viewport centre', async () => {
  const {runner, planner} = dropSetup();
  let release!: (value: AgentPlan) => void;
  planner.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  try {
    (runner as any).ingestDrop();
    await vi.waitFor(() => expect(planner).toHaveBeenCalledTimes(1));
    const cancel = runner.control('cancel'); release(plan); await cancel;
    runner.updateFocusContext({appName: 'Blender', bundleId: 'org.blenderfoundation.blender'});
    runner.ensurePlanned(); await (runner as any).chain;
    expect(planner).toHaveBeenCalledTimes(2);
    expect(planner.mock.calls[1][0].context).toMatchObject({cursor, cursorOrigin: 'user-drop'});
    expect(runner.status()).toMatchObject({phase: 'ready', pendingDrop: {eventId: 'new-drop'}});
  } finally {runner.dispose();}
});
