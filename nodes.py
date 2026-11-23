import os

import torch

from . import mask_utils as mu
from . import video_utils as vu


class VideoFramePicker:
    """Load a video, pick one frame (1-based), output it as IMAGE and/or save it to disk."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": (vu.list_input_videos(), {
                    "tooltip": "Video file from the ComfyUI input folder. Use the Upload button "
                               "to add MP4 or AVI files. AVI is transcoded once for the in-node preview.",
                }),
                "frame_index": ("INT", {
                    "default": 1, "min": 1, "max": 2_000_000_000, "step": 1,
                    "tooltip": "Frame to output (1-based, frame 1 is the first frame). "
                               "Updated automatically while scrubbing the preview player.",
                }),
                "output_mode": (["image_output", "save_file", "both"], {
                    "default": "both",
                    "tooltip": "image_output: only emit the IMAGE tensor. "
                               "save_file: only write the frame to disk when the workflow runs. "
                               "both: do both.",
                }),
                "output_dir": ("STRING", {
                    "default": "",
                    "tooltip": "Folder for saved frames. Empty = ComfyUI output folder. "
                               "Relative paths are created inside the output folder; absolute paths are used as-is.",
                }),
                "file_format": (["jpg", "png"], {
                    "default": "jpg",
                    "tooltip": "Image format for saved frames. Does not affect the IMAGE output.",
                }),
                "jpg_quality": ("INT", {
                    "default": 95, "min": 1, "max": 100, "step": 1,
                    "tooltip": "JPEG quality (1-100). Ignored for PNG.",
                }),
                "overwrite": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Overwrite an existing file with the same name. "
                               "Off: append _001, _002, ... instead.",
                }),
                "mask_source": (mu.MASK_SOURCES, {
                    "default": "none",
                    "tooltip": "Which mask comes out at 'mask'. none: empty mask. "
                               "MaskEditor: painted with the Mask Editor button (paint colour is drawn into the image). "
                               "rectangle: drag a rectangle over the player. "
                               "freehand: paint the area to keep, the rest of the image is filled with fill_color. "
                               "The mask is stored in the workflow and applies to whichever frame is selected.",
                }),
                "fill_color": (list(mu.FILL_COLORS), {
                    "default": "yellow",
                    "tooltip": "Colour for the area outside the freehand shape.",
                }),
                "crop_data": ("STRING", {
                    "default": "",
                    "tooltip": "Written by the editor in the node preview.",
                }),
                "crop_to_mask": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Crop image and mask to the bounding box of the mask. "
                               "Without a mask nothing is cropped. The saved file is never cropped.",
                }),
            }
        }

    # New outputs are only ever appended: existing links refer to outputs by slot index.
    RETURN_TYPES = ("IMAGE", "INT", "FLOAT", "INT", "INT", "STRING", "STRING", "STRING", "MASK")
    RETURN_NAMES = ("image", "frame_index", "fps", "width", "height", "saved_path",
                    "filename", "frame_filename", "mask")
    OUTPUT_TOOLTIPS = (
        "The selected frame as a standard ComfyUI IMAGE tensor (1, H, W, 3), RGB, 0-1.",
        "The 1-based index of the frame that was actually decoded (clamped to the video length).",
        "Frames per second of the source video.",
        "Frame width in pixels.",
        "Frame height in pixels.",
        "Absolute path of the saved file, or an empty string if nothing was saved.",
        "File name of the source video without extension (e.g. 'clip' for clip.mp4).",
        "Name for the selected frame without extension (e.g. 'clip_frame00123'), "
        "the same stem used for saved files. Works in every output_mode, "
        "e.g. as filename_prefix for a Save Image node.",
        "Mask from mask_source, same size as the image.",
    )
    FUNCTION = "pick"
    CATEGORY = "video/frame picker"
    DESCRIPTION = ("Loads an MP4/AVI video, lets you scrub to a frame inside the node and outputs "
                   "exactly that frame as an IMAGE. Optionally saves it as JPG/PNG named "
                   "<video>_frameXXXXX. The 'Save frame now' button exports without running the workflow.")

    @classmethod
    def IS_CHANGED(cls, video, frame_index, output_mode, output_dir, file_format, jpg_quality, overwrite,
                   mask_source, fill_color, crop_data, crop_to_mask):
        try:
            path = vu.resolve_video_path(video)
            return (f"{path}|{os.path.getmtime(path)}|{frame_index}|{output_mode}|{output_dir}|{file_format}|"
                    f"{jpg_quality}|{overwrite}|{mask_source}|{fill_color}|{crop_data}|{crop_to_mask}")
        except Exception:
            return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, video, **kwargs):
        try:
            vu.resolve_video_path(video)
        except Exception as e:
            return str(e)
        return True

    def pick(self, video, frame_index, output_mode, output_dir, file_format, jpg_quality, overwrite,
             mask_source, fill_color, crop_data, crop_to_mask):
        path = vu.resolve_video_path(video)
        info = vu.probe_video(path)
        total = info["frame_count"]
        idx = max(1, min(int(frame_index), total)) if total > 0 else int(frame_index)

        rgb = vu.read_frame(path, idx)

        saved_path = ""
        if output_mode in ("save_file", "both"):
            saved_path = vu.save_frame(rgb, path, idx, total, output_dir,
                                       fmt=file_format, quality=jpg_quality, overwrite=overwrite)

        filename = os.path.splitext(os.path.basename(path))[0]
        frame_filename = os.path.splitext(vu.build_output_filename(path, idx, total, "jpg"))[0]

        out_rgb, mask = mu.apply_mask(rgb, mask_source, fill_color, crop_data, crop_to_mask)
        h, w = out_rgb.shape[:2]
        return (vu.frame_to_tensor(out_rgb), idx, float(info["fps"]), w, h, saved_path, filename, frame_filename,
                torch.from_numpy(mask)[None, ...])


NODE_CLASS_MAPPINGS = {
    "VideoFramePicker": VideoFramePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VideoFramePicker": "Video Frame Picker",
}
