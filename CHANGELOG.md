# Changelog

## 0.1.1 – 2026-08-21
- Fix: widget values shifted after reloading a workflow (jpg_quality received 'both'), caused by inserting the upload button and preview between the inputs. They now stay below the inputs.

## 0.1.0 – 2026-08-21
Initial release.
- Video Frame Picker node with in-node player and frame-accurate stepping.
- Video and frame metadata panels, exactly decoded frame thumbnail.
- IMAGE output plus JPG/PNG export (on run or instantly via button).
- MP4/WebM native preview, AVI/MOV/MKV via cached ffmpeg transcode.
- Additional outputs: frame_index, fps, width, height, saved_path.
