// ============ hand-rolled SVG charts (single hue = brand teal = Q2) ============

import { todayKey, addDays, dayStats, fmtShort, weekdayOf } from './store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// last N days: bar = share of completed time spent on important-not-urgent work
export function q2TrendChart(n = 14) {
  const W = 720, H = 150, padL = 34, padR = 8, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gap = 6;
  const barW = Math.min(30, (plotW - gap * (n - 1)) / n);
  const step = (plotW - barW * n) / (n - 1) + barW;

  const data = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(todayKey(), -i);
    const s = dayStats(k);
    data.push({ k, share: s.q2Share, done: s.done });
  }

  const y = (v) => padT + plotH * (1 - v);
  let bars = '';
  data.forEach((d, i) => {
    const x = padL + i * step;
    if (d.share == null) {
      bars += `<circle cx="${x + barW / 2}" cy="${y(0)}" r="2" fill="var(--line)"/>`;
    } else {
      const h = Math.max(3, plotH * d.share);
      bars += `<g><rect x="${x}" y="${y(0) - h}" width="${barW}" height="${h}" rx="3.5" fill="var(--accent)">` +
        `<title>${esc(fmtShort(d.k))} ${esc(weekdayOf(d.k))}：重要不紧急占比 ${(d.share * 100).toFixed(0)}%</title></rect>`;
      if (i === data.length - 1) {
        bars += `<text x="${x + barW / 2}" y="${y(d.share) - 5}" text-anchor="middle" font-size="11" fill="var(--accent-ink)" font-weight="600">${(d.share * 100).toFixed(0)}%</text>`;
      }
      bars += `</g>`;
    }
    if (i % 2 === (data.length - 1) % 2) {
      bars += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(fmtShort(d.k))}</text>`;
    }
  });

  const grid = [0, 0.5, 1].map((v) =>
    `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="var(--line-soft)" stroke-width="1"/>` +
    `<text x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10.5" fill="var(--muted)">${v * 100}%</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="最近${n}天重要不紧急时间占比">
    ${grid}${bars}
    <line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="var(--line)" stroke-width="1"/>
  </svg>`;
}
