# ComfyUI-VideoFramePicker

A ComfyUI custom node that loads a video (MP4, AVI and more), lets you **scrub to any frame inside the node** and outputs exactly the visible frame – as a standard `IMAGE` tensor for further processing and/or as a JPG/PNG file on disk.

![Node](docs/node.png)

## Features

- **In-node video player** with frame-accurate stepping (±1 / ±10 / first / last, arrow keys, Shift+arrows).
  The player fills the node and grows when you resize it; portrait videos are supported.
- **Drag & drop**: drop a video file onto the node (or the player) to upload and select it.
- **Live metadata**
  - Summary line: frame number (1-based), timestamp, size and the resulting file name.
  - Click the summary line to expand the video details: file name, container/codec, resolution, FPS, frame count, duration, file size, audio track.
- **Two export paths**
  - `IMAGE` output when the workflow runs – ready for VAE Encode, ControlNet, IPAdapter, upscalers, …
  - **"Save frame now"** button writes the frame immediately without queueing the workflow.
- Output file naming: `<video name>_frameXXXXX.jpg` (at least 5 digits, grows automatically for long videos).
- Extra outputs: `frame_index`, `fps`, `width`, `height`, `saved_path`, `filename`, `frame_filename`.
- MP4/WebM are previewed natively. AVI, MOV, MKV are transcoded once with ffmpeg for the preview (cached in the temp folder); decoding for the outputs always uses the original file.

## Installation

### ComfyUI Manager
Search for **Video Frame Picker** and install.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Slartibart23/ComfyUI-VideoFramePicker.git
cd ComfyUI-VideoFramePicker
pip install -r requirements.txt
```
Restart ComfyUI.

**Optional:** `ffmpeg`/`ffprobe` on your PATH enables AVI/MOV/MKV previews and audio detection. MP4 works without it.

## Usage

1. Add **video → frame picker → Video Frame Picker**.
2. Drag a video file onto the node, click **Upload video** (both copy the file to `ComfyUI/input`) or pick an existing file from the dropdown.
   Selecting a new video resizes the node to the video's aspect ratio; drag the node corner to make the preview larger or smaller.
3. Scrub the player or use the step buttons. `frame_index` follows the player and vice versa.
4. Either
   - connect the `image` output and queue the workflow, or
   - press **Save frame now** to export immediately.

### Inputs

| Input | Description |
|---|---|
| `video` | File from the input folder. |
| `frame_index` | 1-based frame number. Updated while scrubbing. Clamped to the video length. |
| `output_mode` | `image_output`, `save_file` or `both` (applies when the workflow runs). |
| `output_dir` | Empty = `ComfyUI/output`. Relative paths are created inside `output`, absolute paths are used as-is. |
| `file_format` | `jpg` or `png`. |
| `jpg_quality` | 1–100, JPEG only. |
| `overwrite` | Overwrite existing files, otherwise append `_001`, `_002`, … |

### Outputs

| Output | Type | Description |
|---|---|---|
| `image` | IMAGE | `(1, H, W, 3)` float32 RGB 0–1 – the normal ComfyUI image format. |
| `frame_index` | INT | The frame that was actually decoded. |
| `fps` | FLOAT | Source frame rate. |
| `width`, `height` | INT | Frame dimensions. |
| `saved_path` | STRING | Absolute path of the saved file, empty if nothing was saved. |
| `filename` | STRING | Video file name without extension, e.g. `clip` for `clip.mp4`. |
| `frame_filename` | STRING | Frame name without extension, e.g. `clip_frame00123` – same stem as saved files, available in every `output_mode` (handy as `filename_prefix` for Save Image). |

## Notes

- Frame numbering is **1-based** (frame 1 = first frame), like most NLEs.
- The `IMAGE` output is decoded losslessly from the source; `file_format`/`jpg_quality` only affect the saved file.
- Seeking accuracy: OpenCV seeks by keyframe on some codecs. The node verifies the position and falls back to a short sequential decode, so the output frame matches `frame_index`.

### Large videos (upload error 413)

ComfyUI rejects uploads larger than its upload limit (default 100 MB) – this applies to drag & drop and the Upload button alike. Either start ComfyUI with a higher limit, e.g. `--max-upload-size 2000` (MB), or copy the file into `ComfyUI/input` and pick it from the dropdown.

## License

MIT
