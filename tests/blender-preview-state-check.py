"""Deterministic transaction checks without Blender/GPU. Real bpy has a separate suite."""
import copy
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch


class Properties(list):
    def __getitem__(self, key):
        return next(p for p in self if p.identifier == key) if isinstance(key, str) else super().__getitem__(key)


class Block:
    def __init__(self, **values):
        props = Properties()
        for key, value in values.items():
            setattr(self, key, value)
            kind = 'BOOLEAN' if isinstance(value, bool) else 'STRING' if isinstance(value, str) else 'FLOAT'
            props.append(NS(identifier=key, type=kind, is_readonly=False))
        self.bl_rna = NS(properties=props, identifier=type(self).__name__)


class ID(Block):
    def __init__(self, name, **values):
        super().__init__(name=name, **values)
        self.props = {}

    def get(self, key):
        return self.props.get(key)

    def __getitem__(self, key):
        return self.props[key]


class Object(ID):
    def __init__(self, name, key):
        super().__init__(name, hide_render=False)
        self.props['okpaste_object_id'] = key
        self.type = 'CAMERA'
        self.matrix_world = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        self.parent = None
        self.data = Block(lens=50)
        self.modifiers = []
        self.constraints = []
        self.material_slots = []


def scene():
    cameras = [Object('Camera one', 'one'), Object('Camera two', 'two')]
    return NS(objects=cameras, camera=cameras[0],
              world=ID('World', use_nodes=False, color=[.05, .05, .05]),
              render=Block(engine='CYCLES', film_transparent=False, resolution_x=1920),
              view_settings=Block(view_transform='AgX', exposure=0))


