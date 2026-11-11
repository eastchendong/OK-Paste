"""Tuotie managed startup bridge: attach to this Blender without opening a file."""
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.request

import bpy

RUNTIME = Path.home() / 'Library/Application Support/Tuotie/runtime'
_last_error = ''


def service_ready():
    try:
        # Local health checks must not use a machine's HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:47721/health', timeout=0.2) as response:
            return json.load(response).get('ok') is True
    except (OSError, ValueError):
        return False


def attach(runtime=RUNTIME):
    """Reuse loaded modules and transactions; only register missing bridge classes."""
    if not getattr(bpy.context, 'scene', None):
        return
    addon = sys.modules.get('okpaste_upstream_mcp')
    if addon is None and hasattr(bpy.types.Scene, 'blendermcp_port'):
        addon = next((module for module in tuple(sys.modules.values())
                      if callable(getattr(module, '_blendermcp_schedule_auto_start', None))), None)
        if addon is None:
            raise RuntimeError('已有 Blender MCP，无法识别其启动接口；保留原连接')
    if addon is None:
        source = runtime / '.local/mcp-for-blender/addon.py'
        if not source.is_file():
            raise RuntimeError('请先准备妥帖 Blender MCP 运行资源')
        os.environ.setdefault('DISABLE_TELEMETRY', '1')
        os.environ.setdefault('BLENDER_MCP_DISABLE_TELEMETRY', '1')
        spec = importlib.util.spec_from_file_location('okpaste_upstream_mcp', source)
        addon = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = addon
        try:
            spec.loader.exec_module(addon)
            addon.register()
        except Exception:
            sys.modules.pop(spec.name, None)
            raise

    server = getattr(bpy.types, 'blendermcp_server', None)
    if server and server.running and server.port != 9876:
        raise RuntimeError('现有 Blender MCP 使用其他端口；保留原连接')
    if (not server or not server.running) and addon._blendermcp_port_has_listener('127.0.0.1', 9876):
        raise RuntimeError('另一个 Blender 已连接妥帖；当前窗口不接管拖放')
    bpy.context.scene.blendermcp_port = 9876
    bpy.context.scene.blendermcp_auto_start_server = True
    addon._blendermcp_schedule_auto_start()

    module_path = str(runtime / 'blender')
    if module_path not in sys.path:
        sys.path.insert(0, module_path)
    operations = importlib.import_module('operations')
    operations.ROOT = runtime
    for cls in (operations.OKPASTE_OT_drop_reference, operations.OKPASTE_FH_reference):
        if not cls.is_registered:
            bpy.utils.register_class(cls)
    # Respect a manual stop in Blender's own connection panel.
    if not getattr(addon, '_user_stopped_server', False) and not bpy.context.window_manager.get('okpaste_ai_mode', False):
        operations.set_mode(True)


def tick():
    global _last_error
    if not service_ready():
        return 2.0
    try:
        attach()
        _last_error = ''
    except Exception as error:
        message = str(error)
        if message != _last_error:
            print('妥帖自动连接：' + message, flush=True)
            _last_error = message
    return 2.0


def register():
    # Batch rendering and command-line file tools should not expose an MCP server.
    if not bpy.app.background and not bpy.app.timers.is_registered(tick):
        bpy.app.timers.register(tick, first_interval=1.0, persistent=True)


def unregister():
    if bpy.app.timers.is_registered(tick):
        bpy.app.timers.unregister(tick)
