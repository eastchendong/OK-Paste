import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class AutoConnectTests(unittest.TestCase):
    def setUp(self):
        self.scene = SimpleNamespace()
        self.manager = {}
        self.timers = Mock()
        self.timers.is_registered.return_value = False
        self.bpy = SimpleNamespace(
            context=SimpleNamespace(scene=self.scene, window_manager=self.manager),
            types=SimpleNamespace(Scene=type('Scene', (), {})),
            app=SimpleNamespace(background=False, timers=self.timers),
            utils=SimpleNamespace(register_class=Mock(side_effect=lambda cls: setattr(cls, 'is_registered', True))))
        self.addon = SimpleNamespace(_blendermcp_schedule_auto_start=Mock(), _blendermcp_port_has_listener=Mock(return_value=False), _user_stopped_server=False)
        self.operations = SimpleNamespace(
            ROOT=None, PREVIEWS={'existing': object()}, HISTORY={'applied': object()},
            OKPASTE_OT_drop_reference=SimpleNamespace(is_registered=False),
            OKPASTE_FH_reference=SimpleNamespace(is_registered=False),
            set_mode=Mock(side_effect=lambda value: self.manager.update(okpaste_ai_mode=value)))
        self.modules = patch.dict(sys.modules, {'bpy': self.bpy, 'okpaste_upstream_mcp': self.addon, 'operations': self.operations})
        self.modules.start()
        spec=importlib.util.spec_from_file_location('tuotie_startup_test',Path(__file__).parents[1]/'blender/tuotie_autoconnect.py')
        self.module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.addCleanup(self.modules.stop)

    def test_waits_for_service_then_attaches_without_replacing_existing_transactions(self):
        previews=self.operations.PREVIEWS
        with patch.object(self.module, 'service_ready', return_value=False):
            self.assertEqual(self.module.tick(), 2.0)
            self.addon._blendermcp_schedule_auto_start.assert_not_called()
        with patch.object(self.module, 'service_ready', return_value=True):
            self.module.tick(); self.module.tick()
        self.assertEqual(self.bpy.utils.register_class.call_count, 2)
        self.operations.set_mode.assert_called_once_with(True)
        self.assertIs(self.operations.PREVIEWS, previews)
        self.assertEqual(self.scene.blendermcp_port, 9876)

    def test_register_is_deferred_persistent_and_does_not_enable_batch_rendering(self):
        self.module.register()
        self.timers.register.assert_called_once_with(self.module.tick, first_interval=1.0, persistent=True)
        self.addon._blendermcp_schedule_auto_start.assert_not_called()
        self.timers.register.reset_mock();self.bpy.app.background=True
        self.module.register();self.timers.register.assert_not_called()

    def test_does_not_retarget_an_existing_connection_or_override_manual_stop(self):
        self.bpy.types.blendermcp_server=SimpleNamespace(running=True,port=9999)
        with self.assertRaisesRegex(RuntimeError, '其他端口'):
            self.module.attach()
        self.bpy.utils.register_class.assert_not_called()
        del self.bpy.types.blendermcp_server
        self.addon._user_stopped_server=True
        self.module.attach();self.operations.set_mode.assert_not_called()

    def test_does_not_enable_drops_in_a_second_blender_when_the_port_is_already_owned(self):
        self.addon._blendermcp_port_has_listener.return_value=True
        with self.assertRaisesRegex(RuntimeError, '另一个 Blender'):
            self.module.attach()
        self.bpy.utils.register_class.assert_not_called()
        self.operations.set_mode.assert_not_called()
        self.addon._blendermcp_schedule_auto_start.assert_not_called()


if __name__ == '__main__':
    unittest.main()