class PreviewStateChecks(unittest.TestCase):
    def setUp(self):
        self.bpy = NS(types=NS(ID=ID, Object=Object), data=NS(collections=NS(new=Mock(), remove=Mock())))
        modules = patch.dict(sys.modules, {'bpy': self.bpy, 'mathutils': NS(Vector=list)})
        modules.start()
        self.addCleanup(modules.stop)
        path = Path(__file__).resolve().parents[1] / 'blender/agent_scene.py'
        spec = importlib.util.spec_from_file_location('preview_state_under_test', path)
        self.agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.agent)
        self.original = scene()
        self.stage = copy.deepcopy(self.original)
        self.record = {'original': self.original, 'stage': self.stage, 'committed': False,
                       'before': self.agent.protected(self.original),
                       'beforeScene': self.agent.scene_state(self.original),
                       'originalObjects': {obj['okpaste_object_id']: obj for obj in self.original.objects},
                       'originalCamera': self.original.camera, 'originalWorld': self.original.world,
                       'parentLinks': {obj['okpaste_object_id']: (None, obj.matrix_world) for obj in self.original.objects},
                       'version': 2}
        self.agent.TRANSACTIONS['task'] = self.record
        self.agent.cleanup_stage = Mock()
        self.agent.cleanup_owned = Mock()
        self.bpy.context = NS(view_layer=NS(update=Mock()))

    def test_cloned_values_have_same_fingerprint_despite_datablock_names(self):
        self.stage.world.name = 'World.001'
        self.stage.camera.name = 'Camera one.001'
        self.assertEqual(self.agent.protected(self.original), self.agent.protected(self.stage))
        self.assertEqual(self.agent.scene_state(self.original), self.agent.scene_state(self.stage))
        self.assertFalse(any(self.agent.diff('task').values()))

    def test_apply_uses_latest_camera_environment_and_exposure_and_undo_restores_them(self):
        old_world = self.original.world
        self.stage.view_settings.exposure = 1
        self.stage.view_settings.exposure = 2  # second preview round
        self.stage.camera = self.stage.objects[1]
        self.stage.world.color = [.1, .2, .3]
        self.stage.render.resolution_x = 320
        self.stage.render.film_transparent = True
        expected = self.agent.scene_state(self.stage)
        self.assertTrue(self.agent.diff('task')['scene'])
        self.agent.commit('task', 2)
        self.assertEqual(self.agent.scene_state(self.original), expected)
        self.assertIs(self.original.camera, self.original.objects[1])
        self.assertIs(self.original.world, self.stage.world)
        self.assertTrue(self.agent.undo('task')['restored'])
        self.assertIs(self.original.world, old_world)
        self.assertEqual(self.agent.scene_state(self.original), self.record['beforeScene'])

    def test_scene_only_edit_is_not_no_change_and_keeps_original_objects(self):
        original_objects = list(self.original.objects)
        self.stage.view_settings.exposure = 2
        changes = self.agent.diff('task')
        self.assertTrue(changes['scene'])
        self.assertFalse(changes['modified'])
        self.agent.commit('task', 2)
        self.assertEqual(self.original.objects, original_objects)
        self.assertEqual(self.original.view_settings.exposure, 2)
        self.assertIs(self.original.world, self.record['originalWorld'])

    def test_removed_active_camera_is_not_silently_replaced_with_old_camera(self):
        self.stage.camera = None
        self.agent.commit('task', 2)
        self.assertIsNone(self.original.camera)
        self.assertTrue(self.agent.undo('task')['restored'])
        self.assertIs(self.original.camera, self.original.objects[0])

    def test_stale_revision_does_not_apply_or_clean_preview(self):
        self.stage.view_settings.exposure = 2
        with self.assertRaisesRegex(ValueError, '预览已改变'):
            self.agent.commit('task', 1)
        self.assertTrue(self.agent.original_unchanged(self.record))
        self.agent.cleanup_stage.assert_not_called()

    def test_user_environment_edit_blocks_commit_and_later_undo(self):
        self.original.world.color = [1, 1, 1]
        with self.assertRaisesRegex(ValueError, '正式场景已改变'):
            self.agent.commit('task', 2)
        self.original.world.color = [.05, .05, .05]
        self.stage.view_settings.exposure = 2
        self.agent.commit('task', 2)
        self.original.view_settings.exposure = 3
        with self.assertRaisesRegex(ValueError, '提交后场景已有修改'):
            self.agent.undo('task')
        self.assertTrue(self.record['committed'])

    def test_camera_and_modifier_values_change_object_fingerprint(self):
        original_digest = self.agent.digest(self.stage.camera)
        self.stage.camera.data.lens = 85
        self.assertNotEqual(self.agent.digest(self.stage.camera), original_digest)
        self.stage.camera.data.lens = 50
        modifier = Block(width=.1, segments=2)
        modifier.type = 'BEVEL'
        self.stage.camera.modifiers.append(modifier)
        first = self.agent.digest(self.stage.camera)
        self.assertNotEqual(first, original_digest)
        modifier.width = .3
        self.assertNotEqual(self.agent.digest(self.stage.camera), first)

    def test_curve_points_and_bevel_change_object_fingerprint(self):
        obj = self.stage.camera
        obj.type = 'CURVE'
        obj.data = Block(bevel_depth=.1)
        spline = Block(use_cyclic_u=False)
        spline.points = []
        spline.bezier_points = [Block(co=[0, 0, 0], handle_left=[-1, 0, 0])]
        obj.data.splines = [spline]
        before = self.agent.digest(obj)
        spline.bezier_points[0].co[2] = 3
        self.assertNotEqual(self.agent.digest(obj), before)

    def test_nested_rna_arrays_and_shader_links_are_recorded(self):
        matrix = ((1, 0), (0, 1))
        self.assertEqual(self.agent.rna_values(Block(matrix=matrix)), {'matrix': [[1, 0], [0, 1]]})
        node = Block(name='Shader', operation='ADD')
        node.bl_idname = 'ShaderNodeMath'
        node.inputs = [NS(identifier='Value', default_value=1)]
        tree = NS(nodes=[node], links=[])
        before = self.agent.node_tree_state(tree)
        tree.links.append(NS(from_node=node, to_node=node,
                             from_socket=NS(identifier='Value'), to_socket=NS(identifier='Value_001')))
        self.assertNotEqual(self.agent.node_tree_state(tree), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
