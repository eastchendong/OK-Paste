"""Generic isolated scene transactions for natural-language Blender operations."""
import bpy, uuid, json, hashlib, ast, io, math
from contextlib import redirect_stdout
from mathutils import Vector
TRANSACTIONS={}
DATA_KINDS=('objects','collections','meshes','materials','images','worlds','cameras','lights','curves')
SCENE_SETTINGS=('render','render.image_settings','view_settings','display_settings',
                'sequencer_colorspace_settings','unit_settings','cycles','eevee')

def plain_value(value):
    if value is None or isinstance(value,(str,int,float,bool)):return value
    if isinstance(value,set):return sorted(value)
    return [plain_value(item) for item in value]

def rna_values(block, pointers=False):
    """Writable values, excluding copied datablock names and transient runtime flags."""
    result={}
    if block is None:return result
    for prop in block.bl_rna.properties:
        key=prop.identifier
        if prop.is_readonly or key in {'rna_type','name','name_full'}:continue
        value=getattr(block,key)
        if prop.type in {'BOOLEAN','INT','FLOAT','STRING','ENUM'}:
            result[key]=plain_value(value)
        elif pointers and prop.type=='POINTER' and isinstance(value,bpy.types.ID):
            result[key]={'object':value.get('okpaste_object_id')} if isinstance(value,bpy.types.Object) else {'type':value.bl_rna.identifier,'name':value.name}
    return result

def node_tree_state(tree):
    if not tree:return None
    nodes=[]
    for node in tree.nodes:
        inputs=[]
        for socket in node.inputs:
            if hasattr(socket,'default_value'):
                value=socket.default_value
                if isinstance(value,bpy.types.ID):value={'type':value.bl_rna.identifier,'name':value.name}
                else:value=plain_value(value)
                inputs.append([socket.identifier,value])
        nodes.append([node.name,node.bl_idname,rna_values(node,True),inputs])
    return {'nodes':nodes,'links':[[link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier] for link in tree.links]}

def settings_blocks(scene):
    for path in SCENE_SETTINGS:
        block=scene
        for key in path.split('.'):block=getattr(block,key,None)
        if block is not None:yield path,block

def scene_settings(scene):
    return {path:rna_values(block) for path,block in settings_blocks(scene)}

def scene_state(scene):
    world=scene.world
    return {'camera':scene.camera.get('okpaste_object_id') if scene.camera else None,
            'world':{'values':rna_values(world),'nodes':node_tree_state(world.node_tree) if world and world.use_nodes else None},
            'settings':scene_settings(scene)}

def apply_settings(scene,settings):
    for path,block in settings_blocks(scene):
        # Parent render.engine / view_transform are restored before dependent values.
        values=settings.get(path,{})
        first={'engine','view_transform','display_device','file_format','color_mode'}
        for key in sorted(values,key=lambda key:0 if key in first else 1):
            value=values[key]
            if plain_value(getattr(block,key))==value:continue
            prop=block.bl_rna.properties[key]
            setattr(block,key,set(value) if prop.type=='ENUM' and getattr(prop,'is_enum_flag',False) else value)

def original_unchanged(r):
    return protected(r['original'])==r['before'] and scene_state(r['original'])==r['beforeScene']

def data_snapshot():
    return {kind:set(getattr(bpy.data,kind)) for kind in DATA_KINDS}

def new_data(before):
    return {kind:set(getattr(bpy.data,kind))-before[kind] for kind in DATA_KINDS}

def cleanup_owned(r):
    for _ in range(4):
        changed=False
        for kind in DATA_KINDS:
            for block in list(r.get('owned',{}).get(kind,set())):
                try:
                    if block.users==0:getattr(bpy.data,kind).remove(block);r['owned'][kind].discard(block);changed=True
                except ReferenceError:r['owned'][kind].discard(block)
        if not changed:break

