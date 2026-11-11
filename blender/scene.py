"""Generate the explicit, disposable demonstration scene in a separate Blender."""
import bpy, math, uuid
from mathutils import Vector
from pathlib import Path

def build(filepath):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene; scene.name='OK Paste · 篮子测试'
    scene['okpaste_scene_id']=str(uuid.uuid4())
    def material(name,color):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
        bsdf=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value=(*color,1);bsdf.inputs['Roughness'].default_value=.65
        return m
    wicker=material('藤篮',(0.48,.27,.10));wood=material('浅木桌面',(.48,.38,.27));dark=material('背景',(.16,.20,.23))
    bpy.ops.object.empty_add();basket=bpy.context.object;basket.name='Basket';basket['okpaste_target_id']=str(uuid.uuid4());basket['okpaste_demo_basket']=True
    def part(obj):
        obj.parent=basket;obj.data.materials.append(wicker)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.48,depth=.055,location=(0,0,.055));part(bpy.context.object)
    for z in [.09,.14,.19,.24,.29,.34,.39,.43]:
        radius=.48+(z-.055)*.22
        bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=.012,major_segments=64,minor_segments=8,location=(0,0,z));part(bpy.context.object)
    for i in range(36):
        angle=i*math.tau/36
        bottom=Vector((.48*math.cos(angle),.48*math.sin(angle),.06));top=Vector((.56*math.cos(angle),.56*math.sin(angle),.43))
        bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.009,depth=(top-bottom).length,location=(top+bottom)/2)
        obj=bpy.context.object;obj.rotation_euler=(top-bottom).to_track_quat('Z','Y').to_euler();part(obj)
    bpy.ops.object.empty_add(location=(0,0,.087));anchor=bpy.context.object;anchor.name='Basket.PlacementAnchor';anchor.parent=basket;anchor['okpaste_anchor']=True
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,-.045));table=bpy.context.object;table.name='Table';table.scale=(3,2,.09);table.data.materials.append(wood)
    bevel=table.modifiers.new('桌边','BEVEL');bevel.width=.035;bevel.segments=3
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.095));bpy.context.object.data.materials.append(dark)
    bpy.ops.object.camera_add(location=(1.9,-2.8,2.1));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.20))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.75;scene.camera=camera
    for loc,power,size in [((1,-1,3),380,3),((-2,1,2),200,2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.size=size;light.rotation_euler=(Vector((0,0,.15))-light.location).to_track_quat('-Z','Y').to_euler()
    scene.world.color=(.3,.3,.3);scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.render.resolution_x=900;scene.render.resolution_y=650;scene.render.resolution_percentage=100
    for obj in scene.objects:obj.select_set(False)
    basket.select_set(True);bpy.context.view_layer.objects.active=basket
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    Path(filepath).parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(filepath))
