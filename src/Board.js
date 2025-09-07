// src/Board.js
import Konva from 'https://esm.sh/konva@9';
import { cardStyles } from './cardStyles.js';

const DEFAULT_CFG = {
  world: { width: 6000, height: 6000 },
  zoom: {
    hardMin: 0.10,
    max: 5.0,
    wheelSens: 240,
    animMs: 160,
    btnStepPct: 10,
    btnMaxBelowMaxPct: 10
  },
  pan: { animMs: 220 }
};

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

export class Board {
  constructor({ mount, controls = {}, config = {} }) {
    if (!mount) throw new Error('Board: mount element is required');

    this.CFG = deepMerge(structuredClone(DEFAULT_CFG), config);

    // global style state
    this.worldStyle = { top: '#0f1418', bottom: '#0b0f13', stroke: '#2a3238' };
    this.gridStyle  = { spacing: 100, heavyEvery: 500, light: '#1c242a', heavy: '#2f3a41' };

    // global card shadow style (native Konva shadows on body)
    this.cardShadow = { enabled: true, dx: 6, dy: 6, blur: 6, color: '#000000', opacity: 0.35 };

    // DOM
    this.mount = mount;
    this.mount.style.position = 'relative';
    this.mount.style.overflow = 'auto';
    this.mount.addEventListener('contextmenu', (e) => e.preventDefault());

    this.spacer = document.createElement('div');
    this.spacer.style.width  = `${this.CFG.world.width}px`;
    this.spacer.style.height = `${this.CFG.world.height}px`;
    this.spacer.style.pointerEvents = 'none';
    this.mount.appendChild(this.spacer);

    this.stageHost = document.createElement('div');
    this.stageHost.style.position = 'absolute';
    this.stageHost.style.inset = '0';
    this.stageHost.style.pointerEvents = 'auto';
    this.mount.appendChild(this.stageHost);

    this.pinOverlayToScroll = () => {
      this.stageHost.style.transform =
        `translate(${this.mount.scrollLeft}px, ${this.mount.scrollTop}px)`;
    };

    // Konva: single Layer + world group (so camera transform applies to all)
    this.stage = new Konva.Stage({
      container: this.stageHost,
      width: this.stageHost.clientWidth,
      height: this.stageHost.clientHeight
    });
    this.layer = new Konva.Layer();
    this.world = new Konva.Group({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    this.layer.add(this.world);
    this.stage.add(this.layer);

    // Subgroups inside "world" for z-bucketing
    this.groups = {
      background:   new Konva.Group({ name: 'g-background' }),
      grid:         new Konva.Group({ name: 'g-grid' }),
      stringsBelow: new Konva.Group({ name: 'g-strings-below' }),
      cards:        new Konva.Group({ name: 'g-cards' }),
      stringsAbove: new Konva.Group({ name: 'g-strings-above' }),
      pins:         new Konva.Group({ name: 'g-pins' })
    };
    // Order matters
    this.world.add(
      this.groups.background,
      this.groups.grid,
      this.groups.stringsBelow,
      this.groups.cards,
      this.groups.stringsAbove,
      this.groups.pins
    );

    // world visuals
    this._buildWorld();

    // models + nodes
    this.SHAPES = new Map();      // id -> model
    this.SHAPE_NODES = new Map(); // id -> Konva.Group

    // hooks
    this.Hooks = {
      onDragStart: ()=>true,
      onDrag: ()=>{},
      onDragEnd: ()=>{},
      onZOrderChange: ()=>{}
    };

    // camera
    this.zoom = 1;
    this.camera = { x: 0, y: 0 };
    this.minZoom = this.CFG.zoom.hardMin;
    this.suppressScrollSync = false;

    // controls
    this.controls = controls;
    this._wireControls();

    // scroll sync
    this.mount.addEventListener('scroll', () => {
      if (this.suppressScrollSync) return;
      this.pinOverlayToScroll();
      this.camera.x = this.mount.scrollLeft / this.zoom;
      this.camera.y = this.mount.scrollTop  / this.zoom;
      this._clampCamera();
      this._render();
    });

    // zoom (Alt + wheel)
    this.stage.on('wheel', (e) => {
      if (e.evt.ctrlKey || !e.evt.altKey) return;
      e.evt.preventDefault();
      this._updateMinZoomAndUI({ animateIfRaised: false });
      const ptr = this.stage.getPointerPosition();
      if (!ptr) return;
      const anchorWorld = { x: this.camera.x + ptr.x / this.zoom, y: this.camera.y + ptr.y / this.zoom };
      const factor = Math.pow(2, -e.evt.deltaY / this.CFG.zoom.wheelSens);
      this._animateZoomTo(this.zoom * factor, anchorWorld, ptr);
    });

// --- left-click pan with movement threshold (prevents snap when dragging cards) ---
this.isPanning = false;
this.panStart = null;
this.scrollStart = null;
this.panCandidate = null;
this.PAN_THRESHOLD = 5; // pixels

this.stage.on('mousedown', (e) => {
  if (e.evt.button !== 0) return; // left only
  // If the click is on a shape, let Konva's drag logic take over.
  if (this._isOnShape(e.target)) return;

  // Not on a shape: mark as a pan candidate but don't start yet.
  const p = this.stage.getPointerPosition();
  if (!p) return;
  this.panCandidate = { x: p.x, y: p.y };
  this.scrollStart = { left: this.mount.scrollLeft, top: this.mount.scrollTop };
});

this.stage.on('mousemove', () => {
  const p = this.stage.getPointerPosition();
  if (!p) return;

  // If we're actively panning, apply deltas to scroll.
  if (this.isPanning && this.panStart) {
    const dx = p.x - this.panStart.x;
    const dy = p.y - this.panStart.y;
    this.suppressScrollSync = true;
    this.mount.scrollLeft = this.scrollStart.left - dx;
    this.mount.scrollTop  = this.scrollStart.top  - dy;
    this.pinOverlayToScroll();
    this.suppressScrollSync = false;
    return;
  }

  // If we only have a candidate, see if we've moved far enough to start a pan.
  if (this.panCandidate) {
    const dx = p.x - this.panCandidate.x;
    const dy = p.y - this.panCandidate.y;
    if ((dx*dx + dy*dy) >= (this.PAN_THRESHOLD * this.PAN_THRESHOLD)) {
      // Promote to real pan
      this.isPanning = true;
      this.panStart = { x: this.panCandidate.x, y: this.panCandidate.y };
      this.stage.container().style.cursor = 'grabbing';
      this.mount.style.userSelect = 'none';
      // keep existing scrollStart
    }
  }
});

const cancelPanGesture = () => {
  this.isPanning = false;
  this.panStart = null;
  this.panCandidate = null;
  this.scrollStart = null;
  this.stage.container().style.cursor = '';
  this.mount.style.userSelect = '';
};

this.stage.on('mouseup', cancelPanGesture);
this.stage.on('mouseleave', cancelPanGesture);

// If a drag actually starts (e.g., you grabbed a card), cancel any pan-in-progress/candidate.
this.stage.on('dragstart', () => { cancelPanGesture(); });

    // resize + initial center
    new ResizeObserver(() => this._resizeStageToViewport()).observe(this.mount);
    window.addEventListener('resize', () => this._resizeStageToViewport());

    this.pinOverlayToScroll();
    this._centerOn(this.CFG.world.width / 2, this.CFG.world.height / 2);
  }

  // ---------- PUBLIC API ----------
  setCallbacks(cb) { Object.assign(this.Hooks, cb || {}); }

  applySnapshot(arr) {
    // Sort by z (undefined -> 0) so we create back->front
    const sorted = [...arr].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const incoming = new Set(sorted.map(s => s.id));
    sorted.forEach(s => this._upsertCard(s));   // (cards only in this phase)
    // remove missing
    this.SHAPE_NODES.forEach((_, id) => { if (!incoming.has(id)) this._removeShape(id); });
    this.layer.batchDraw();
  }

  applyPatch(patch) {
    if (!patch) return;
    if (Array.isArray(patch.add))    patch.add.forEach(s => this._upsertCard(s));
    if (Array.isArray(patch.update)) patch.update.forEach(s => this._upsertCard(s));
    if (Array.isArray(patch.remove)) patch.remove.forEach(id => this._removeShape(id));
    this.layer.batchDraw();
  }

  // Camera helpers
  center() { this._animatePanTo(this.CFG.world.width/2, this.CFG.world.height/2); }
  setZoomPct(pct){
    const c={x:this.stage.width()/2,y:this.stage.height()/2};
    const anchor={x:this.camera.x+c.x/this.zoom,y:this.camera.y+c.y/this.zoom};
    this._animateZoomTo(Math.max(this.minZoom, Math.min(this.CFG.zoom.max, pct/100)), anchor, c);
  }
  setCamera(x,y){ this.camera.x=x; this.camera.y=y; this._clampCamera(); this._syncScrollFromCamera(); this._render(); }
  getCamera(){ return { ...this.camera, zoom: this.zoom }; }
  clientToWorld(clientX, clientY){
    const rect = this.mount.getBoundingClientRect();
    return { x: this.camera.x + (clientX - rect.left)/this.zoom, y: this.camera.y + (clientY - rect.top)/this.zoom };
  }
  worldToClient(worldX, worldY){
    const rect = this.mount.getBoundingClientRect();
    return { x: rect.left + (worldX - this.camera.x)*this.zoom, y: rect.top + (worldY - this.camera.y)*this.zoom };
  }

  // Global world/grid/shadow styling
  setGridVisible(flag) {
    if (!this.groups?.grid) return;
    this.groups.grid.visible(!!flag);
    this.layer.batchDraw();
  }
  isGridVisible() {
    return !!this.groups?.grid?.visible();
  }
  setWorldStyle({ top, bottom, stroke } = {}) {
    if (top    != null) this.worldStyle.top    = top;
    if (bottom != null) this.worldStyle.bottom = bottom;
    if (stroke != null) this.worldStyle.stroke = stroke;
    if (this.worldBG) {
      this.worldBG.fillLinearGradientColorStops([0, this.worldStyle.top, 1, this.worldStyle.bottom]);
      this.worldBG.stroke(this.worldStyle.stroke);
      this.layer.draw();
    }
  }
  setGridStyle({ spacing, heavyEvery, light, heavy } = {}) {
    if (spacing    != null) this.gridStyle.spacing    = Math.max(10, +spacing || 10);
    if (heavyEvery != null) this.gridStyle.heavyEvery = Math.max(50, +heavyEvery || 50);
    if (light      != null) this.gridStyle.light      = light;
    if (heavy      != null) this.gridStyle.heavy      = heavy;

    if (this.gridShape) {
      this.gridShape.setAttrs({
        gridSpacing: this.gridStyle.spacing,
        heavyEvery:  this.gridStyle.heavyEvery,
        lightColor:  this.gridStyle.light,
        heavyColor:  this.gridStyle.heavy
      });
      this.layer.draw();
    }
  }
  setCardShadowStyle({ enabled, dx, dy, blur, color, opacity } = {}) {
    if (enabled != null) this.cardShadow.enabled = !!enabled;
    if (dx      != null) this.cardShadow.dx = +dx || 0;
    if (dy      != null) this.cardShadow.dy = +dy || 0;
    if (blur    != null) this.cardShadow.blur = +blur || 0;
    if (color   != null) this.cardShadow.color = color;
    if (opacity != null) this.cardShadow.opacity = Math.max(0, Math.min(1, +opacity));

    // Apply to existing card bodies
    this.groups.cards.getChildren().forEach(g => {
      const body = g.findOne('.body');
      if (!body) return;
      if (this.cardShadow.enabled) {
        body.shadowColor(this.cardShadow.color);
        body.shadowBlur(this.cardShadow.blur);
        body.shadowOpacity(this.cardShadow.opacity);
        body.shadowOffset({ x: this.cardShadow.dx, y: this.cardShadow.dy });
      } else {
        body.shadowBlur(0);
        body.shadowOpacity(0);
        body.shadowOffset({ x: 0, y: 0 });
      }
    });
    this.layer.batchDraw();
  }

  // Z-Order helpers
  getCardOrder() {
    const nodes = this.groups.cards.getChildren(n => n.hasName('shape') && n.getAttr('shapeKind') === 'card');
    return nodes.map((n, idx) => ({ id: n.getAttr('shapeId'), z: idx }));
  }

  _normalizeAndEmitCardOrder() {
    const order = this.getCardOrder(); // dense, back->front
    // update in-memory models
    order.forEach(({id, z}) => {
      const m = this.SHAPES.get(id);
      if (m) m.z = z;
    });
    // emit hook for persistence
    this.Hooks.onZOrderChange?.(order);
  }

  getCards() {
    // return models in draw order (using groups.cards children)
    const nodes = this.groups.cards.getChildren(n => n.hasName('shape') && n.getAttr('shapeKind') === 'card');
    return nodes.map(n => this.SHAPES.get(n.getAttr('shapeId'))).filter(Boolean);
  }
  getShapeModel(id) { return this.SHAPES.get(id); }

  // ---------- INTERNALS ----------
  _buildWorld() {
    const W = this.CFG.world.width, H = this.CFG.world.height;

    // background rect
    this.worldBG = new Konva.Rect({
      x: 0, y: 0, width: W, height: H,
      fillLinearGradientStartPoint: { x: 0, y: 0 },
      fillLinearGradientEndPoint:   { x: 0, y: H },
      fillLinearGradientColorStops: [0, this.worldStyle.top, 1, this.worldStyle.bottom],
      stroke: this.worldStyle.stroke, strokeWidth: 2
    });
    this.groups.background.add(this.worldBG);

    // grid (draw across full world)
    const gridW = W, gridH = H;
    this.gridShape = new Konva.Shape({
      listening: false,
      gridSpacing: this.gridStyle.spacing,
      heavyEvery:  this.gridStyle.heavyEvery,
      lightColor:  this.gridStyle.light,
      heavyColor:  this.gridStyle.heavy,
      sceneFunc: (ctx, shape) => {
        const spacing   = shape.getAttr('gridSpacing');
        const heavyEach = shape.getAttr('heavyEvery');
        const lightCol  = shape.getAttr('lightColor');
        const heavyCol  = shape.getAttr('heavyColor');
        // light
        ctx.beginPath(); ctx.strokeStyle = lightCol; ctx.lineWidth = 1;
        for (let x = 0; x <= gridW; x += spacing)
          if (x % heavyEach !== 0) { ctx.moveTo(x + 0.5, 0.5); ctx.lineTo(x + 0.5, gridH + 0.5); }
        for (let y = 0; y <= gridH; y += spacing)
          if (y % heavyEach !== 0) { ctx.moveTo(0.5, y + 0.5); ctx.lineTo(gridW + 0.5, y + 0.5); }
        ctx.stroke();
        // heavy
        ctx.beginPath(); ctx.strokeStyle = heavyCol; ctx.lineWidth = 2;
        for (let x = 0; x <= gridW; x += heavyEach) { ctx.moveTo(x + 0.5, 0.5); ctx.lineTo(x + 0.5, gridH + 0.5); }
        for (let y = 0; y <= gridH; y += heavyEach) { ctx.moveTo(0.5, y + 0.5); ctx.lineTo(gridW + 0.5, y + 0.5); }
        ctx.stroke();
      }
    });
    this.groups.grid.add(this.gridShape);

    // corner markers
    const addDot = (x,y)=>this.groups.background.add(new Konva.Circle({ x,y, radius:3, fill:'#9AE6B4' }));
    const addLbl = (x,y,t)=>this.groups.background.add(new Konva.Text({ x,y, text:t, fill:'#9AE6B4', fontSize:12, fontFamily:'ui-monospace, monospace' }));
    addDot(0,0);       addLbl(8,4,'0,0');
    addDot(0,H);       addLbl(8,H-16,`0,${H}`);
    addDot(W,0);       addLbl(W-88,4,`${W},0`);
    addDot(W,H);       addLbl(W-128,H-16,`${W},${H}`);
    const cx=W/2, cy=H/2; addDot(cx,cy); addLbl(cx+8,cy+4,`${cx},${cy}`);

    this.layer.draw();
  }

  _clampCardCenter(cx, cy, w, h) {
    const halfW = w/2, halfH = h/2;
    const minX = halfW, maxX = this.CFG.world.width  - halfW;
    const minY = halfH, maxY = this.CFG.world.height - halfH;
    return { cx: Math.min(Math.max(minX, cx), maxX), cy: Math.min(Math.max(minY, cy), maxY) };
  }

  _applyShadowToBody(body) {
    if (!body) return;
    if (this.cardShadow.enabled) {
      body.shadowColor(this.cardShadow.color);
      body.shadowBlur(this.cardShadow.blur);
      body.shadowOpacity(this.cardShadow.opacity);
      body.shadowOffset({ x: this.cardShadow.dx, y: this.cardShadow.dy });
    } else {
      body.shadowBlur(0);
      body.shadowOpacity(0);
      body.shadowOffset({ x: 0, y: 0 });
    }
  }

  // -- NEW: build/replace the styled body+header via cardStyles.js --
  _buildCardSkin(node, model) {
    const styleFn = cardStyles[model.styleKey] || cardStyles.default;

    const safeStyle = {
      w: model.w,
      h: model.h,
      stroke: model.stroke ?? '#3b4a52',
      strokeWidth: model.strokeWidth ?? 2,
      bodyFill: model.bodyFill ?? '#1b2126',
      headerFill: model.headerFill ?? '#0f1317',
    };

    // create skin (Group named 'cardGroup', containing .body + .header)
    const skin = styleFn(safeStyle);
    skin.name('cardGroup');
    // apply shadow on body
    const body = skin.findOne('.body');
    if (body) this._applyShadowToBody(body);

    // insert skin first (bottom)
    node.add(skin);

    // ensure title & image nodes exist (or create them)
    let title = node.findOne('.title');
    let img   = node.findOne('.img');
    let frame = node.findOne('.imgFrame');

    const header = skin.findOne('.header');
    const headerH = header?.height() ?? 26;
    const imgSize = 70;
    const imgX = 12;
    const imgY = headerH + 10;

    if (!img) {
      img = new Konva.Image({
        name: 'img',
        x: imgX, y: imgY, width: imgSize, height: imgSize,
        listening: false, visible: false
      });
      node.add(img);
    } else {
      img.position({ x: imgX, y: imgY });
      img.size({ width: imgSize, height: imgSize });
    }

    if (!frame) {
      frame = new Konva.Rect({
        name: 'imgFrame',
        x: imgX, y: imgY, width: imgSize, height: imgSize,
        cornerRadius: 6,
        stroke: '#2d3741',
        strokeWidth: 1,
        listening: false
      });
      frame.fillEnabled(false); // border-only so it never hides the image
      node.add(frame);
    } else {
      frame.position({ x: imgX, y: imgY });
      frame.size({ width: imgSize, height: imgSize });
      frame.fillEnabled(false);
      frame.listening(false);
    }

    if (!title) {
      title = new Konva.Text({
        name: 'title',
        x: 12, y: 6, width: model.w - 24, height: (headerH - 8),
        text: model.title ?? model.id,
        fontFamily: 'ui-monospace, monospace', fontSize: 14, fill: '#cfe3d0', listening: false,
        align: 'left', verticalAlign: 'middle',
      });
      node.add(title);
    } else {
      title.position({ x: 12, y: 6 });
      title.width(model.w - 24);
      title.height(headerH - 8);
      title.text(model.title ?? model.id);
    }

    // Keep draw order clear: skin (bottom) -> frame -> img -> title
    // (frame has no fill, so even if above img it won’t hide it)
    skin.zIndex(0);
    frame.zIndex(1);
    img.zIndex(2);
    title.zIndex(3);

    // (re)load image if URL present
    this._setCardImage(node, model.img);
  }

  _rebuildCardSkin(node, model) {
    const old = node.findOne('.cardGroup');
    if (old) old.destroy();
    this._buildCardSkin(node, model);
  }

  _upsertCard(model) {
    const prev = this.SHAPES.get(model.id);
    const next = { kind: 'card', ...prev, ...model };
    next.w = typeof next.w === 'number' ? next.w : 300;
    next.h = typeof next.h === 'number' ? next.h : 150;

    const clamped = this._clampCardCenter(
      next.cx ?? (prev?.cx ?? next.w/2),
      next.cy ?? (prev?.cy ?? next.h/2),
      next.w, next.h
    );
    next.cx = clamped.cx; next.cy = clamped.cy;

    // Default z to previous or append to end
    if (typeof next.z !== 'number') {
      next.z = (typeof prev?.z === 'number') ? prev.z : this.groups.cards.getChildren().length;
    }

    this.SHAPES.set(next.id, next);

    let node = this.SHAPE_NODES.get(next.id);
    if (!node) {
      node = new Konva.Group({
        x: next.cx, y: next.cy,
        offsetX: next.w/2, offsetY: next.h/2,
        draggable: true,
        name: 'shape card'
      });
      node.setAttr('shapeId', next.id);
      node.setAttr('shapeKind', 'card');

      // Build the styled skin (body+header) + title + image via helpers
      this._buildCardSkin(node, next);

      if (typeof next.rot === 'number') node.rotation(next.rot);

      // Drag UX
      node.on('mouseenter', () => this.stage.container().style.cursor = 'grab');
      node.on('mousedown',  () => this.stage.container().style.cursor = 'grabbing');
      node.on('mouseup',    () => this.stage.container().style.cursor = 'grab');
      node.on('mouseleave', () => this.stage.container().style.cursor = '');

      node.dragBoundFunc((pos) => {
        const p = this._clampCardCenter(pos.x, pos.y, next.w, next.h);
        return { x: p.cx, y: p.cy };
      });

      node.on('dragstart', () => {
        // bring to front immediately
        node.moveToTop();
        this.layer.batchDraw();
        const ok = this.Hooks.onDragStart(next.id, { cx: next.cx, cy: next.cy });
        if (ok === false) { node.stopDrag(); return; }
      });

      node.on('dragmove', () => {
        const p = this._clampCardCenter(node.x(), node.y(), next.w, next.h);
        node.position({ x: p.cx, y: p.cy });
        next.cx = p.cx; next.cy = p.cy;
        this.Hooks.onDrag(next.id, { cx: next.cx, cy: next.cy });
      });

      node.on('dragend', () => {
        const p = this._clampCardCenter(node.x(), node.y(), next.w, next.h);
        node.position({ x: p.cx, y: p.cy });
        next.cx = p.cx; next.cy = p.cy;
        this.Hooks.onDragEnd(next.id, { cx: next.cx, cy: next.cy });
        // Normalize and emit order for persistence
        this._normalizeAndEmitCardOrder();
      });

      this.groups.cards.add(node);
      this.SHAPE_NODES.set(next.id, node);

      // Respect incoming z (place at index)
      if (typeof next.z === 'number') node.zIndex(next.z);

    } else {
      // update existing
      const sizeChanged = (next.w !== prev.w) || (next.h !== prev.h);
      const styleChanged = next.styleKey !== prev?.styleKey
        || next.stroke !== prev?.stroke
        || next.strokeWidth !== prev?.strokeWidth
        || next.bodyFill !== prev?.bodyFill
        || next.headerFill !== prev?.headerFill;

      node.position({ x: next.cx, y: next.cy });
      if (typeof next.rot === 'number') node.rotation(next.rot);

      if (sizeChanged || styleChanged) {
        node.offset({ x: next.w/2, y: next.h/2 });
        this._rebuildCardSkin(node, next);
      } else {
        // minor updates
        const title = node.findOne('.title');
        if (title && next.title != null) title.text(next.title);
        // if image URL changed, reload
        this._setCardImage(node, next.img);
      }

      // z update if requested
      if (typeof next.z === 'number') node.zIndex(next.z);
    }
  }

  _removeShape(id) {
    this.SHAPES.delete(id);
    const node = this.SHAPE_NODES.get(id);
    if (node) { node.destroy(); this.SHAPE_NODES.delete(id); }
  }

  // camera + UI
  _getFitMinZoom() {
    const vw = this.mount.clientWidth  || 1;
    const vh = this.mount.clientHeight || 1;
    return Math.max(this.CFG.zoom.hardMin, vw / this.CFG.world.width, vh / this.CFG.world.height);
  }
  _updateSpacer() {
    this.spacer.style.width  = `${this.CFG.world.width  * this.zoom}px`;
    this.spacer.style.height = `${this.CFG.world.height * this.zoom}px`;
  }
  _clampCamera() {
    const vw = this.stage.width(), vh = this.stage.height();
    const maxX = Math.max(0, this.CFG.world.width  - vw / this.zoom);
    const maxY = Math.max(0, this.CFG.world.height - vh / this.zoom);
    this.camera.x = Math.min(Math.max(0, this.camera.x), maxX);
    this.camera.y = Math.min(Math.max(0, this.camera.y), maxY);
  }
  _render() {
    this.world.scale({ x: this.zoom, y: this.zoom });
    this.world.position({ x: -this.camera.x * this.zoom, y: -this.camera.y * this.zoom });
    this.layer.batchDraw();
  }
  _syncScrollFromCamera() {
    this.suppressScrollSync = true;
    this.mount.scrollLeft = this.camera.x * this.zoom;
    this.mount.scrollTop  = this.camera.y * this.zoom;
    this.pinOverlayToScroll();
    this.suppressScrollSync = false;
  }
  _setZoomLabel(pct) {
    const { zoomPctEl } = this.controls;
    if (zoomPctEl) zoomPctEl.textContent = `${pct}%`;
  }
  _setSliderFromZoom(pct) {
    const { sliderEl } = this.controls;
    if (!sliderEl || !sliderEl.noUiSlider) return;
    this._suppressSlider = true;
    sliderEl.noUiSlider.set(pct);
    this._setZoomLabel(pct);
    this._suppressSlider = false;
  }
  _updateMinZoomAndUI({ animateIfRaised = true } = {}) {
    const newMin = Math.min(this._getFitMinZoom(), this.CFG.zoom.max);
    if (Math.abs(newMin - this.minZoom) > 1e-6) {
      this.minZoom = newMin;
      const { sliderEl } = this.controls;
      if (sliderEl && sliderEl.noUiSlider) {
        const minPct = Math.round(this.minZoom * 100);
        const maxPct = Math.round(this.CFG.zoom.max * 100);
        sliderEl.noUiSlider.updateOptions({ range: { min: minPct, max: maxPct } }, false);
        const curPct = Math.round(this.zoom * 100);
        if (curPct < minPct) {
          this._suppressSlider = true;
          sliderEl.noUiSlider.set(minPct);
          this._setZoomLabel(minPct);
          this._suppressSlider = false;
        }
      }
      if (this.zoom < this.minZoom && animateIfRaised) this._animateZoomToCenter(this.minZoom);
    }
  }

  _animate({ duration, ease = easeOutCubic, update, done }) {
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      update(e, t, now);
      if (t < 1) requestAnimationFrame(frame);
      else if (done) done();
    };
    requestAnimationFrame(frame);
  }
  _animateZoomTo(targetZoom, anchorWorld, anchorScreen, duration = this.CFG.zoom.animMs) {
    targetZoom = Math.max(this.minZoom, Math.min(this.CFG.zoom.max, targetZoom));
    const startZoom = this.zoom;
    this._animate({
      duration,
      update: (e) => {
        this.zoom = startZoom + (targetZoom - startZoom) * e;
        this._updateSpacer();
        this.camera.x = anchorWorld.x - (anchorScreen.x / this.zoom);
        this.camera.y = anchorWorld.y - (anchorScreen.y / this.zoom);
        this._clampCamera();
        this._syncScrollFromCamera();
        this._render();
        this._setSliderFromZoom(Math.round(this.zoom * 100));
      }
    });
  }
  _animateZoomToCenter(targetZoom, duration = this.CFG.zoom.animMs) {
    const centerScreen = { x: this.stage.width() / 2, y: this.stage.height() / 2 };
    const anchorWorld  = { x: this.camera.x + centerScreen.x / this.zoom, y: this.camera.y + centerScreen.y / this.zoom };
    this._animateZoomTo(targetZoom, anchorWorld, centerScreen, duration);
  }
  _animatePanTo(cxWorld, cyWorld, duration = this.CFG.pan.animMs) {
    const startX = this.camera.x, startY = this.camera.y;
    const targetX = cxWorld - this.stage.width()  / (2 * this.zoom);
    const targetY = cyWorld - this.stage.height() / (2 * this.zoom);
    this._animate({
      duration,
      update: (e) => {
        this.camera.x = startX + (targetX - startX) * e;
        this.camera.y = startY + (targetY - startY) * e;
        this._clampCamera();
        this._syncScrollFromCamera();
        this._render();
      }
    });
  }
  _startPanAtPointer() {
    this.isPanning = true;
    this.panStart = this.stage.getPointerPosition();
    this.scrollStart = { left: this.mount.scrollLeft, top: this.mount.scrollTop };
    this.stage.container().style.cursor = 'grabbing';
    this.mount.style.userSelect = 'none';
  }
  _endPan() {
    this.isPanning = false;
    this.panStart = null;
    this.scrollStart = null;
    this.stage.container().style.cursor = '';
    this.mount.style.userSelect = '';
  }
  _isOnShape(target, kind) {
    const group = target.findAncestor('Group', true);
    if (!group || !group.hasName('shape')) return false;
    if (!kind) return true;
    return group.hasName(kind) || group.getAttr('shapeKind') === kind;
  }
  _resizeStageToViewport() {
    const w = this.mount.clientWidth, h = this.mount.clientHeight;
    const cx = this.camera.x + (this.stage.width()  / (2 * this.zoom));
    const cy = this.camera.y + (this.stage.height() / (2 * this.zoom));
    this.stage.size({ width: w, height: h });
    this._clampCamera();
    this.camera.x = cx - (w / (2 * this.zoom));
    this.camera.y = cy - (h / (2 * this.zoom));
    this._clampCamera();
    this._updateMinZoomAndUI();
    this._updateSpacer();
    this._syncScrollFromCamera();
    this._render();
  }
  _centerOn(cx, cy) {
    this._resizeStageToViewport();
    this._updateMinZoomAndUI({ animateIfRaised: false });
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
    this._updateSpacer();
    this.camera.x = cx - this.stage.width()  / (2 * this.zoom);
    this.camera.y = cy - this.stage.height() / (2 * this.zoom);
    this._clampCamera();
    this._syncScrollFromCamera();
    this._render();
    this._setSliderFromZoom(Math.round(this.zoom * 100));
  }

  _wireControls() {
    const { zoomPctEl, sliderEl, zoomMinusBtn, zoomPlusBtn, recenterBtn } = this.controls;

    if (sliderEl && window.noUiSlider) {
      noUiSlider.create(sliderEl, {
        start: 100,
        step: 1,
        connect: 'lower',
        range: { min: 10, max: Math.round(this.CFG.zoom.max * 100) }
      });
      let sliderAnchorWorld = null;
      sliderEl.noUiSlider.on('start', () => {
        sliderAnchorWorld = {
          x: this.camera.x + this.stage.width()  / (2 * this.zoom),
          y: this.camera.y + this.stage.height() / (2 * this.zoom)
        };
      });
      sliderEl.noUiSlider.on('update', (values) => {
        if (this._suppressSlider) return;
        this._updateMinZoomAndUI({ animateIfRaised: false });
        const pct = Math.round(parseFloat(values[0]));
        const nextZoom = Math.max(this.minZoom, Math.min(this.CFG.zoom.max, pct / 100));
        if (zoomPctEl) zoomPctEl.textContent = `${Math.round(nextZoom * 100)}%`;
        if (Math.abs(nextZoom - this.zoom) < 1e-6) return;

        this.zoom = nextZoom;
        this._updateSpacer();
        const anchor = sliderAnchorWorld || {
          x: this.camera.x + this.stage.width()  / (2 * this.zoom),
          y: this.camera.y + this.stage.height() / (2 * this.zoom)
        };
        this.camera.x = anchor.x - this.stage.width()  / (2 * this.zoom);
        this.camera.y = anchor.y - this.stage.height() / (2 * this.zoom);
        this._clampCamera();
        this._syncScrollFromCamera();
        this._render();
      });
      sliderEl.noUiSlider.on('end', () => { sliderAnchorWorld = null; });
    }

    const BTN_MAX_PCT = Math.round(this.CFG.zoom.max * 100) - this.CFG.zoom.btnMaxBelowMaxPct;
    const curPct = () => Math.round(this.zoom * 100);
    const nextDownStep = (p) => { const s = this.CFG.zoom.btnStepPct; const min = Math.round(this.minZoom*100); return Math.max(min, Math.floor((p-1)/s)*s); }
    const nextUpStep   = (p)  => { const s = this.CFG.zoom.btnStepPct; return Math.min(BTN_MAX_PCT, Math.ceil((p+1)/s)*s); }

    const zoomToPctAnimated = (pTarget) => {
      const targetZoom = Math.max(this.minZoom, Math.min(this.CFG.zoom.max, pTarget / 100));
      const c = { x: this.stage.width()/2, y: this.stage.height()/2 };
      const anchorWorld  = { x: this.camera.x + c.x / this.zoom, y: this.camera.y + c.y / this.zoom };
      this._animateZoomTo(targetZoom, anchorWorld, c);
      this._setSliderFromZoom(Math.round(targetZoom * 100));
    };

    if (zoomMinusBtn) zoomMinusBtn.addEventListener('click', () => {
      this._updateMinZoomAndUI({ animateIfRaised:false });
      zoomToPctAnimated(nextDownStep(curPct()));
    });
    if (zoomPlusBtn)  zoomPlusBtn .addEventListener('click', () => {
      this._updateMinZoomAndUI({ animateIfRaised:false });
      zoomToPctAnimated(nextUpStep(curPct()));
    });
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () =>
        this._animatePanTo(this.CFG.world.width / 2, this.CFG.world.height / 2)
      );
    }
  }

  // image fitting/centering inside the 70x70 slot
  _setCardImage(node, url) {
    const imgNode = node.findOne('.img');
    const frame   = node.findOne('.imgFrame');
    if (!imgNode || !frame) return;

    if (!url) {
      imgNode.visible(false);
      imgNode.image(null);
      return;
    }

    const targetW = frame.width();
    const targetH = frame.height();

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(targetW / img.width, targetH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;

      imgNode.image(img);
      imgNode.width(drawW);
      imgNode.height(drawH);
      imgNode.position({
        x: frame.x() + (targetW - drawW) / 2,
        y: frame.y() + (targetH - drawH) / 2,
      });
      imgNode.visible(true);
      this.layer.batchDraw();
    };
    img.onerror = () => {
      imgNode.visible(false);
      imgNode.image(null);
      this.layer.batchDraw();
    };
    img.src = url;
  }
}

// utils
function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      target[k] = deepMerge(target[k] ? {...target[k]} : {}, src[k]);
    } else {
      target[k] = src[k];
    }
  }
  return target;
}
