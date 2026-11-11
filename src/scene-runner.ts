import type {AppContext} from './app-context';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {AgentClient, type AgentPlan} from './agent-client';
import type {ClipboardItem} from './clipboard/types';
import type {ClipboardStore} from './clipboard/store';
import type {BlenderLink} from './destinations/blender-link';
import {listLocalModels} from './model-assets';

export interface SceneRunRequest {
  continuation?: boolean;
  destinationId?: string;
  itemId?: string;
  itemIds?: string[];
  actionIndex: number;
  instruction?: string;
  dropEventId?: string;
}
export type SceneControl = 'commit' | 'cancel' | 'undo' | 'retry' | 'finish';
type Cursor = {area?: string; error?: unknown; preferredPlacementPoint?: unknown; worldPoint?: unknown; locationRelation?: string; hitObject?: {name?: string}};
export interface PendingDrop {
  eventId: string;
  destinationId: string;
  appName: string;
  placeable: boolean;
  summary: string;
  cursor: unknown;
  cursorOrigin?: 'viewport-center' | 'user-drop';
}
type SceneContext = {
  focus?:AppContext;
  sceneFingerprint?: string;
  sceneSessionId?: string;
  scene?: {name?: string; objects?: Array<{name?: string}>};
  cursor?: unknown;
  cursorOrigin?: 'viewport-center' | 'user-drop';
  sources?: unknown[];
};
type Changes = {added: string[]; removed: string[]; modified: string[]; scene?: string[]};
type ResultGeometry = {available:boolean; phase:'preview'|'done'; reason?:string; coordinateSpace?:'window-content-normalized-top-left'; objectCount?:number; window?:{x:number;y:number;width:number;height:number}; regions?:Array<{x:number;y:number;width:number;height:number}>; viewports?:unknown[]; screenMetrics?:unknown};

export function placeableCursor(cursor: unknown): boolean {
  if (!cursor || typeof cursor !== 'object' || (cursor as Cursor).error) return false;
  const value = cursor as Cursor;
  const point = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n));
  return point(value.preferredPlacementPoint) || point(value.worldPoint);
}
function dropSummary(cursor: unknown): string {
  const value = cursor as Cursor | null;
  if (!placeableCursor(cursor)) return '位置待明确';
  if (value?.locationRelation === 'basket' || value?.locationRelation === 'projected-inside-basket') return '篮内落点';
  if (value?.locationRelation === 'outside-basket') return '桌面落点';
  return value?.hitObject?.name || '三维视图';
}
function recommendations(plan: AgentPlan): string[] {
  if (plan.suggestions?.length) return plan.suggestions;
  return plan.needsClarification ? [] : [plan.title];
}

export class SceneRunner {
  onDrop?: () => boolean;
  phase: 'idle' | 'planning' | 'ready' | 'running' | 'preview' | 'done' | 'error' = 'idle';
  itemId = '';
  title = '';
  summary = '';
  actions: string[] = [];
  error = '';
  result = '';
  step = '';
  changes: Changes | null = null;
  previewImage = '';
  resultFeedback: (ResultGeometry & {id:string; capturedAt?:number}) | null = null;
  private plan: AgentPlan | null = null;
  private targetLocation='';
  private context: SceneContext | null = null;
  private source = '';
  private conversation: {role: string; text: string}[] = [];
  private chain: Promise<void> = Promise.resolve();
  private model: AgentClient | null = null;
  private seenDropId = '';
  private pendingDrop: PendingDrop | null = null;
  private plannedDropId = '';
  private taskId = '';
  private version = 0;
  private lastCommitted = '';
  private abort?: AbortController;
  private supplements: string[] = [];
  private timer: ReturnType<typeof setInterval>;
  private stopping = false;
  private pasteCapturing = false;
  private pasteCaptureRevision = 0;

