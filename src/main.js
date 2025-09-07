// src/main.js
import { Board } from './Board.js';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const safeNumber = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// ---------- create board FIRST ----------
const mount = $('konvaMount');

const board = new Board({
  mount,
  controls: {
    zoomPctEl:    $('zoomPct'),
    sliderEl:     $('zoomSlider'),
    zoomMinusBtn: $('zoomMinusBtn'),
    zoomPlusBtn:  $('zoomPlusBtn'),
    recenterBtn:  $('recenterBtn')
  }
});

// ---------- demo content (cards only) ----------
const demoCards = [
  {
    id: 'Alpha',
    boardId: 'board-1',
    cx: 1200, cy: 1400, w: 300, h: 150, rot: 0, z: 0,
    styleKey: 'standard',
    stroke: '#1d4b9a', strokeWidth: 3,
    bodyFill: '#39ff14', headerFill: '#36454f',
    img: 'https://i.imgur.com/PS730wz.png',
    title: 'Alpha'
  },
  {
    id: 'Bravo',
    boardId: 'board-1',
    cx: 3000, cy: 3000, w: 300, h: 150, rot: 0, z: 0,
    styleKey: 'sharp',
    stroke: '#1d4b9a', strokeWidth: 3,
    bodyFill: '#39ff14', headerFill: '#36454f',
    img: 'https://i.imgur.com/NfjPkdq.png',
    title: 'Bravo'
  },
  {
    id: 'Charlie',
    boardId: 'board-1',
    cx: 4800, cy: 3600, w: 300, h: 150, rot: 0, z: 0,
    styleKey: 'bottomRounded',
    stroke: '#1d4b9a', strokeWidth: 3,
    bodyFill: '#39ff14', headerFill: '#36454f',
    img: 'https://i.imgur.com/CtXPCAf.png',
    title: 'Charlie'
  }
];

board.applySnapshot(demoCards);

// For selection dropdown
const cardIds = demoCards.map(c => c.id);

// ---------- LEFT PANEL: world / grid / shadow ----------
const worldTopColor    = $('worldTopColor');
const worldBottomColor = $('worldBottomColor');
const worldStrokeColor = $('worldStrokeColor');

function applyWorldStyle() {
  if (!worldTopColor || !worldBottomColor || !worldStrokeColor) return;
  board.setWorldStyle({
    top:    worldTopColor.value,
    bottom: worldBottomColor.value,
    stroke: worldStrokeColor.value
  });
}
[worldTopColor, worldBottomColor, worldStrokeColor].forEach(el => {
  if (el) el.addEventListener('input', applyWorldStyle);
});
applyWorldStyle();

const gridToggle     = $('gridToggle');
const gridLightColor = $('gridLightColor');
const gridHeavyColor = $('gridHeavyColor');
const gridSpacing    = $('gridSpacing');
const gridMajorEvery = $('gridMajorEvery');

function applyGridStyle() {
  if (!gridLightColor || !gridHeavyColor || !gridSpacing || !gridMajorEvery) return;
  const spacing = Math.max(10, safeNumber(gridSpacing.value, 100));
  let major = Math.max(50, safeNumber(gridMajorEvery.value, 500));
  if (major < spacing) major = spacing * 5;

  board.setGridStyle({
    spacing,
    heavyEvery: major,
    light: gridLightColor.value,
    heavy: gridHeavyColor.value
  });
}
[gridLightColor, gridHeavyColor, gridSpacing, gridMajorEvery].forEach(el => {
  if (el) el.addEventListener('input', applyGridStyle);
});
applyGridStyle();

if (gridToggle) {
  // init checkbox to actual state
  gridToggle.checked = board.isGridVisible();
  gridToggle.addEventListener('change', () => {
    board.setGridVisible(gridToggle.checked);
  });
}

// Card shadow (global)
// Note: opacity/blur inputs are optional; code guards if you haven't added them yet.
const shadowEnabled = $('shadowEnabled');
const shadowDx      = $('shadowDx');
const shadowDy      = $('shadowDy');
const shadowColor   = $('shadowColor');
const shadowOpacity = $('shadowOpacity'); // optional (0..1)
const shadowBlur    = $('shadowBlur');    // optional (px)



function applyShadowStyle() {
  board.setCardShadowStyle({
    enabled: shadowEnabled ? shadowEnabled.checked : true,
    dx:      shadowDx ? safeNumber(shadowDx.value, 6) : 6,
    dy:      shadowDy ? safeNumber(shadowDy.value, 6) : 6,
    color:   shadowColor ? shadowColor.value : '#000000',
    opacity: shadowOpacity ? safeNumber(shadowOpacity.value, 0.35) : 0.35,
    blur:    shadowBlur ? safeNumber(shadowBlur.value, 12) : 12
  });
}
[shadowEnabled, shadowDx, shadowDy, shadowColor, shadowOpacity, shadowBlur].forEach(el => {
  if (el) el.addEventListener('input', applyShadowStyle);
});
applyShadowStyle();

// ---------- RIGHT PANEL: selection tracking ----------
const selCard   = $('selCard');
const selStatus = $('selStatus');
const selCx     = $('selCx');
const selCy     = $('selCy');
const selW      = $('selW');
const selH      = $('selH');
const selRot    = $('selRot');

// Populate card selector
if (selCard) {
  selCard.innerHTML = '';
  for (const id of cardIds) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    selCard.appendChild(opt);
  }
}

// Helper to push state into the right panel fields
function paintState(state) {
  if (!state) return;
  if (selCx)  selCx.value  = Math.round(state.cx ?? 0);
  if (selCy)  selCy.value  = Math.round(state.cy ?? 0);
  if (selW)   selW.value   = Math.round(state.w  ?? 0);
  if (selH)   selH.value   = Math.round(state.h  ?? 0);
  if (selRot) selRot.value = Math.round(state.rot ?? 0);
}

let currentId = cardIds[0] || null;
if (selCard && currentId) selCard.value = currentId;
if (currentId) paintState(board.getShapeState(currentId));

if (selCard) {
  selCard.addEventListener('change', () => {
    currentId = selCard.value || null;
    if (currentId) {
      const st = board.getShapeState(currentId);
      paintState(st);
      if (selStatus) selStatus.textContent = 'idle';
    }
  });
}

// Wire board hooks so dragging/selection updates the right panel
board.setCallbacks({
  onSelect: (id, state) => {
    currentId = id;
    if (selCard) selCard.value = id;
    paintState(state);
    if (selStatus) selStatus.textContent = 'idle';
  },
  onDragStart: (id) => {
    if (currentId === id && selStatus) selStatus.textContent = 'dragging';
  },
  onDrag: (id) => {
    if (currentId !== id) return;
    const st = board.getShapeState(id);
    paintState(st);
  },
  onDragEnd: (id) => {
    if (currentId !== id) return;
    const st = board.getShapeState(id);
    paintState(st);
    if (selStatus) selStatus.textContent = 'idle';
  }
});

// Optional: expose for quick debugging in dev tools
// window.board = board;
