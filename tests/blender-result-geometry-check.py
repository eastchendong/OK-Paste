"""Read-only projection protocol checks without a GPU, timers or scene writes."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
class Matrix:
    def __matmul__(self, point): return point
class Obj(dict):
    type='MESH'
    matrix_world=Matrix()
    bound_box=((100,200),(300,600))
    def visible_get(self, **kwargs): return True
class GeometryChecks(unittest.TestCase):
    def setUp(self):
        self.obj=Obj(okpaste_object_id='new-object');self.obj.name='renamed-after-creation'
        self.scene=NS(objects=[self.obj]);self.original=NS(objects=[])
        self.region=NS(type='WINDOW',x=4,y=164,width=2477,height=1443)
        self.area=NS(type='VIEW_3D',x=4,y=164,width=2477,height=1443,regions=[self.region],spaces=NS(active=NS(region_3d=NS())))
        self.window=NS(scene=self.scene,x=0,y=3,width=1512,height=830,screen=NS(areas=[self.area]),view_layer=NS())
        self.record={'committed':False,'stage':self.scene,'original':self.original,'before':{}}
        self.agent=NS(TRANSACTIONS={'task':self.record},digest=lambda obj:'changed')
        self.bpy=NS(context=NS(window_manager=NS(windows=[self.window]),preferences=NS(system=NS(pixel_size=2.0,ui_scale=2.0))))
        self.modules=patch.dict(sys.modules,{'bpy':self.bpy,'agent_scene':self.agent,'mathutils':NS(Vector=lambda v:v)})
        self.modules.start();self.addCleanup(self.modules.stop)
        spec=importlib.util.spec_from_file_location('geometry_under_test',ROOT/'blender/result_geometry.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.module._project_point=lambda region,view,point:point
    def test_retina_window_normalization_uses_reported_pixel_size_and_top_left_origin(self):
        result=self.module.describe('task')
        self.assertTrue(result['available']);self.assertEqual(result['objectCount'],1)
        self.assertEqual(result['coordinateSpace'],'window-content-normalized-top-left')
        self.assertEqual(result['window'],{'x':0,'y':3,'width':3024.0,'height':1660.0})
        rect=result['regions'][0]
        self.assertAlmostEqual(rect['x'],104/3024);self.assertAlmostEqual(rect['y'],1-764/1660)
        self.assertAlmostEqual(rect['width'],200/3024);self.assertAlmostEqual(rect['height'],400/1660)
        self.assertEqual(result['screenMetrics']['rawWindow']['width'],1512)
        self.assertEqual(result['viewports'][0]['region']['width'],2477)
        self.assertEqual(self.obj.name,'renamed-after-creation');self.assertEqual(self.record['before'],{})
    def test_non_retina_metrics_are_not_scaled_by_ui_scale(self):
        self.bpy.context.preferences.system.pixel_size=1
        self.window.width=3024;self.window.height=1660
        result=self.module.describe('task')
        self.assertEqual(result['window']['width'],3024)
        self.assertAlmostEqual(result['regions'][0]['x'],104/3024)
    def test_delete_only_and_missing_view_do_not_fabricate_regions(self):
        self.scene.objects=[]
        self.assertEqual(self.module.describe('task')['reason'],'no-generated-geometry')
        self.scene.objects=[self.obj];self.window.screen.areas=[]
        result=self.module.describe('task')
        self.assertFalse(result['available']);self.assertEqual(result['reason'],'no-3d-viewport');self.assertEqual(result['regions'],[])
    def test_modified_and_committed_geometry_use_stable_identity(self):
        self.record['before']={'new-object':'old'}
        self.assertTrue(self.module.describe('task')['available'])
        self.record.update(committed=True,committedObjects=[self.obj]);self.window.scene=self.original
        result=self.module.describe('task','done')
        self.assertTrue(result['available']);self.assertEqual(result['objectCount'],1)
        self.assertEqual(self.module.describe('task')['reason'],'transaction-phase-changed')
    def test_offscreen_and_behind_view_are_unavailable_without_changing_view(self):
        self.obj.bound_box=((3000,200),(3100,600))
        self.assertEqual(self.module.describe('task')['reason'],'geometry-outside-view')
        self.obj.bound_box=((100,200),(300,600));self.module._project_point=lambda *args:None
        self.assertEqual(self.module.describe('task')['reason'],'geometry-outside-view')
        self.assertEqual(self.window.screen.areas,[self.area])
    def test_inconsistent_window_metrics_fail_instead_of_guessing_scale(self):
        self.bpy.context.preferences.system.pixel_size=1
        result=self.module.describe('task')
        self.assertFalse(result['available']);self.assertEqual(result['reason'],'inconsistent-window-metrics')
    def test_offscreen_objects_do_not_expand_the_region_for_visible_objects(self):
        outside=Obj(okpaste_object_id='offscreen');outside.bound_box=((3000,100),(3100,300))
        self.scene.objects.append(outside)
        result=self.module.describe('task')
        self.assertEqual(result['objectCount'],1);self.assertAlmostEqual(result['regions'][0]['width'],200/3024)

if __name__=='__main__':unittest.main()
