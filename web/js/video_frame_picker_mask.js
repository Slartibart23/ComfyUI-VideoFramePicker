// Rectangle / freehand / MaskEditor mask drawn over the player of the Video Frame Picker.
// Everything is stored as JSON in the hidden crop_data widget (rect, strokes, and the MaskEditor
// mask / paint layer as PNG data URLs), so masks live in the workflow and apply to whichever frame
// is selected.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const API = "/video_frame_picker";
const CLIPSPACE_RESULT = /^clipspace-painted-masked-(\d+)\.png$/;
const ME_SUBFOLDER = "video_frame_picker";

const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

const getWidget = (node, name) => node.widgets?.find((w) => w.name === name);

function parseCropData(text) {
  try {
    const d = JSON.parse(text || "{}");
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image could not be loaded"));
    im.src = src;
  });
}

// MaskEditor mask PNG (white = masked) -> red canvas that is opaque only where masked
async function tintMask(dataUrl) {
  const src = await loadImage(dataUrl);
  const c = el("canvas");
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  const cx = c.getContext("2d");
  cx.drawImage(src, 0, 0);
  const px = cx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < px.data.length; i += 4) {
    px.data[i + 3] = px.data[i];
    px.data[i] = 255;
    px.data[i + 1] = px.data[i + 2] = 51;
  }
  cx.putImageData(px, 0, 0);
  return c;
}

function alphaBounds(c) {
  const { width: w, height: h } = c;
  if (!w || !h) return null;
  const px = c.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function label(ctx, text, x, y) {
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(x - 2, y - 1, w + 4, 14);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
}

function dashed(ctx, x, y, w, h, text) {
  ctx.strokeStyle = "#4af";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  if (text) label(ctx, text, x + 4, y + 4);
}

function paintStrokes(ctx, box, strokes) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const st of strokes) {
    const pts = st.p.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h]);
    if (!pts.length) continue;
    ctx.globalCompositeOperation = st.t === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = ctx.strokeStyle = "#f33";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (st.t === "lasso") {
      if (pts.length < 3) continue;
      ctx.closePath();
      ctx.fill();
      continue;
    }
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    ctx.lineWidth = Math.max(1, st.s * box.w);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

