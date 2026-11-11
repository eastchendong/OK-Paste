"""Small stdio-only extension of the pinned CapCut MCP (MIT).

The upstream manages real pyJianYingDraft catalogs and editable draft files.
Its HTTP/auth entry points are not used. The parent supplies a private staging
directory; no MCP editing tool sees the user's existing projects.
"""
import json
from typing import Optional
import pyJianYingDraft as draftlib
from capcut_mcp.server import mcp, manager
from capcut_mcp.core import DraftManager, _enum_member


# pyJianYingDraft registers decorations when add_segment is called. MCP edits
# already-added segments, so saving must register those later decorations too.
_original_save = DraftManager.save


def _save_with_decorations(self, draft_name):
    opened = self._get(draft_name)
    materials = opened.script.materials
    for segment in opened.segments.values():
        for attribute, collection in (("transition", "transitions"),
                                      ("animations_instance", "animations"),
                                      ("fade", "audio_fades")):
            decoration = getattr(segment, attribute, None)
            if decoration is not None and decoration not in materials:
                getattr(materials, collection).append(decoration)
        for effect in getattr(segment, "effects", []):
            if effect not in materials:
                collection = "video_effects" if isinstance(segment, draftlib.VideoSegment) else "audio_effects"
                getattr(materials, collection).append(effect)
    return _original_save(self, draft_name)


DraftManager.save = _save_with_decorations


@mcp.tool()
def add_video_effect(draft: str, segment_id: str, effect: str,
                     catalog: str = "video_scene_effect",
                     params: Optional[list[Optional[float]]] = None) -> str:
    """Apply a real catalog effect to a video segment. Browse list_effects first.

    catalog is video_scene_effect or video_character_effect; params follow the
    catalog defaults unless explicitly supplied. No invented resource IDs.
    """
    if catalog not in ("video_scene_effect", "video_character_effect"):
        raise ValueError("请选择视频画面或人物特效目录")
    editing = manager()
    opened = editing._get(draft)
    segment = editing._segment(opened, segment_id)
    segment.add_effect(_enum_member(catalog, effect), params=params)
    return json.dumps({"segment_id": segment_id, "effect": effect,
                       "catalog": catalog}, ensure_ascii=False)


@mcp.tool()
def describe_effect(catalog: str, name: str) -> str:
    """Read a real catalog entry, including resource IDs, VIP flags and parameters.

    Use catalog names from list_effects. Do not invent resource IDs or assume a
    paid effect is available; select according to the actual metadata.
    """
    value = _enum_member(catalog, name).value
    return json.dumps({"name": name, "catalog": catalog, "metadata": vars(value)},
                      ensure_ascii=False, default=lambda item: vars(item) if hasattr(item, "__dict__") else str(item))


if __name__ == "__main__":
    mcp.run(transport="stdio")
