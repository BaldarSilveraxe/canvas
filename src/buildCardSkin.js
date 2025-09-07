// src/buildCardSkin.js
import Konva from 'https://esm.sh/konva@9';
import { cardStyles } from './cardStyles.js';

// ---- Public base + scaler ----
export const CARD_BASE = {
  w: 300,
  h: 150,
  pad: 12,
  headerH: 26,
  img: 70,
  font: 14,
  radius: 8,
  strokeWidth: 2,
  shadow: { dx: 6, dy: 6, blur: 6, opacity: 0.35 }
};

export function computeCardMetrics(w, h) {
  const sx = Math.max(0.1, w / CARD_BASE.w);
  const sy = Math.max(0.1, h / CARD_BASE.h);
  const s  = Math.min(sx, sy);

  const pad         = Math.max(6,  CARD_BASE.pad * s);
  const headerH     = Math.max(18, CARD_BASE.headerH * sy); // header tracks vertical scale
  const titleFont   = Math.max(10, CARD_BASE.font * s);
  const imgSize     = Math.max(32, CARD_BASE.img * s);
  const imgX        = pad;
  const imgY        = headerH + Math.max(6, 10 * s);
  const cornerR     = Math.max(4, CARD_BASE.radius * s);
  const strokeWidth = Math.max(1, CARD_BASE.strokeWidth * s);

  const shadow = {
    dx: Math.round(CARD_BASE.shadow.dx * s),
    dy: Math.round(CARD_BASE.shadow.dy * s),
    blur: Math.max(1, Math.round(CARD_BASE.shadow.blur * s)),
    opacity: CARD_BASE.shadow.opacity
  };

  return { sx, sy, s, pad, headerH, titleFont, imgSize, imgX, imgY, cornerR, strokeWidth, shadow };
}

// ---- Shared helpers ----
export function applyShadowToBody(body, cardShadow, shadowScale) {
  if (!body) return;
  if (cardShadow?.enabled) {
    body.shadowColor(cardShadow.color ?? '#000');
    body.shadowBlur(shadowScale?.blur ?? cardShadow.blur ?? 0);
    body.shadowOpacity(shadowScale?.opacity ?? cardShadow.opacity ?? 0.35);
    body.shadowOffset({
      x: shadowScale?.dx ?? cardShadow.dx ?? 0,
      y: shadowScale?.dy ?? cardShadow.dy ?? 0
    });
  } else {
    body.shadowBlur(0);
    body.shadowOpacity(0);
    body.shadowOffset({ x: 0, y: 0 });
  }
}

export function setCardImage(node, url) {
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
      y: frame.y() + (targetH - drawH) / 2
    });
    imgNode.visible(true);
    node.getLayer()?.batchDraw();
  };
  img.onerror = () => {
    imgNode.visible(false);
    imgNode.image(null);
    node.getLayer()?.batchDraw();
  };
  img.src = url;
}

// ---- Main builders ----
export function buildCardSkin(node, model, cardShadow) {
  const M = computeCardMetrics(model.w, model.h);

  const styleFn = cardStyles[model.styleKey] || cardStyles.default;
  const safeStyle = {
    w: model.w,
    h: model.h,
    stroke: model.stroke ?? '#3b4a52',
    strokeWidth: model.strokeWidth ?? M.strokeWidth,
    bodyFill: model.bodyFill ?? '#1b2126',
    headerFill: model.headerFill ?? '#0f1317',
  };

  const skin = styleFn(safeStyle); // Group with .body + .header
  skin.name('cardGroup');

  // Apply (scaled) shadow to the body
  const body = skin.findOne('.body');
  applyShadowToBody(body, cardShadow, M.shadow);

  // Optionally scale the header block height
  const headerNode = skin.findOne('.header');
  if (headerNode?.height) headerNode.height(M.headerH);

  node.add(skin);

  // Title + Image + Frame (created or updated)
  const headerH = headerNode?.height?.() ?? M.headerH;

  let img   = node.findOne('.img');
  let frame = node.findOne('.imgFrame');
  let title = node.findOne('.title');

  if (!img) {
    img = new Konva.Image({
      name: 'img',
      x: M.imgX, y: M.imgY, width: M.imgSize, height: M.imgSize,
      listening: false, visible: false
    });
    node.add(img);
  } else {
    img.position({ x: M.imgX, y: M.imgY });
    img.size({ width: M.imgSize, height: M.imgSize });
  }

  if (!frame) {
    frame = new Konva.Rect({
      name: 'imgFrame',
      x: M.imgX, y: M.imgY, width: M.imgSize, height: M.imgSize,
      cornerRadius: M.cornerR,
      stroke: '#2d3741',
      strokeWidth: Math.max(1, Math.round(M.strokeWidth * 0.5)),
      fill: false
    });
    node.add(frame);
  } else {
    frame.position({ x: M.imgX, y: M.imgY });
    frame.size({ width: M.imgSize, height: M.imgSize });
    frame.cornerRadius(M.cornerR);
    frame.strokeWidth(Math.max(1, Math.round(M.strokeWidth * 0.5)));
    frame.fillEnabled(false);
  }

  const titleX = M.pad;
  const titleY = Math.max(4, M.pad * 0.5);
  const titleW = model.w - (M.pad * 2);
  const titleH = Math.max(14, headerH - M.pad * 0.5);

  if (!title) {
    title = new Konva.Text({
      name: 'title',
      x: titleX, y: titleY, width: titleW, height: titleH,
      text: model.title ?? model.id,
      fontFamily: 'ui-monospace, monospace',
      fontSize: M.titleFont,
      fill: '#cfe3d0',
      listening: false,
      align: 'left',
      verticalAlign: 'middle'
    });
    node.add(title);
  } else {
    title.position({ x: titleX, y: titleY });
    title.width(titleW);
    title.height(titleH);
    title.fontSize(M.titleFont);
    if (model.title != null) title.text(model.title);
  }

  // Keep draw order: skin -> img -> frame -> title
  skin.moveToBottom();
  img.moveToTop(); frame.moveToTop(); title.moveToTop();

  // Load/fix image if URL present
  setCardImage(node, model.img);
}

export function rebuildCardSkin(node, model, cardShadow) {
  const old = node.findOne('.cardGroup');
  if (old) old.destroy();
  buildCardSkin(node, model, cardShadow);
}