def digest(obj):
    data={'type':obj.type,'matrix':[v for row in obj.matrix_world for v in row],'parent':obj.parent.get('okpaste_object_id') if obj.parent else None,'hide':obj.hide_render,'values':rna_values(obj),'data':rna_values(obj.data),
          'modifiers':[[m.type,rna_values(m,True)] for m in obj.modifiers],
          'constraints':[[c.type,rna_values(c,True)] for c in obj.constraints]}
    if obj.type=='MESH':
        data['data']['vertices']=[list(v.co) for v in obj.data.vertices]
        data['data']['polygons']=[list(p.vertices) for p in obj.data.polygons]
        data['data']['edges']=[list(e.vertices) for e in obj.data.edges]
        data['data']['faceSettings']=[[p.material_index,p.use_smooth] for p in obj.data.polygons]
        data['data']['uv']=[[[*uv.uv] for uv in layer.data] for layer in obj.data.uv_layers]
    elif obj.type in {'CURVE','SURFACE','FONT'}:
        data['data']['splines']=[{'values':rna_values(spline),
            'points':[rna_values(point) for point in spline.points],
            'bezier':[rna_values(point) for point in spline.bezier_points]} for spline in obj.data.splines]
    if hasattr(obj.data,'node_tree') and obj.data.use_nodes:data['data']['nodes']=node_tree_state(obj.data.node_tree)
    if hasattr(obj,'material_slots'):
        data['data']['materials']=[]
        for slot in obj.material_slots:
            m=slot.material
            data['data']['materials'].append(None if m is None else {'values':rna_values(m),'nodes':node_tree_state(m.node_tree) if m.use_nodes else None})
    return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

def protected(scene):
    return {o.get('okpaste_object_id'):digest(o) for o in scene.objects}

def ensure_ids(scene):
    seen=set()
    for o in scene.objects:
        key=o.get('okpaste_object_id')
        if not key or key in seen:key=str(uuid.uuid4());o['okpaste_object_id']=key
        seen.add(key)

def clone_scene(original,task):
    ensure_ids(original)
    stage=original.copy();stage.name='妥帖 · Agent 预览';stage['okpaste_agent_preview']=task
    # A copied scene initially shares child collections; replace them with an
    # independent collection and cloned objects/data/materials before any tool.
    for child in list(stage.collection.children):stage.collection.children.unlink(child)
    for obj in list(stage.collection.objects):stage.collection.objects.unlink(obj)
    collection=bpy.data.collections.new('OKPaste.AgentPreview');stage.collection.children.link(collection)
    copies={};materials={}
    for obj in original.objects:
        copy=obj.copy()
        if obj.data:copy.data=obj.data.copy()
        if hasattr(copy.data,'materials'):
            for index,slot in enumerate(copy.material_slots):
                material=slot.material
                if material:
                    if material not in materials:materials[material]=material.copy()
                    copy.data.materials[index]=materials[material]
        collection.objects.link(copy);copies[obj]=copy
    for obj,copy in copies.items():
        copy.parent=copies.get(obj.parent,obj.parent)
        for modifier in copy.modifiers:
            for prop in modifier.bl_rna.properties:
                if prop.type=='POINTER' and not prop.is_readonly:
                    value=getattr(modifier,prop.identifier,None)
                    if isinstance(value,bpy.types.Object) and value in copies:setattr(modifier,prop.identifier,copies[value])
        for constraint in copy.constraints:
            if hasattr(constraint,'target') and constraint.target in copies:constraint.target=copies[constraint.target]
    stage.camera=copies.get(original.camera)
    if stage.world:stage.world=stage.world.copy()
    return stage,collection,copies

def begin(task):
    if task in TRANSACTIONS:return status(task)
    original=bpy.context.scene
    if original.get('okpaste_agent_preview') or original.get('okpaste_preview'):raise ValueError('请先处理当前预览。')
    data_before=data_snapshot()
    stage,collection,copies=clone_scene(original,task)
    TRANSACTIONS[task]={'original':original,'stage':stage,'collection':collection,'copies':copies,'before':protected(original),'beforeScene':scene_state(original),'originalObjects':{o['okpaste_object_id']:o for o in original.objects},'version':0,'owned':new_data(data_before),'committed':False,'backup':None,'parentLinks':{o['okpaste_object_id']:(o.parent,o.matrix_world.copy()) for o in original.objects},'originalCamera':original.camera,'originalWorld':original.world}
    bpy.context.window.scene=stage
    bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection.children[collection.name]
    bpy.context.view_layer.update()
    return status(task)

