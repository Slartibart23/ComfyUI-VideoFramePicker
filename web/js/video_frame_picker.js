import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "VideoFramePicker";
const API = "/video_frame_picker";

const VIDEO_EXTENSIONS = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"];
const DEFAULT_NODE_WIDTH = 640;
const MIN_PLAYER_HEIGHT = 140;   // the player never shrinks below this
// When the node is auto-fitted to a video, the player is at most this tall and never taller than wide
// (portrait videos get a square player instead of a very tall node).
const MAX_AUTO_PLAYER_HEIGHT = 900;

const CSS = `
.vfp-root { display:flex; flex-direction:column; gap:4px; font-family: var(--font-family, sans-serif);
  font-size:11px; color: var(--input-text, #ddd); width:100%; height:100%; box-sizing:border-box;
  padding:2px; overflow:hidden; position:relative; outline:none; }
.vfp-stage { flex:1 1 auto; min-height:${MIN_PLAYER_HEIGHT}px; position:relative; background:#000;
  border-radius:4px; overflow:hidden; }
.vfp-player { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; background:#000; }
.vfp-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center;
  padding:8px; opacity:.6; pointer-events:none; font-size:12px; line-height:1.5; }
.vfp-empty[hidden] { display:none; }
.vfp-row { flex:0 0 auto; display:flex; gap:4px; align-items:center; }
.vfp-row button { flex:0 0 auto; background: var(--comfy-input-bg,#333); color: var(--input-text,#ddd);
  border:1px solid var(--border-color,#555); border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; }
.vfp-row button:hover { border-color: var(--input-text,#ddd); }
.vfp-row button:disabled { opacity:.4; cursor:default; }
.vfp-spacer { flex:1; }
.vfp-export { background: var(--comfy-menu-bg,#444) !important; font-weight:600; }
.vfp-summary { flex:0 0 auto; display:flex; gap:6px; align-items:center; background: var(--comfy-input-bg,#222);
  border:1px solid var(--border-color,#444); border-radius:4px; padding:3px 6px; cursor:pointer; user-select:none;
  white-space:nowrap; overflow:hidden; }
.vfp-summary:hover { border-color: var(--input-text,#ddd); }
.vfp-caret { flex:0 0 auto; opacity:.7; width:10px; }
.vfp-summary-text { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; }
.vfp-details { flex:0 0 auto; background: var(--comfy-input-bg,#222); border:1px solid var(--border-color,#444);
  border-radius:4px; padding:4px 6px; line-height:1.45; }
.vfp-details[hidden] { display:none; }
.vfp-details h4 { margin:0 0 2px; font-size:10px; text-transform:uppercase; letter-spacing:.04em; opacity:.7; font-weight:600; }
.vfp-grid { display:grid; grid-template-columns:auto 1fr auto 1fr; column-gap:8px; row-gap:0; }
.vfp-grid span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.vfp-grid span:nth-child(odd) { opacity:.65; }
.vfp-status { flex:0 0 auto; font-size:10px; opacity:.8; min-height:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vfp-status.err { color:#f66; opacity:1; }
.vfp-status.ok { color:#8d8; opacity:1; }
.vfp-drop { position:absolute; inset:0; display:none; align-items:center; justify-content:center; z-index:5;
  border:2px dashed #6af; border-radius:6px; background:rgba(40,90,160,.35); color:#fff; font-size:14px;
  font-weight:600; pointer-events:none; }
.vfp-root.vfp-dragover .vfp-drop { display:flex; }
`;

function injectCSS() {
  if (document.getElementById("vfp-style")) return;
  const s = document.createElement("style");
  s.id = "vfp-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fmtTime(sec) {
  if (!isFinite(sec)) return "--:--:--.---";
  const ms = Math.round((sec % 1) * 1000) % 1000;
  const s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
}

