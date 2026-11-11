"""Read-only result geometry for the host's cross-application overlay.

No draw handlers, timers, selections, view changes or scene writes belong here.
Blender's region coordinates are backing pixels, while macOS window.width/height
are logical points. The reported pixel_size supplies that explicit conversion;
the native host validates it against its real target window and display metrics.
"""
import math
import sys

import bpy

_GEOMETRY = {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'VOLUME', 'POINTCLOUD', 'GREASEPENCIL'}
_COORDINATE_SPACE = 'window-content-normalized-top-left'


def _targets(task, phase):
    agent = sys.modules.get('agent_scene')
    record = agent.TRANSACTIONS.get(task) if agent else None
    if not record:
        return None, [], 'transaction-unavailable'
    committed = bool(record.get('committed'))
    if (phase == 'done') != committed:
        return None, [], 'transaction-phase-changed'
    scene = record['original'] if committed else record['stage']
    objects = list(record.get('committedObjects', [])) if committed else list(scene.objects)
    objects = [obj for obj in objects if obj.type in _GEOMETRY]
    added = [obj for obj in objects if obj.get('okpaste_object_id') not in record['before']]
    if added:
        return scene, added, None
    modified = objects if committed else [obj for obj in objects
        if agent.digest(obj) != record['before'].get(obj.get('okpaste_object_id'))]
    return scene, modified, None if modified else 'no-generated-geometry'


def _project_point(region, region_3d, point):
    clip = region_3d.perspective_matrix @ point.to_4d()
    if clip.w <= 0:
        return None
    from bpy_extras.view3d_utils import location_3d_to_region_2d
    return location_3d_to_region_2d(region, region_3d, point, default=None)


def _project_bounds(objects, region, region_3d, view_layer):
    from mathutils import Vector
    points, visible = [], set()
    for obj in objects:
        try:
            if not obj.visible_get(view_layer=view_layer):
                continue
            projected = [_project_point(region, region_3d, obj.matrix_world @ Vector(corner)) for corner in obj.bound_box]
            if not projected or any(point is None or not all(math.isfinite(float(v)) for v in point) for point in projected):
                continue
            # Offscreen objects do not enlarge a visible object's rectangle.
            left, right = min(p[0] for p in projected), max(p[0] for p in projected)
            bottom, top = min(p[1] for p in projected), max(p[1] for p in projected)
            if right <= 0 or left >= region.width or top <= 0 or bottom >= region.height:
                continue
            points.extend(projected)
            visible.add(obj.get('okpaste_object_id'))
        except (ReferenceError, RuntimeError):
            continue
    if not points:
        return None, set()
    left, right = max(0, min(p[0] for p in points)), min(region.width, max(p[0] for p in points))
    bottom, top = max(0, min(p[1] for p in points)), min(region.height, max(p[1] for p in points))
    if right <= left or top <= bottom:
        return None, set()
    return (left, bottom, right, top), visible


def _window_metrics(window):
    system = bpy.context.preferences.system
    pixel_size = float(system.pixel_size)
    ui_scale = float(system.ui_scale)
    if not math.isfinite(pixel_size) or pixel_size <= 0 or window.width <= 0 or window.height <= 0:
        return None
    width, height = float(window.width) * pixel_size, float(window.height) * pixel_size
    layout_width = max((area.x + area.width for area in window.screen.areas), default=0)
    layout_height = max((area.y + area.height for area in window.screen.areas), default=0)
    # Return unavailable for inconsistent metrics instead of inventing a ratio.
    if layout_width > width + 1 or layout_height > height + 1:
        return None
    return ({'x': window.x, 'y': window.y, 'width': width, 'height': height},
            {'pixelSize': pixel_size, 'uiScale': ui_scale,
             'rawWindow': {'x': window.x, 'y': window.y, 'width': window.width, 'height': window.height},
             'layoutExtents': {'width': layout_width, 'height': layout_height}})


def describe(task, phase='preview'):
    """Return actual projected result bounds; the native host owns highlighting."""
    if not isinstance(task, str) or phase not in {'preview', 'done'}:
        raise ValueError('无效的生成结果区域请求')
    base = {'available': False, 'phase': phase, 'coordinateSpace': _COORDINATE_SPACE, 'regions': []}
    scene, objects, reason = _targets(task, phase)
    if reason:
        return {**base, 'reason': reason}
    saw_view = False
    for window in bpy.context.window_manager.windows:
        if window.scene != scene:
            continue
        metrics = _window_metrics(window)
        if metrics is None:
            return {**base, 'reason': 'inconsistent-window-metrics'}
        source_window, screen_metrics = metrics
        regions, viewports, visible = [], [], set()
        for area in window.screen.areas:
            if area.type != 'VIEW_3D' or not area.spaces.active.region_3d:
                continue
            for region in area.regions:
                if region.type != 'WINDOW' or region.width <= 1 or region.height <= 1:
                    continue
                saw_view = True
                bounds, object_ids = _project_bounds(objects, region, area.spaces.active.region_3d, window.view_layer)
                if bounds is None:
                    continue
                left, bottom, right, top = bounds
                absolute_left, absolute_top = region.x + left, region.y + top
                rect = {'x': absolute_left / source_window['width'],
                        'y': 1 - absolute_top / source_window['height'],
                        'width': (right-left) / source_window['width'],
                        'height': (top-bottom) / source_window['height']}
                if rect['x'] < 0 or rect['y'] < 0 or rect['x']+rect['width'] > 1 or rect['y']+rect['height'] > 1:
                    continue
                regions.append(rect)
                visible.update(object_ids)
                viewports.append({'region': {'x': region.x, 'y': region.y, 'width': region.width, 'height': region.height},
                                  'projectedBounds': {'x': left, 'y': bottom, 'width': right-left, 'height': top-bottom}})
        if regions:
            return {**base, 'available': True, 'objectCount': len(visible), 'window': source_window,
                    'regions': regions, 'viewports': viewports, 'screenMetrics': screen_metrics}
    return {**base, 'reason': 'geometry-outside-view' if saw_view else 'no-3d-viewport'}
