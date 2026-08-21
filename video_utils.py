"""Video helpers shared by the node and the HTTP routes."""

import os
import hashlib
import shutil
import subprocess

import cv2
import numpy as np
from PIL import Image

import folder_paths

SUPPORTED_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v")
# Formats the browser <video> element can play without transcoding
BROWSER_NATIVE_EXTENSIONS = (".mp4", ".webm", ".m4v")


def list_input_videos():
    """Return all video files found in the ComfyUI input directory (sorted)."""
    input_dir = folder_paths.get_input_directory()
    files = []
    for root, _dirs, names in os.walk(input_dir):
        for name in names:
            if name.lower().endswith(SUPPORTED_EXTENSIONS):
                rel = os.path.relpath(os.path.join(root, name), input_dir)
                files.append(rel.replace(os.sep, "/"))
    return sorted(files)


def resolve_video_path(video):
    """Map a node 'video' value (relative to input dir) to an absolute, validated path."""
    if not video:
        raise ValueError("No video selected.")
    path = folder_paths.get_annotated_filepath(video)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Video file not found: {video}")
    return path


def _fourcc_to_str(value):
    try:
        v = int(value)
        return "".join(chr((v >> (8 * i)) & 0xFF) for i in range(4)).strip() or "unknown"
    except Exception:
        return "unknown"


def probe_video(path):
    """Return a dict with the basic video metadata."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {os.path.basename(path)}")
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        codec = _fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC))
    finally:
        cap.release()

    duration = (total / fps) if fps > 0 else 0.0
    return {
        "filename": os.path.basename(path),
        "container": os.path.splitext(path)[1].lstrip(".").lower(),
        "codec": codec,
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "frame_count": total,
        "duration": round(duration, 3),
        "file_size": os.path.getsize(path),
        "has_audio": _has_audio(path),
    }


def _has_audio(path):
    """Best-effort audio detection via ffprobe. Returns None when ffprobe is unavailable."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=15,
        )
        return "audio" in out.stdout
    except Exception:
        return None


def read_frame(path, frame_index_1based):
    """Decode one frame (1-based index). Returns an RGB uint8 numpy array (H, W, 3)."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {os.path.basename(path)}")
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total > 0:
            frame_index_1based = max(1, min(frame_index_1based, total))
        target = frame_index_1based - 1

        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        ok, frame = cap.read()

        # Some codecs seek imprecisely; verify and fall back to a short sequential walk.
        pos_after = int(cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1
        if not ok or (pos_after != target and pos_after >= 0):
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, target - 30))
            ok = False
            while True:
                current = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                ok, frame = cap.read()
                if not ok or current >= target:
                    break
        if not ok or frame is None:
            raise RuntimeError(f"Could not decode frame {frame_index_1based}.")
    finally:
        cap.release()

    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def frame_to_tensor(rgb):
    """numpy (H, W, 3) uint8 -> torch tensor (1, H, W, 3) float32 in [0, 1]."""
    import torch
    arr = rgb.astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]


def build_output_filename(video_path, frame_index_1based, total_frames, ext):
    stem = os.path.splitext(os.path.basename(video_path))[0]
    digits = max(5, len(str(total_frames)))
    return f"{stem}_frame{frame_index_1based:0{digits}d}.{ext}"


def resolve_output_dir(output_dir):
    """Empty -> ComfyUI output dir. Relative paths are resolved inside the output dir."""
    base = folder_paths.get_output_directory()
    if not output_dir or not output_dir.strip():
        return base
    output_dir = os.path.expanduser(output_dir.strip())
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(base, output_dir)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def save_frame(rgb, video_path, frame_index_1based, total_frames, output_dir,
               fmt="jpg", quality=95, overwrite=True):
    """Save an RGB frame to disk. Returns the absolute path of the written file."""
    fmt = "png" if str(fmt).lower() == "png" else "jpg"
    out_dir = resolve_output_dir(output_dir)
    filename = build_output_filename(video_path, frame_index_1based, total_frames, fmt)
    target = os.path.join(out_dir, filename)

    if not overwrite and os.path.exists(target):
        stem, ext = os.path.splitext(filename)
        n = 1
        while os.path.exists(os.path.join(out_dir, f"{stem}_{n:03d}{ext}")):
            n += 1
        target = os.path.join(out_dir, f"{stem}_{n:03d}{ext}")

    img = Image.fromarray(rgb)
    if fmt == "jpg":
        img.save(target, "JPEG", quality=int(quality), subsampling=0, optimize=True)
    else:
        img.save(target, "PNG", compress_level=4)
    return target


def preview_path_for(path):
    """Return a browser-playable file for the given video.

    MP4/WebM are served directly. Other containers (e.g. AVI) are transcoded once with
    ffmpeg into the ComfyUI temp directory and cached by path + mtime.
    """
    if path.lower().endswith(BROWSER_NATIVE_EXTENSIONS):
        return path

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to preview this container in the browser, "
                           "but it was not found on PATH.")

    key = hashlib.sha1(f"{path}|{os.path.getmtime(path)}".encode()).hexdigest()[:16]
    cache_dir = os.path.join(folder_paths.get_temp_directory(), "video_frame_picker")
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, f"{key}.mp4")
    if os.path.isfile(out):
        return out

    cmd = [ffmpeg, "-y", "-v", "error", "-i", path,
           "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True, timeout=600)
    return out
