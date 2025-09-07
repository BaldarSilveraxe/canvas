// src/main.js
import { Board } from './Board.js';

const $ = (id) => document.getElementById(id);
const mount = $('konvaMount');

// --- Instantiate board ---
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

// --- Demo content w/ z values (dense, back->front = 0..N-1) ---
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
    cx: 3000, cy: 3000, w: 300, h: 150, rot: 0, z: 1,
    styleKey: 'sharp',
    stroke: '#1d4b9a', strokeWidth: 3,
    bodyFill: '#39ff14', headerFill: '#36454f',
    img: 'https://i.imgur.com/NfjPkdq.png',
    title: 'Bravo'
  },
  {
    id: 'Charlie',
    boardId: 'board-1',
    cx: 4800, cy: 3600, w: 300, h: 150, rot: 0, z: 2,
    styleKey: 'bottomRounded',
    stroke: '#1d4b9a', strokeWidth: 3,
    bodyFill: '#39ff14', headerFill: '#36454f',
    img: 'https://i.imgur.com/CtXPCAf.png',
    title: 'Charlie'
  }
];

// Apply in z order (Board also sorts by z as a safety)
board.applySnapshot(demoCards);

// ------- LEFT PANEL: GLOBAL SETTINGS (live) -------
function applyWorldStyle() {
  board.setWorldStyle({
    top:    $('worldTopColor').value,
    bottom: $('worldBottomColor').value,
    stroke: $('worldStrokeColor').value
  });
}
['worldTopColor','worldBottomColor','worldStrokeColor'].forEach(id =>
  $(id).addEventListener('input', applyWorldStyle)
);

function applyGridStyle() {
  const spacing = Math.max(10, parseInt($('gridSpacing').value || '100', 10));
  let major = Math.max(50, parseInt($('gridMajorEvery').value || '500', 10));
  if (major < spacing) major = spacing * 5;
  board.setGridStyle({
    spacing,
    heavyEvery: major,
    light: $('gridLightColor').value,
    heavy: $('gridHeavyColor').value
  });
}
['gridLightColor','gridHeavyColor','gridSpacing','gridMajorEvery'].forEach(id =>
  $(id).addEventListener('input', applyGridStyle)
);
$('gridToggle').addEventListener('change', () => {
  board.setGridVisible($('gridToggle').checked);
});

// Card shadow (global)
function applyShadowStyle() {
  board.setCardShadowStyle({
    enabled: $('shadowEnabled').checked,
    dx:      parseFloat($('shadowDx').value || '6'),
    dy:      parseFloat($('shadowDy').value || '6'),
    blur:    parseFloat($('shadowBlur').value || '6'),
    color:   $('shadowColor').value,
    opacity: parseFloat($('shadowOpacity').value || '0.35')
  });
}
['shadowEnabled','shadowDx','shadowDy','shadowBlur','shadowColor','shadowOpacity'].forEach(id =>
  $(id).addEventListener('input', applyShadowStyle)
);

// Initialize visuals once
applyWorldStyle();
applyGridStyle();
applyShadowStyle();

// ------- RIGHT PANEL: Selection/Inspector -------
const selCard = $('selCard');
const selStatus = $('selStatus');
const selCx = $('selCx'), selCy = $('selCy'), selW = $('selW'), selH = $('selH'), selRot = $('selRot');
const selZ = $('selZ'), selOrderLabel = $('selOrderLabel');

let selectedId = null;

function setInspectorEnabled(enabled) {
  [selCx, selCy, selW, selH, selRot, selZ].forEach(el => el.disabled = !enabled);
}

function clearInspector() {
  selCx.value = '';
  selCy.value = '';
  selW.value  = '';
  selH.value  = '';
  selRot.value = '';
  selZ.value = '';
  selOrderLabel.textContent = '—';
}

function refreshCardDropdown() {
  // cards in draw order (back->front)
  const cards = board.getCards();
  selCard.innerHTML = '';
  for (const c of cards) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.title || c.id;
    selCard.appendChild(opt);
  }
  // keep selection if still present
  if (selectedId && cards.some(c => c.id === selectedId)) {
    selCard.value = selectedId;
  } else if (cards.length) {
    selectedId = cards[cards.length - 1].id; // default to front-most
    selCard.value = selectedId;
  }
  updateInspector();
}

function formatOrderLabel(z, total) {
  if (typeof z !== 'number' || total <= 0) return '—';
  const pos = z + 1;
  const frontIdx = total - 1;
  const tag = (z === frontIdx) ? 'Top' : (z === 0 ? 'Bottom' : '');
  return `${pos} / ${total}${tag ? ` (${tag})` : ''}`;
}

function updateInspector() {
  if (!selectedId) return;
  const m = board.getShapeModel(selectedId);
  if (!m) return;

  selCx.value = Math.round(m.cx ?? 0);
  selCy.value = Math.round(m.cy ?? 0);
  selW.value  = Math.round(m.w  ?? 0);
  selH.value  = Math.round(m.h  ?? 0);
  selRot.value = Math.round(m.rot ?? 0);

  const order = board.getCardOrder();
  const total = order.length;
  const entry = order.find(o => o.id === selectedId);
  if (entry) {
    selZ.value = entry.z;
    selOrderLabel.textContent = formatOrderLabel(entry.z, total);
  } else {
    selZ.value = '';
    selOrderLabel.textContent = '—';
  }
}

selCard.addEventListener('change', () => {
  selectedId = selCard.value;
  // make the board actually select it so transformer + status update
  if (selectedId) board.selectCard(selectedId);
  updateInspector();
});

// Hook board callbacks for inspector + z-order persistence demo
board.setCallbacks({
  // NEW: selection state from the canvas (clicks, drag start/end, background clicks, Esc)
  onSelectionChange: (state, id /*, meta */) => {
    selStatus.textContent = state;
    if (state === 'idle' || !id) {
      selectedId = null;
      selCard.value = '';
      setInspectorEnabled(false);
      clearInspector();
      return;
    }
    // selected or dragging
    selectedId = id;
    // keep dropdown in sync with canvas
    if (selCard.value !== id) selCard.value = id;
    setInspectorEnabled(true);
    updateInspector();
  },

  onDragStart: (id) => {
    // canvas already emits onSelectionChange('dragging', id),
    // this keeps parity if you depended on the old hooks
    if (id === selectedId) selStatus.textContent = 'dragging';
  },
  onDrag: (id, pos) => {
    if (id === selectedId) {
      selCx.value = Math.round(pos.cx);
      selCy.value = Math.round(pos.cy);
    }
  },
  onDragEnd: (id, pos) => {
    if (id === selectedId) {
      // IMPORTANT CHANGE: after drag we stay selected
      selStatus.textContent = 'selected';
      selCx.value = Math.round(pos.cx);
      selCy.value = Math.round(pos.cy);
    }
  },
  onZOrderChange: (order) => {
    console.log('z-order changed:', order);
    updateInspector();
    refreshCardDropdown();
  }
});

// Initial population of selection list
refreshCardDropdown();
// Start with inspector disabled until something is selected
setInspectorEnabled(false);
selStatus.textContent = 'idle';
