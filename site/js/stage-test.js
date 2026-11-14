/*
 * Centre column, test view: one test at true scale. FLEX droplets burn in the Fire-X lite model,
 * with NASA's recorded values as readouts and three sliders for what-if. Every other kind of test
 * opens with NASA's recorded values and an unlit flame: there is no gas-flame or solid model yet.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$, esc = C.esc, fmt = S.fmt, fo2 = S.fo2;
  var cur = { key: null, wiKey: null, burnable: false }, ov = {}, lastFrame = null, dragging = null;
  var END_GLOSS = { Disruption: 'the droplet broke apart', Extinction: 'the flame went out', Completion: 'the droplet burned away' };
  var CABIN_TICKS = { o2: [['ISS', 21], ['Moon', 30]], psi: [['suit', 4.3], ['Moon', 10.2], ['ISS', 14.7]] };
  var PLAY = '<svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg>', PAUSE = '<svg viewBox="0 0 10 10"><path d="M2 1h2v8H2zM6 1h2v8H6z"/></svg>';

  function wiKey(w) { return w ? [w.o2, w.psi, w.dil, w.frac].join('|') : ''; }
  function condText(c) {
    return fo2(c.o2) + ' % oxygen · ' + (c.frac > 0 ? fo2(c.frac) + ' % ' + C.DIL[c.dil] : 'no CO₂ or helium') + ' · ' + fmt(c.psi, 1) + ' psi';
  }

  // ------------------------------------------------------------------ header
  function header(t, wi) {
    var inv = S.invById[t.inv], c = C.store.cabin(), aside;
    var over = 'Stage · ' + esc(inv.name) + ' · ' + C.KIND_VIEW[t.kind];
    var title = wi ? 'What-if · ' + esc(t.fuel) : esc(t.id) + (t.fuel ? ' · ' + esc(t.fuel.length > 22 ? t.fuel.slice(0, 21) + '…' : t.fuel) : '');
    if (wi) aside = '<span class="aside" data-x="whatif">' + esc(condText(wi)) + '</span>';
    else { var o = S.outsideText(t, c); aside = o ? '<span class="aside" data-x="outside">' + esc(o) + '</span>' : '<span class="aside c-accent" data-x="outside">Inside ' + esc(c.name) + '</span>'; }
    $('test-head').innerHTML = '<span class="over t-micro">' + over + '</span><div class="line"><span class="t-title" data-x="' + (wi ? 'whatif' : 'test:' + t.inv + ':' + esc(t.k)) + '">' + title + '</span>' +
      (wi ? C.badge('model') : C.chip(t.inv, t)) + aside + '</div>';
  }

  // ------------------------------------------------------------------ viewport overlays
  function buildOverlays(t, plan) {
    var tested = !plan || plan.tested, lit = plan && plan.lit;
    var h = '<div class="ov scale-note" id="ov-scale" data-x="truescale"></div>';
    if (lit) {
      h += '<div class="ov ring" id="ov-r5"></div><div class="ov ring" id="ov-r10"></div>' +
        '<div class="ov ring-lab" id="ov-r5l">5 mm</div><div class="ov ring-lab" id="ov-r10l">10 mm</div>' +
        '<div class="ov start-lab" id="ov-start" data-x="readout:d0">start ' + fmt(t.d0, 2) + ' mm</div><div class="ov leader" id="ov-lead"></div>' +
        (tested && t.dext > 0 && t.end === 'Extinction' ? '<div class="ov out-lab" id="ov-out" data-x="readout:dext">flame out at ' + fmt(t.dext, 2) + ' mm</div>' : '<div class="ov out-lab" id="ov-out" data-x="readout:dext" hidden></div>') +
        '<div class="ov flame-lab" id="ov-flame" data-x="flame" hidden><span id="ov-flame-t"></span>' + C.badge('model') + '</div>' +
        '<div class="ov scalebar" id="ov-bar" data-x="truescale"><i id="ov-bar-i"></i>2 mm</div>' +
        '<div class="ov status" id="ov-status" aria-live="polite"></div>' +
        '<div class="ov caption" data-x="flame">Droplet size: ' + (tested && !plan.kModel ? 'measured' : tested ? '≈ model (no burning rate recorded)' : '≈ model') + ' · Flame size: ≈ model</div>';
    } else {
      var why;
      if (t.inv !== 'PSI-69') why = { gas: 'No flame model for gas flames on this site yet.', burner: 'No flame model for burner-oxygen flames on this site yet.', solid: 'No flame model for solid samples on this site yet.', droplet: 'No flame model for cool flames on this site yet.' }[t.kind];
      else if (plan && !plan.lit) why = 'Outside the air FLEX tested for ' + t.fuel.toLowerCase() + '.';
      else if (t.psi == null) why = 'NASA logged this test at ' + esc(t.pSrc || 'no pressure') + ', so it cannot be replayed.';
      else if (!(t.d0 > 0)) why = 'NASA logged no starting droplet size, so it cannot be replayed.';
      else why = 'NASA logged neither a burn time nor a burning rate, so when it ended is unknown and it cannot be replayed.';
      var small = plan && !plan.lit ? '∅ outside tested range: move a slider back toward the solid part of its track' : 'The values below are NASA’s.';
      h += '<div class="ov unlit-flame" data-x="unlit"></div><div class="ov unlit-note" data-x="unlit">' + esc(why) + '<small>' + esc(small) + '</small></div>';
    }
    $('overlays').innerHTML = h;
    ['scale', 'r5', 'r10', 'r5l', 'r10l', 'start', 'lead', 'out', 'flame', 'flame-t', 'bar', 'bar-i', 'status'].forEach(function (k) { ov[k] = $('ov-' + k); });
  }
  function clearCanvas() {
    var cv = $('flame'), ctx = cv.getContext('2d');
    var r = cv.getBoundingClientRect(); cv.width = Math.max(1, Math.round(r.width)); cv.height = Math.max(1, Math.round(r.height));
    if (ctx) { ctx.fillStyle = '#0a0908'; ctx.fillRect(0, 0, cv.width, cv.height); }
  }
  function place(el, x, y) { if (el) { el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px'; } }
  function onFrame(f) {
    lastFrame = f;
    var plan = C.burn.plan, t = C.store.test();
    if (!plan || !t) return;
    // scrubber
    var frac = plan.tEnd > 0 ? Math.min(1, f.t / plan.tEnd) : 0, sc = $('scrub');
    if (!dragging) sc.value = Math.round(frac * 1000);
    sc.style.setProperty('--p', (frac * 100).toFixed(1) + '%');
    $('t-label').textContent = 't = ' + fmt(f.t, 1) + ' s';
    var playing = f.playing || (f.catching && C.burn.debug.catchUp && C.burn.debug.catchUp.resume);
    $('play').innerHTML = playing ? PAUSE : PLAY; $('play').setAttribute('aria-label', playing ? 'Pause' : (f.ended ? 'Burn again' : 'Play'));
    // overlays
    var lay = f.layout;
    if (!lay || !ov.r5) return;
    var ppm = lay.pxPerMm, cx = lay.cx, cy = lay.cy;
    ov.scale.textContent = 'True scale · 1 mm = ' + Math.round(ppm) + ' px';
    [[ov.r5, 5], [ov.r10, 10]].forEach(function (a) { place(a[0], cx, cy); a[0].style.width = a[0].style.height = (2 * a[1] * ppm).toFixed(1) + 'px'; });
    place(ov.r5l, cx + 5 * ppm * 0.80 + 4, cy + 5 * ppm * 0.60 - 2);
    place(ov.r10l, cx + 10 * ppm * 0.80 + 4, cy + 10 * ppm * 0.60 - 2);
    var r0 = plan.D0 / 2 * ppm;
    place(ov.start, cx, cy - r0 - 54); place(ov.lead, cx, cy - r0 - 36); ov.lead.style.height = '32px';
    if (ov.out) {
      if (!plan.tested && plan.outcome && plan.outcome.kind === 'model' && f.ended) { ov.out.hidden = false; ov.out.textContent = '≈ flame out at ' + fmt(plan.outcome.D, 2) + ' mm'; }
      else if (!plan.tested) ov.out.hidden = true;
      place(ov.out, cx, cy + r0 + 14);
    }
    if (f.flameR > 0) {
      ov.flame.hidden = false; ov['flame-t'].textContent = 'Flame Ø ' + fmt(2 * f.flameR, 1) + ' mm';
      var R = f.flameR * ppm;
      place(ov.flame, Math.min(cx + R * 0.72 + 12, $('viewport').clientWidth - 190), Math.max(36, cy - R * 0.72 - 34));
    } else if (f.ended) ov.flame.hidden = true;
    ov['bar-i'].style.width = (2 * ppm).toFixed(1) + 'px';
    // status
    var st = '', p = plan;
    if (f.catching) st = 'Catching up to t = ' + fmt(C.burn.debug.catchUp ? C.burn.debug.catchUp.target : f.t, 1) + ' s…';
    else if (f.ended === 'extinction') st = 'Flame out at ' + fmt(p.tEnd, 1) + ' s, ' + (p.tComputed ? 'ƒ by the d² law' : 'as NASA logged it') + '. Fuel is still there.';
    else if (f.ended === 'disruption') st = 'The droplet broke apart at ' + fmt(p.tEnd, 1) + ' s while burning, as NASA logged it.';
    else if (f.ended === 'completion') st = p.tested ? 'Burned to the end, as NASA logged it.' : '≈ model: the droplet burns away.';
    else if (f.ended === 'model') st = '≈ model: the flame goes out at ' + fmt(p.tEnd, 1) + ' s with fuel left.';
    else if (f.ended === 'noignite') st = '≈ model: the flame does not light in this air.';
    else if (f.slow) st = 'Slowed to fit this device.';
    ov.status.textContent = st;
  }
  function endText(p) {
    if (!p.lit) return '∅ outside tested range';
    if (p.tested) return (p.end || 'completion') + ' at ' + fmt(p.tEnd, p.tEnd < 2 ? 2 : 1) + ' s' + (p.tComputed ? ' · ƒ computed' : '');
    if (!p.outcome) return '≈ model: finding the outcome…';
    return { completion: '≈ model: the droplet burns away at ', model: '≈ model: flame out at ', noignite: '≈ model: no flame by ' }[p.outcome.kind] + fmt(p.tEnd, 1) + ' s';
  }
  function scrubTicks(p) {
    var h = '';
    if (p && p.lit) { var step = p.tEnd > 12 ? 2 : p.tEnd > 5 ? 1 : 0.5; for (var s = step; s < p.tEnd - step * 0.3; s += step) h += '<i style="left:' + (s / p.tEnd * 100).toFixed(2) + '%"></i>'; }
    $('scrub-ticks').innerHTML = h;
    $('t-end').textContent = p ? endText(p) : '';
  }

  // ------------------------------------------------------------------ readouts
  function readout(key, value, unit, label, gloss, opts) {
    opts = opts || {};
    return '<div class="readout" data-x="readout:' + key + '"' + (opts.act ? ' data-act="explain" style="cursor:help"' : '') + '><div class="v' + (opts.cls ? ' ' + opts.cls : '') + '">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="k">' + label + '</div><div class="g">' + (opts.badge ? C.badge(opts.badge) : '') + (gloss || '') + '</div></div>';
  }
  function numHtml(v, d, big) { return '<span class="' + (big ? 't-title' : 't-numeral') + '">' + v + '</span>'; }
  function readoutsTested(t) {
    var burn = t.burn != null ? (/~/.test(t.burnRaw) ? '~' : '') + fmt(t.burn, t.burn < 2 && t.burn % 1 ? 2 : 1) : '–';
    var left = t.fuelLeft != null
      ? readout('left', numHtml(fmt(t.fuelLeft, 1)), '%', 'Fuel left at flame-out', '', { badge: 'computed', act: true })
      : readout('left', numHtml('–'), '', 'Fuel left at flame-out', t.end === 'Extinction' ? '∅ no flame-out diameter recorded' : 'no flame-out', { cls: 'none', act: true });
    return readout('burn', numHtml(burn), t.burn != null ? 's' : '', 'Burn time', t.burn == null ? '∅ not recorded' : '') +
      readout('rate', numHtml(t.rate != null ? fmt(t.rate, 2) : '–'), t.rate != null ? 'mm²/s' : '', 'Burning rate', t.rate == null ? '∅ not recorded' : '') +
      readout('end', numHtml(esc(t.end || '–'), 0, true), '', 'Ended by', esc(END_GLOSS[t.end] || '')) + left;
  }
  function readoutsModel(p) {
    if (!p.lit) {
      var no = '∅ outside tested range';
      return readout('burn', numHtml('∅'), '', 'Burn time', no, { cls: 'none' }) + readout('rate', numHtml('∅'), '', 'Burning rate', no, { cls: 'none' }) +
        readout('end', numHtml('∅', 0, true), '', 'Ended by', no, { cls: 'none' }) + readout('left', numHtml('∅'), '', 'Fuel left at flame-out', no, { cls: 'none', act: true });
    }
    var o = p.outcome, wait = '…';
    var endWord = !o ? wait : { completion: 'Burns away', model: 'Flame out', noignite: 'No flame' }[o.kind];
    var endGloss = !o ? 'the model is running ahead' : { completion: 'in the model the droplet burns to the end', model: 'in the model the flame goes out', noignite: 'in the model the flame does not light' }[o.kind];
    return readout('burn', numHtml(o ? fmt(o.t, 1) : wait), o ? 's' : '', 'Burn time', '', { badge: 'model', cls: 'approx' }) +
      readout('rate', numHtml(fmt(p.K, 2)), 'mm²/s', 'Burning rate', '', { badge: 'model', cls: 'approx' }) +
      readout('end', numHtml(endWord, 0, true), '', 'Ended by', endGloss, { badge: 'model', cls: 'approx' }) +
      (o && o.kind === 'model'
        ? readout('left', numHtml(fmt(o.fuelLeft, 1)), '%', 'Fuel left at flame-out', '', { badge: 'model', cls: 'approx', act: true })
        : readout('left', numHtml(o ? '–' : wait), '', 'Fuel left at flame-out', o ? 'no flame-out in the model' : '', { cls: 'approx', act: true }));
  }

  // ------------------------------------------------------------------ sliders
  function track(spans, min, max) {
    var segs = spans.map(function (s) {
      var a = (Math.max(min, s[0] - 0.4 * (max - min) / 100) - min) / (max - min) * 100, b = (Math.min(max, s[1] + 0.4 * (max - min) / 100) - min) / (max - min) * 100;
      return 'transparent ' + a.toFixed(2) + '%, var(--bone-400) ' + a.toFixed(2) + '% ' + b.toFixed(2) + '%, transparent ' + b.toFixed(2) + '%';
    });
    return 'linear-gradient(90deg, transparent 0%, ' + (segs.length ? segs.join(', ') + ', ' : '') + 'transparent 100%), repeating-linear-gradient(90deg, var(--char-500) 0 3px, transparent 3px 6px)';
  }
  function marks(list, min, max) {
    return list.map(function (m) { return '<span style="left:' + ((m[1] - min) / (max - min) * 100).toFixed(2) + '%">' + m[0] + '</span>'; }).join('');
  }
  function slidersHtml(t) {
    return '<div class="slider" data-x="slider:o2"><div class="lab">Oxygen<span class="val" id="v-o2"></span></div><div class="wrap"><input type="range" id="s-o2" min="10" max="45" step="0.5" aria-label="Oxygen, percent"></div><div class="marks">' + marks(CABIN_TICKS.o2, 10, 45) + '</div></div>' +
      '<div class="slider" data-x="slider:psi"><div class="lab">Pressure<span class="val" id="v-psi"></span></div><div class="wrap"><input type="range" id="s-psi" min="0" max="45" step="0.1" aria-label="Pressure, psi"></div><div class="marks">' + marks(CABIN_TICKS.psi, 0, 45) + '</div></div>' +
      '<div class="slider dil" data-x="slider:dil"><div class="lab">Diluent<span class="seg" role="group" aria-label="Diluent">' +
      ['N2', 'CO2', 'He'].map(function (d) { return '<button type="button" data-dil="' + d + '">' + C.DIL[d] + '</button>'; }).join('') +
      '</span><span class="val" id="v-frac"></span></div><div class="wrap"><input type="range" id="s-frac" min="0" max="50" step="1" aria-label="Diluent fraction, percent"></div></div>' +
      '<p class="fine" id="dil-note" data-x="slider:dil"></p><p class="fine" data-x="gravity">0 g. PSI has no partial-gravity test.<button type="button" class="reset" id="reset" hidden></button></p>';
  }
  function syncSliders(t, wi) {
    var c = wi || S.condOf(t), r = S.flexRange(t.fuel);
    var o = $('s-o2'), p = $('s-psi'), f = $('s-frac');
    if (!o) return;
    if (dragging !== o) o.value = c.o2;
    if (dragging !== p) p.value = Math.round(c.psi * 10) / 10;
    if (dragging !== f) f.value = c.frac || 0;
    f.disabled = c.dil === 'N2';
    $('v-o2').textContent = fo2(c.o2) + ' %'; $('v-psi').textContent = fmt(c.psi, 1) + ' psi'; $('v-frac').textContent = fo2(c.frac || 0) + ' %';
    o.style.setProperty('--track', track(S.testedSpans(r.o2s, 1.01), 10, 45));
    p.style.setProperty('--track', track(S.testedSpans(r.psis, 0.6), 0, 45));
    var dil = c.dil === 'N2' ? 'CO2' : c.dil, fr = S.tests.filter(function (x) { return x.inv === 'PSI-69' && x.fuel === t.fuel && x.dil === dil; }).map(function (x) { return x.dilPct; });
    f.style.setProperty('--track', c.dil === 'N2' ? 'var(--char-600)' : track(S.testedSpans(fr, 5.01), 0, 50));
    document.querySelectorAll('[data-dil]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.dil === c.dil)); });
    // which oxygen NASA used with this diluent at this pressure
    var same = S.tests.filter(function (x) { return x.inv === 'PSI-69' && x.fuel === t.fuel && x.dil === dil && x.psi != null && Math.abs(x.psi - c.psi) < 0.6; });
    var lo = Math.min.apply(null, same.map(function (x) { return x.o2; })), hi = Math.max.apply(null, same.map(function (x) { return x.o2; }));
    $('dil-note').textContent = same.length ? 'NASA’s ' + C.DIL[dil] + ' tests at this pressure used ' + fo2(lo) + (hi > lo ? '–' + fo2(hi) : '') + ' % oxygen.' : 'FLEX has no ' + C.DIL[dil] + ' test with ' + t.fuel.toLowerCase() + ' at this pressure.';
    var rs = $('reset'); rs.hidden = !wi; rs.textContent = 'Back to ' + t.id; rs.dataset.act = 'test'; rs.dataset.inv = t.inv; rs.dataset.k = t.k;
  }
  function readCond(t) {
    var base = C.store.state.wi || S.condOf(t), dil = base.dil;
    var o2 = +$('s-o2').value, psi = +$('s-psi').value, frac = dil === 'N2' ? 0 : +$('s-frac').value;
    return { o2: o2, psi: psi, dil: dil, frac: Math.min(frac, 100 - o2) };
  }
  function bindSliders(t) {
    ['s-o2', 's-psi', 's-frac'].forEach(function (id) {
      var el = $(id);
      el.addEventListener('pointerdown', function () { dragging = el; });
      el.addEventListener('input', function () { C.store.set({ wi: readCond(t) }, { replace: true }); });
      el.addEventListener('change', function () { dragging = null; snap(t); });
      el.addEventListener('blur', function () { dragging = null; });
    });
    document.querySelectorAll('[data-dil]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = readCond(t), d = b.dataset.dil, base = S.condOf(t);
        c.dil = d; c.frac = d === 'N2' ? 0 : (base.dil === d ? base.frac : (c.frac > 0 ? c.frac : 20));
        C.store.set({ wi: c }); snap(t);
      });
    });
  }
  /** Landing on air NASA tested loads that test: the badge goes and the readouts are measured again. */
  function snap(t) {
    var w = C.store.state.wi;
    if (!w) return;
    var m = S.measuredAt(w, t.fuel, t.d0);
    if (m && C.burn.canBurn(m)) C.store.set({ inv: m.inv, test: m.k, wi: null });
  }

  // ------------------------------------------------------------------ strip
  function strip(t, wi) {
    var el = $('strip');
    if (!wi) { el.hidden = true; return; }
    var near = S.nearestMeasured(wi, t.fuel, t.d0), base = S.condOf(t);
    var from = fo2(base.o2) + ' % oxygen · ' + (base.frac > 0 ? fo2(base.frac) + ' % ' + C.DIL[base.dil] : 'no ' + (wi.frac > 0 ? C.DIL[wi.dil] : 'CO₂ or helium'));
    var h = '<span>Started from</span><button type="button" data-act="test" data-inv="' + t.inv + '" data-k="' + esc(t.k) + '" data-x="strip:start"><b>' + esc(t.id) + '</b><span>' + esc(from) + '</span></button>';
    if (near && near.test.k !== t.k) {
      h += '<i class="sep"></i><span>Nearest measured</span><button type="button" data-act="test" data-inv="' + near.test.inv + '" data-k="' + esc(near.test.k) + '" data-x="strip:near"><b>' + esc(near.test.id) + '</b><span>' + esc(near.diff) + '</span></button>';
    }
    el.innerHTML = h; el.hidden = false;
  }

  // ------------------------------------------------------------------ facts for tests without a model
  var row = function (k, v, cls) { return v == null || v === '' ? '' : '<dt>' + k + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</dd>'; };
  var u = function (v, d, unit) { return v == null ? null : fmt(v, d) + (unit ? ' ' + unit : ''); };
  function facts(t) {
    var psi = t.psi != null ? fmt(t.psi, 1) + ' psi' + (t.pSrc ? ' · ' + esc(t.pSrc) : '') : (t.kind === 'solid' ? '∅ not recorded' : esc(t.pNote || '∅ not recorded'));
    var o2 = fo2(t.o2) + ' %' + (t.o2After != null ? ' → ' + fo2(t.o2After) + ' %' : '');
    var h = row('Fuel', esc(t.fuel || '–'), 'text');
    if (t.kind === 'burner') h += row('O₂ in burner flow', o2) + row('Fuel in chamber', t.xf != null ? fo2(t.xf * 100) + ' %' : null);
    else h += row(t.kind === 'solid' ? 'O₂ at start → end' : 'Oxygen', o2);
    h += row('Pressure', psi);
    if (t.inv === 'PSI-69') h += row('Diluent', C.DIL[t.dil] + (t.dilPct ? ' ' + fo2(t.dilPct) + ' %' : '')) + row('Start diameter', t.d0 != null ? fmt(t.d0, 2) + ' mm' : '∅ not recorded') + row('Burn time', t.burnRaw ? esc(t.burnRaw) + ' s' : null) + row('Ended by', esc(t.end));
    if (t.inv === 'PSI-39') h += row('Helium', t.dilPct ? fo2(t.dilPct) + ' %' : '0 %') + row('Fiber', esc(t.fiber || '–')) + row('Run', esc(t.cir)) + row('Date', esc(t.date));
    if (t.inv === 'PSI-159') h += row('Flame temp.', u(t.tad, 0, 'K')) + row('Zst', u(t.zst, 3)) + row('Hot ignition', esc(t.hot)) + row('Burn time', t.burn != null ? t.burn + ' s' : null) + row('Outcome', esc(t.end || { none: 'No flame: it never lit', cool: 'Cool flame only, no hot ignition' }[S.flame(t)] || (t.endRaw && t.endRaw !== '-' ? t.endRaw : '∅ not recorded')), 'text') + row('Colour', esc(t.colour)) + row('Comment', esc(t.note || t.cool), 'text');
    if (t.inv === 'PSI-10') h += row('Fuel fraction', t.xfuel != null ? fo2(t.xfuel * 100) + ' %' : (t.ramped ? 'ramped' : null)) + row('Flame temp.', t.tad != null ? fmt(t.tad, 0) + ' K' : (t.ramped ? 'ramped' : null)) + row('Zst', u(t.zst, 3));
    if (t.inv === 'PSI-25') h += row('CO₂ start → end', t.co2 != null ? fmt(t.co2, 2) + (t.co2After != null ? ' → ' + fmt(t.co2After, 2) : '') + ' %' : null) + row('CO start → end', t.co != null ? t.co + (t.coAfter != null ? ' → ' + t.coAfter : '') + ' ppm' : null) + row('Sample', esc(t.sample)) + row('Date', esc(t.date));
    if (t.inv === 'PSI-99') h += row('Thickness', esc(t.thick)) + row('Air flow', esc(t.flow)) + row('Flow direction', esc(t.dir)) + row('Burn time', esc(t.burnRaw)) +
      row('Burned in 0 g', esc(t.ugLen)) + row('Spread in 0 g', esc(t.ugRate)) + row('Burned on Earth', esc(t.g1Len), 'earthv') + row('Spread on Earth', esc(t.g1Rate), 'earthv');
    return '<dl class="facts" data-x="test:' + t.inv + ':' + esc(t.k) + '">' + h + '</dl>';
  }
  function about(t) {
    var s = {
      'PSI-159': t.kind === 'burner' ? 'An inverse flame: oxygen flows out of the porous sphere into a chamber of fuel and nitrogen. Its oxygen is not the air a crew breathes, so it counts for no cabin.' : 'A gas flame on a porous sphere: fuel flows out into the surrounding air. CFI-G looked for the point where a hot flame turns into a cool one.',
      'PSI-10': t.kind === 'burner' ? 'An inverse flame: oxygen flows out of the sphere into ethylene and nitrogen. It counts for no cabin.' : 'A spherical gas flame. Flame Design measured what makes a flame sooty and when it goes out.',
      'PSI-39': 'A dodecane droplet burned for its cool flame. CFI’s table lists the conditions only; outcomes are in the per-test files.',
      'PSI-25': 'A solid sample burned in a fan-driven flow. BASS-II lowered the oxygen during the run; the table gives it at start and end. Pressure was not recorded.',
      'PSI-99': 'A material sample burned in an uncrewed Cygnus cargo ship, beside the same test on Earth. Pressure was not recorded.',
      'PSI-69': 'A FLEX droplet that cannot be replayed: the table is missing a value the model needs. NASA’s values are shown as recorded.'
    }[t.inv];
    if (S.flame(t) === 'none') s += ' NASA logged no ignition for this run, so it counts for no cabin and is not on the ladder.';
    return '<h3>What this test is</h3><div class="finding"><p class="t-body">' + esc(s) + '</p></div>' +
      '<div class="finding unlit"><p class="t-body">' + C.badge('nodata') + ' ' + (t.inv === 'PSI-69' ? 'No replay for this row.' : 'No flame model for this kind of flame yet, so it stays unlit.') + '</p><div class="chips">' + C.chip(t.inv, t) + '</div></div>';
  }

  // ------------------------------------------------------------------ render
  function render(state) {
    var t = C.store.test(), wi = state.wi, key = state.inv + '|' + state.test, wk = wiKey(wi);
    if (!t) return;
    var burnable = C.burn.canBurn(t);
    if (key !== cur.key) {
      cur.key = key; cur.wiKey = wk; cur.burnable = burnable; lastFrame = null;
      header(t, wi);
      if (burnable) {
        $('scrub-box').hidden = false;
        $('test-console').innerHTML = '<div class="readouts" id="readouts"></div><div class="sliders">' + slidersHtml(t) + '</div>';
        bindSliders(t);
        var plan = C.burn.load(t, wi);
        buildOverlays(t, plan); if (!plan.lit) clearCanvas();
        $('readouts').innerHTML = plan.tested ? readoutsTested(t) : readoutsModel(plan);
        syncSliders(t, wi); strip(t, wi); scrubTicks(plan);
      } else {
        C.burn.leave(); clearCanvas();
        $('scrub-box').hidden = true; $('strip').hidden = true;
        buildOverlays(t, null);
        $('test-console').innerHTML = '<div>' + facts(t) + '</div><div>' + about(t) + '</div>';
      }
      return;
    }
    header(t, wi);
    if (wk !== cur.wiKey && burnable) {
      cur.wiKey = wk;
      var was = C.burn.plan, p = C.burn.retune(t, wi);
      // the overlays carry the lit/unlit view and the measured/model labels: rebuild when either changes
      if (!was || p.lit !== was.lit || p.tested !== was.tested || p.kModel !== was.kModel || !$('ov-r5') !== !p.lit) { buildOverlays(t, p); if (!p.lit) clearCanvas(); }
      $('readouts').innerHTML = p.tested ? readoutsTested(t) : readoutsModel(p);
      syncSliders(t, wi); strip(t, wi); scrubTicks(p);
    }
  }

  C.stageTest = {
    init: function () {
      C.burn.init($('flame'), $('viewport'), {
        onFrame: onFrame,
        onOutcome: function () { var p = C.burn.plan; if (p && !p.tested && $('readouts')) { $('readouts').innerHTML = readoutsModel(p); scrubTicks(p); } }
      });
      var sc = $('scrub'), was = false;
      sc.addEventListener('pointerdown', function () { dragging = sc; was = C.burn.playing; });
      sc.addEventListener('input', function () { var p = C.burn.plan; if (p) C.burn.seek(sc.value / 1000 * p.tEnd, false); });
      sc.addEventListener('change', function () { dragging = null; var p = C.burn.plan; if (p && was) C.burn.seek(sc.value / 1000 * p.tEnd, true); });
      $('play').addEventListener('click', function () { C.burn.toggle(); });
    },
    render: render,
    leave: function () { if (cur.key) { C.burn.leave(); cur.key = null; cur.wiKey = null; } },
    resize: function () { if (cur.burnable) C.burn.resize(); else clearCanvas(); },
    seekTo: function (s) { C.burn.seek(s, false); },
    frame: function () { return lastFrame; }
  };
})();
