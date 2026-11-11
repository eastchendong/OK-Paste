"""Allowlisted operations invoked via upstream MCP. Never executes model code."""
import bpy, json, uuid, hashlib, math
from mathutils import Vector
from pathlib import Path
ROOT=None
PREVIEWS={}
HISTORY={}
SUSPENDED_HANDLERS=[]

def uid(scene):
    if not scene.get('okpaste_scene_id'):scene['okpaste_scene_id']=str(uuid.uuid4())
    return scene['okpaste_scene_id']

def fingerprint(scene,exclude_task=None):
    rows=[]
    for o in sorted(scene.objects,key=lambda o:o.name):
        if exclude_task and o.get('okpaste_task')==exclude_task:continue
        row=[o.name,o.type,list(v for r in o.matrix_world for v in r)]
        if o.type=='MESH':row.append(hashlib.sha256(str([(tuple(v.co)) for v in o.data.vertices]).encode()).hexdigest())
        rows.append(row)
    return hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()

def bounds(objects):
    points=[o.matrix_world@Vector(c) for o in objects if o.type=='MESH' for c in o.bound_box]
    if not points:raise ValueError('目标没有可读取的几何，请选择篮子。')
    lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
    return lo,hi

def snapshot():
    scene=bpy.context.scene
    if scene.get('okpaste_preview'):raise ValueError('请先取消或确认当前预览。')
    o=bpy.context.view_layer.objects.active
    if not o or not o.select_get():raise ValueError('请先在 Blender 中选中篮子，再拖入图片。')
    # A selected basket component resolves to its explicitly tagged parent.
    while o.parent and not o.get('okpaste_target_id'):o=o.parent
    if not o.get('okpaste_target_id'):o['okpaste_target_id']=str(uuid.uuid4())
    objects=[o]+list(o.children_recursive);lo,hi=bounds(objects)
    anchors=[x for x in objects if x.get('okpaste_anchor')]
    anchor=list(anchors[0].matrix_world.translation) if anchors else [float((lo.x+hi.x)/2),float((lo.y+hi.y)/2),float(lo.z+.08*(hi.z-lo.z))]
    return {'sceneId':uid(scene),'sceneName':scene.name,'targetId':o['okpaste_target_id'],'targetName':o.name,'min':list(lo),'max':list(hi),'anchor':anchor,'anchorType':'configured' if anchors else 'bbox-heuristic','signature':fingerprint(scene),'objects':len(scene.objects)}

def validate(target,task=None):
    scene=next((s for s in bpy.data.scenes if s.get('okpaste_scene_id')==target['sceneId'] and not s.get('okpaste_preview')),None)
    if not scene:raise ValueError('原场景已关闭，请重新绑定目标。')
    current=bpy.context.scene
    if current!=scene and not current.get('okpaste_preview'):raise ValueError('已切换场景，请重新绑定目标。')
    if not any(o.get('okpaste_target_id')==target['targetId'] for o in scene.objects):raise ValueError('目标已删除，请重新选择篮子。')
    if fingerprint(scene,task)!=target['signature']:raise ValueError('正式场景已变更，旧预览已失效，请取消并重新绑定。')
    return scene

def shot(path):
    scene=bpy.context.scene
    if not scene.camera:raise ValueError('当前场景没有预览相机。测试场景已配好固定视角。')
    old=scene.render.filepath;old_samples=scene.cycles.samples;old_x=scene.render.resolution_x;old_y=scene.render.resolution_y
    try:
        scene.render.filepath=str(path);scene.render.resolution_x=800;scene.render.resolution_y=580;scene.cycles.samples=12
        bpy.ops.render.render(write_still=True)
    finally:scene.render.filepath=old;scene.cycles.samples=old_samples;scene.render.resolution_x=old_x;scene.render.resolution_y=old_y
    return {'path':str(path),'scene':scene.name}

def transform(record,scale,height):
    root=record['root'];base=record['baseScale'];root.scale=(base*scale,)*3
    bpy.context.view_layer.update();lo,hi=bounds(record['objects'])
    root.location.z+=record['target']['anchor'][2]+height-lo.z
    bpy.context.view_layer.update()

