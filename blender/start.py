"""Start an isolated demo Blender; load the unmodified upstream MCP addon."""
import bpy, importlib.util, sys, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender'))
from scene import build
path=ROOT/'assets/scenes/apple-basket.blend'
if not path.exists():build(path)
else:bpy.ops.wm.open_mainfile(filepath=str(path))
addon=ROOT/'.local/mcp-for-blender/addon.py'
spec=importlib.util.spec_from_file_location('okpaste_upstream_mcp',addon)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m);m.register()
bpy.context.scene.blendermcp_port=9876
bpy.context.scene.blendermcp_auto_start_server=True
import operations
operations.register(ROOT)
print('OKPASTE_BLENDER_READY',flush=True)
