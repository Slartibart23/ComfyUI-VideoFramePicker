import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "VideoFramePicker";
const API = "/video_frame_picker";

const CSS = `
.vfp-root { display:flex; flex-direction:column; gap:6px; font-family: var(--font-family, sans-serif);
  font-size:11px; color: var(--input-text, #ddd); width:100%; box-sizing:border-box; padding:4px 2px; }
.vfp-player { width:100%; background:#000; border-radius:4px; aspect-ratio:16/9; object-fit:contain; display:block; }
.vfp-row { display:flex; gap:4px; align-items:center; }
.vfp-row button { flex:0 0 auto; background: var(--comfy-input-bg,#333); color: var(--input-text,#ddd);
  border:1px solid var(--border-color,#555); border-radius:4px; padding:2px 8px; cursor:pointer; font-size:11px; }
.vfp-row button:hover { border-color: var(--input-text,#ddd); }
.vfp-row button:disabled { opacity:.4; cursor:default; }
.vfp-spacer { flex:1; }
.vfp-panel { background: var(--comfy-input-bg,#222); border:1px solid var(--border-color,#444);
  border-radius:4px; padding:4px 6px; line-height:1.45; }
.vfp-panel h4 { margin:0 0 2px; font-size:10px; text-transform:uppercase; letter-spacing:.04em; opacity:.7; font-weight:600; }
.vfp-grid { display:grid; grid-template-columns:auto 1fr; column-gap:8px; row-gap:0; }
.vfp-grid span:nth-child(odd) { opacity:.65; }
.vfp-thumb { width:96px; height:54px; object-fit:contain; background:#000; border-radius:3px; flex:0 0 auto; }
.vfp-frame { display:flex; gap:8px; align-items:flex-start; }
.vfp-export { background: var(--comfy-menu-bg,#444) !important; font-weight:600; }
.vfp-status { font-size:10px; opacity:.8; min-height:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.vfp-status.err { color:#f66; opacity:1; }
.vfp-status.ok { color:#8d8; opacity:1; }
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
  const ms = Math.round((sec % 1) * 1000);
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

      // ---------- state ----------
      let info = null;          // metadata from /info
      let syncing = false;      // prevents feedback loops between player and widget
      let thumbTimer = null;

      // ---------- DOM ----------
      const root = el("div", "vfp-root");

      const player = el("video", "vfp-player");
      player.controls = true;
      player.muted = true;
      player.preload = "metadata";
      player.playsInline = true;
      root.appendChild(player);

      const ctl = el("div", "vfp-row");
      const bFirst = el("button", null, "⏮");   bFirst.title = "First frame";
      const bPrev10 = el("button", null, "-10"); bPrev10.title = "Back 10 frames";
      const bPrev = el("button", null, "◀ -1");   bPrev.title = "Previous frame (pauses playback)";
      const bNext = el("button", null, "+1 ▶");   bNext.title = "Next frame (pauses playback)";
      const bNext10 = el("button", null, "+10"); bNext10.title = "Forward 10 frames";
      const bLast = el("button", null, "⏭");    bLast.title = "Last frame";
      const bExport = el("button", "vfp-export", "Save frame now");
      bExport.title = "Write the visible frame to disk immediately, without running the workflow. "
                    + "Uses output_dir, file_format, jpg_quality and overwrite from this node.";
      ctl.append(bFirst, bPrev10, bPrev, bNext, bNext10, bLast, el("div", "vfp-spacer"), bExport);
      root.appendChild(ctl);

      const status = el("div", "vfp-status", "");
      root.appendChild(status);

      const vPanel = el("div", "vfp-panel");
      vPanel.appendChild(el("h4", null, "Video"));
      const vGrid = el("div", "vfp-grid");
      vPanel.appendChild(vGrid);
      root.appendChild(vPanel);

      const fPanel = el("div", "vfp-panel");
      fPanel.appendChild(el("h4", null, "Selected frame"));
      const fRow = el("div", "vfp-frame");
      const thumb = el("img", "vfp-thumb");
      thumb.title = "Exactly decoded frame (what the IMAGE output will contain)";
      thumb.alt = "";
      const fGrid = el("div", "vfp-grid");
      fRow.append(thumb, fGrid);
      fPanel.appendChild(fRow);
      root.appendChild(fPanel);

      const widget = node.addDOMWidget("vfp_preview", "VFP", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 360,
      });
      widget.computeSize = () => [node.size[0], 380];

      // ---------- helpers ----------
      const setStatus = (msg, cls = "") => { status.textContent = msg; status.className = "vfp-status " + cls; };

      const fill = (grid, pairs) => {
        grid.innerHTML = "";
        for (const [k, v] of pairs) { grid.append(el("span", null, k), el("span", null, String(v))); }
      };

      const fps = () => (info?.fps > 0 ? info.fps : (player.duration && info?.frame_count ? info.frame_count / player.duration : 25));
      const total = () => info?.frame_count || 0;
      const clamp = (i) => Math.max(1, total() ? Math.min(i, total()) : i);

      const timeToIndex = (t) => clamp(Math.floor(t * fps() + 1e-4) + 1);
      const indexToTime = (i) => (i - 1 + 0.5) / fps();

      const updateFrameInfo = (idx) => {
        fill(fGrid, [
          ["Frame", total() ? `${idx} / ${total()}` : idx],
          ["Time", fmtTime((idx - 1) / fps())],
          ["Size", info ? `${info.width} × ${info.height}` : "-"],
          ["File", info ? outputName(idx) : "-"],
        ]);
        clearTimeout(thumbTimer);
        thumbTimer = setTimeout(() => {
          if (!videoW.value) return;
          thumb.src = api.apiURL(`${API}/frame?video=${encodeURIComponent(videoW.value)}&frame_index=${idx}&t=${Date.now()}`);
        }, 150);
      };

      const outputName = (idx) => {
        const stem = (info?.filename || "video").replace(/\.[^.]+$/, "");
        const digits = Math.max(5, String(total()).length);
        return `${stem}_frame${String(idx).padStart(digits, "0")}.${fmtW?.value || "jpg"}`;
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
        thumb.removeAttribute("src");
        if (!name) { fill(vGrid, [["No video", "Use Upload or pick one"]]); return; }
        setStatus("Loading…");
        try {
          const res = await api.fetchApi(`${API}/info?video=${encodeURIComponent(name)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || res.statusText);
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
          setStatus(info.container === "mp4" || info.container === "webm" ? "" : "Preview transcoded with ffmpeg (cached).");
          setIndex(clamp(frameW.value || 1), { seek: false });
        } catch (e) {
          setStatus(`Could not load video: ${e.message}`, "err");
          fill(vGrid, [["Error", e.message]]);
        }
      };

      // ---------- wiring ----------
      player.addEventListener("loadedmetadata", () => setIndex(clamp(frameW.value || 1)));
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
      root.tabIndex = 0;

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
      videoW.callback = function () { origVideoCb?.apply(this, arguments); loadVideo(); };

      const origFrameCb = frameW.callback;
      frameW.callback = function (v) {
        origFrameCb?.apply(this, arguments);
        if (!syncing) setIndex(Number(v) || 1);
      };

      const origFmtCb = fmtW?.callback;
      if (fmtW) fmtW.callback = function () { origFmtCb?.apply(this, arguments); updateFrameInfo(frameW.value || 1); };

      // ---------- upload button ----------
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".mp4,.avi,.mov,.mkv,.webm,.m4v,video/*";
      fileInput.style.display = "none";
      document.body.appendChild(fileInput);

      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        setStatus(`Uploading ${file.name}…`);
        try {
          const body = new FormData();
          body.append("image", file);
          body.append("overwrite", "true");
          const res = await api.fetchApi("/upload/image", { method: "POST", body });
          if (!res.ok) throw new Error(res.statusText);
          const data = await res.json();
          const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
          const list = await (await api.fetchApi(`${API}/videos`)).json();
          videoW.options.values = list.videos;
          videoW.value = name;
          loadVideo();
        } catch (e) {
          setStatus(`Upload failed: ${e.message}`, "err");
        } finally {
          fileInput.value = "";
        }
      };

      const uploadW = node.addWidget("button", "Upload video", null, () => fileInput.click());
      uploadW.tooltip = "Copy an MP4/AVI file into the ComfyUI input folder and select it.";
      uploadW.serialize = false;

      // NOTE: do not reorder widgets. ComfyUI restores widgets_values by position,
      // so inserting non-serialized widgets between inputs would shift the values.
      uploadW.options = { ...(uploadW.options || {}), serialize: false };
      widget.options = { ...(widget.options || {}), serialize: false };

      node.size = [Math.max(node.size[0], 420), node.computeSize()[1]];
      node.setDirtyCanvas(true, true);

      // initial load (also covers workflows restored from JSON)
      setTimeout(loadVideo, 0);

      const onRemoved = node.onRemoved;
      node.onRemoved = function () { fileInput.remove(); onRemoved?.apply(this, arguments); };

      return r;
    };
  },
});
