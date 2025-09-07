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

// --- Demo content ---
const demoCards = [
  { id: 'Alpha',   boardId: 'board-1', cx: 1200, cy: 1400, w: 300, h: 150, rot: 0, z: 0, styleKey:'standard',      stroke:'#1d4b9a', strokeWidth:3, bodyFill:'#39ff14', headerFill:'#36454f', img:'https://i.imgur.com/PS730wz.png', title:'Alpha' },
  { id: 'Bravo',   boardId: 'board-1', cx: 3000, cy: 3000, w: 300, h: 150, rot: 0, z: 1, styleKey:'sharp',         stroke:'#1d4b9a', strokeWidth:3, bodyFill:'#39ff14', headerFill:'#36454f', img:'https://i.imgur.com/NfjPkdq.png',  title:'Bravo' },
  { id: 'Charlie', boardId: 'board-1', cx: 4800, cy: 3600, w: 300, h: 150, rot: 0, z: 2, styleKey:'bottomRounded', stroke:'#1d4b9a', strokeWidth:3, bodyFill:'#39ff14', headerFill:'#36454f', img:'https://i.imgur.com/CtXPCAf.png',  title:'Charlie' }
];
board.applySnapshot(demoCards);

// ------- LEFT PANEL -------
function applyWorldStyle() {
  board.setWorldStyle({
    top:    $('worldTopColor').value,
    bottom: $('worldBottomColor').value,
    stroke: $('worldStrokeColor').value
  });
}
['worldTopColor','worldBottomColor','worldStrokeColor'].forEach(id => $(id).addEventListener('input', applyWorldStyle));

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
['gridLightColor','gridHeavyColor','gridSpacing','gridMajorEvery'].forEach(id => $(id).addEventListener('input', applyGridStyle));
$('gridToggle').addEventListener('change', () => board.setGridVisible($('gridToggle').checked));
applyWorldStyle(); applyGridStyle();
function applyShadowStyle() {
  board.setCardShadowStyle({
    enabled: $('shadowEnabled').checked,
    dx: parseFloat($('shadowDx').value || '6'),
    dy: parseFloat($('shadowDy').value || '6'),
    blur: parseFloat($('shadowBlur').value || '6'),
    color: $('shadowColor').value,
    opacity: parseFloat($('shadowOpacity').value || '0.35')
  });
}
['shadowEnabled','shadowDx','shadowDy','shadowBlur','shadowColor','shadowOpacity'].forEach(id => $(id).addEventListener('input', applyShadowStyle));
applyShadowStyle();

// ------- RIGHT PANEL -------
const selCard = $('selCard');
const selStatus = $('selStatus');
const selCx = $('selCx'), selCy = $('selCy'), selW = $('selW'), selH = $('selH'), selRot = $('selRot');
const selZ = $('selZ'), selOrderLabel = $('selOrderLabel');

let selectedId = null;

// --- Deleted log support ---
const deletedLog = []; // { id, title, time }
let lastDeletedMeta = null;

function ensureDeletedLogContainer() {
  let el = $('deletedLog');
  if (el) return el;
  // Create a simple container right below the status row
  el = document.createElement('div');
  el.id = 'deletedLog';
  el.style.marginTop = '8px';
  el.innerHTML = `
    <div style="font-weight:600; opacity:0.8; margin-bottom:4px;">Deleted</div>
    <table id="deletedLogTable" style="width:100%; border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left; font-weight:500; opacity:0.7;">Time</th>
          <th style="text-align:left; font-weight:500; opacity:0.7;">Card</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  // Try to insert after the status label’s row
  const target = selStatus?.parentElement ?? document.body;
  target.parentElement?.insertBefore(el, target.nextSibling) || document.body.appendChild(el);
  return el;
}

function renderDeletedLog() {
  const container = ensureDeletedLogContainer();
  const tbody = container.querySelector('tbody');
  tbody.innerHTML = '';
  // show newest first, cap to 20
  const rows = [...deletedLog].slice(-20).reverse();
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:2px 0; white-space:nowrap;">${formatTime(r.time)}</td>
      <td style="padding:2px 0;">${escapeHtml(r.title || r.id)} <span style="opacity:0.6;">(${escapeHtml(r.id)})</span></td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}
function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n)=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setInspectorEnabled(enabled) {
  [selCx, selCy, selW, selH, selRot, selZ].forEach(el => el.disabled = !enabled);
}
function clearInspector() {
  selCx.value = selCy.value = selW.value = selH.value = selRot.value = selZ.value = '';
  selOrderLabel.textContent = '—';
}

function refreshCardDropdown() {
  const cards = board.getCards();
  selCard.innerHTML = '';
  for (const c of cards) {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.title || c.id;
    selCard.appendChild(opt);
  }
  if (selectedId && cards.some(c => c.id === selectedId)) {
    selCard.value = selectedId;
  } else if (cards.length) {
    selectedId = cards[cards.length - 1].id;
    selCard.value = selectedId;
  } else {
    selectedId = null;
    selCard.value = '';
  }
  if (selectedId) updateInspector();
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

// Dropdown selects a card
selCard.addEventListener('change', () => {
  selectedId = selCard.value || null;
  if (selectedId) {
    board.selectCard(selectedId);
    setInspectorEnabled(true);
    updateInspector();
  } else {
    setInspectorEnabled(false);
    clearInspector();
  }
});

// --- Hooks including 'deleted' state ---
board.setCallbacks({
  onSelectionChange: (state, id, meta) => {
    selStatus.textContent = state;

    if (state === 'deleted') {
      // Card just got deleted: clear inspector & remember meta for the log
      selectedId = null;
      selCard.value = '';
      setInspectorEnabled(false);
      clearInspector();
      lastDeletedMeta = { id, title: meta?.title || id, time: Date.now() };
      return;
    }

    if (state === 'idle' || !id) {
      selectedId = null;
      selCard.value = '';
      setInspectorEnabled(false);
      clearInspector();
      return;
    }

    // selected / dragging
    selectedId = id;
    if (selCard.value !== id) selCard.value = id;
    setInspectorEnabled(true);
    updateInspector();
  },

  onDragStart: (id) => {
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
      selStatus.textContent = 'selected';
      selCx.value = Math.round(pos.cx);
      selCy.value = Math.round(pos.cy);
    }
  },

  // Confirm delete
  onDelete: (id) => confirm(`Delete card "${id}"?`),

  // After deletion: log it, refresh dropdown, and pick next selection if any
  onDeleted: (id) => {
    const meta = (lastDeletedMeta && lastDeletedMeta.id === id)
      ? lastDeletedMeta
      : { id, title: id, time: Date.now() };
    deletedLog.push(meta);
    renderDeletedLog();
    lastDeletedMeta = null;

    // Update dropdown/items
    const opt = Array.from(selCard.options).find(o => o.value === id);
    if (opt) opt.remove();

    const cards = board.getCards();
    if (cards.length) {
      const nextId = cards[cards.length - 1].id;
      selCard.value = nextId;
      selectedId = nextId;
      board.selectCard(nextId);
      setInspectorEnabled(true);
      updateInspector();
      // Leave status 'deleted' visible until next interaction is fine
    } else {
      selectedId = null;
      selCard.value = '';
      // Keep 'deleted' visible; user action will flip it to idle/selected
    }

    refreshCardDropdown(); // keeps order view tidy
  },

  onZOrderChange: (order) => {
    console.log('z-order changed:', order);
    updateInspector();
    refreshCardDropdown();
  }
});

// Initial UI
refreshCardDropdown();
setInspectorEnabled(false);
selStatus.textContent = 'idle';
renderDeletedLog(); // ensure container exists
