/**
 * Gráficos SVG leves, sem dependências externas. Suportam linha/área e barras,
 * com tooltip e escala automática. Recebem os dados e são redesenhados sem recarregar.
 */
import { esc } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 800;
const H = 240;
const PAD = { top: 12, right: 14, bottom: 26, left: 48 };

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceMax(v) {
  if (!v || v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function formatTick(v, unit) {
  if (unit === '%') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'ms') return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
  return String(Math.round(v));
}

/**
 * Desenha série temporal.
 * @param {HTMLElement} container
 * @param {Array<{label:string, value:number|null}>} points
 * @param {{unit?:string, type?:'line'|'bar', color?:string, min?:number, max?:number, fixedMax?:number, emptyText?:string}} opts
 */
export function drawChart(container, points, opts = {}) {
  if (!container) return;
  // Desenha na largura real do contêiner: o texto dos eixos mantém o tamanho de 11 px.
  const W = Math.max(320, Math.round(container.clientWidth || 800));
  container._last = [points, opts];
  if (!container._observer && typeof ResizeObserver !== 'undefined') {
    container._observer = new ResizeObserver(() => {
      if (container._last && container.clientWidth) drawChart(container, ...container._last);
    });
    container._observer.observe(container);
  }
  const { unit = '', type = 'line', color = 'var(--accent)', emptyText = 'Sem dados no período' } = opts;
  container.innerHTML = '';
  const values = points.map((p) => p.value).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!points.length || !values.length) {
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': emptyText }, container);
    el('text', { x: W / 2, y: H / 2, class: 'empty-chart' }, svg).textContent = emptyText;
    return;
  }

  const dataMax = Math.max(...values, 0);
  // minMax evita escalas minúsculas (ex.: 1–4 ms), que geram rótulos repetidos.
  // integer força marcas inteiras (contagens).
  let max = opts.fixedMax ?? niceMax(Math.max(opts.minMax ?? 0, opts.max ?? dataMax * 1.1));
  if (opts.integer) max = Math.max(4, Math.ceil(max));
  const min = opts.min ?? 0;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);

  // Grade horizontal e rótulos do eixo Y
  for (let i = 0; i <= 4; i += 1) {
    const v = min + ((max - min) * i) / 4;
    const yy = y(v);
    const shown = opts.integer ? Math.round(v) : v;
    el('line', { x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy, class: 'grid-line' }, svg);
    const t = el('text', { x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis-label' }, svg);
    t.textContent = formatTick(shown, unit);
  }

  // Rótulos do eixo X (até 6 marcas)
  const step = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const t = el('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'axis-label' }, svg);
    t.textContent = p.shortLabel ?? p.label;
  });

  if (type === 'bar') {
    const barW = Math.min(36, Math.max(3, (innerW / points.length) * 0.6));
    points.forEach((p, i) => {
      const v = p.value ?? 0;
      const h = Math.max(0, innerH * ((v - min) / (max - min || 1)));
      el('rect', {
        x: x(i) - barW / 2, y: PAD.top + innerH - h, width: barW, height: h,
        rx: 2, fill: color, class: 'bar', 'data-index': i,
      }, svg);
    });
  } else {
    // Área + linha; lacunas (null) interrompem a linha.
    let segment = [];
    const segments = [];
    points.forEach((p, i) => {
      if (p.value === null || p.value === undefined) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else {
        segment.push({ i, v: p.value });
      }
    });
    if (segment.length) segments.push(segment);
    for (const seg of segments) {
      const d = seg.map((pt, idx) => `${idx ? 'L' : 'M'}${x(pt.i).toFixed(1)},${y(pt.v).toFixed(1)}`).join(' ');
      const base = PAD.top + innerH;
      const area = `${d} L${x(seg[seg.length - 1].i).toFixed(1)},${base} L${x(seg[0].i).toFixed(1)},${base} Z`;
      el('path', { d: area, fill: color, class: 'area' }, svg);
      el('path', { d, stroke: color, class: 'line' }, svg);
      if (seg.length <= 2) {
        for (const pt of seg) el('circle', { cx: x(pt.i), cy: y(pt.v), r: 4, fill: color }, svg);
      }
    }
  }

  // Tooltip e ponto de foco
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.hidden = true;
  container.appendChild(tip);
  const focus = el('line', { y1: PAD.top, y2: PAD.top + innerH, stroke: 'var(--border-strong)', 'stroke-dasharray': '3 3', opacity: 0 }, svg);
  const hit = el('rect', { x: PAD.left, y: 0, width: innerW, height: H, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(((px - PAD.left) / innerW) * (points.length - 1))));
    const p = points[idx];
    focus.setAttribute('x1', x(idx));
    focus.setAttribute('x2', x(idx));
    focus.setAttribute('opacity', 1);
    tip.hidden = false;
    const valueText = p.value === null || p.value === undefined ? 'sem dados' : `${formatTick(p.value, unit)}`;
    tip.innerHTML = `<strong>${esc(p.tooltipLabel ?? p.label)}</strong><br>${esc(valueText)}`;
    tip.style.left = `${(x(idx) / W) * rect.width}px`;
    tip.style.top = `${(y(p.value ?? min) / H) * rect.height}px`;
  });
  hit.addEventListener('mouseleave', () => {
    tip.hidden = true;
    focus.setAttribute('opacity', 0);
  });
}