function fmtBytes(b) {
  if (!b && b !== 0) return "-";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function getWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function isVideoFile(file) {
  if (!file) return false;
  if (file.type?.startsWith("video/")) return true;
  const n = file.name?.toLowerCase() || "";
  return VIDEO_EXTENSIONS.some((ext) => n.endsWith(ext));
}

function hasFiles(e) {
  return Array.from(e?.dataTransfer?.types || []).includes("Files");
}

function firstVideoFile(e) {
  return Array.from(e?.dataTransfer?.files || []).find(isVideoFile) || null;
}

app.registerExtension({
  name: "comfy.VideoFramePicker",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    injectCSS();

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      const node = this;

      const videoW = getWidget(node, "video");
      const frameW = getWidget(node, "frame_index");
      const outDirW = getWidget(node, "output_dir");
      const fmtW = getWidget(node, "file_format");
      const qualW = getWidget(node, "jpg_quality");
      const overW = getWidget(node, "overwrite");

      node.properties = node.properties || {};

      // ---------- state ----------
      let info = null;          // metadata from /info
      let syncing = false;      // prevents feedback loops between player and widget
      let fitOnLoad = false;    // resize the node to the video's aspect ratio once its metadata is known

      // ---------- DOM ----------
      const root = el("div", "vfp-root");
      root.tabIndex = 0;

      const stage = el("div", "vfp-stage");
      const player = el("video", "vfp-player");
      player.controls = true;
      player.muted = true;
      player.preload = "metadata";
      player.playsInline = true;
      const empty = el("div", "vfp-empty", "Drop a video here\nor use “Upload video”");
      empty.style.whiteSpace = "pre-line";
      stage.append(player, empty);
      root.appendChild(stage);

      const ctl = el("div", "vfp-row");
      const bFirst = el("button", null, "⏮");   bFirst.title = "First frame";
      const bPrev10 = el("button", null, "-10"); bPrev10.title = "Back 10 frames (Shift+←)";
      const bPrev = el("button", null, "◀ -1");   bPrev.title = "Previous frame (←, pauses playback)";
      const bNext = el("button", null, "+1 ▶");   bNext.title = "Next frame (→, pauses playback)";
      const bNext10 = el("button", null, "+10"); bNext10.title = "Forward 10 frames (Shift+→)";
      const bLast = el("button", null, "⏭");    bLast.title = "Last frame";
      const bExport = el("button", "vfp-export", "Save frame now");
      bExport.title = "Write the visible frame to disk immediately, without running the workflow. "
                    + "Uses output_dir, file_format, jpg_quality and overwrite from this node.";
      ctl.append(bFirst, bPrev10, bPrev, bNext, bNext10, bLast, el("div", "vfp-spacer"), bExport);
      root.appendChild(ctl);

      const summary = el("div", "vfp-summary");
      summary.title = "Click to show or hide the video details";
      const caret = el("span", "vfp-caret", "▸");
      const summaryText = el("span", "vfp-summary-text", "No video");
      summary.append(caret, summaryText);
      root.appendChild(summary);

      const details = el("div", "vfp-details");
      details.appendChild(el("h4", null, "Video"));
      const vGrid = el("div", "vfp-grid");
      details.appendChild(vGrid);
      root.appendChild(details);

      const status = el("div", "vfp-status", "");
      root.appendChild(status);

      const dropOverlay = el("div", "vfp-drop", "Drop video to load it");
      root.appendChild(dropOverlay);

      // Height of everything except the player, measured when possible (falls back to estimates
      // while the element is not laid out, e.g. right after creation or when zoomed out).
      const chromeHeight = () => {
        let h = 0;
        let n = 0;
        for (const child of [ctl, summary, details, status]) {
          if (child.hidden) continue;
          const fallback = child === details ? 74 : child === status ? 13 : 24;
          h += child.offsetHeight || fallback;
          n++;
        }
        return h + n * 4 + 4; // flex gaps + root padding
      };

      // `let` + later assignment: getMinHeight may run while addDOMWidget is still executing.
      let widget = null;
      widget = node.addDOMWidget("vfp_preview", "VFP", root, {
        serialize: false,
        hideOnZoom: false,
        // No getMaxHeight: the widget takes all free node height, so the player grows with the node.
        // The frontend shrinks the element by the widget margin on both sides, so add it back.
        getMinHeight: () => MIN_PLAYER_HEIGHT + chromeHeight() + 2 * (widget?.margin ?? 10),
      });

      // ---------- helpers ----------
      const setStatus = (msg, cls = "") => { status.textContent = msg; status.className = "vfp-status " + cls; };

      const fill = (grid, pairs) => {
        grid.innerHTML = "";
        for (const [k, v] of pairs) {
          const vs = el("span", null, String(v));
          vs.title = String(v);
          grid.append(el("span", null, k), vs);
        }
      };

      const fps = () => (info?.fps > 0 ? info.fps : (player.duration && info?.frame_count ? info.frame_count / player.duration : 25));
      const total = () => info?.frame_count || 0;
      const clamp = (i) => Math.max(1, total() ? Math.min(i, total()) : i);

      const timeToIndex = (t) => clamp(Math.floor(t * fps() + 1e-4) + 1);
      const indexToTime = (i) => (i - 1 + 0.5) / fps();

      const outputName = (idx) => {
        const stem = (info?.filename || "video").replace(/\.[^.]+$/, "");
        const digits = Math.max(5, String(total()).length);
        return `${stem}_frame${String(idx).padStart(digits, "0")}.${fmtW?.value || "jpg"}`;
      };

      const updateFrameInfo = (idx) => {
        if (!info) {
          summaryText.textContent = videoW.value ? "Loading…" : "No video";
          return;
        }
        const parts = [
          `Frame ${total() ? `${idx} / ${total()}` : idx}`,
          fmtTime((idx - 1) / fps()),
          `${info.width}×${info.height}`,
          outputName(idx),
        ];
        summaryText.textContent = parts.join("  ·  ");
        summary.title = "Click to show or hide the video details\n" + parts.join("\n");
      };

      const relayout = () => {
        // Grow the node if the minimum content height increased (e.g. details expanded).
        const min = node.computeSize()[1];
        if (node.size[1] < min) node.setSize([node.size[0], min]);
        node.setDirtyCanvas(true, true);
      };

      const setDetailsOpen = (open) => {
        details.hidden = !open;
        caret.textContent = open ? "▾" : "▸";
        node.properties.vfp_details_open = !!open;
        relayout();
      };
      summary.addEventListener("click", () => setDetailsOpen(details.hidden));

      // Resize the node so the player area matches the video's aspect ratio at the current width.
      const fitToVideo = () => {
        const vw = player.videoWidth, vh = player.videoHeight;
        const current = stage.clientHeight;
        if (!vw || !vh || !current) return;
        const maxH = Math.min(MAX_AUTO_PLAYER_HEIGHT, stage.clientWidth);
        const target = Math.round(Math.max(MIN_PLAYER_HEIGHT, Math.min(maxH, stage.clientWidth * vh / vw)));
        if (Math.abs(target - current) < 4) return;
        node.setSize([node.size[0], Math.max(node.computeSize()[1], node.size[1] + target - current)]);
        node.setDirtyCanvas(true, true);
      };

      const setIndex = (idx, { seek = true } = {}) => {
        idx = clamp(idx);
        if (frameW.value !== idx) {
          syncing = true;
          frameW.value = idx;
          syncing = false;
        }
        if (seek && isFinite(player.duration)) {
          player.pause();
          player.currentTime = Math.min(indexToTime(idx), Math.max(0, player.duration - 0.001));
        }
        updateFrameInfo(idx);
        node.setDirtyCanvas(true, true);
      };

      const step = (d) => setIndex((frameW.value || 1) + d);

      const loadVideo = async () => {
        const name = videoW.value;
        info = null;
        empty.hidden = !!name;
        if (!name) {
          player.removeAttribute("src");
          player.load();
          fill(vGrid, [["No video", "Drop a file or use Upload video"]]);
          updateFrameInfo(1);
          setStatus("");
          return;
        }
        setStatus("Loading…");
        updateFrameInfo(1);
        try {
          const res = await api.fetchApi(`${API}/info?video=${encodeURIComponent(name)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          if (videoW.value !== name) return; // a newer selection superseded this one
          info = data;
          fill(vGrid, [
            ["File", info.filename],
            ["Format", `${info.container} / ${info.codec}`],
            ["Resolution", `${info.width} × ${info.height}`],
            ["FPS", info.fps],
            ["Frames", info.frame_count],
            ["Duration", fmtTime(info.duration)],
            ["File size", fmtBytes(info.file_size)],
            ["Audio", info.has_audio === null ? "unknown" : (info.has_audio ? "yes" : "no")],
          ]);
          if (frameW.options) frameW.options.max = Math.max(1, info.frame_count);
          player.src = api.apiURL(`${API}/preview?video=${encodeURIComponent(name)}`);
          player.load();
          setStatus(["mp4", "webm", "m4v"].includes(info.container) ? "" : "Preview transcoded with ffmpeg (cached).");
          setIndex(clamp(frameW.value || 1), { seek: false });
        } catch (e) {
          setStatus(`Could not load video: ${e.message}`, "err");
          fill(vGrid, [["Error", e.message]]);
          summaryText.textContent = "Error loading video";
        }
      };

      // Select a video by name (after upload or a combo change) and fit the node to it.
      const selectVideo = (name) => {
        videoW.value = name;
        fitOnLoad = true;
        loadVideo();
        node.graph?.change?.();
      };

      // ---------- upload (button and drag & drop) ----------
      const uploadFile = async (file) => {
        if (!isVideoFile(file)) {
          setStatus(`Not a supported video: ${file?.name || "?"} (${VIDEO_EXTENSIONS.join(", ")})`, "err");
          return false;
        }
        setStatus(`Uploading ${file.name} (${fmtBytes(file.size)})…`);
        try {
          const body = new FormData();
          body.append("image", file);
          body.append("overwrite", "true");
          const res = await api.fetchApi("/upload/image", { method: "POST", body });
          if (res.status === 413) {
            throw new Error(`${fmtBytes(file.size)} exceeds ComfyUI's upload limit. Start ComfyUI with `
              + `--max-upload-size <MB> (default 100) or copy the file into the input folder.`);
          }
          if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
          const data = await res.json();
          const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
          const list = await (await api.fetchApi(`${API}/videos`)).json();
          videoW.options.values = list.videos;
          selectVideo(name);
          return true;
        } catch (e) {
          setStatus(`Upload failed: ${e.message}`, "err");
          return false;
        }
      };

      // Created per click and never attached to the document, so nothing is left behind.
      const pickFile = () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = VIDEO_EXTENSIONS.join(",") + ",video/*";
        fileInput.onchange = async () => {
          const file = fileInput.files?.[0];
          if (file) await uploadFile(file);
        };
        fileInput.click();
      };

      // Drops on the canvas part of the node (title, widgets) arrive through LiteGraph.
      node.onDragOver = function (e) {
        return hasFiles(e) && (!e.dataTransfer?.files?.length || !!firstVideoFile(e));
      };
      node.onDragDrop = async function (e) {
        const file = firstVideoFile(e);
        if (!file) return false;
        await uploadFile(file);
        return true;
      };

      // Drops on the player / panels hit the DOM overlay and never reach the canvas.
      let dragDepth = 0;
      root.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth++;
        root.classList.add("vfp-dragover");
      });
      root.addEventListener("dragover", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      });
      root.addEventListener("dragleave", (e) => {
        if (!hasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) root.classList.remove("vfp-dragover");
      });
      root.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth = 0;
        root.classList.remove("vfp-dragover");
        const file = firstVideoFile(e) || e.dataTransfer.files?.[0];
        if (file) uploadFile(file);
      });

      // ---------- wiring ----------
      player.addEventListener("loadedmetadata", () => {
        setIndex(clamp(frameW.value || 1));
        if (fitOnLoad) { fitOnLoad = false; requestAnimationFrame(fitToVideo); }
      });
      player.addEventListener("timeupdate", () => { if (!syncing) setIndex(timeToIndex(player.currentTime), { seek: false }); });
      player.addEventListener("seeked", () => { if (!syncing) setIndex(timeToIndex(player.currentTime), { seek: false }); });
      player.addEventListener("pause", () => setIndex(timeToIndex(player.currentTime), { seek: false }));

      bFirst.onclick = () => setIndex(1);
      bLast.onclick = () => setIndex(total() || frameW.value);
      bPrev.onclick = () => step(-1);
      bNext.onclick = () => step(1);
      bPrev10.onclick = () => step(-10);
      bNext10.onclick = () => step(10);

      root.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
        if (e.key === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      });

      bExport.onclick = async () => {
        if (!videoW.value) { setStatus("Select a video first.", "err"); return; }
        bExport.disabled = true;
        setStatus("Saving…");
        try {
          const res = await api.fetchApi(`${API}/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              video: videoW.value,
              frame_index: frameW.value,
              output_dir: outDirW?.value || "",
              file_format: fmtW?.value || "jpg",
              jpg_quality: qualW?.value ?? 95,
              overwrite: overW?.value ?? true,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
          setStatus(`Saved ${data.filename} (${data.width}×${data.height})`, "ok");
        } catch (e) {
          setStatus(`Save failed: ${e.message}`, "err");
        } finally {
          bExport.disabled = false;
        }
      };

      // widget callbacks
      const origVideoCb = videoW.callback;
      videoW.callback = function () {
        origVideoCb?.apply(this, arguments);
        fitOnLoad = true;
        loadVideo();
      };

      const origFrameCb = frameW.callback;
      frameW.callback = function (v) {
        origFrameCb?.apply(this, arguments);
        if (!syncing) setIndex(Number(v) || 1);
      };

      const origFmtCb = fmtW?.callback;
      if (fmtW) fmtW.callback = function () { origFmtCb?.apply(this, arguments); updateFrameInfo(frameW.value || 1); };

      const uploadW = node.addWidget("button", "Upload video", null, pickFile);
      uploadW.tooltip = "Copy a video file into the ComfyUI input folder and select it. "
                      + "You can also drag a video file onto this node.";
      uploadW.serialize = false;

      // NOTE: do not reorder widgets. ComfyUI restores widgets_values by position,
      // so inserting non-serialized widgets between inputs would shift the values.
      uploadW.options = { ...(uploadW.options || {}), serialize: false };
      widget.options = { ...(widget.options || {}), serialize: false };

      // Details start collapsed; restored from the node properties of a saved workflow.
      setDetailsOpen(false);
      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        const res = onConfigure?.apply(this, arguments);
        setDetailsOpen(!!node.properties?.vfp_details_open);
        return res;
      };

      // Default size for a new node: 640 px wide, player area 16:9. A saved workflow
      // overrides this with its stored size right after creation.
      const baseHeight = node.computeSize()[1] - MIN_PLAYER_HEIGHT;
      node.setSize([Math.max(node.size[0], DEFAULT_NODE_WIDTH),
                    baseHeight + Math.round(DEFAULT_NODE_WIDTH * 9 / 16)]);
      node.setDirtyCanvas(true, true);

      // initial load (also covers workflows restored from JSON)
      setTimeout(loadVideo, 0);

      return r;
    };
  },
});
