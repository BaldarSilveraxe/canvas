// src/Board.js
import Konva from 'https://esm.sh/konva@9';

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

    // Global card shadow state (native Konva shadow on card body)
    this.cardShadow = { enabled: true, dx: 6, dy: 6, color: '#000000', opacity: 0.35, blur: 12 };

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

    // Konva stage
    this.stage = new Konva.Stage({
      container: this.stageHost,
      width: this.stageHost.clientWidth,
      height: this.stageHost.clientHeight
    });

    // ------- LAYERS (lowest → highest) -------
    this.layers = {
      background:   new Konva.Layer({ listening: false }),
      grid:         new Konva.Layer({ listening: false }),
      stringsBelow: new Konva.Layer({ listening: false }),
      cards:        new Konva.Layer(),
      stringsAbove: new Konva.Layer({ listening: false }),
      pins:         new Konva.Layer({ listening: false })
    };
    Object.values(this.layers).forEach(l => this.stage.add(l));

    // Each layer gets a "world group" that we transform for camera/pan/zoom
    this.worldGroups = {
      background:   new Konva.Group(),
      grid:         new Konva.Group(),
      stringsBelow: new Konva.Group(),
      cards:        new Konva.Group(),
      stringsAbove: new Konva.Group(),
      pins:         new Konva.Group()
    };
    this.layers.background.add(this.worldGroups.background);
    this.layers.grid.add(this.worldGroups.grid);
    this.layers.stringsBelow.add(this.worldGroups.stringsBelow);
    this.layers.cards.add(this.worldGroups.cards);
    this.layers.stringsAbove.add(this.worldGroups.stringsAbove);
    this.layers.pins.add(this.worldGroups.pins);

    // World visuals (BG + grid + markers)
    this._buildWorld();

    // Shapes
    this.SHAPES = new Map();      // id -> model
    this.SHAPE_NODES = new Map(); // id -> Konva.Group (in cards worldGroup)
    this.READ_ONLY = false;

    // hooks
    this.Hooks = {
      onSelect:   () => {},
      onDragStart:(id, pos) => true,
      onDrag:     (id, pos) => {},
      onDragEnd:  (id, pos) => {}
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

    // left-click pan when not on a shape
    this.isPanning = false; this.panStart = null; this.scrollStart = null;
    this.stage.on('mousedown', (e) => {
      if (e.evt.button !== 0) return;         // only left button
      if (this._isOnShape(e.target)) return;  // let shapes drag themselves
      this._startPanAtPointer();
    });
    this.stage.on('dragstart', () => { if (this.isPanning) this._endPan(); });
    this.stage.on('mouseup',   () => this._endPan());
    this.stage.on('mouseleave',() => this._endPan());
    this.stage.on('mousemove', () => {
      if (!this.isPanning || !this.panStart) return;
      const p = this.stage.getPointerPosition();
      if (!p) return;
      const dx = p.x - this.panStart.x;
      const dy = p.y - this.panStart.y;
      this.suppressScrollSync = true;
      this.mount.scrollLeft = this.scrollStart.left - dx;
      this.mount.scrollTop  = this.scrollStart.top  - dy;
      this.pinOverlayToScroll();
      this.suppressScrollSync = false;
      // scroll handler updates camera & render
    });

    // resize + initial center
    new ResizeObserver(() => this._resizeStageToViewport()).observe(this.mount);
    window.addEventListener('resize', () => this._resizeStageToViewport());

    this.pinOverlayToScroll();
    this._centerOn(this.CFG.world.width / 2, this.CFG.world.height / 2);
  }

  // ---------- PUBLIC API ----------
  applySnapshot(arr) {
    const incoming = new Set(arr.map(s => s.id));
    arr.forEach(s => this._upsertShape(s));
    this.SHAPE_NODES.forEach((_, id) => { if (!incoming.has(id)) this._removeShape(id); });
    this.layers.cards.batchDraw();
  }
  applyPatch(patch) {
    if (!patch) return;
    if (Array.isArray(patch.add))    patch.add.forEach(s => this._upsertShape(s));
    if (Array.isArray(patch.update)) patch.update.forEach(s => this._upsertShape(s));
    if (Array.isArray(patch.remove)) patch.remove.forEach(id => this._removeShape(id));
    this.layers.cards.batchDraw();
  }
  setReadOnly(flag) {
    this.READ_ONLY = !!flag;
    this.SHAPE_NODES.forEach(node => node.draggable(!this.READ_ONLY));
  }
  setCallbacks(cb) { Object.assign(this.Hooks, cb || {}); }

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

  /** Selection helper used by right panel */
  getShapeState(id) {
    const m = this.SHAPES.get(id);
    return m ? { id: m.id, cx: m.cx, cy: m.cy, w: m.w, h: m.h, rot: m.rot || 0 } : null;
  }

  /** GLOBAL: Show/hide the grid */
  setGridVisible(flag) {
    if (!this.layers?.grid) return;
    this.layers.grid.visible(!!flag);
    this.layers.grid.batchDraw();
  }
  isGridVisible() {
    return !!this.layers?.grid?.visible();
  }

  /** GLOBAL: world gradient / border */
  setWorldStyle({ top, bottom, stroke } = {}) {
    if (top    != null) this.worldStyle.top    = top;
    if (bottom != null) this.worldStyle.bottom = bottom;
    if (stroke != null) this.worldStyle.stroke = stroke;

    if (this.worldBG) {
      this.worldBG.fillLinearGradientColorStops([0, this.worldStyle.top, 1, this.worldStyle.bottom]);
      this.worldBG.stroke(this.worldStyle.stroke);
      this.layers.background.batchDraw();
    }
  }

  /** GLOBAL: grid spacing/colors */
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
      this.layers.grid.batchDraw();
    }
  }

  /** GLOBAL: card native shadow for all cards */
  setCardShadowStyle({ enabled, dx, dy, color, opacity, blur } = {}) {
    if (enabled != null) this.cardShadow.enabled = !!enabled;
    if (dx != null) this.cardShadow.dx = +dx || 0;
    if (dy != null) this.cardShadow.dy = +dy || 0;
    if (color != null) this.cardShadow.color = color;
    if (opacity != null) this.cardShadow.opacity = +opacity || 0;
    if (blur != null) this.cardShadow.blur = +blur || 0;

    // apply to all card bodies
    this.SHAPE_NODES.forEach((node, id) => {
      const kind = node.getAttr('shapeKind');
      if (kind !== 'card') return;
      const body = node.findOne('.body');
      if (!body) return;
      if (this.cardShadow.enabled) {
        body.shadowColor(this.cardShadow.color);
        body.shadowOpacity(this.cardShadow.opacity);
        body.shadowBlur(this.cardShadow.blur);
        body.shadowOffset({ x: this.cardShadow.dx, y: this.cardShadow.dy });
      } else {
        body.shadowColor('rgba(0,0,0,0)');
        body.shadowOpacity(0);
        body.shadowBlur(0);
        body.shadowOffset({ x: 0, y: 0 });
      }
    });
    this.layers.cards.batchDraw();
  }

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
    this.worldGroups.background.add(this.worldBG);

    // grid
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

        // light lines
        ctx.beginPath(); ctx.strokeStyle = lightCol; ctx.lineWidth = 1;
        for (let x = 0; x <= gridW; x += spacing)
          if (x % heavyEach !== 0) { ctx.moveTo(x + 0.5, 0.5); ctx.lineTo(x + 0.5, gridH + 0.5); }
        for (let y = 0; y <= gridH; y += spacing)
          if (y % heavyEach !== 0) { ctx.moveTo(0.5, y + 0.5); ctx.lineTo(gridW + 0.5, y + 0.5); }
        ctx.stroke();

        // heavy lines
        ctx.beginPath(); ctx.strokeStyle = heavyCol; ctx.lineWidth = 2;
        for (let x = 0; x <= gridW; x += heavyEach) { ctx.moveTo(x + 0.5, 0.5); ctx.lineTo(x + 0.5, gridH + 0.5); }
        for (let y = 0; y <= gridH; y += heavyEach) { ctx.moveTo(0.5, y + 0.5); ctx.lineTo(gridW + 0.5, y + 0.5); }
        ctx.stroke();
      }
    });
    this.worldGroups.grid.add(this.gridShape);

    // markers (on background layer so they sit under grid)
    const addDot = (x,y)=>this.worldGroups.background.add(new Konva.Circle({ x,y, radius:3, fill:'#9AE6B4' }));
    const addLbl = (x,y,t)=>this.worldGroups.background.add(new Konva.Text({ x,y, text:t, fill:'#9AE6B4', fontSize:12, fontFamily:'ui-monospace, monospace' }));
    addDot(0,0);       addLbl(8,4,'0,0');
    addDot(0,H);       addLbl(8,H-16,`0,${H}`);
    addDot(W,0);       addLbl(W-88,4,`${W},0`);
    addDot(W,H);       addLbl(W-128,H-16,`${W},${H}`);
    const cx=W/2, cy=H/2; addDot(cx,cy); addLbl(cx+8,cy+4,`${cx},${cy}`);

    this.stage.draw();
  }

  _clampShapeCenter(cx, cy, w, h) {
    const halfW = w/2, halfH = h/2;
    const minX = halfW, maxX = this.CFG.world.width  - halfW;
    const minY = halfH, maxY = this.CFG.world.height - halfH;
    return { cx: Math.min(Math.max(minX, cx), maxX), cy: Math.min(Math.max(minY, cy), maxY) };
  }

  _applyCardBodyShadow(body) {
    if (!body) return;
    if (this.cardShadow.enabled) {
      body.shadowColor(this.cardShadow.color);
      body.shadowOpacity(this.cardShadow.opacity);
      body.shadowBlur(this.cardShadow.blur);
      body.shadowOffset({ x: this.cardShadow.dx, y: this.cardShadow.dy });
    } else {
      body.shadowColor('rgba(0,0,0,0)');
      body.shadowOpacity(0);
      body.shadowBlur(0);
      body.shadowOffset({ x: 0, y: 0 });
    }
  }

  _upsertShape(model) {
    const prev = this.SHAPES.get(model.id);
    const next = { kind: 'card', ...prev, ...model };
    next.w = typeof next.w === 'number' ? next.w : 200;
    next.h = typeof next.h === 'number' ? next.h : 120;
    const clamped = this._clampShapeCenter(next.cx ?? (prev?.cx ?? next.w/2),
                                           next.cy ?? (prev?.cy ?? next.h/2),
                                           next.w, next.h);
    next.cx = clamped.cx; next.cy = clamped.cy;
    this.SHAPES.set(next.id, next);

    let node = this.SHAPE_NODES.get(next.id);

    // corner style
    const cr = (() => {
      switch (next.styleKey) {
        case 'sharp':          return 0;
        case 'bottomRounded':  return [0,0,10,10];
        default:               return 10; // standard rounded
      }
    })();

    if (!node) {
      node = new Konva.Group({
        x: next.cx, y: next.cy,
        offsetX: next.w/2, offsetY: next.h/2,
        draggable: !this.READ_ONLY,
        name: 'shape card'
      });
      node.setAttr('shapeKind', next.kind);

      // card rect
      const body = new Konva.Rect({
        name: 'body',
        x: 0, y: 0, width: next.w, height: next.h,
        cornerRadius: cr,
        fill: next.bodyFill ?? '#0e161d',
        stroke: next.stroke || next.style?.stroke || '#93c5fd',
        strokeWidth: next.strokeWidth ?? next.style?.strokeWidth ?? 2
      });
      this._applyCardBodyShadow(body);

      // header
      const headerH = 26;
      const header = new Konva.Rect({
        name: 'header',
        x: 0, y: 0, width: next.w, height: headerH,
        cornerRadius: Array.isArray(cr) ? [cr[0], cr[1], 0, 0] : (cr ? [cr,cr,0,0] : 0),
        fill: next.headerFill ?? '#0b1217'
      });

      // title
      const titleText = new Konva.Text({
        name: 'label',
        x: 8, y: 5, width: next.w - 16, height: headerH - 10,
        text: next.title ?? next.id,
        fontSize: 13, fill: '#cfe3d0', fontFamily: 'ui-monospace, monospace', listening: false
      });

      // image (70x70) at left, inside body under header
      let imgNode = null;
      if (next.img) {
        imgNode = new Konva.Image({ x: 10, y: headerH + 10, width: 70, height: 70, listening: false });
        const image = new Image();
        image.onload = () => { imgNode.image(image); this.layers.cards.batchDraw(); };
        image.src = next.img;
      }

      // click to select
      node.on('mousedown', () => {
        const s = this.getShapeState(next.id);
        this.Hooks.onSelect(next.id, s);
      });

      // cursor affordance
      node.on('mouseenter', () => this.stage.container().style.cursor = this.READ_ONLY ? '' : 'grab');
      node.on('mousedown',  () => this.stage.container().style.cursor = this.READ_ONLY ? '' : 'grabbing');
      node.on('mouseup',    () => this.stage.container().style.cursor = this.READ_ONLY ? '' : 'grab');
      node.on('mouseleave', () => this.stage.container().style.cursor = '');

      node.dragBoundFunc((pos) => {
        const p = this._clampShapeCenter(pos.x, pos.y, next.w, next.h);
        return { x: p.cx, y: p.cy };
      });
      node.on('dragstart', () => {
        if (this.READ_ONLY) { node.stopDrag(); return; }
        const ok = this.Hooks.onDragStart(next.id, { cx: next.cx, cy: next.cy });
        if (ok === false) { node.stopDrag(); return; }
      });
      node.on('dragmove', () => {
        const p = this._clampShapeCenter(node.x(), node.y(), next.w, next.h);
        node.position({ x: p.cx, y: p.cy });
        next.cx = p.cx; next.cy = p.cy;
        this.Hooks.onDrag(next.id, { cx: next.cx, cy: next.cy });
      });
      node.on('dragend', () => {
        const p = this._clampShapeCenter(node.x(), node.y(), next.w, next.h);
        node.position({ x: p.cx, y: p.cy });
        next.cx = p.cx; next.cy = p.cy;
        this.Hooks.onDragEnd(next.id, { cx: next.cx, cy: next.cy });
      });

      // assemble
      node.add(body, header, titleText);
      if (imgNode) node.add(imgNode);

      this.worldGroups.cards.add(node);
      this.SHAPE_NODES.set(next.id, node);
    } else {
      node.position({ x: next.cx, y: next.cy });
      if (typeof next.rot === 'number') node.rotation(next.rot);
      node.setAttr('shapeKind', next.kind);

      const body   = node.findOne('.body');
      const header = node.findOne('.header');
      const label  = node.findOne('.label');

      // corner radius update
      if (body) body.cornerRadius(cr);
      if (header) header.cornerRadius(Array.isArray(cr) ? [cr[0], cr[1], 0, 0] : (cr ? [cr,cr,0,0] : 0));

      const sizesChanged = (body?.width() !== next.w) || (body?.height() !== next.h);
      if (sizesChanged) {
        if (body)   { body.width(next.w); body.height(next.h); }
        if (header) { header.width(next.w); }
        if (label)  { label.width(next.w - 16); }
        node.offset({ x: next.w/2, y: next.h/2 });
        const p = this._clampShapeCenter(node.x(), node.y(), next.w, next.h);
        node.position({ x: p.cx, y: p.cy });
        next.cx = p.cx; next.cy = p.cy;
      }
      if (body) {
        body.fill(next.bodyFill ?? '#0e161d');
        body.stroke(next.stroke || next.style?.stroke || '#93c5fd');
        const sw = (next.strokeWidth != null) ? next.strokeWidth : next.style?.strokeWidth;
        if (sw != null) body.strokeWidth(sw);
        this._applyCardBodyShadow(body);
      }
      if (header) header.fill(next.headerFill ?? '#0b1217');
      node.draggable(!this.READ_ONLY);
    }

    this.layers.cards.batchDraw();
  }

  _removeShape(id) {
    this.SHAPES.delete(id);
    const node = this.SHAPE_NODES.get(id);
    if (node) { node.destroy(); this.SHAPE_NODES.delete(id); }
  }

  // camera helpers
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
    // Apply camera transform to all world groups (so all layers move together)
    const tx = -this.camera.x * this.zoom;
    const ty = -this.camera.y * this.zoom;
    for (const g of Object.values(this.worldGroups)) {
      g.scale({ x: this.zoom, y: this.zoom });
      g.position({ x: tx, y: ty });
    }
    // draw all layers once
    this.stage.batchDraw();
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
