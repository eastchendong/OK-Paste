"""Real bpy regressions; run in a separate factory-startup background Blender.

Blender --background --factory-startup --python tests/blender-preview-commit-check.py
Never connect this suite to the user's running Blender or save their file.
"""
from pathlib import Path
import sys
import unittest

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'blender'))
import agent_scene as agent


class PreviewCommitChecks(unittest.TestCase):
    def setUp(self):
        self.home = bpy.context.scene
        self.scene = bpy.data.scenes.new('Isolated commit regression')
        self.scene.world = bpy.data.worlds.new('Isolated world')
        self.scene.world.use_nodes = True
        bpy.context.window.scene = self.scene
        bpy.ops.mesh.primitive_cube_add()
        self.cube = bpy.context.object
        self.cube.name = 'Existing cube'
        bpy.ops.object.camera_add(location=(4, -6, 4))
        self.scene.camera = bpy.context.object
        self.task = self.id()

    def tearDown(self):
        record = agent.TRANSACTIONS.get(self.task)
        if record and not record['committed']:
            agent.cancel(self.task)
        # Each test owns this scene and process. Avoid undo masking a failure.
        agent.TRANSACTIONS.pop(self.task, None)
        bpy.context.window.scene = self.home
        bpy.data.scenes.remove(self.scene)

    def begin(self):
        agent.begin(self.task)
        return agent.TRANSACTIONS[self.task]['stage']

    def apply(self):
        status = agent.status(self.task)
        agent.commit(self.task, status['version'])
        bpy.context.view_layer.update()

    def test_two_rounds_apply_latest_camera_world_and_render_settings(self):
        old_camera = self.scene.camera
        old_world = self.scene.world
        old_settings = (self.scene.render.resolution_x, self.scene.render.film_transparent,
                        self.scene.view_settings.exposure)
        stage = self.begin()
        agent.run_code(self.task, """import bpy
bpy.ops.mesh.primitive_uv_sphere_add(radius=.4)
bpy.context.object.name = 'Generated model'
bpy.context.scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .1
""")
        agent.run_code(self.task, """import bpy
scene = bpy.context.scene
bpy.ops.object.camera_add(location=(8, -8, 5))
scene.camera = bpy.context.object
scene.camera.data.lens = 72
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .7
scene.render.resolution_x = 320
scene.render.film_transparent = True
scene.view_settings.exposure = 1.5
""")
        latest_camera_id = stage.camera['okpaste_object_id']
        self.assertEqual(self.scene.camera, old_camera)
        self.assertEqual(old_world.node_tree.nodes.get('Background').inputs['Strength'].default_value, 1)
        self.apply()
        self.assertEqual(self.scene.camera['okpaste_object_id'], latest_camera_id)
        self.assertAlmostEqual(self.scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value, .7)
        self.assertEqual(self.scene.render.resolution_x, 320)
        self.assertTrue(self.scene.render.film_transparent)
        self.assertEqual(self.scene.view_settings.exposure, 1.5)
        self.assertTrue(agent.undo(self.task)['restored'])
        self.assertEqual(self.scene.camera, old_camera)
        self.assertEqual(self.scene.world, old_world)
        self.assertEqual((self.scene.render.resolution_x, self.scene.render.film_transparent,
                          self.scene.view_settings.exposure), old_settings)

    def test_scene_only_refinement_is_a_real_change_and_can_be_undone(self):
        self.begin()
        agent.run_code(self.task, "bpy.context.scene.view_settings.exposure = 2")
        changes = agent.status(self.task)['changes']
        self.assertTrue(any(changes.values()), 'scene-only edits must not be discarded as no change')
        self.apply()
        self.assertEqual(self.scene.view_settings.exposure, 2)
        self.assertTrue(agent.undo(self.task)['restored'])
        self.assertEqual(self.scene.view_settings.exposure, 0)

    def test_modifier_only_refinement_survives_apply(self):
        self.begin()
        agent.run_code(self.task, """import bpy
cube = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bevel = cube.modifiers.new('Refined bevel', 'BEVEL')
bevel.width = .3
bevel.segments = 4
""")
        self.assertIn(self.cube.name, agent.status(self.task)['changes']['modified'])
        self.apply()
        cube = next(o for o in self.scene.objects if o.type == 'MESH')
        self.assertAlmostEqual(cube.modifiers[0].width, .3)
        self.assertTrue(agent.undo(self.task)['restored'])
        self.assertEqual(len(self.cube.modifiers), 0)

    def test_existing_camera_lens_refinement_survives_apply(self):
        old_lens = self.scene.camera.data.lens
        self.begin()
        agent.run_code(self.task, "bpy.context.scene.camera.data.lens = 85")
        self.apply()
        self.assertEqual(self.scene.camera.data.lens, 85)
        self.assertTrue(agent.undo(self.task)['restored'])
        self.assertEqual(self.scene.camera.data.lens, old_lens)

    def test_curve_shape_refinement_survives_apply(self):
        curve = bpy.data.curves.new('Original curve', 'CURVE')
        curve.dimensions = '3D'
        spline = curve.splines.new('BEZIER')
        spline.bezier_points.add(1)
        obj = bpy.data.objects.new('Original curve', curve)
        self.scene.collection.objects.link(obj)
        self.begin()
        agent.run_code(self.task, """import bpy
curve = next(o for o in bpy.context.scene.objects if o.type == 'CURVE').data
curve.bevel_depth = .2
curve.splines[0].bezier_points[1].co.z = 3
""")
        self.assertIn(obj.name, agent.status(self.task)['changes']['modified'])
        self.apply()
        result = next(o for o in self.scene.objects if o.type == 'CURVE')
        self.assertEqual(result.data.splines[0].bezier_points[1].co.z, 3)
        self.assertAlmostEqual(result.data.bevel_depth, .2)
        self.assertTrue(agent.undo(self.task)['restored'])
        self.assertEqual(obj.data.splines[0].bezier_points[1].co.z, 0)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PreviewCommitChecks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