  constructor(private readonly root: string, private readonly blender: BlenderLink, private readonly store: ClipboardStore) {
    this.seenDropId = this.readDropFile()?.eventId ?? '';
    this.timer = setInterval(() => this.ingestDrop(), 400);
    this.timer.unref();
  }
  dispose() { clearInterval(this.timer); }
  async shutdown() { this.stopping = true; this.dispose(); await this.control('cancel'); }
  status() {
    return {
      targetKind:'blender-scene',targetLocation:this.pendingDrop?.summary||this.targetLocation,adjustmentProfile:'scene',phase: this.phase, itemId: this.itemId, title: this.title, summary: this.summary,
      plannedSourceIds:this.plannedSourceIds,actions: this.actions, questions: this.plan?.questions ?? [], needsClarification: this.plan?.needsClarification ?? false, error: this.error,
      result: this.result, step: this.step, changes: this.changes,
      previewAvailable: Boolean(this.previewImage), canUndo: Boolean(this.lastCommitted),
      resultFeedback: this.resultFeedback,
      pendingDrop: this.pendingDrop ? {...this.pendingDrop, cursor: undefined} : null,
    };
  }
  private focusContext?:AppContext;
  private planSignature='';private planRevision=0;private plannedSourceIds:string[]=[];
  updateFocusContext(focus:AppContext){if(JSON.stringify(focus)!==JSON.stringify(this.focusContext)){this.focusContext=focus;this.planSignature='';}}
  async beginPaste(focus: AppContext) {
    if (this.stopping || this.pasteCapturing || ['running', 'preview'].includes(this.phase)) throw new Error('请先完成或取消当前任务');
    const item = this.latestItem();
    if (!item) throw new Error('请先向内容包添加参考图片或文字');
    const captureRevision=++this.pasteCaptureRevision, planRevision=++this.planRevision;
    this.pasteCapturing = true; this.abort?.abort();
    this.plan=null; this.actions=[]; this.plannedSourceIds=[]; this.pendingDrop=null; this.plannedDropId='';
    this.phase='planning'; this.error=''; this.step='读取三维视口中心';
    const check=()=>{
      if(this.stopping||!this.pasteCapturing||captureRevision!==this.pasteCaptureRevision||planRevision!==this.planRevision||this.phase!=='planning')throw new Error('本次位置捕获已取消，请重新按 ⌥⌘V');
      if(!this.store.list().some(source=>source.id===item.id))throw new Error('来源内容已改变，请重新按 ⌥⌘V');
    };
    try {
      await this.chain; check();
      if (!this.blender.connected) {await this.blender.connect(); check();}
      if (!this.blender.connected) throw new Error('Blender 尚未连接，请打开 Blender 后重试');
      const cursor = await this.viewCursor(); check();
      if (!cursor || (cursor as Cursor).error) throw new Error('请在 Blender 打开三维视口后按 ⌥⌘V');
      this.updateFocusContext(focus);
      const drop: PendingDrop = {eventId: crypto.randomUUID(), destinationId: 'blender', appName: 'Blender', placeable: placeableCursor(cursor), summary: '三维视口中心', cursor, cursorOrigin: 'viewport-center'};
      this.itemId = item.id; this.pendingDrop = drop;
      this.pasteCapturing=false;
      this.planDrop(item, drop);
      return {ok: true};
    } catch(error) {
      if(captureRevision===this.pasteCaptureRevision){this.phase='idle';this.step='';}
      throw error;
    } finally {if(captureRevision===this.pasteCaptureRevision)this.pasteCapturing = false;}
  }
  cancelPasteCapture() {
    if(!this.pasteCapturing)return false;
    ++this.pasteCaptureRevision; ++this.planRevision; this.pasteCapturing=false;
    this.abort?.abort(); this.phase='idle'; this.step=''; this.planSignature='';
    return true;
  }
  ensurePlanned() {
    if(this.stopping||this.pasteCapturing||!this.blender.connected||['running','preview'].includes(this.phase))return;
    if(this.pendingDrop){
      // A foreground refresh must not replace a real drop with the viewport
      // centre. Resume an interrupted/explicitly retried drop at its own cursor.
      if(this.plannedDropId!==this.pendingDrop.eventId&&['idle','ready'].includes(this.phase)){
        const item=this.store.get(this.itemId)??this.latestItem();
        if(item)this.planDrop(item,this.pendingDrop);
      }
      return;
    }
    const items=this.store.list(),latest=this.latestItem();
    const signature=JSON.stringify([items.map(item=>item.id),this.focusContext]);
    if(signature===this.planSignature&&this.phase!=='idle')return;
    this.abort?.abort();const revision=++this.planRevision;this.planSignature=signature;
    if(!latest){this.actions=[];this.phase='idle';return;}
    this.phase='planning';this.actions=[];this.abort=new AbortController();const signal=this.abort.signal;
    this.enqueue(async()=>{try{if(revision!==this.planRevision)return;await this.planItem(latest,'',undefined,signal,revision);}catch(error){if(revision!==this.planRevision||signal.aborted)return;throw error;}});
  }
  private enqueue(work: () => Promise<void>) {
    this.chain = this.chain.then(work).catch(error => {
      this.phase = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.step = '';
      this.record();
    });
    return this.chain;
  }
  private agent() { return this.model ??= new AgentClient(this.root); }
  private latestItem() { return this.store.list().find(item => (item.type === 'image' && typeof item.body.file === 'string') || typeof item.body.text === 'string'); }
  private sourceImage(item: ClipboardItem) {
    const mime = typeof item.body.mime === 'string' ? item.body.mime : '';
    const bytes = item.type === 'image' ? this.store.readContent(item.id) : undefined;
    return bytes?.length ? `data:${mime || 'image/jpeg'};base64,${bytes.toString('base64')}` : '';
  }
  private sourceFacts(item: ClipboardItem) {
    const {file, dataUrl, ...body} = item.body;
    return {id: item.id, type: item.type, source: item.source, body};
  }
  private async planItem(item: ClipboardItem, instruction = '', cursor?: unknown, signal=this.abort!.signal, revision=this.planRevision, cursorOrigin: 'viewport-center' | 'user-drop' = 'user-drop') {
    this.phase = 'planning'; this.error = ''; this.step = '理解来源和当前场景';
    this.itemId = item.id;
    this.source = this.sourceImage(item);
    const scene = cursor === undefined ? await this.sceneContext() : {...await this.blender.client.op<SceneContext>('context'), cursor, cursorOrigin};
    const items=this.store.list();
    this.context = {...scene, sources: items.map(source=>this.sourceFacts(source)), focus:this.focusContext};
    const sceneImage = await this.blender.client.look();
    const request = instruction || (cursor !== undefined
      ? `${cursorOrigin === 'viewport-center' ? '我在 Blender 按了 ⌥⌘V，使用此刻三维视口中心的真实射线位置；这不是鼠标落点。请结合内容包参考和当前场景规划操作。' : '我把参考图片拖到了这个位置。请在真实拖放落点创建与参考主体相符的三维模型预览；'}有合适的现成模型可复用，没有就通过 Blender 程序化建模。常规尺寸和细节请结合场景合理决定，保留已有对象，先给出待确认的具体方案。`
      : '');
    this.conversation = request ? [{role: 'user', text: request}] : [];
    if (signal.aborted || this.stopping || revision!==this.planRevision) return;
    const plan = await this.agent().plan({source: this.source, images:items.map(source=>this.sourceImage(source)).filter(Boolean), sceneImage, context: this.context, conversation: this.conversation, assets: listLocalModels(this.root)}, signal);
    if(signal.aborted||revision!==this.planRevision)return;this.plan=plan;this.plannedSourceIds=items.map(source=>source.id);
    this.actions = recommendations(this.plan);
    this.title = this.plan.title;
    this.summary = this.plan.summary;
    this.phase = 'ready'; this.step = '';
    this.record();
  }
  dismissDrop(eventId?: string) {
    if (eventId && this.pendingDrop?.eventId !== eventId) return {ok: true};
    if (this.pendingDrop) this.seenDropId = this.pendingDrop.eventId;
    this.pendingDrop = null;
    return {ok: true};
  }
  run(input: SceneRunRequest) {
    if(this.pasteCapturing)return {ok:false,error:'正在读取三维视口中心，请稍候'};
    const interruptPlan=this.phase==='planning'&&Boolean(this.pendingDrop&&input.instruction?.trim());
    if (!interruptPlan&&!['ready', 'done', 'preview', 'error'].includes(this.phase)) return {ok: false, error: '正在处理，请稍候'};
    const item = input.itemId ? this.store.get(input.itemId) : input.itemIds?.length
      ? input.itemIds.map(id => this.store.get(id)).find(Boolean) : this.store.get(this.itemId);
    if (!item) return {ok: false, error: '请选择已保存的来源内容'};
    const instruction = input.instruction?.trim().slice(0, 4000) || '';
    if(this.pendingDrop&&!input.dropEventId)return {ok:false,error:'请在本次目标面板发送要求，或重新选择位置'};
    const drop = input.dropEventId ? this.pendingDrop : null;
    if (input.dropEventId && drop?.eventId !== input.dropEventId) return {ok: false, error: '这次拖放已经失效，请再拖一次'};
    const chosen = instruction || (drop ? this.plan?.title : this.actions[input.actionIndex]);
    if (!chosen) return {ok: false, error: '输入要求，或选择一条推荐'};
    if(interruptPlan){this.abort?.abort();++this.planRevision;}
    if (drop){this.seenDropId = drop.eventId;this.targetLocation=drop.summary;}
    this.pendingDrop = null;
    if (!this.taskId && !(input.continuation && this.phase === 'done')) this.conversation = [];
    this.supplements = [];
    this.phase = 'running'; this.error = ''; this.result = ''; this.resultFeedback = null; this.step = '读取当前场景';
    this.abort = new AbortController();
    const sources = (input.itemIds ?? [item.id]).map(id => this.store.get(id)).filter((source): source is ClipboardItem => Boolean(source)).map(source => this.sourceFacts(source));
    this.enqueue(() => this.execute(item, chosen, Boolean(instruction), drop?.cursor, sources, drop?.cursorOrigin));
    return {ok: true, phase: 'running'};
  }
  supplement(instruction: string) {
    if (this.phase !== 'running') return {ok: false, error: '当前没有生成任务，请在方向输入框补充要求'};
    if (!instruction.trim()) return {ok: false, error: '请输入补充要求'};
    this.supplements.push(instruction.trim().slice(0, 4000));
    this.step = '已收到补充要求，接着处理';
    return {ok: true};
  }
  private async execute(item: ClipboardItem, chosen: string, custom: boolean, dropped?: unknown, sources: unknown[] = [], cursorOrigin: 'viewport-center' | 'user-drop' = 'user-drop') {
    const signal = this.abort!.signal;
    try {
      await this.clearResultFeedback();
      const scene = dropped === undefined ? await this.sceneContext() : {...await this.blender.client.op<SceneContext>('context'), cursor: dropped, cursorOrigin};
      const context = {...scene, sources};
      const sceneImage = await this.blender.client.look();
      this.source = this.sourceImage(item);
      const sourceChanged = this.itemId !== item.id;
      this.itemId = item.id;
      const assets = listLocalModels(this.root);
      const images = sources.flatMap(source => {
        const id = (source as {id?: string}).id;
        const saved = id ? this.store.get(id) : undefined;
        const image = saved ? this.sourceImage(saved) : '';
        return image ? [image] : [];
      });
      const conversation = [...this.conversation, {role: 'user', text: chosen}];
      let plan: AgentPlan = dropped !== undefined && !custom && this.plan
        ? this.plan : {title: chosen, summary: chosen, actions: [chosen], questions: [], needsClarification: false};
      if (sourceChanged || context.sceneFingerprint !== this.context?.sceneFingerprint || context.sceneSessionId !== this.context?.sceneSessionId || custom && (dropped === undefined && !this.taskId || this.plan?.needsClarification || dropped !== undefined && !placeableCursor(dropped))) {
        this.step = '理解你的要求';
        plan = await this.agent().plan({source: this.source, images, sceneImage, context, conversation, assets}, signal);
      }
      this.context = context; this.plan = plan; this.title = plan.title; this.summary = plan.summary;
      if (plan.needsClarification) {
        this.actions = recommendations(plan); this.phase = this.taskId ? 'preview' : 'ready'; this.step = '';
        this.result = [plan.summary, ...plan.questions].join('\n');
        this.record(); return;
      }
      if (signal.aborted) throw new Error('任务已取消');
      if (!this.taskId) {
        this.taskId = crypto.randomUUID();
        await this.blender.client.agentOp('begin', {task: this.taskId});
      }
      const previewContext = {...await this.blender.client.op<SceneContext>('context'), cursor: context.cursor, cursorOrigin: context.cursorOrigin, sources};
      this.step = '生成独立预览';
      const executed = await this.agent().execute({
        taskId: this.taskId, plan, context: previewContext, source: this.source, images, sceneImage, assets, conversation,
        client: this.blender.client, signal,
        onStep: step => { this.step = step; },
      });
      if (signal.aborted) throw new Error('任务已取消');
      this.conversation = [...conversation, {role: 'assistant', text: executed.summary}];
      const supplement = this.supplements.splice(0).join('\n');
      if (supplement) { await this.execute(item, supplement, true, dropped, sources, cursorOrigin); return; }
      const status = await this.blender.client.agentOp<{version: number; changes: Changes; originalUnchanged: boolean}>('status', {task: this.taskId});
      this.version = status.version; this.changes = status.changes;
      const changed = Object.values(status.changes).some(list => list.length);
      this.result = executed.summary;
      if (!changed) {
        await this.cancelPreview();
        this.phase = 'ready'; this.step = '本次没有修改场景';
      } else {
        this.previewImage = executed.previewImage || await this.blender.client.look();
        this.phase = 'preview'; this.step = '检查预览，再决定是否应用';
        await this.describeResultFeedback(this.taskId, 'preview');
      }
      this.record({toolCalls: executed.calls, originalUnchanged: status.originalUnchanged, chosenAction: chosen, cursor: context.cursor});
    } catch (error) {
      await this.cancelPreview();
      if (signal.aborted) { this.phase = 'ready'; this.step = ''; this.record(); return; }
      throw error;
    }
  }
  async control(action: SceneControl) {
    if (action === 'cancel') {
      this.cancelPasteCapture();
      this.supplements = [];
      this.abort?.abort(); await this.chain;
      await this.cancelPreview(); this.phase = 'ready'; this.error = ''; this.step = ''; this.record();
      return {ok: true};
    }
    if(this.pasteCapturing)return {ok:false,error:'正在读取三维视口中心，请稍候'};
    if (['planning', 'running'].includes(this.phase)) return {ok: false, error: '正在处理，请稍候'};
    if (action === 'finish') {
      if(this.phase==='preview')return {ok:false,error:'请先应用或取消预览'};
      this.dismissDrop();this.abort?.abort();++this.planRevision;this.phase='idle';this.result='';this.changes=null;this.conversation=[];this.record();return {ok:true};
    }
    if (action === 'commit') {
      if (this.phase !== 'preview' || !this.taskId) return {ok: false, error: '请先查看预览'};
      try { await this.blender.client.agentOp('commit', {task: this.taskId, version: this.version}); }
      catch (error) {
        const status = await this.blender.client.agentOp<{committed: boolean}>('status', {task: this.taskId}).catch(() => null);
        if (!status?.committed) throw error;
      }
      this.lastCommitted = this.taskId; this.taskId = ''; this.phase = 'done'; this.step = '已应用到 Blender';
      this.previewImage = ''; await this.describeResultFeedback(this.lastCommitted, 'done'); this.record();
      return {ok: true};
    }
    if (action === 'undo') {
      if (!this.lastCommitted) return {ok: false, error: '没有可撤回的场景修改'};
      await this.clearResultFeedback();
      await this.blender.client.agentOp('undo', {task: this.lastCommitted});
      this.lastCommitted = ''; this.phase = 'idle'; this.result = ''; this.changes = null; this.resultFeedback = null; this.record();
    }
    if (action === 'retry') { this.phase = 'idle'; this.error = ''; this.plannedDropId = ''; }
    this.ensurePlanned();
    return {ok: true};
  }
  private async cancelPreview() {
    await this.clearResultFeedback();
    if (this.taskId) {
      await this.blender.client.agentOp('cancel', {task: this.taskId});
      this.taskId = '';
    }
    this.previewImage = ''; this.changes = null; this.resultFeedback = null;
  }
  private async describeResultFeedback(task: string, phase: 'preview' | 'done') {
    try {
      const capturedAt = Date.now();
      const code = `import json, result_geometry\nprint('OKPASTE_JSON:'+json.dumps(result_geometry.describe(task=${JSON.stringify(task)}, phase=${JSON.stringify(phase)})))`;
      const value = this.readMarker(await this.blender.client.raw('execute_blender_code', {code, user_prompt: '只读获取本次新增或修改物体的实际视口投影区域，不绘制或修改场景'})) as ResultGeometry;
      this.resultFeedback = {...value, id: `${task}:${phase}:${this.version}`, capturedAt, phase, available: value.available === true};
    } catch {
      // Visual feedback is best effort: a completed transaction stays usable.
      this.resultFeedback = {id: `${task}:${phase}:${this.version}`, phase, available: false, reason: '结果已生成，暂未能标明生成区域'};
    }
  }
  private async clearResultFeedback() {
    this.resultFeedback = null;
  }
  private async sceneContext(): Promise<SceneContext> {
    const scene = await this.blender.client.op<SceneContext>('context');
    let cursor: unknown = null;
    try {
      cursor = await this.viewCursor();
    } catch (error) {
      cursor = {error: error instanceof Error ? error.message : String(error)};
    }
    return {...scene, cursor, cursorOrigin: 'viewport-center'};
  }