// Returns { row, poll, reload }: `row` is the toolbar to place below the player, `poll` is called
// from the node's draw loop, `reload` re-reads crop_data (workflow load).
export function attachMask({ node, stage, player, getFrame, setStatus, relayout }) {
  const srcW = getWidget(node, "mask_source");
  const fillW = getWidget(node, "fill_color");
  const dataW = getWidget(node, "crop_data");
  const cropW = getWidget(node, "crop_to_mask");
  if (!srcW || !dataW) return null;
  // the controls live in the toolbar below the player instead of the widget list
  for (const w of [dataW, srcW, fillW, cropW]) if (w) w.hidden = true;

  let data = { strokes: [] };
  let lastValue = null;
  let maskImg = null;
  let paintImg = null;
  let tool = "brush";
  let editing = false;
  let drag = null;
  let hover = null;
  let lastImported = "";
  let shownSrc = null;
  let shownCrop = false;

  const canvas = el("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  stage.appendChild(canvas);
  const shapeCanvas = el("canvas");

  // ---------- toolbar ----------
  const bar = el("div");
  bar.style.cssText = "display:flex;flex-direction:column;gap:4px;flex:0 0 auto;";
  const srcRow = el("div", "vfp-row");
  const row = el("div", "vfp-row");
  row.hidden = true;
  bar.append(srcRow, row);
  const btn = (text, title, fn) => {
    const b = el("button");
    b.textContent = text;
    b.title = title;
    b.onclick = fn;
    return b;
  };
  const srcBtns = {};
  for (const [name, text] of [["none", "No mask"], ["MaskEditor", "MaskEditor"], ["rectangle", "Rectangle"], ["freehand", "Freehand"]]) {
    srcBtns[name] = btn(text, `mask_source = ${name}`, () => { srcW.value = name; srcW.callback?.(name); });
    srcRow.append(srcBtns[name]);
  }
  const cropBtn = btn("Crop", "crop_to_mask: crop image and mask to the bounding box of the mask", () => {
    cropW.value = !cropW.value;
    cropW.callback?.(cropW.value);
  });
  const fillSel = el("select");
  for (const c of fillW?.options?.values || []) fillSel.add(new Option(c, c));
  fillSel.title = "fill_color: colour outside the freehand shape";
  fillSel.onchange = () => { fillW.value = fillSel.value; fillW.callback?.(fillW.value); };
  const editBtn = btn("✎ Edit", "Edit the mask on the player (draw, move, resize). Click again to use the player controls", () => setEditing(!editing));
  const tools = {
    brush: btn("Brush", "Paint the area to keep", () => { tool = "brush"; refreshToolbar(); }),
    lasso: btn("Lasso", "Draw an outline, the enclosed area is kept", () => { tool = "lasso"; refreshToolbar(); }),
    erase: btn("Eraser", "Erase from the painted area", () => { tool = "erase"; refreshToolbar(); }),
    move: btn("Move/Size", "Move or resize the drawn shape with its handles", () => { tool = "move"; refreshToolbar(); }),
  };
  const size = el("input");
  size.type = "range";
  size.min = "1";
  size.max = "20";
  size.value = "4";
  size.style.width = "70px";
  size.title = "Brush size";
  const clearBtn = btn("Delete mask", "Delete the rectangle, freehand shape and MaskEditor mask (the paint colour stays) and set mask_source back to none", () => {
    data.rect = null;
    data.strokes = [];
    delete data.mask;
    maskImg = null;
    srcW.value = "none";
    setEditing(false);
    save();
    relayout();
  });
  const meBtn = btn("Mask Editor", "Paint a mask or colour on the current frame in ComfyUI's MaskEditor", () => openMaskEditor());
  const meDelPaint = btn("Remove paint", "Delete the colour painted in the MaskEditor", () => { delete data.paint; paintImg = null; save(); });
  srcRow.append(cropBtn);
  const hint = el("span");
  hint.style.cssText = "opacity:.7;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  row.append(editBtn, tools.brush, tools.lasso, tools.erase, tools.move, size, fillSel, clearBtn, meBtn, meDelPaint, hint);

  const mode = () => srcW.value || "none";
  const drawMode = () => mode() === "rectangle" || mode() === "freehand";

  function setEditing(on) {
    editing = !!on && mode() !== "none";
    canvas.style.pointerEvents = editing ? "auto" : "none";
    canvas.style.cursor = "crosshair";
    refreshToolbar();
  }

  function refreshToolbar() {
    const m = mode();
    shownSrc = srcW.value;
    shownCrop = !!cropW?.value;
    if (mode() === "none" && editing) setEditing(false);
    row.hidden = m === "none";
    for (const [k, b] of Object.entries(srcBtns)) b.style.background = k === m ? "#2a6db0" : "";
    cropBtn.style.display = m === "none" ? "none" : "";
    cropBtn.style.background = cropW?.value ? "#2a6db0" : "";
    fillSel.style.display = m === "freehand" ? "" : "none";
    fillSel.value = fillW?.value || "yellow";
    editBtn.style.display = "";
    clearBtn.style.display = "";
    size.style.display = m === "freehand" && (tool === "brush" || tool === "erase") ? "" : "none";
    for (const [k, b] of Object.entries(tools)) {
      b.style.display = m === "freehand" ? "" : "none";
      b.style.background = k === tool ? "#2a6db0" : "";
    }
    meBtn.style.display = m === "MaskEditor" ? "" : "none";
    meDelPaint.style.display = m === "MaskEditor" && data.paint ? "" : "none";
    editBtn.style.background = editing ? "#2a6db0" : "";
    hint.textContent = { rectangle: "drag to draw, handles to move/size", freehand: "paint the area to keep",
      MaskEditor: data.mask ? "mask in red, handles move/size" : "no mask yet" }[m] || "";
    draw();
  }

  // ---------- data ----------
  async function reload() {
    lastValue = dataW.value;
    data = parseCropData(dataW.value);
    if (!Array.isArray(data.strokes)) data.strokes = [];
    maskImg = data.mask ? await tintMask(data.mask).catch(() => null) : null;
    paintImg = data.paint ? await loadImage(data.paint).catch(() => null) : null;
    refreshToolbar();
  }

  function save() {
    const clean = {};
    if (data.rect) clean.rect = data.rect.map((v) => Math.round(v * 1e5) / 1e5);
    if (data.strokes.length) clean.strokes = data.strokes;
    if (data.mask) clean.mask = data.mask;
    if (data.paint) clean.paint = data.paint;
    dataW.value = Object.keys(clean).length ? JSON.stringify(clean) : "";
    lastValue = dataW.value;
    refreshToolbar();
    node.graph?.change?.();
  }

  // ---------- geometry ----------
  function imageBox() {
    const vw = player.videoWidth, vh = player.videoHeight;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!vw || !vh || !cw || !ch) return null;
    const s = Math.min(cw / vw, ch / vh);
    return { x: (cw - vw * s) / 2, y: (ch - vh * s) / 2, w: vw * s, h: vh * s };
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function toRel(e, box) {
    const r = canvas.getBoundingClientRect();
    // the node can be zoomed: getBoundingClientRect is scaled, clientWidth is not
    const x = (e.clientX - r.left) * canvas.clientWidth / r.width, y = (e.clientY - r.top) * canvas.clientHeight / r.height;
    return { x, y, rx: (x - box.x) / box.w, ry: (y - box.y) / box.h };
  }

  // ---------- drawing ----------
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
                    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move" };
  let curBB = null;   // relative bounding box [x, y, w, h] of the current mask, target of the move/size handles

  // Move/size applies to the rectangle always, to the freehand shape with the Move tool and to the MaskEditor mask.
  const transforming = () => editing && (mode() === "rectangle" || mode() === "MaskEditor" || (mode() === "freehand" && tool === "move"));

  function handlePoints(box, b) {
    const L = box.x + b[0] * box.w, T = box.y + b[1] * box.h, R = L + b[2] * box.w, B = T + b[3] * box.h;
    const cx = (L + R) / 2, cy = (T + B) / 2;
    return { L, T, R, B, nw: [L, T], n: [cx, T], ne: [R, T], e: [R, cy], se: [R, B], s: [cx, B], sw: [L, B], w: [L, cy] };
  }

  function hitBB(p, box, b) {
    const hs = handlePoints(box, b);
    for (const k of HANDLES) if (Math.hypot(p.x - hs[k][0], p.y - hs[k][1]) <= 8) return k;
    return p.x >= hs.L && p.x <= hs.R && p.y >= hs.T && p.y <= hs.B ? "move" : null;
  }

  function resizeBB(b, type, dx, dy, limit) {
    const [x, y, w, h] = b;
    const lim = (v) => (limit ? clamp01(v) : v);
    if (type === "move") {
      return [limit ? Math.min(Math.max(x + dx, 0), 1 - w) : x + dx, limit ? Math.min(Math.max(y + dy, 0), 1 - h) : y + dy, w, h];
    }
    let L = x, T = y, R = x + w, B = y + h;
    if (type.includes("w")) L = lim(L + dx);
    if (type.includes("e")) R = lim(R + dx);
    if (type.includes("n")) T = lim(T + dy);
    if (type.includes("s")) B = lim(B + dy);
    return [Math.min(L, R), Math.min(T, B), Math.max(Math.abs(R - L), 0.005), Math.max(Math.abs(B - T), 0.005)];
  }

  // maps points of the box b0 onto the box b1
  function moveStrokes(strokes, b0, b1) {
    const sx = b1[2] / b0[2], sy = b1[3] / b0[3];
    return strokes.map((st) => ({ ...st, ...(st.s ? { s: st.s * sx } : {}),
      p: st.p.map(([x, y]) => [b1[0] + (x - b0[0]) * sx, b1[1] + (y - b0[1]) * sy]) }));
  }

  // where the whole MaskEditor mask image lands (relative) when its bounding box b0 is moved to b1
  function maskDest(b0, b1) {
    const sx = b1[2] / b0[2], sy = b1[3] / b0[3];
    return [b1[0] - b0[0] * sx, b1[1] - b0[1] * sy, sx, sy];
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const m = mode();
    const box = imageBox();
    if (!box || m === "none") { curBB = null; return; }
    const vw = player.videoWidth, vh = player.videoHeight;
    const xform = drag?.xform;

    if (paintImg) ctx.drawImage(paintImg, box.x, box.y, box.w, box.h);

    let bb = null;
    if (m === "rectangle") {
      bb = xform ? drag.bb : (drag?.rect || data.rect);
      if (bb) {
        const [x, y, w, h] = bb;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.w, box.h);
        ctx.rect(box.x + x * box.w, box.y + y * box.h, w * box.w, h * box.h);
        ctx.fill("evenodd");
        dashed(ctx, box.x + x * box.w, box.y + y * box.h, w * box.w, h * box.h, `${Math.round(w * vw)}×${Math.round(h * vh)}`);
      }
    } else if (m === "freehand" || m === "MaskEditor") {
      shapeCanvas.width = canvas.width;
      shapeCanvas.height = canvas.height;
      const sctx = shapeCanvas.getContext("2d");
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (m === "MaskEditor") {
        if (maskImg) {
          const [dx, dy, dw, dh] = xform ? maskDest(drag.bb0, drag.bb) : [0, 0, 1, 1];
          sctx.drawImage(maskImg, box.x + dx * box.w, box.y + dy * box.h, dw * box.w, dh * box.h);
        }
      } else {
        const strokes = xform ? moveStrokes(data.strokes, drag.bb0, drag.bb) : data.strokes;
        paintStrokes(sctx, box, drag?.stroke ? [...strokes, drag.stroke] : strokes);
      }
      ctx.globalAlpha = 0.5;
      ctx.drawImage(shapeCanvas, 0, 0, cw, ch);
      ctx.globalAlpha = 1;

      if (xform) {
        bb = drag.bb;
      } else if (!drag && (editing || cropW?.value)) {
        const px = alphaBounds(shapeCanvas);
        if (px) bb = [(px.x / dpr - box.x) / box.w, (px.y / dpr - box.y) / box.h, px.w / dpr / box.w, px.h / dpr / box.h];
        if (px && cropW?.value && !editing) {
          dashed(ctx, px.x / dpr, px.y / dpr, px.w / dpr, px.h / dpr, `crop ${Math.round(bb[2] * vw)}×${Math.round(bb[3] * vh)}`);
        }
      }
      if (m === "freehand" && editing && hover && (tool === "brush" || tool === "erase")) {
        ctx.strokeStyle = tool === "erase" ? "#f66" : "#fff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, size.value / 100 * box.w / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    curBB = bb;

    if (bb && transforming()) {
      const hs = handlePoints(box, bb);
      if (m !== "rectangle") dashed(ctx, hs.L, hs.T, hs.R - hs.L, hs.B - hs.T, `${Math.round(bb[2] * vw)}×${Math.round(bb[3] * vh)}`);
      ctx.fillStyle = "#4af";
      for (const k of HANDLES) ctx.fillRect(hs[k][0] - 4, hs[k][1] - 4, 8, 8);
    }
  }

  // ---------- pointer ----------
  canvas.addEventListener("pointerdown", (e) => {
    const box = imageBox();
    if (!editing || !box || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    const p = toRel(e, box);
    const pt = [clamp01(p.rx), clamp01(p.ry)];
    if (transforming()) {
      const hit = curBB && hitBB(p, box, curBB);
      if (hit) drag = { xform: hit, start: [p.rx, p.ry], bb0: [...curBB], bb: [...curBB] };
      else if (mode() === "rectangle") drag = { start: pt, rect: [pt[0], pt[1], 0, 0] };
    } else {
      drag = { stroke: { t: tool, s: size.value / 100, p: [pt] } };
    }
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    const box = imageBox();
    if (!box) return;
    const p = toRel(e, box);
    hover = { x: p.x, y: p.y };
    if (!drag) {
      const hit = transforming() && curBB ? hitBB(p, box, curBB) : null;
      canvas.style.cursor = CURSORS[hit] || "crosshair";
      if (mode() === "freehand" && editing) draw();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const pt = [clamp01(p.rx), clamp01(p.ry)];
    if (drag.xform) {
      drag.bb = resizeBB(drag.bb0, drag.xform, p.rx - drag.start[0], p.ry - drag.start[1], mode() === "rectangle");
    } else if (drag.stroke) {
      const last = drag.stroke.p[drag.stroke.p.length - 1];
      if (Math.hypot((pt[0] - last[0]) * box.w, (pt[1] - last[1]) * box.h) >= 1.5) drag.stroke.p.push(pt);
    } else {
      drag.rect = [Math.min(drag.start[0], pt[0]), Math.min(drag.start[1], pt[1]),
                   Math.abs(pt[0] - drag.start[0]), Math.abs(pt[1] - drag.start[1])];
    }
    draw();
  });

  // new mask PNG (white = masked) with the MaskEditor mask moved from b0 to b1
  function transformedMask(b0, b1) {
    const [dx, dy, dw, dh] = maskDest(b0, b1);
    const w = maskImg.width, h = maskImg.height;
    const c = el("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d");
    cx.drawImage(maskImg, dx * w, dy * h, dw * w, dh * h);
    const px = cx.getImageData(0, 0, w, h);
    for (let i = 0; i < px.data.length; i += 4) {
      px.data[i] = px.data[i + 1] = px.data[i + 2] = px.data[i + 3];
      px.data[i + 3] = 255;
    }
    cx.putImageData(px, 0, 0);
    return c.toDataURL("image/png");
  }

  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  const endDrag = async (e) => {
    if (!drag) return;
    e.stopPropagation();
    const d = drag;
    if (d.xform) {
      if (mode() === "rectangle") {
        data.rect = d.bb;
      } else if (mode() === "freehand") {
        data.strokes = moveStrokes(data.strokes, d.bb0, d.bb).map((st) => ({ ...st, ...(st.s ? { s: round4(st.s) } : {}),
          p: st.p.map(([x, y]) => [round4(x), round4(y)]) }));
      } else if (maskImg) {
        data.mask = transformedMask(d.bb0, d.bb);
        maskImg = await tintMask(data.mask);
      }
    } else if (d.stroke) {
      const st = d.stroke;
      if (st.t !== "lasso" || st.p.length >= 3) {
        st.p = st.p.map(([x, y]) => [round4(x), round4(y)]);
        if (st.t === "lasso") delete st.s;
        data.strokes.push(st);
      }
    } else if (d.rect[2] * player.videoWidth >= 2 && d.rect[3] * player.videoHeight >= 2) {
      data.rect = d.rect;
    }
    drag = null;
    save();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { hover = null; if (!drag) draw(); });

  // ---------- MaskEditor ----------
  // The MaskEditor reads node.images / node.imgs through /view. After saving it points node.images at
  // its own clipspace files; mask (alpha) and paint layer are read from them and stored in crop_data.
  function setNodeImages(ref) {
    node.images = ref ? [{ ...ref }] : undefined;
    if (ref) {
      const im = new Image();
      im.src = api.apiURL(`/view?${new URLSearchParams(ref)}`);
      node.imgs = [im];
      node.imageIndex = 0;
    } else {
      node.imgs = undefined;
    }
  }

  async function openMaskEditor() {
    if (!player.videoWidth) { setStatus("Select a video first.", "err"); return; }
    try {
      const res = await api.fetchApi(`${API}/mask_editor/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video: getWidget(node, "video").value, frame_index: getFrame(), crop_data: dataW.value }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.statusText);
      setNodeImages(out);
      app.canvas.selectNode(node);
      app.extensionManager.command.execute("Comfy.MaskEditor.OpenMaskEditor");
    } catch (e) {
      setStatus(`Could not open the MaskEditor: ${e.message || e}`, "err");
    }
  }

  const layerFromEditor = (prefix, id, subfolder) => loadImage(api.apiURL(
    `/view?${new URLSearchParams({ filename: `clipspace-${prefix}-${id}.png`, subfolder, type: "input", rand: Date.now() })}`));

  async function importEditorResult(ref) {
    const id = CLIPSPACE_RESULT.exec(ref.filename)[1];
    try {
      const src = await layerFromEditor("mask", id, ref.subfolder || "");
      const c = el("canvas");
      c.width = src.naturalWidth;
      c.height = src.naturalHeight;
      const cx = c.getContext("2d");
      cx.drawImage(src, 0, 0);
      const px = cx.getImageData(0, 0, c.width, c.height);
      let any = false;
      for (let i = 0; i < px.data.length; i += 4) {
        const v = 255 - px.data[i + 3];   // transparent = masked
        px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
        px.data[i + 3] = 255;
        if (v) any = true;
      }
      cx.putImageData(px, 0, 0);
      if (any) data.mask = c.toDataURL("image/png"); else delete data.mask;

      delete data.paint;
      try {
        const paintSrc = await layerFromEditor("paint", id, ref.subfolder || "");
        const pc = el("canvas");
        pc.width = paintSrc.naturalWidth;
        pc.height = paintSrc.naturalHeight;
        pc.getContext("2d").drawImage(paintSrc, 0, 0);
        if (alphaBounds(pc)) data.paint = pc.toDataURL("image/png");
      } catch { /* older frontends write no paint layer */ }
      maskImg = data.mask ? await tintMask(data.mask) : null;
      paintImg = data.paint ? await loadImage(data.paint) : null;
      setStatus(data.mask || data.paint ? "MaskEditor result stored in the node" : "Nothing painted: mask removed", "ok");
    } catch (e) {
      setStatus(`MaskEditor result could not be read: ${e.message}`, "err");
    }
    setNodeImages(null);
    save();
  }

  // Called from the node's draw loop: picks up the MaskEditor result and external widget changes.
  function poll() {
    const ref = node.images?.[0];
    if (ref && CLIPSPACE_RESULT.test(ref.filename || "") && ref.subfolder !== ME_SUBFOLDER && ref.filename !== lastImported) {
      lastImported = ref.filename;
      importEditorResult(ref);
    }
    if (dataW.value !== lastValue && !drag) reload();
    else if (srcW.value !== shownSrc || !!cropW?.value !== shownCrop) refreshToolbar();
  }

  const chain = (w, fn) => {
    if (!w) return;
    const orig = w.callback;
    w.callback = function () { orig?.apply(this, arguments); fn(); };
  };
  chain(srcW, () => { setEditing(drawMode()); relayout(); });
  chain(fillW, draw);
  chain(cropW, refreshToolbar);
  size.oninput = draw;
  new ResizeObserver(draw).observe(stage);
  player.addEventListener("loadedmetadata", draw);

  reload();
  return { row: bar, poll, reload };
}
