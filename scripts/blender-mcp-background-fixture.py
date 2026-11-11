"""Isolated developer fixture using upstream MCP TCP handlers in batch Blender.

Upstream intentionally refuses start() in background mode. This fixture pumps
its existing command queue on the main thread and substitutes camera rendering
for GPU viewport capture. No production startup configuration is changed.
"""
import bpy
import importlib.util
import os
from pathlib import Path
import socket
import sys
import threading
import time
from mathutils import Vector

args = sys.argv[sys.argv.index('--')+1:]
root, folder, port = Path(args[0]), Path(args[1]), int(args[2])
sys.path.insert(0, str(root / 'blender'))
os.environ['DISABLE_TELEMETRY'] = '1'
os.environ['BLENDER_MCP_DISABLE_TELEMETRY'] = '1'
spec = importlib.util.spec_from_file_location('isolated_upstream_mcp', root / '.local/mcp-for-blender/addon.py')
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
# Factory scene is private to this new background process.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.name = 'Tuotie isolated MCP check'
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.08))
ground = bpy.context.object
ground.name = 'FixtureGround'
ground.scale = (3, 3, 0.16)
bpy.ops.object.camera_add(location=(2.8, -4.0, 3.0))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,0,0.4))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 3.8
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(0,-2,4))
bpy.context.object.data.energy = 450
bpy.context.object.data.size = 5
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
import operations
operations.ROOT = folder

class FixtureServer(addon.BlenderMCPServer):
    def get_viewport_screenshot(self, max_size=800, filepath=None, format='png'):
        current = bpy.context.scene
        old = current.render.filepath
        try:
            current.render.filepath = filepath
            bpy.ops.render.render(write_still=True)
        finally:
            current.render.filepath = old
        return {'success': True, 'filepath': filepath, 'method': 'isolated-background-camera-render'}

server = FixtureServer(host='127.0.0.1', port=port)
server.running = True
server.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.socket.bind(('127.0.0.1', port))
server.socket.listen(5)
server.server_thread = threading.Thread(target=server._server_loop, daemon=True)
server.server_thread.start()
(folder / 'ready').write_text(str(port))
try:
    deadline = time.monotonic()+600
    while not (folder / 'stop').exists() and time.monotonic() < deadline:
        server._drain_command_queue()
        time.sleep(0.03)
finally:
    server.running = False
    server.socket.close()