  private async viewCursor() {
    const code = [
      'import json, bpy, spatial',
      'found = {"error": "no-view"}',
      'try:',
      '    for window in bpy.context.window_manager.windows:',
      '        for area in window.screen.areas:',
      '            if area.type != "VIEW_3D":',
      '                continue',
      '            region = next((region for region in area.regions if region.type == "WINDOW"), None)',
      '            if region is None or region.width < 2 or region.height < 2:',
      '                continue',
      '            xy = (region.width * 0.5, region.height * 0.5)',
      '            with bpy.context.temp_override(window=window, area=area, region=region):',
      '                found = spatial.cursor_facts(bpy.context, area, region, xy)',
      '            break',
      '        else:',
      '            continue',
      '        break',
      'except Exception as error:',
      '    found = {"error": str(error)}',
      'print("OKPASTE_JSON:" + json.dumps(found))',
    ].join('\n');
    return this.readMarker(await this.blender.client.raw('execute_blender_code', {code, user_prompt: '读取当前三维视口中心的落点。'}));
  }

  private readMarker(result: unknown) {
    const content = (result as {content?: Array<{type?: string; text?: string}>}).content ?? [];
    const text = content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n');
    const marker = text.lastIndexOf('OKPASTE_JSON:');
    if (marker < 0) throw new Error(text.slice(0, 500) || '场景没有返回落点');
    const raw = text.slice(marker + 'OKPASTE_JSON:'.length).trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error(raw.slice(0, 500) || '场景没有返回落点');
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  }

