/*
 * Centre column, cabin view: the cabin's evidence as lights. Oxygen on x, pressure on y, one mark per
 * test. A mark is lit only if the test burned inside the chosen cabin's window. Marks that share a
 * position fan out sideways; a group of more than five carries its count.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$, esc = C.esc, fo2 = S.fo2, fmt = S.fmt;
  var VIEW = { moon: { x: [20, 45], y: [4, 18] }, suit: { x: [88, 100], y: [0, 10] }, apollo1: { x: [88, 100], y: [0, 18] }, eva: { x: [15, 40], y: [4, 18] }, iss: { x: [10, 32], y: [6, 20] } };
  var PAD = { l: 88, r: 24, t: 24, gutter: 24, b: 44 };
  var drawnKey = null;

  function shape(kind, lit) {
    if (kind === 'droplet') return '<circle class="f" r="' + (lit ? 4 : 3.5) + '"/>';
    if (kind === 'solid') return '<rect class="f" x="-5" y="-1.5" width="10" height="3" rx="1"/>';
    return '<circle class="s" r="' + (lit ? 4.5 : 3.75) + '"/>';
  }
  function deoverlap(blocks, lo, hi) {   // rigid blocks on one row: keep order, move each as little as possible
    blocks.sort(function (a, b) { return a.x - b.x; });
    var cl = [];
    blocks.forEach(function (b) {
      var c = { items: [b], w: b.w, sum: b.x - b.w / 2, left: b.x - b.w / 2 };
      cl.push(c);
      while (cl.length > 1) {
        var p = cl[cl.length - 2], q = cl[cl.length - 1];
        if (p.left + p.w <= q.left) break;
        q.items.forEach(function (it) { p.sum += it.x - it.w / 2 - p.w; p.w += it.w; p.items.push(it); });
        p.left = p.sum / p.items.length; cl.pop();
      }
    });
    cl.forEach(function (c) {
      var x = Math.max(lo, Math.min(hi - c.w, c.left));
      c.items.forEach(function (it) { it.cx = x + it.w / 2; x += it.w; });
    });
  }

  function plot(c, invSel) {
    var box = $('plot'), W = box.clientWidth, H = box.clientHeight, v = VIEW[c.id];
    if (!W || !H) return;
    var L = PAD.l, R = W - PAD.r, T = PAD.t, B = H - PAD.b - PAD.gutter, PW = R - L, PH = B - T;
    var X = function (o) { return L + (o - v.x[0]) / (v.x[1] - v.x[0]) * PW; }, Y = function (p) { return T + (v.y[1] - p) / (v.y[1] - v.y[0]) * PH; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tests in PSI by oxygen and pressure around ' + esc(c.name) + '">' +
      '<defs><radialGradient id="halo"><stop offset="0" stop-color="#4f93fa" stop-opacity=".42"/><stop offset=".55" stop-color="#4f93fa" stop-opacity=".12"/><stop offset="1" stop-color="#4f93fa" stop-opacity="0"/></radialGradient>' +
      '<clipPath id="clip"><rect x="' + L + '" y="' + (T - 12) + '" width="' + PW + '" height="' + (PH + 12) + '"/></clipPath></defs>' +
      '<rect class="frame" x="' + L + '" y="' + T + '" width="' + PW + '" height="' + PH + '" data-x="plot"/><g class="grid">';
    var xs = (v.x[1] - v.x[0]) <= 14 ? 2 : 5, ys = 2, t;
    for (t = Math.ceil(v.x[0] / xs) * xs; t <= v.x[1]; t += xs) {
      if (t > v.x[0] && t < v.x[1]) s += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + T + '" y2="' + B + '"/>';
      s += '<text class="tick" x="' + X(t) + '" y="' + (B + PAD.gutter + 17) + '" text-anchor="middle">' + t + '</text>';
    }
    for (t = Math.ceil(v.y[0] / ys) * ys; t <= v.y[1]; t += ys) {
      if (t > v.y[0] && t < v.y[1]) s += '<line x1="' + L + '" x2="' + R + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/>';
      s += '<text class="tick" x="' + (L - 12) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + t + '</text>';
    }
    s += '</g><text class="axis" x="' + (L + PW / 2) + '" y="' + (H - 6) + '" text-anchor="middle" data-x="plot">Oxygen in the air, %</text>' +
      '<text class="axis" transform="translate(' + (L - 44) + ' ' + (T + PH / 2) + ') rotate(-90)" text-anchor="middle" data-x="plot">Pressure, psi</text>';

    // the cabin's window
    var ow = S.o2Window(c), pw = S.psiWindow(c);
    var wx0 = Math.max(L, X(ow[0])), wx1 = c.type === 'range' ? R + 10 : Math.min(R, X(ow[1]));
    var wy0 = pw ? Math.max(T, Y(pw[1])) : T, wy1 = pw ? Math.min(B, Y(pw[0])) : B;
    var wl = c.type === 'range' ? c.name + ' · counted up to ' + c.psiMax + ' psi' : c.name + ' · ' + fo2(c.o2) + ' % oxygen, ' + (c.psi == null ? 'pressure not stated' : c.psi + ' psi');
    s += '<rect class="window" data-x="window" x="' + wx0 + '" y="' + wy0 + '" width="' + (wx1 - wx0) + '" height="' + (wy1 - wy0) + '"/>' +
      '<text class="win" x="' + Math.min(R, wx1) + '" y="' + (wy0 > T + 20 ? wy0 - 10 : wy0 + 18) + '" text-anchor="end" data-x="window"' + (wy0 > T + 20 ? '' : ' dx="-8"') + '>' + esc(wl) + '</text>';

    // group the tests
    var groups = {}, gut = {}, off = { right: { n: 0, burner: 0, max: 0 }, left: 0, above: 0, below: 0 };
    S.tests.forEach(function (t) {
      if (t.o2 == null) return;
      if (t.o2 > v.x[1] + 0.25) { if (t.kind === 'burner') { off.right.burner++; off.right.max = Math.max(off.right.max, t.o2); } else off.right.n++; return; }
      if (t.o2 < v.x[0] - 0.25) { off.left++; return; }
      var lit = S.inCabin(t, c);
      if (t.psi == null) { var gk = Math.round(t.o2) + '|' + lit; (gut[gk] = gut[gk] || { o2: 0, lit: lit, tests: [] }).tests.push(t); return; }
      if (t.psi > v.y[1]) { off.above++; return; }
      if (t.psi < v.y[0]) { off.below++; return; }
      var row = Math.round(t.psi), k = t.kind + '|' + lit + '|' + t.inv + '|' + Math.round(t.o2) + '|' + row;
      (groups[k] = groups[k] || { kind: t.kind, lit: lit, inv: t.inv, row: row, tests: [] }).tests.push(t);
    });
    var rows = {}, list = Object.keys(groups).map(function (k) { return groups[k]; });
    list.forEach(function (g) {
      var n = g.tests.length; g.m = Math.min(n, g.lit ? 10 : 4); g.step = g.lit ? 7.5 : 4.5;
      g.o2 = g.tests.reduce(function (a, t) { return a + t.o2; }, 0) / n; g.psi = g.tests.reduce(function (a, t) { return a + t.psi; }, 0) / n;
      g.x = X(g.o2); g.y = Y(g.psi); g.w = (g.m - 1) * g.step + (g.lit ? 12 : 11);
      if (n > 5) g.w = Math.max(g.w, String(n).length * 8 + 6);
      (rows[g.row] = rows[g.row] || []).push(g);
    });
    Object.keys(rows).forEach(function (r) { deoverlap(rows[r], L + 4, R - 4); });

    var marks = '', halos = '', labels = '', extent = {};
    list.sort(function (a, b) { return (a.lit ? 1 : 0) - (b.lit ? 1 : 0); }).forEach(function (g) {
      var n = g.tests.length, x0 = g.cx - (g.m - 1) * g.step / 2, cls = 'mark ' + g.kind + (g.lit ? ' lit' : '');
      for (var i = 0; i < g.m; i++) {
        var t = g.tests[i];
        marks += '<g class="' + cls + '" transform="translate(' + (x0 + i * g.step).toFixed(1) + ' ' + g.y.toFixed(1) + ')" data-act="test" data-inv="' + t.inv + '" data-k="' + esc(t.k) + '" data-x="test:' + t.inv + ':' + esc(t.k) + '">' +
          '<circle class="hit" r="12"/>' + shape(g.kind, g.lit) + '</g>';
      }
      if (n > 5) labels += '<text class="count' + (g.lit ? ' lit' : '') + '" x="' + g.cx.toFixed(1) + '" y="' + (g.lit ? g.y + 20 : g.y - 9).toFixed(1) + '" text-anchor="middle" data-act="inv" data-id="' + g.inv + '" data-x="count-label">' + n + '</text>';
      if (g.lit) {
        var e = extent[g.inv] = extent[g.inv] || { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0, kind: g.kind, counted: false };
        e.x0 = Math.min(e.x0, x0 - 6); e.x1 = Math.max(e.x1, x0 + (g.m - 1) * g.step + 6); e.y0 = Math.min(e.y0, g.y); e.y1 = Math.max(e.y1, g.y); e.n += n; e.counted = e.counted || n > 5;
        if (invSel === g.inv) halos += '<ellipse class="halo" cx="' + g.cx.toFixed(1) + '" cy="' + g.y.toFixed(1) + '" rx="' + (g.w / 2 + 46).toFixed(0) + '" ry="58"/>';
      }
    });
    // label each lit investigation where it collides with nothing already placed: right, below, above, left
    var taken = list.filter(function (g) { return g.lit; }).map(function (g) { return { x0: g.cx - g.w / 2 - 2, x1: g.cx + g.w / 2 + 2, y0: g.y - 8, y1: g.y + (g.tests.length > 5 ? 24 : 8) }; });
    Object.keys(extent).sort(function (a, b) { return extent[b].n - extent[a].n; }).forEach(function (id) {
      var e = extent[id], text = S.invById[id].name + ' · ' + S.plural(e.n, e.kind), tw = text.length * 6.6, mid = (e.x0 + e.x1) / 2, below = e.y1 + (e.counted ? 26 : 12);
      var cands = [{ x: e.x1 + 10, y: e.y0 + 4 }, { x: e.x0, y: below + 12 }, { x: mid - tw / 2, y: below + 12 }, { x: e.x0, y: e.y0 - 14 }, { x: mid - tw / 2, y: e.y0 - 14 }, { x: e.x0 - tw - 10, y: e.y0 + 4 }];
      [28, 44, 60, 76, 92].forEach(function (dy) { [e.x0, mid - tw / 2, e.x1 - tw].forEach(function (x) { cands.push({ x: x, y: below + dy }, { x: x, y: e.y0 - dy }); }); });
      // first free spot; if none is free, the spot that overlaps the least
      var pick = null, best = Infinity, bestBox = null;
      cands.forEach(function (c) {
        var x = Math.max(L + 4, Math.min(R - tw - 4, c.x)), bx = { x0: x, x1: x + tw, y0: c.y - 12, y1: c.y + 4 };
        if (bx.y0 < T + 2 || bx.y1 > B - 2) return;
        var o = taken.reduce(function (a, r) { return a + Math.max(0, Math.min(bx.x1, r.x1) - Math.max(bx.x0, r.x0)) * Math.max(0, Math.min(bx.y1, r.y1) - Math.max(bx.y0, r.y0)); }, 0);
        if (o < best - 1e-6) { best = o; pick = { x: x, y: c.y }; bestBox = bx; }
      });
      pick = pick || { x: Math.max(L + 4, Math.min(R - tw - 4, e.x0)), y: below + 12 };
      if (bestBox) taken.push(bestBox);
      labels += '<text class="lab" x="' + pick.x.toFixed(1) + '" y="' + pick.y.toFixed(1) + '" data-act="inv" data-id="' + id + '" data-x="inv:' + id + '" style="cursor:pointer">' + esc(text) + '</text>';
    });

    // no recorded pressure: placed by oxygen only, under the plot
    var g0 = B, gutter = '<rect class="gutter" x="' + L + '" y="' + g0 + '" width="' + PW + '" height="' + PAD.gutter + '" data-x="gutter"/>';
    var gkeys = Object.keys(gut);
    gkeys.forEach(function (k) {
      var g = gut[k], n = g.tests.length, o2 = g.tests.reduce(function (a, t) { return a + t.o2; }, 0) / n, x = X(o2), t = g.tests[0];
      gutter += '<g class="mark ' + t.kind + (g.lit ? ' lit' : '') + '" transform="translate(' + x.toFixed(1) + ' ' + (g0 + 19) + ')" data-act="test" data-inv="' + t.inv + '" data-k="' + esc(t.k) + '" data-x="gutter"><rect class="hit" x="-12" y="-19" width="24" height="24"/>' + shape(t.kind, g.lit) + '</g>' +
        '<text class="count' + (g.lit ? ' lit' : '') + '" x="' + x.toFixed(1) + '" y="' + (g0 + 12) + '" text-anchor="middle" data-x="gutter">' + n + '</text>';
    });
    if (gkeys.length) gutter += '<text class="note" x="' + (R - 8) + '" y="' + (g0 + 16) + '" text-anchor="end" data-x="gutter">pressure not recorded</text>';

    // what the frame leaves out
    var notes = '';
    if (off.right.burner) notes += '<text class="note" x="' + (R - 12) + '" y="' + (B - 10) + '" text-anchor="end" data-x="legend:burner">' + off.right.burner + ' more burner-oxygen flames beyond ' + v.x[1] + ' %, up to ' + fo2(off.right.max) + ' % →</text>';
    if (off.above) notes += '<text class="note" x="' + (L + 10) + '" y="' + (T + 16) + '" data-x="plot">↑ ' + off.above + ' tests above ' + v.y[1] + ' psi</text>';
    if (off.left) notes += '<text class="note" x="' + (L + 10) + '" y="' + (B - 10) + '" data-x="plot">← ' + off.left + ' tests below ' + v.x[0] + ' % oxygen</text>';
    if (!S.counts(c).total) notes += '<text class="empty" x="' + (L + PW / 2) + '" y="' + (T + PH * 0.24) + '" text-anchor="middle">No flame in PSI was lit in this air.</text>';

    box.innerHTML = s + gutter + '<g clip-path="url(#clip)">' + halos + marks + '</g>' + labels + notes + '</svg>';
  }

  function consoleHtml(c) {
    var n = S.counts(c);
    function num(v, kind, word) {
      return '<div class="num' + (v ? '' : ' unlit') + '" data-x="count:' + kind + '">' +
        (v ? '<span class="t-numeral">' + v + '</span>' : '<span class="t-numeral"><span class="zero">0</span></span>') +
        '<div class="cap">' + C.glyph(kind, v ? 'lit' : 'dim') + word + '</div>' + (v ? (kind === 'solid' ? '<div class="sub">pressure not recorded</div>' : '') : '<div class="sub">no test in PSI</div>') + '</div>';
    }
    var counted = !n.total && c.type === 'point' ? 'Counted: oxygen ± ' + S.O2_TOL + ' points' + (c.psi == null ? '.' : ', pressure ± ' + S.P_TOL * 100 + ' %.')
      : c.type === 'range' ? 'Counted: oxygen ' + c.o2 + ' % or more, pressure up to ' + c.psiMax + ' psi. FLEX ran its 0.7 atm tests at 10.3–10.5 psi.'
      : 'Counted: oxygen ' + (c.o2 - S.O2_TOL) + '–' + (c.o2 + S.O2_TOL) + ' %, pressure ' + fmt(c.psi * (1 - S.P_TOL), 1) + '–' + fmt(c.psi * (1 + S.P_TOL), 1) + ' psi.' + (n.solid ? ' Solids by oxygen alone.' : '');
    return '<div><div class="nums">' + num(n.gas, 'gas', 'gas flames') + num(n.droplet, 'droplet', 'droplets') + num(n.solid, 'solid', 'solids') + '</div>' +
      '<p class="counted" data-x="window">' + esc(counted) + '</p></div>' +
      '<div><h3>What they found</h3>' + S.findings(c).map(function (f, i) {
        return '<div class="finding' + (f.lit ? '' : ' unlit') + '" data-x="finding:' + i + '"><p class="t-body">' + esc(f.text) + '</p><div class="chips">' + f.chips.map(function (id) { return C.chip(id); }).join('') + '</div></div>';
      }).join('') + '</div>';
  }

  function render(state, prev) {
    var c = C.store.cabin(), inv = C.store.inv(), key = state.cabin + '|' + (state.inv || '');
    var view = $('view-cabin'), n = S.counts(c);
    if (key !== drawnKey || !view.firstChild) {
      view.innerHTML = '<header class="stage-head"><span class="over t-micro">Stage · cabin' + (inv ? ' · ' + esc(inv.name) : '') + '</span>' +
        '<div class="line"><span class="t-title' + (n.total ? '' : ' unlit') + '" data-x="cabin:' + c.id + '">' + esc(c.name) + '</span><span class="chip" data-x="cabin:' + c.id + '">' + esc(c.def) + '</span></div></header>' +
        '<div class="stage-body"><div class="plot" id="plot"></div>' +
        '<div class="legend"><span data-x="legend:gas">' + C.glyph('gas') + 'gas flame</span><span data-x="legend:droplet">' + C.glyph('droplet') + 'droplet</span><span data-x="legend:solid">' + C.glyph('solid') + 'solid</span>' +
        '<span data-x="legend:burner">' + C.glyph('burner') + 'burner oxygen, not counted</span><span class="key" data-x="legend:lit">Lit: burned in this cabin’s air · Dim: outside it</span></div></div>' +
        '<div class="console">' + consoleHtml(c) + '</div>';
      drawnKey = key;
      if (prev && prev.cabin !== state.cabin && !C.reduced) { view.classList.remove('relight'); void view.offsetWidth; view.classList.add('relight'); }
    }
    plot(c, state.inv);
  }

  // hover: which test is this mark
  function tip(e) {
    var m = e.target.closest && e.target.closest('.mark'), el = $('tip');
    if (!m || !m.dataset.k) { el.hidden = true; return; }
    var t = S.findTest(m.dataset.inv, m.dataset.k);
    if (!t) { el.hidden = true; return; }
    el.innerHTML = '<b>' + esc(t.id) + '</b>' + esc(S.invById[t.inv].name) + ' · ' + esc(t.fuel || C.KIND_VIEW[t.kind]) + ' <span>· ' + fo2(t.o2) + ' % O₂' + (t.psi == null ? ' · pressure not recorded' : ' · ' + fmt(t.psi, 1) + ' psi') + (t.kind === 'burner' ? ' · oxygen from the burner' : '') + (S.flame(t) === 'none' ? ' · never lit' : '') + '</span>';
    el.hidden = false;
    var w = el.offsetWidth; el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX + 14)) + 'px'; el.style.top = (e.clientY - 38) + 'px';
  }

  C.stageCabin = { render: render, invalidate: function () { drawnKey = null; }, tip: tip };
})();