def code_guard(code):
    tree=ast.parse(code)
    forbidden_names={'open','exec','eval','compile','__import__','globals','locals','vars','input','breakpoint','exit','quit'}
    forbidden_paths=('bpy.data.scenes','bpy.context.window','bpy.ops.wm','bpy.ops.scene','bpy.app','bpy.utils','bpy.ops.script','bpy.ops.text','bpy.data.texts','bpy.ops.preferences','bpy.ops.extensions')
    for node in ast.walk(tree):
        if isinstance(node,(ast.Import,ast.ImportFrom)):
            names=[x.name for x in node.names] if isinstance(node,ast.Import) else [node.module or '']
            if any(n.split('.')[0] not in {'bpy','bmesh','mathutils','math','random','json','statistics'} for n in names):raise ValueError('预览工具不允许访问文件系统、网络或其他进程。')
        if isinstance(node,ast.Attribute) and node.attr in {'driver_add','driver_remove'}:raise ValueError('预览工具不执行脚本驱动。')
        if isinstance(node,ast.Name) and node.id in forbidden_names:raise ValueError('代码包含不允许的执行入口。')
        if isinstance(node,ast.Attribute) and node.attr.startswith('_'):raise ValueError('不允许访问内部属性。')
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in {'getattr','setattr','delattr'}:
            if len(node.args)<2 or not isinstance(node.args[1],ast.Constant) or str(node.args[1].value).startswith('_'):raise ValueError('动态内部属性访问不受支持。')
        if isinstance(node,ast.Attribute):
            source=ast.unparse(node)
            if any(source.startswith(p) for p in forbidden_paths):raise ValueError('预览中不能访问其他场景、系统或窗口。')
        if isinstance(node,(ast.For,ast.Subscript,ast.Call)):
            source=ast.unparse(node)
            if any(p in source for p in ['bpy.data.objects[','bpy.data.objects.get','bpy.data.objects.remove','bpy.data.materials[','bpy.data.materials.get','bpy.data.collections.remove']):raise ValueError('请通过 bpy.context.scene.objects 操作预览对象，不能查改全局原对象。')
    return tree

def run_code(task,code):
    r=TRANSACTIONS[task]
    if r['committed']:raise ValueError('任务已提交。')
    if bpy.context.scene!=r['stage']:raise ValueError('当前已切换场景，请返回预览再执行。')
    if not original_unchanged(r):raise ValueError('正式场景已改变，请取消并重新开始。')
    code_guard(code);out=io.StringIO();data_before=data_snapshot();objects_before=set(r['stage'].objects)
    try:
        with redirect_stdout(out):exec(compile(code,'<okpaste-preview-tool>','exec'),{'bpy':bpy,'Vector':Vector,'math':math})
    finally:
        for kind,blocks in new_data(data_before).items():r['owned'][kind].update(blocks)
        # Object.copy() copies custom properties, including our stable identity.
        # Give new objects their own IDs before deduplication can steal an old ID.
        for obj in r['stage'].objects:
            if obj not in objects_before:obj['okpaste_object_id']=str(uuid.uuid4())
    ensure_ids(r['stage']);bpy.context.view_layer.update();r['version']+=1
    if not original_unchanged(r):raise ValueError('工具越过预览边界，正式场景已变化。请停止并检查。')
    return {'output':out.getvalue()[-12000:],'version':r['version'],'changes':diff(task)}

def diff(task):
    r=TRANSACTIONS[task];current={o.get('okpaste_object_id'):o for o in r['stage'].objects};before=r['before']
    return {'added':[o.name for key,o in current.items() if key not in before],'removed':[r['originalObjects'][key].name for key in before if key not in current],'modified':[r['originalObjects'][key].name for key,o in current.items() if key in before and digest(o)!=before[key]],
            'scene':['相机、环境或渲染设置'] if scene_state(r['stage'])!=r['beforeScene'] else []}

def status(task):
    r=TRANSACTIONS[task]
    return {'taskId':task,'version':r['version'],'committed':r['committed'],'changes':r.get('finalChanges') if r['committed'] else diff(task),'originalUnchanged':original_unchanged(r) if not r['committed'] else None}

def cleanup_stage(r,keep=set()):
    objects=list(r['stage'].objects);bpy.context.window.scene=r['original'];bpy.data.scenes.remove(r['stage'])
    if r['collection'].name in bpy.data.collections:bpy.data.collections.remove(r['collection'])
    for obj in objects:
        if obj not in keep and obj.users==0:bpy.data.objects.remove(obj)