def preview(args):
    task=args['taskId'];target=args['target'];original=validate(target)
    if task in PREVIEWS:return {'taskId':task,'version':PREVIEWS[task]['version']}
    if any(s.get('okpaste_preview') for s in bpy.data.scenes):raise ValueError('已有预览，请先取消。')
    temporary=original.copy();temporary.name='妥帖 · 临时预览';temporary['okpaste_preview']=task
    temporary['okpaste_scene_id']=str(uuid.uuid4());bpy.context.window.scene=temporary
    collection=bpy.data.collections.new('OKPaste.PreviewObjects');temporary.collection.children.link(collection)
    bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection.children[collection.name]
    before=set(bpy.data.objects)
    try:
        models=sorted((ROOT/'assets'/'models').glob('*.glb'))
        asset=Path(args['asset']) if args.get('asset') else (models[0] if models else None)
        if not asset or not asset.is_file() or asset.suffix.lower()!='.glb':raise ValueError('没有可用的本地模型文件。')
        bpy.ops.import_scene.gltf(filepath=str(asset))
        objects=list(set(bpy.data.objects)-before)
        bpy.ops.object.empty_add();root=bpy.context.object;root.name='OKPaste.AssetRoot';objects.append(root)
        for obj in objects:
            obj['okpaste_task']=task
            if obj!=root and obj.parent not in objects:
                world=obj.matrix_world.copy();obj.parent=root;obj.matrix_world=world
        bpy.context.view_layer.update();lo,hi=bounds(objects)
        desired=min(target['max'][0]-target['min'][0],target['max'][1]-target['min'][1])*.30
        base=desired/max(hi.x-lo.x,hi.y-lo.y)
        root.scale=(base,)*3;bpy.context.view_layer.update();lo,hi=bounds(objects)
        root.location.x+=target['anchor'][0]-(lo.x+hi.x)/2;root.location.y+=target['anchor'][1]-(lo.y+hi.y)/2
        record={'collection':collection,'scene':temporary,'original':original,'root':root,'objects':objects,'target':target,'baseScale':base,'version':1}
        PREVIEWS[task]=record;transform(record,1,0)
        return {'taskId':task,'version':1,'objectNames':[o.name for o in objects],'rootScale':base,'originalSignature':fingerprint(original)}
    except Exception:
        bpy.context.window.scene=original
        for obj in set(bpy.data.objects)-before:bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.scenes.remove(temporary);bpy.data.collections.remove(collection);PREVIEWS.pop(task,None);raise

def cleanup_scene(record):
    bpy.context.window.scene=record['original'];bpy.data.scenes.remove(record['scene']);bpy.data.collections.remove(record['collection'])

def cancel(task):
    r=PREVIEWS.pop(task,None)
    if not r:return {'cancelled':True}
    objects=r['objects'];cleanup_scene(r)
    for o in objects:
        if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)
    return {'cancelled':True}

def commit(args):
    task=args['taskId']
    if task in HISTORY:return {'committed':True,'idempotent':True,'taskId':task}
    r=PREVIEWS[task]
    if args['version']!=r['version']:raise ValueError('预览版本已改变，请重新查看后确认。')
    original=validate(r['target']);objects=r['objects']
    for o in objects:original.collection.objects.link(o)
    cleanup_scene(r)
    for o in original.objects:o.select_set(False)
    r['root'].select_set(True);bpy.context.view_layer.objects.active=r['root']
    HISTORY[task]={'objects':objects,'scene':original,'signature':fingerprint(original),'names':[o.name for o in objects]}
    PREVIEWS.pop(task)
    return {'committed':True,'taskId':task,'objectNames':[o.name for o in objects]}

def undo(task):
    r=HISTORY.get(task)
    if not r:return {'undone':True,'idempotent':True}
    if fingerprint(r['scene'])!=r['signature']:raise ValueError('提交后场景已有修改，为保护你的编辑，请手动处理或回到提交时状态。')
    for o in r['objects']:
        if o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)
    HISTORY.pop(task)
    return {'undone':True,'remainingObjects':len(r['scene'].objects)}

