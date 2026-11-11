"""Read-only spatial facts from the live Blender view; no intent vocabulary."""
import bpy, math
from mathutils import Vector

def world_bounds(obj):
    meshes=[o for o in [obj]+list(obj.children_recursive) if o.type=='MESH']
    points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
    if not points:return None
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    return {'min':lo,'max':hi,'center':[(a+b)/2 for a,b in zip(lo,hi)],'size':[b-a for a,b in zip(lo,hi)]}

def object_facts(obj):
    materials=[]
    if obj.type=='MESH':
        for slot in obj.material_slots:
            m=slot.material
            if m:
                fact={'name':m.name,'viewportColor':list(m.diffuse_color)}
                if m.use_nodes and m.node_tree:
                    shader=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
                    if shader:
                        color=shader.inputs.get('Base Color')
                        if color:fact.update({'baseColor':list(color.default_value),'baseColorLinked':color.is_linked})
                    fact['imageTextures']=[{'name':n.image.name,'size':list(n.image.size)} for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
                materials.append(fact)
    return {'name':obj.name,'objectId':obj.get('okpaste_object_id'),'type':obj.type,'parent':obj.parent.name if obj.parent else None,'location':list(obj.matrix_world.translation),'bounds':world_bounds(obj),'materials':materials,'children':len(obj.children_recursive),'assetKind':obj.get('okpaste_asset_kind'),'taskId':obj.get('okpaste_task')}

def scene_facts(scene):
    # Keep multipart imported assets together, but expose enough detail to inspect.
    roots=[o for o in scene.objects if not o.parent or o.parent not in list(scene.objects)]
    facts=[object_facts(o) for o in roots]
    return {'name':scene.name,'objectCount':len(scene.objects),'selected':[o.name for o in scene.objects if o.select_get()],'objects':facts,'truncated':False,'units':{'system':scene.unit_settings.system,'scaleLength':scene.unit_settings.scale_length}}

def ray_for_pixel(region,rv,xy):
    # In an orthographic camera Blender's legacy origin helper can start behind
    # geometry. Unproject both clipping planes to retain the true view ray.
    inverse=rv.perspective_matrix.inverted()
    x=2*xy[0]/region.width-1;y=2*xy[1]/region.height-1
    near=inverse@Vector((x,y,-1,1));far=inverse@Vector((x,y,1,1))
    origin=near.xyz/near.w;end=far.xyz/far.w
    return origin,(end-origin).normalized()

def cursor_facts(context,area,region,xy):
    rv=area.spaces.active.region_3d;origin,direction=ray_for_pixel(region,rv,xy)
    hit,point,normal,index,obj,matrix=context.scene.ray_cast(context.evaluated_depsgraph_get(),origin,direction)
    hit_obj=obj.original if obj else None
    top=hit_obj
    while top and top.parent:top=top.parent
    result={'area':area.type,'pixel':list(xy),'regionSize':[region.width,region.height],'rayOrigin':list(origin),'rayDirection':list(direction),'hit':hit,'hitObject':object_facts(hit_obj) if hit_obj else None,'hitRoot':top.name if top else None,'worldPoint':list(point) if hit else None,'preferredPlacementPoint':list(point) if hit else None,'normal':list(normal) if hit else None,'locationRelation':'unresolved','relationBasis':None}
    basket=next((o for o in context.scene.objects if o.get('okpaste_demo_basket')),None)
    if basket:
        bbox=world_bounds(basket)
        floor_candidates=[]
        for obj in basket.children_recursive:
            box=world_bounds(obj)
            if box and box['size'][2] < .2*min(box['size'][0],box['size'][1]):floor_candidates.append((box['min'][2],obj,box))
        if floor_candidates:
            _,floor,box=min(floor_candidates,key=lambda row:row[0]);z=box['max'][2]
            if abs(direction.z)>1e-6:
                t=(z-origin.z)/direction.z;floor_point=origin+direction*t
                center=Vector(box['center']);radii=[box['size'][0]/2,box['size'][1]/2]
                projected_inside=sum(((floor_point[i]-center[i])/max(radii[i],1e-8))**2 for i in (0,1))<1
                result['basketContext']={'name':basket.name,'bounds':bbox,'floorObject':floor.name,'floorHeight':z,'floorProjection':list(floor_point),'projectionWithinFloor':projected_inside}
            if top==basket:
                result['locationRelation']='basket';result['relationBasis']='ray hit basket geometry'
                if 'floor_point' in locals():result['preferredPlacementPoint']=list(floor_point)
            elif hit_obj and hit_obj.name=='Table':
                result['locationRelation']='outside-basket';result['relationBasis']='ray hit table surface outside basket'
            elif locals().get('projected_inside',False):
                result['preferredPlacementPoint']=list(floor_point)
                result['locationRelation']='projected-inside-basket';result['relationBasis']='view ray projected onto measured basket floor, not a collision proof'
    if not hit:result['relationBasis']='No surface hit; use scene and selection, ask before assuming a 3D position.'
    return result