def cancel(task):
    r=TRANSACTIONS.get(task)
    if not r:return {'cancelled':True}
    if r['committed']:raise ValueError('任务已提交，请使用撤回。')
    cleanup_stage(r);cleanup_owned(r);TRANSACTIONS.pop(task);return {'cancelled':True}

def commit(task,version):
    r=TRANSACTIONS[task]
    if r['committed']:return {'committed':True,'idempotent':True}
    if version!=r['version']:raise ValueError('预览已改变，请查看最新版本。')
    if not original_unchanged(r):raise ValueError('正式场景已改变，请重新预览。')
    original=r['original'];current={o['okpaste_object_id']:o for o in r['stage'].objects};changed=set(k for k,o in current.items() if k not in r['before'] or digest(o)!=r['before'][k]);removed=set(r['before'])-set(current)
    backup=bpy.data.collections.new('OKPaste.UndoBackup');r['backup']=backup
    original_links={}
    for key in changed|removed:
        obj=r['originalObjects'].get(key)
        if obj:
            original_links[key]=list(obj.users_collection);backup.objects.link(obj)
            for col in list(obj.users_collection):
                if col!=backup:col.objects.unlink(obj)
    retained={}
    for key,obj in current.items():
        if key in changed:original.collection.objects.link(obj);retained[key]=obj
        else:retained[key]=r['originalObjects'][key]
    # Fix parent/constraint references to retained objects before dropping copies.
    for key in changed:
        obj=current[key]
        if obj.parent:
            world=obj.matrix_world.copy();obj.parent=retained.get(obj.parent.get('okpaste_object_id'));obj.matrix_world=world
        for modifier in obj.modifiers:
            for prop in modifier.bl_rna.properties:
                if prop.type=='POINTER' and not prop.is_readonly:
                    value=getattr(modifier,prop.identifier,None)
                    if isinstance(value,bpy.types.Object):
                        replacement=retained.get(value.get('okpaste_object_id'))
                        if replacement:setattr(modifier,prop.identifier,replacement)
        for constraint in obj.constraints:
            if hasattr(constraint,'target') and constraint.target:constraint.target=retained.get(constraint.target.get('okpaste_object_id'),constraint.target)
    for key,obj in retained.items():
        if key not in changed and obj.parent and obj.parent.get('okpaste_object_id') in changed:
            world=obj.matrix_world.copy();obj.parent=retained[obj.parent['okpaste_object_id']];obj.matrix_world=world
    stage=r['stage']
    original.camera=retained.get(stage.camera.get('okpaste_object_id')) if stage.camera else None
    if scene_state(stage)['world']!=r['beforeScene']['world']:original.world=stage.world
    apply_settings(original,scene_settings(stage))
    r['finalChanges']=diff(task)
    cleanup_stage(r,set(current[k] for k in changed));cleanup_owned(r);r['committed']=True;r['committedObjects']=[current[k] for k in changed];r['originalLinks']=original_links
    r['after']=protected(original);r['afterScene']=scene_state(original);return {'committed':True,'changes':{'addedOrModified':len(changed),'removed':len(removed)}}

def undo(task):
    r=TRANSACTIONS[task]
    if not r['committed']:raise ValueError('尚未提交。')
    if protected(r['original'])!=r['after'] or scene_state(r['original'])!=r['afterScene']:raise ValueError('提交后场景已有修改，不能自动撤回。')
    for obj in r['committedObjects']:bpy.data.objects.remove(obj,do_unlink=True)
    for key,collections in r['originalLinks'].items():
        obj=r['originalObjects'][key]
        for col in collections:col.objects.link(obj)
    bpy.data.collections.remove(r['backup'])
    for key,(parent,matrix) in r['parentLinks'].items():
        obj=r['originalObjects'][key]
        # Reassigning every unchanged parent/world matrix decomposes transforms
        # and introduces rounding drift after the next dependency-graph update.
        if obj.parent!=parent or obj.matrix_world!=matrix:
            obj.parent=parent;obj.matrix_world=matrix
    r['original'].camera=r['originalCamera']
    r['original'].world=r['originalWorld']
    apply_settings(r['original'],r['beforeScene']['settings'])
    cleanup_owned(r)
    bpy.context.view_layer.update()
    restored=original_unchanged(r)
    TRANSACTIONS.pop(task)
    if not restored:raise ValueError('撤回后校验不一致，请检查场景。')
    return {'undone':True,'restored':restored}