def dispatch(action,args):
    if action=='snapshot':return snapshot()
    if action=='context':
        import spatial
        return {'scene':spatial.scene_facts(bpy.context.scene),'sceneFingerprint':fingerprint(bpy.context.scene),'sceneSessionId':str(bpy.context.scene.as_pointer()),'temporaryPreview':bool(bpy.context.scene.get('okpaste_agent_preview') or bpy.context.scene.get('okpaste_preview'))}
    if action=='shot':return shot(Path(args['path']))
    if action=='mode':return set_mode(args['active'])
    if action=='preview':return preview(args)
    if action=='cancel':return cancel(args['taskId'])
    if action=='commit':return commit(args)
    if action=='undo':return undo(args['taskId'])
    if action=='adjust':
        r=PREVIEWS[args['taskId']];validate(r['target'])
        scale=float(args['scale']);height=float(args['height'])
        if not math.isfinite(scale) or not .5<=scale<=1.6 or not math.isfinite(height) or not -.05<=height<=.20:raise ValueError('调整超出允许范围。')
        transform(r,scale,height);r['version']+=1;return {'version':r['version']}
    if action=='status':return {'previews':list(PREVIEWS),'committed':list(HISTORY),'scene':bpy.context.scene.name,'sceneObjects':len(bpy.context.scene.objects),'version':bpy.app.version_string}
    raise ValueError('未知操作')

def set_mode(active):
    bpy.context.window_manager['okpaste_ai_mode']=active
    # In AI mode, the native image drop is handled by this task instead of
    # creating a Blender background image. Restore normal handlers on exit.
    from bl_operators import view3d
    for name in ['VIEW3D_FH_empty_image','VIEW3D_FH_camera_background_image']:
        cls=getattr(view3d,name)
        if active and cls.is_registered:
            bpy.utils.unregister_class(cls);SUSPENDED_HANDLERS.append(cls)
    if not active:
        for cls in list(SUSPENDED_HANDLERS):
            if not cls.is_registered:bpy.utils.register_class(cls)
            SUSPENDED_HANDLERS.remove(cls)
    return {'active':active}

class OKPASTE_OT_drop_reference(bpy.types.Operator):
    bl_idname='okpaste.drop_reference';bl_label='妥帖：拖入参考图片'
    filepath:bpy.props.StringProperty(subtype='FILE_PATH')
    directory:bpy.props.StringProperty(subtype='DIR_PATH')
    files:bpy.props.CollectionProperty(type=bpy.types.OperatorFileListElement)
    def invoke(self,context,event):
        print('OKPASTE_DROP_INVOKED',self.filepath,event.mouse_region_x,event.mouse_region_y,flush=True)
        if not context.window_manager.get('okpaste_ai_mode',False):return {'CANCELLED'}
        try:
            import spatial
            cursor={'area':context.area.type if context.area else None,'locationRelation':'unresolved','relationBasis':'Dropped outside the 3D view; no exact 3D position is available.'}
            if context.area and context.area.type=='VIEW_3D':
                region=next((r for r in context.area.regions if r.type=='WINDOW'),None)
                if region:
                    xy=(event.mouse_x-region.x,event.mouse_y-region.y)
                    cursor=spatial.cursor_facts(context,context.area,region,xy)
            path=self.filepath or str(Path(self.directory)/self.files[0].name)
            payload={'eventId':str(uuid.uuid4()),'sourcePath':path,'context':{'scene':spatial.scene_facts(context.scene),'cursor':cursor}}
        except Exception as error:
            payload={'eventId':str(uuid.uuid4()),'error':str(error)}
        folder=ROOT/'.local';folder.mkdir(exist_ok=True)
        path=folder/'drop-event.json';temporary=path.with_suffix('.tmp')
        temporary.write_text(json.dumps(payload));temporary.replace(path)
        self.report({'INFO'},'妥帖：请在对话框中确认操作')
        return {'FINISHED'}
    def execute(self,context):
        self.report({'ERROR'},'请从参考图片拖入 Blender 视口。');return {'CANCELLED'}

class OKPASTE_FH_reference(bpy.types.FileHandler):
    bl_idname='OKPASTE_FH_reference';bl_label='妥帖参考图片'
    bl_import_operator='okpaste.drop_reference'
    bl_file_extensions='.png;.jpg;.jpeg;.webp;.okpaste'
    @classmethod
    def poll_drop(cls,context):
        print('OKPASTE_POLL_DROP',str(context.area.type if context.area else None),bool(context.window_manager.get('okpaste_ai_mode',False)),flush=True)
        return bool(context.area and context.window_manager.get('okpaste_ai_mode',False))

def register(root):
    global ROOT;ROOT=Path(root)
    bpy.utils.register_class(OKPASTE_OT_drop_reference)
    bpy.utils.register_class(OKPASTE_FH_reference)
