// Hand-rolled SVG chart helpers — no charting library needed for this
// app's scale. Each function returns an SVG markup string sized by its
// viewBox; callers set width:100% in CSS so it scales responsively. Mark
// specs (2px lines, hairline gridlines, small dot radius) stay consistent
// across all of them on purpose.

const Charts = (() => {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** Short axis labels (275,650 → 276k, 18,443,000 → 18.4M) so they fit the left margin; exact values stay in tooltips. */
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
    return String(Math.round(v));
  }

  /**
   * Trend line/area chart. points: [{label, value}], ascending.
   * detailed: the enlarged view, with more gridlines and x labels and a
   * hoverable dot on every point instead of only the first and last.
   */
  function lineChart(points, { width = 520, height = 160, color = 'var(--sb-accent)', valueFormat = (v) => Math.round(v).toLocaleString(), detailed = false } = {}) {
    const padLeft = detailed ? 56 : 40, padRight = 10, padTop = 10, padBottom = 26;
    const plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
    const clean = points.filter((p) => p.value != null);
    if (clean.length < 2) {
      return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle">Not enough history yet</text></svg>`;
    }
    const values = clean.map((p) => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const x = (i) => padLeft + (i / (clean.length - 1)) * plotW;
    const y = (v) => padTop + plotH - ((v - min) / span) * plotH;

    const gridSteps = detailed ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
    const gridLines = gridSteps.map((f) => {
      const gy = padTop + f * plotH;
      const val = max - f * span;
      return `<line class="grid-line" x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${width - padRight}" y2="${gy.toFixed(1)}" stroke="var(--sb-gridline)"/>` +
        `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${esc(Math.abs(val) >= 1000 ? compact(val) : valueFormat(val))}</text>`;
    }).join('');

    const linePoints = clean.map((p, i) => `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' L ');
    const areaPath = `M ${linePoints} L ${x(clean.length - 1).toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

    const dotIdxs = detailed ? clean.map((_, i) => i) : [0, clean.length - 1];
    const dots = dotIdxs.map((i) =>
      `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(clean[i].value).toFixed(1)}" r="${detailed ? 3.5 : 3}"><title>${esc(detailed ? `${clean[i].label}: ` : '')}${esc(valueFormat(clean[i].value))}</title></circle>`
    ).join('');

    const maxLabels = detailed ? 10 : 5;
    const labelIdxs = clean.length <= maxLabels
      ? clean.map((_, i) => i)
      : detailed
        ? [...new Set(Array.from({ length: maxLabels }, (_, k) => Math.round((k * (clean.length - 1)) / (maxLabels - 1))))]
        : [0, Math.floor((clean.length - 1) / 2), clean.length - 1];
    // First/last labels anchor inward so they don't get clipped at the edges.
    const anchor = (i) => (i === 0 ? 'start' : i === clean.length - 1 ? 'end' : 'middle');
    const labels = labelIdxs.map((i) =>
      `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor(i)}">${esc(clean[i].label)}</text>`
    ).join('');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      ${gridLines}
      <path d="${areaPath}" fill="${color}" opacity="0.10"/>
      <path d="M ${linePoints}" fill="none" stroke="${color}" stroke-width="2"/>
      ${dots}
      ${labels}
    </svg>`;
  }

  /** Vertical histogram/bar chart. bars: [{label, value}]. */
  function barChart(bars, { width = 520, height = 170, color = 'var(--sb-seq-450)' } = {}) {
    const padLeft = 10, padRight = 10, padTop = 10, padBottom = 26;
    const plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
    if (!bars.length) {
      return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle">No data yet</text></svg>`;
    }
    const max = Math.max(...bars.map((b) => b.value), 1);
    const gap = 12;
    const barW = (plotW - gap * (bars.length - 1)) / bars.length;

    const gridLines = [0, 0.5, 1].map((f) =>
      `<line class="grid-line" x1="${padLeft}" y1="${(padTop + f * plotH).toFixed(1)}" x2="${width - padRight}" y2="${(padTop + f * plotH).toFixed(1)}" stroke="var(--sb-gridline)"/>`
    ).join('');

    const bodies = bars.map((b, i) => {
      const bh = (b.value / max) * plotH;
      const bx = padLeft + i * (barW + gap);
      const by = padTop + plotH - bh;
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh, 1).toFixed(1)}" rx="3" fill="${color}"><title>${esc(b.label)}: ${b.value}</title></rect>` +
        `<text x="${(bx + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    }).join('');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${gridLines}${bodies}</svg>`;
  }

  /** Signed delta around zero (e.g. weekly net income). bars: [{label, value}], blue = positive, red = negative. */
  function divergingBarChart(bars, { width = 520, height = 170, valueFormat = (v) => Math.round(v).toLocaleString() } = {}) {
    const padLeft = 44, padRight = 10, padTop = 10, padBottom = 26;
    const plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
    const clean = bars.filter((b) => b.value != null);
    if (!clean.length) {
      return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle">No finance data yet</text></svg>`;
    }
    const maxAbs = Math.max(...clean.map((b) => Math.abs(b.value)), 1);
    const zeroY = padTop + plotH / 2;
    const gap = 10;
    const barW = (plotW - gap * (clean.length - 1)) / clean.length;

    const zeroLabel = `<line x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${width - padRight}" y2="${zeroY.toFixed(1)}" stroke="var(--sb-baseline)" stroke-width="1"/>` +
      `<text x="${padLeft - 6}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end">0</text>`;

    const bodies = clean.map((b, i) => {
      const bx = padLeft + i * (barW + gap);
      const h = (Math.abs(b.value) / maxAbs) * (plotH / 2);
      const positive = b.value >= 0;
      const by = positive ? zeroY - h : zeroY;
      // Money in is good news: accent green up, critical red down. (The
      // --sb-div-* scale is for neutral two-sided data, and its "pos" side is red.)
      const color = positive ? 'var(--sb-accent)' : 'var(--sb-status-critical)';
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" fill="${color}"><title>${esc(b.label)}: ${valueFormat(b.value)}</title></rect>` +
        `<text x="${(bx + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    }).join('');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${zeroLabel}${bodies}</svg>`;
  }

  /** Before→after dumbbell chart. rows: [{label, from, to}], sorted by caller. */
  function dumbbellChart(rows, { width = 520, height, formatValue = (v) => (v > 0 ? '+' : '') + Math.round(v).toLocaleString() } = {}) {
    const rowH = 32;
    height = height || rows.length * rowH + 20;
    if (!rows.length) {
      return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle">No movers this week</text></svg>`;
    }
    const labelW = 110, valueW = 70, padTop = 12;
    const plotLeft = labelW, plotRight = width - valueW;
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.to - r.from)), 1);
    const mid = (plotLeft + plotRight) / 2;
    const halfSpan = (plotRight - plotLeft) / 2 - 10;

    const body = rows.map((r, i) => {
      const delta = r.to - r.from;
      const cy = padTop + i * rowH + rowH / 2;
      const dx = (delta / maxAbs) * halfSpan;
      const startX = mid;
      const endX = mid + dx;
      const color = delta >= 0 ? 'var(--sb-status-good-text)' : 'var(--sb-status-critical-text)';
      return `<line x1="${startX.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${color}" stroke-width="2" opacity="0.55"/>` +
        `<circle cx="${startX.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="var(--sb-baseline)"/>` +
        `<circle cx="${endX.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="${color}"/>` +
        `<text x="${labelW - 8}" y="${(cy + 3).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>` +
        `<text x="${width - 4}" y="${(cy + 3).toFixed(1)}" text-anchor="end" class="mono" fill="${color}">${esc(formatValue(delta))}</text>`;
    }).join('');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <line x1="${mid.toFixed(1)}" y1="4" x2="${mid.toFixed(1)}" y2="${height - 4}" stroke="var(--sb-gridline)" stroke-width="1"/>
      ${body}
    </svg>`;
  }

  /** Win/Draw/Loss stacked probability bar. */
  function stackedProbBar({ winPct, drawPct, lossPct }, { width = 520, height = 64 } = {}) {
    const trackX = 4, trackW = width - 8, trackY = 18, trackH = 22;
    const winW = (winPct / 100) * trackW;
    const drawW = (drawPct / 100) * trackW;
    const lossW = trackW - winW - drawW;
    const seg = (x, w, fill, label) => w > 0
      ? `<rect x="${x.toFixed(1)}" y="${trackY}" width="${w.toFixed(1)}" height="${trackH}" fill="${fill}"><title>${label}</title></rect>` +
        (w > 34 ? `<text x="${(x + w / 2).toFixed(1)}" y="${trackY + 15}" text-anchor="middle" font-weight="600" font-size="11" fill="#fff">${Math.round((w / trackW) * 100)}%</text>` : '')
      : '';
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect x="${trackX}" y="${trackY}" width="${trackW}" height="${trackH}" rx="4" fill="var(--sb-gridline)"/>
      ${seg(trackX, winW, 'var(--sb-accent)', `Win ${winPct}%`)}
      ${seg(trackX + winW, drawW, 'var(--sb-baseline)', `Draw ${drawPct}%`)}
      ${seg(trackX + winW + drawW, lossW, 'var(--sb-status-critical-text)', `Loss ${lossPct}%`)}
      <rect x="4" y="${height - 14}" width="8" height="8" rx="2" fill="var(--sb-accent)"/><text x="16" y="${height - 6}" font-size="10">Win</text>
      <rect x="66" y="${height - 14}" width="8" height="8" rx="2" fill="var(--sb-baseline)"/><text x="78" y="${height - 6}" font-size="10">Draw</text>
      <rect x="128" y="${height - 14}" width="8" height="8" rx="2" fill="var(--sb-status-critical-text)"/><text x="140" y="${height - 6}" font-size="10">Loss</text>
    </svg>`;
  }

  /** Two-series grouped horizontal bars, one pair per row. rows: [{label, you, opponent}]. */
  function groupedHBar(rows, { width = 520 } = {}) {
    const rowH = 46, labelW = 66, valueW = 90, padTop = 12;
    const height = rows.length * rowH + 32;
    const barMaxW = width - labelW - valueW;
    const max = Math.max(...rows.flatMap((r) => [r.you, r.opponent]), 1);
    const body = rows.map((r, i) => {
      const y0 = padTop + i * rowH;
      const youW = (r.you / max) * barMaxW;
      const oppW = (r.opponent / max) * barMaxW;
      return `<rect x="${labelW}" y="${y0}" width="${youW.toFixed(1)}" height="15.6" rx="3" fill="var(--sb-accent)"><title>You ${esc(r.label)}: ${r.you}</title></rect>` +
        `<rect x="${labelW}" y="${(y0 + 18.6).toFixed(1)}" width="${oppW.toFixed(1)}" height="15.6" rx="3" fill="var(--sb-baseline)"><title>Opponent ${esc(r.label)}: ${r.opponent}</title></rect>` +
        `<text x="${labelW - 8}" y="${(y0 + 12).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>` +
        `<text x="${(labelW + Math.max(youW, oppW) + 8).toFixed(1)}" y="${(y0 + 12).toFixed(1)}" text-anchor="start" class="mono" font-size="9">${r.you} / ${r.opponent}</text>`;
    }).join('');
    const legendY = height - 10;
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      ${body}
      <rect x="${labelW}" y="${legendY - 8}" width="8" height="8" rx="2" fill="var(--sb-accent)"/><text x="${labelW + 12}" y="${legendY}" font-size="10">You</text>
      <rect x="${labelW + 60}" y="${legendY - 8}" width="8" height="8" rx="2" fill="var(--sb-baseline)"/><text x="${labelW + 72}" y="${legendY}" font-size="10">Opponent</text>
    </svg>`;
  }

  /** Tiny inline trend sparkline for a stat tile. */
  function sparkline(values, { width = 90, height = 28, color = 'var(--sb-accent)' } = {}) {
    const clean = values.filter((v) => v != null);
    if (clean.length < 2) return '';
    const min = Math.min(...clean), max = Math.max(...clean), span = max - min || 1;
    const x = (i) => (i / (clean.length - 1)) * (width - 4) + 2;
    const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
    const pts = clean.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' L ');
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <path d="M ${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
  }

  /** Small top-down pitch with 11 tokens placed by line. slots: {gk:[{code}], def:[...], mid:[...], att:[...]} */
  function pitchDiagram(slots, { width = 280, height = 400 } = {}) {
    const lineColor = { gk: 'var(--sb-line-gk)', def: 'var(--sb-line-def)', mid: 'var(--sb-line-mid)', att: 'var(--sb-line-att)' };
    const rowY = { att: 88, mid: 200, def: 304, gk: 368 };
    const spread = (n, rowWidth) => {
      if (n <= 1) return [rowWidth / 2];
      const step = rowWidth / (n + 1);
      return Array.from({ length: n }, (_, i) => step * (i + 1));
    };
    let tokens = '';
    for (const line of ['def', 'mid', 'att', 'gk']) {
      const list = slots[line] || [];
      const xs = spread(list.length, width - 40).map((x) => x + 20);
      list.forEach((p, i) => {
        const cx = xs[i], cy = rowY[line];
        tokens += `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="14" fill="${lineColor[line]}" stroke="var(--sb-surface)" stroke-width="2"/>` +
          `<text x="${cx.toFixed(1)}" y="${cy + 4}" text-anchor="middle" fill="#fff" font-weight="700" font-size="10.5">${esc(p.code)}</text>`;
      });
    }
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="max-width:${width}px;display:block;margin:0 auto;">
      <rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="8" fill="var(--sb-accent-tint-10)" stroke="var(--sb-accent-tint-20)" stroke-width="1"/>
      <line x1="2" y1="${height / 2}" x2="${width - 2}" y2="${height / 2}" stroke="var(--sb-accent-tint-20)" stroke-width="1"/>
      <circle cx="${width / 2}" cy="${height / 2}" r="34" fill="none" stroke="var(--sb-accent-tint-20)" stroke-width="1"/>
      <rect x="${width * 0.24}" y="2" width="${width * 0.52}" height="46" fill="none" stroke="var(--sb-accent-tint-20)" stroke-width="1"/>
      <rect x="${width * 0.24}" y="${height - 48}" width="${width * 0.52}" height="46" fill="none" stroke="var(--sb-accent-tint-20)" stroke-width="1"/>
      ${tokens}
    </svg>`;
  }

  // Enlarge: a card renders enlargeButton(spec) in its header; clicking it
  // redraws the same points as a detailed line chart in a modal dialog.
  // spec: {title, subtitle?, points, color?, valueFormat?}
  const enlargeSpecs = [];

  function enlargeButton(spec) {
    const id = enlargeSpecs.push(spec) - 1;
    return `<button type="button" class="enlarge-btn" data-enlarge="${id}" title="Enlarge chart" aria-label="Enlarge ${esc(spec.title)} chart">⤢</button>`;
  }

  function openEnlarged(spec) {
    let dialog = document.getElementById('chartDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'chartDialog';
      dialog.className = 'chart-dialog';
      // A click on the backdrop lands on the dialog element itself.
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
      document.body.appendChild(dialog);
    }
    const clean = spec.points.filter((p) => p.value != null);
    const fmt = spec.valueFormat || ((v) => Math.round(v).toLocaleString());
    let summary = '';
    if (clean.length >= 2) {
      const first = clean[0], last = clean[clean.length - 1];
      const delta = last.value - first.value;
      const pct = first.value ? ` (${delta >= 0 ? '+' : ''}${((delta / first.value) * 100).toFixed(1)}%)` : '';
      const values = clean.map((p) => p.value);
      summary = `<div class="chart-dialog-stats">
        <span>${esc(first.label)} → ${esc(last.label)}: <b>${esc(fmt(first.value))} → ${esc(fmt(last.value))}</b>
          <span style="color:${delta >= 0 ? 'var(--sb-status-good-text)' : 'var(--sb-status-critical-text)'};">${delta >= 0 ? '+' : ''}${esc(fmt(delta))}${pct}</span></span>
        <span>Low <b>${esc(fmt(Math.min(...values)))}</b> · High <b>${esc(fmt(Math.max(...values)))}</b> · ${clean.length} snapshots</span>
      </div>`;
    }
    dialog.innerHTML = `<div class="card-head">
        <div><h3>${esc(spec.title)}</h3>${spec.subtitle ? `<span class="muted" style="font-size:12px;">${esc(spec.subtitle)}</span>` : ''}</div>
        <button type="button" class="enlarge-btn" data-close aria-label="Close">✕</button>
      </div>
      ${summary}
      <div class="plot">${lineChart(spec.points, { width: 960, height: 400, color: spec.color, valueFormat: fmt, detailed: true })}</div>`;
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.showModal();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-enlarge]');
    if (btn) openEnlarged(enlargeSpecs[Number(btn.dataset.enlarge)]);
  });

  return { lineChart, enlargeButton, barChart, divergingBarChart, dumbbellChart, stackedProbBar, groupedHBar, sparkline, pitchDiagram };
})();
