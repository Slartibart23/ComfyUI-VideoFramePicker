"""ComfyUI-VideoFramePicker

Load a video, scrub to a frame inside the node and output / save exactly that frame.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from . import routes  # noqa: F401  (registers the HTTP endpoints on import)

__version__ = "0.1.0"

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
