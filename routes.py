"""HTTP endpoints used by the node's front-end widget."""

import os
import traceback

from aiohttp import web
from server import PromptServer

from . import video_utils as vu

PREFIX = "/video_frame_picker"
routes = PromptServer.instance.routes


def _error(e, status=400):
    traceback.print_exc()
    return web.json_response({"error": str(e)}, status=status)


@routes.get(f"{PREFIX}/videos")
async def list_videos(request):
    """List video files in the input folder (used after an upload to refresh the combo)."""
    return web.json_response({"videos": vu.list_input_videos()})


@routes.get(f"{PREFIX}/info")
async def video_info(request):
    """Metadata for the selected video."""
    video = request.query.get("video", "")
    try:
        path = vu.resolve_video_path(video)
        return web.json_response(vu.probe_video(path))
    except Exception as e:
        return _error(e)


@routes.get(f"{PREFIX}/preview")
async def video_preview(request):
    """Stream a browser-playable version of the video (transcodes AVI etc. once)."""
    video = request.query.get("video", "")
    try:
        path = vu.resolve_video_path(video)
        playable = vu.preview_path_for(path)
        return web.FileResponse(playable, headers={"Accept-Ranges": "bytes"})
    except Exception as e:
        return _error(e)


@routes.get(f"{PREFIX}/frame")
async def frame_preview(request):
    """Exact decoded frame as JPEG, for the accurate still shown next to the player."""
    video = request.query.get("video", "")
    try:
        idx = int(request.query.get("frame_index", "1"))
        path = vu.resolve_video_path(video)
        rgb = vu.read_frame(path, idx)

        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.fromarray(rgb).save(buf, "JPEG", quality=85)
        return web.Response(body=buf.getvalue(), content_type="image/jpeg",
                            headers={"Cache-Control": "no-store"})
    except Exception as e:
        return _error(e)


@routes.post(f"{PREFIX}/export")
async def export_frame(request):
    """Save the selected frame immediately, without queueing the workflow."""
    try:
        data = await request.json()
        video = data.get("video", "")
        idx = int(data.get("frame_index", 1))
        output_dir = data.get("output_dir", "") or ""
        fmt = data.get("file_format", "jpg")
        quality = int(data.get("jpg_quality", 95))
        overwrite = bool(data.get("overwrite", True))

        path = vu.resolve_video_path(video)
        info = vu.probe_video(path)
        total = info["frame_count"]
        idx = max(1, min(idx, total)) if total > 0 else idx

        rgb = vu.read_frame(path, idx)
        saved = vu.save_frame(rgb, path, idx, total, output_dir,
                              fmt=fmt, quality=quality, overwrite=overwrite)
        h, w = rgb.shape[:2]
        return web.json_response({
            "saved_path": saved,
            "filename": os.path.basename(saved),
            "frame_index": idx,
            "width": w,
            "height": h,
        })
    except Exception as e:
        return _error(e)
