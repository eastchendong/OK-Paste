import path from 'node:path';import fs from'node:fs';import{BlenderClient}from'../src/blender-client';
const c=new BlenderClient(path.resolve('.'));try{await c.connect();const code=`
import bpy,json
from bpy_extras import view3d_utils as v
from mathutils import Vector
area=next(a for a in bpy.context.screen.areas if a.type=='VIEW_3D')
region=next(r for r in area.regions if r.type=='WINDOW');rv=area.spaces.active.region_3d
rows=[]
with bpy.context.temp_override(window=bpy.context.window,area=area,region=region):
 for p in [(0,0,.087),(.9,0,.005),(-.8,.5,.005)]:
  pixel=v.location_3d_to_region_2d(region,rv,Vector(p))
  inverse=rv.perspective_matrix.inverted()
  near=inverse@Vector((2*pixel.x/region.width-1,2*pixel.y/region.height-1,-1,1))
  far=inverse@Vector((2*pixel.x/region.width-1,2*pixel.y/region.height-1,1,1))
  origin=near.xyz/near.w
  direction=(far.xyz/far.w-origin).normalized()
  hit,point,normal,index,obj,matrix=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),origin,direction)
  rows.append({'world':p,'pixel':list(pixel),'origin':list(origin),'direction':list(direction),'hit':hit,'point':list(point),'object':obj.name if obj else None})
print(json.dumps({'scene':bpy.context.scene.name,'region':[region.x,region.y,region.width,region.height],'perspective':rv.view_perspective,'rows':rows}))
`;const result=await c.raw('execute_blender_code',{code,user_prompt:'验证鼠标落点与 Blender 真实几何对应关系，包括篮内、篮外和已有苹果。'});console.log(JSON.stringify(result,null,2));fs.writeFileSync('.local/spatial-probe.json',JSON.stringify(result,null,2));}finally{await c.close();}
