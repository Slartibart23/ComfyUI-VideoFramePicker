# Changelog

## 0.1.5 - 2026-08-25
- Removed the decoded-frame preview from the Selected frame panel; the player is the single preview. The panel keeps frame number, timestamp, size and target filename. The /frame endpoint remains available.

## 0.1.4 - 2026-08-25
- Frame preview now spans the full node width and scales with the node, exactly like the player. Its height is capped at 60% of the node width (THUMB_MAX_HEIGHT_RATIO); portrait frames are letterboxed. Frame metadata moved below the preview. Replaces the fixed 320 px thumbnail.

## 0.1.3 - 2026-08-25
- Fix: removed the video_upload widget flag. Newer ComfyUI frontends attached their own upload button and an unbounded video preview below the node, which duplicated the built-in player and could show a stale, unrelated video. The node's own Upload button and player remain.
- Frame preview thumbnail is hidden until it has actually loaded; load errors now show a status message instead of an empty frame.

## 0.1.2 - 2026-08-25
- Fix: the exactly decoded frame preview could render at the video's natural size on some frontends. It is now hard-limited via inline styles (max edge 320 px, configurable via THUMB_MAX in web/js/video_frame_picker.js) and scales with the node.
- Frame info panel: metadata now sits next to the preview and wraps on narrow nodes.
- Exports are unaffected: saved files and the IMAGE output always use the original video resolution.

## 0.1.1 – 2026-08-21
- Fix: widget values shifted after reloading a workflow (jpg_quality received 'both'), caused by inserting the upload button and preview between the inputs. They now stay below the inputs.

## 0.1.0 – 2026-08-21
Initial release.
- Video Frame Picker node with in-node player and frame-accurate stepping.
- Video and frame metadata panels, exactly decoded frame thumbnail.
- IMAGE output plus JPG/PNG export (on run or instantly via button).
- MP4/WebM native preview, AVI/MOV/MKV via cached ffmpeg transcode.
- Additional outputs: frame_index, fps, width, height, saved_path.
