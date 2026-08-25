# ComfyUI-VideoFramePicker

A ComfyUI custom node that loads a video (MP4, AVI and more), lets you **scrub to any frame inside the node** and outputs exactly the visible frame – as a standard `IMAGE` tensor for further processing and/or as a JPG/PNG file on disk.

![Node](docs/node.png)

## Features

- **In-node video player** with frame-accurate stepping (±1 / ±10 / first / last, arrow keys, Shift+arrows).
- **Live metadata panels**
  - Video: file name, container/codec, resolution, FPS, frame count, duration, file size, audio track.
  - Selected frame: frame number (1-based), timestamp, size and the resulting file name.
- **Two export paths**
  - `IMAGE` output when the workflow runs – ready for VAE Encode, ControlNet, IPAdapter, upscalers, …
  - **"Save frame now"** button writes the frame immediately without queueing the workflow.
- Output file naming: `<video name>_frameXXXXX.jpg` (at least 5 digits, grows automatically for long videos).
- Extra outputs: `frame_index`, `fps`, `width`, `height`, `saved_path`.
- MP4/WebM are previewed natively. AVI, MOV, MKV are transcoded once with ffmpeg for the preview (cached in the temp folder); decoding for the outputs always uses the original file.

## Installation

### ComfyUI Manager
Search for **Video Frame Picker** and install.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/slartibart23b/ComfyUI-VideoFramePicker.git
cd ComfyUI-VideoFramePicker
pip install -r requirements.txt
```
Restart ComfyUI.

**Optional:** `ffmpeg`/`ffprobe` on your PATH enables AVI/MOV/MKV previews and audio detection. MP4 works without it.

## Usage

1. Add **video → frame picker → Video Frame Picker**.
2. Click **Upload video** (copies the file to `ComfyUI/input`) or pick an existing file from the dropdown.
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

## Notes

- Frame numbering is **1-based** (frame 1 = first frame), like most NLEs.
- The `IMAGE` output is decoded losslessly from the source; `file_format`/`jpg_quality` only affect the saved file.
- Seeking accuracy: OpenCV seeks by keyframe on some codecs. The node verifies the position and falls back to a short sequential decode, so the output frame matches `frame_index`.

## License

MIT