  private readDropFile(): {eventId?: string; destinationId?: string; appName?: string; context?: {cursor?: unknown}} | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, '.local', 'drop-event.json'), 'utf8')); }
    catch { return null; }
  }
  private planDrop(item: ClipboardItem, drop: PendingDrop) {
    this.phase = 'planning'; this.actions = [];this.plannedSourceIds=this.store.list().map(source=>source.id);
    this.abort?.abort(); this.abort = new AbortController();
    const signal=this.abort.signal,revision=++this.planRevision;
    this.enqueue(async()=>{
      try{
        await this.planItem(item,'',drop.cursor,signal,revision,drop.cursorOrigin);
        if(!signal.aborted&&revision===this.planRevision&&this.pendingDrop?.eventId===drop.eventId)this.plannedDropId=drop.eventId;
      }catch(error){if(signal.aborted||revision!==this.planRevision)return;throw error;}
    });
  }
  private ingestDrop() {
    if(this.pasteCapturing)return;
    const event = this.readDropFile();
    if (!event?.eventId || event.eventId === this.seenDropId || event.eventId === this.pendingDrop?.eventId) return;
    if (['planning', 'running', 'preview'].includes(this.phase)) return;
    this.seenDropId = event.eventId;
    if (this.onDrop && !this.onDrop()) return;
    const item = this.latestItem();
    if (!item) return;
    const cursor = event.context?.cursor ?? null;
    this.pendingDrop = {eventId: event.eventId, destinationId: event.destinationId || 'blender', appName: event.appName || 'Blender', placeable: placeableCursor(cursor), summary: dropSummary(cursor), cursor};
    this.plannedDropId = '';
    this.planDrop(item,this.pendingDrop);
  }
  private record(extra: Record<string, unknown> = {}) {
    const status = this.status();
    fs.mkdirSync(path.join(this.root, '.local'), {recursive: true});
    const event = {...status, taskId: this.taskId || this.lastCommitted, ...extra, at: new Date().toISOString()};
    fs.writeFileSync(path.join(this.root, '.local', 'agent-run.json'), JSON.stringify(event, null, 2));
    fs.appendFileSync(path.join(this.root, '.local', 'desktop-agent-events.ndjson'), JSON.stringify(event) + '\n');
  }
}
