/*
 * Every counting and ranking rule of the site, in one file with no DOM, so the page and the
 * build check (site_build/verify.mjs) run the same code.
 *
 * Rules:
 *  - Point cabins (ISS, EVA prep, Spacesuit, Apollo 1): oxygen within 4 points, pressure within 20 %.
 *  - Moon base: oxygen 30 % or more, pressure up to 10.5 psi (FLEX ran its 0.7 atm tests at 10.3–10.5 psi).
 *  - Solids (BASS-II, Saffire-II) have no pressure column and count by oxygen alone.
 *  - Burner-oxygen (inverse) flames are never counted: their oxygen is in the burner flow, not around the flame.
 *  - Attempts NASA logged as never lighting (CFI-G: no hot ignition, no burn time, no cool flame noted) are
 *    counted for no cabin and left off the ladder. They stay in the tables, in a group of their own.
 *  - Ranking: most tests inside the cabin, then smallest oxygen gap of the nearest test, then smallest pressure gap.
 */
(function (root, factory) {
  var api = factory(root.CODEX_DATA || (typeof require === 'function' ? require('../data/codex-data.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Codex = root.Codex || {}; root.Codex.select = api;
})(typeof self !== 'undefined' ? self : globalThis, function (DATA) {
  'use strict';
  var O2_TOL = 4, P_TOL = 0.2, EPS = 1e-6;
  var TESTS = DATA.tests, CABINS = DATA.cabins, INVS = DATA.investigations;
  var cabinById = {}, invById = {}, testsByInv = {};
  CABINS.forEach(function (c) { cabinById[c.id] = c; });
  INVS.forEach(function (i) { invById[i.id] = i; testsByInv[i.id] = []; });
  TESTS.forEach(function (t, i) { t.i = i; testsByInv[t.inv].push(t); });

  var KIND_WORD = { gas: ['gas flame', 'gas flames'], droplet: ['droplet', 'droplets'], solid: ['solid', 'solids'], burner: ['burner-oxygen flame', 'burner-oxygen flames'] };
  function plural(n, kind) { return n + ' ' + KIND_WORD[kind][n === 1 ? 0 : 1]; }
  function fmt(v, d) { return v == null || !isFinite(v) ? '–' : v.toFixed(d == null ? 1 : d); }
  /** Oxygen as people read it: 34, 39.4 */
  function fo2(v) { return v == null ? '–' : (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1)); }

  // ------------------------------------------------------------------ ignition
  /**
   * Did a flame light? Only CFI-G records it (its "Hot ignition" column, burn time and comments); the other
   * tables list burns. 'none': no hot ignition, no burn time and no cool flame noted, so the attempt never lit
   * (NASA's comments say "No ignition", "Failed to ignite", "Aborted"). 'cool': no hot ignition, but NASA notes
   * a cool flame ("direct cool"). 'lit': everything else, including 21106 F4, logged "No" but burned for 22 s.
   */
  function flame(t) {
    if (!/^no$/i.test(String(t.hot || '').trim())) return 'lit';
    if (/direct cool/i.test(t.note || '')) return 'cool';
    return t.burn > 0 ? 'lit' : 'none';
  }
  function unlit(t) { return flame(t) === 'none'; }

  // ------------------------------------------------------------------ cabins
  /** How far a test is from a cabin. o2Out and pOut are distances outside the counting window (0 = inside). */
  function gap(t, c) {
    var g = { o2Out: Infinity, pOut: 0, dO2: null, dP: null, noP: false };
    if (t.o2 == null) return g;
    if (c.type === 'range') {
      g.dO2 = Math.min(0, t.o2 - c.o2);                         // negative = short of the bound
      g.o2Out = Math.max(0, c.o2 - t.o2);
      if (t.psi != null) { g.dP = Math.max(0, t.psi - c.psi); g.pOut = Math.max(0, t.psi - c.psiMax); }
    } else {
      g.dO2 = t.o2 - c.o2;
      g.o2Out = Math.max(0, Math.abs(g.dO2) - O2_TOL);
      if (t.psi != null && c.psi != null) { g.dP = t.psi - c.psi; g.pOut = Math.max(0, Math.abs(g.dP) - P_TOL * c.psi); }
    }
    if (t.psi == null && c.psi != null) { g.noP = true; if (t.kind !== 'solid') g.pOut = Infinity; }
    if (g.o2Out < EPS) g.o2Out = 0;
    if (g.pOut < EPS) g.pOut = 0;
    return g;
  }
  function inCabin(t, c) {
    if (t.kind === 'burner' || unlit(t)) return false;
    var g = gap(t, c);
    return g.o2Out === 0 && g.pOut === 0;
  }
  function gapOrder(a, b) { return a.o2Out - b.o2Out || a.pOut - b.pOut || Math.abs(a.dO2) - Math.abs(b.dO2) || Math.abs(a.dP || 0) - Math.abs(b.dP || 0); }

  /** "inside", "3.5 psi over", "7.8 points short" */
  function gapText(t, c) {
    var g = gap(t, c);
    if (t.o2 == null) return 'oxygen not recorded';
    if (g.o2Out === 0 && g.pOut === 0) return 'inside';
    if (g.o2Out > 0) return fmt(Math.abs(g.dO2), 1) + ' points ' + (g.dO2 < 0 ? 'short' : 'over');
    if (g.pOut === Infinity) return 'pressure not recorded';
    return fmt(Math.abs(g.dP), 1) + ' psi ' + (g.dP > 0 ? 'over' : 'under');
  }
  /** "40 % O₂ at 13.7 psi" */
  function condText(t) {
    return fo2(t.o2) + ' % O₂' + (t.psi != null ? ' at ' + fmt(t.psi, 1) + ' psi' : '');
  }
  /** Sentence for the test header when the test is outside the cabin. */
  function outsideText(t, c) {
    if (t.kind === 'burner') return 'Oxygen came from the burner: not counted for any cabin';
    if (unlit(t)) return 'Never lit · counted for no cabin';
    var g = gap(t, c);
    if (t.o2 == null || (g.o2Out === 0 && g.pOut === 0)) return '';
    if (g.o2Out > 0) { var n = Math.abs(g.dO2); return 'Outside ' + c.name + ': ' + fo2(n) + (n === 1 ? ' point' : ' points') + ' of oxygen ' + (g.dO2 < 0 ? 'below' : 'above'); }
    if (g.pOut === Infinity) return 'Outside ' + c.name + ': pressure not recorded';
    return 'Outside ' + c.name + ': ' + fmt(Math.abs(g.dP), 1) + ' psi ' + (g.dP > 0 ? 'above' : 'below');
  }

  var countCache = {};
  function counts(c) {
    if (countCache[c.id]) return countCache[c.id];
    var n = { gas: 0, droplet: 0, solid: 0, total: 0, tests: [] };
    TESTS.forEach(function (t) { if (inCabin(t, c)) { n[t.kind]++; n.total++; n.tests.push(t); } });
    return (countCache[c.id] = n);
  }

  // ------------------------------------------------------------------ ranking
  var rankCache = {};
  function rank(c) {
    if (rankCache[c.id]) return rankCache[c.id];
    var total = counts(c).total;
    var rows = INVS.filter(function (i) { return i.rowLevel; }).map(function (inv) {
      var ts = testsByInv[inv.id].filter(function (t) { return t.kind !== 'burner'; });
      var inside = ts.filter(function (t) { return inCabin(t, c); });
      var near = null, ng = null;
      ts.forEach(function (t) { if (t.o2 == null || unlit(t)) return; var g = gap(t, c); if (!near || gapOrder(g, ng) < 0) { near = t; ng = g; } });
      return { inv: inv, n: inside.length, of: ts.length, share: total ? inside.length / total : 0, near: near, gap: ng };
    });
    rows.sort(function (a, b) { return b.n - a.n || gapOrder(a.gap, b.gap) || a.inv.name.localeCompare(b.inv.name); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var rest = INVS.filter(function (i) { return !i.rowLevel; });
    return (rankCache[c.id] = { withTests: rows.filter(function (r) { return r.n > 0; }), without: rows.filter(function (r) { return r.n === 0; }), rest: rest });
  }

  /** Tests of one investigation, nearest to the cabin first, split into inside / outside / burner, plus
   *  noflame: attempts in the cabin's air that never lit. */
  function testsFor(invId, c) {
    var ts = testsByInv[invId] || [], inside = [], outside = [], burner = [], noflame = [];
    ts.forEach(function (t) {
      if (t.kind === 'burner') burner.push(t);
      else if (inCabin(t, c)) inside.push(t);
      else if (unlit(t) && t.o2 != null) { var g = gap(t, c); (g.o2Out === 0 && g.pOut === 0 ? noflame : outside).push(t); }
      else outside.push(t);
    });
    function cmp(a, b) { return gapOrder(gap(a, c), gap(b, c)) || (a.psi || 0) - (b.psi || 0) || a.line - b.line; }
    function cmpIn(a, b) { return (a.psi || 0) - (b.psi || 0) || a.line - b.line; }
    inside.sort(function (a, b) { return Math.round((a.psi || 0) * 10) - Math.round((b.psi || 0) * 10) || cmpIn(a, b); });
    outside.sort(cmp);
    burner.sort(function (a, b) { return a.line - b.line; });
    noflame.sort(cmpIn);
    return { inside: inside, outside: outside, burner: burner, noflame: noflame, counted: inside.length + outside.length + noflame.length };
  }

  // ------------------------------------------------------------------ ladder
  var LADDER = null;
  /** Flames per 2-point oxygen bin (10–100 %), by kind. Bin b covers [10 + 2b, 12 + 2b). Attempts that never lit are left out. */
  function ladder() {
    if (LADDER) return LADDER;
    var bins = [];
    for (var b = 0; b < 45; b++) bins.push({ lo: 10 + 2 * b, hi: 12 + 2 * b, gas: 0, droplet: 0, solid: 0, burner: 0 });
    var totals = { gas: 0, droplet: 0, solid: 0, burner: 0 }, max = { gas: 0, droplet: 0, solid: 0, burner: 0 };
    TESTS.forEach(function (t) {
      if (t.o2 == null || unlit(t)) return;
      var b = Math.min(44, Math.floor((t.o2 - 10 + EPS) / 2));
      if (b < 0) return;
      bins[b][t.kind]++; totals[t.kind]++; if (t.o2 > max[t.kind]) max[t.kind] = t.o2;
    });
    return (LADDER = { bins: bins, totals: totals, max: max });
  }
  function level(n) { return n <= 0 ? 0 : n < 10 ? 1 : n < 40 ? 2 : n < 100 ? 3 : 4; }
  /** Oxygen window of a cabin on the ladder, in percent. */
  function o2Window(c) { return c.type === 'range' ? [c.o2, 100] : [Math.max(10, c.o2 - O2_TOL), Math.min(100, c.o2 + O2_TOL)]; }
  function psiWindow(c) { return c.type === 'range' ? [0, c.psiMax] : c.psi == null ? null : [c.psi * (1 - P_TOL), c.psi * (1 + P_TOL)]; }

  // ------------------------------------------------------------------ words
  function listKinds(n) {
    var parts = [];
    if (n.gas) parts.push(plural(n.gas, 'gas'));
    if (n.droplet) parts.push(plural(n.droplet, 'droplet'));
    if (n.solid) parts.push(n.solid + (n.solid === 1 ? ' solid sample' : ' solid samples'));
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
  }
  function brief(c) {
    var n = counts(c), L = ladder();
    if (!n.total) return 'No test in PSI burned in this air. The nearest flame had ' + fo2(Math.max(L.max.gas, L.max.droplet, L.max.solid)) + ' % oxygen around it.';
    var s = n.total + (n.total === 1 ? ' test' : ' tests') + ' burned in this air: ' + listKinds(n) + '.';
    if (!n.solid) s += ' No solid material.';
    return s;
  }
  function findings(c) {
    var n = counts(c), L = ladder(), out = [];
    if (!n.total) {
      return [{ text: 'Nearest: ' + fo2(Math.max(L.max.gas, L.max.droplet)) + ' % oxygen in surrounding gas; ' + fo2(L.max.burner) + ' % from a burner.', chips: ['PSI-10', 'PSI-159'], lit: false }];
    }
    var gas = n.tests.filter(function (t) { return t.kind === 'gas'; }), drops = n.tests.filter(function (t) { return t.kind === 'droplet'; }), solids = n.tests.filter(function (t) { return t.kind === 'solid'; });
    function invs(ts) { var s = {}; ts.forEach(function (t) { s[t.inv] = 1; }); return Object.keys(s); }
    if (gas.length) {
      var se = gas.filter(function (t) { return t.end === 'Self-extinguished'; }).length, ft = gas.filter(function (t) { return t.end === 'Flow terminated'; }).length,
        cool = gas.filter(function (t) { return !t.end && flame(t) === 'cool'; }).length, none = gas.length - se - ft - cool;
      var s = se + ' of ' + plural(gas.length, 'gas') + ' went out on ' + (gas.length === 1 ? 'its' : 'their') + ' own.';
      var tail = [];
      if (ft) tail.push(ft + ' burned until the fuel was shut off');
      if (cool) tail.push(cool + ' burned only as ' + (cool === 1 ? 'a cool flame' : 'cool flames'));
      if (none) tail.push(none + (none === 1 ? ' has' : ' have') + ' no outcome recorded');
      if (tail.length) s += ' ' + tail.join('; ').replace(/^./, function (m) { return m.toUpperCase(); }) + '.';
      out.push({ text: s, chips: invs(gas), lit: true });
    }
    if (drops.length) {
      var ex = drops.filter(function (t) { return t.end === 'Extinction'; }).length, di = drops.filter(function (t) { return t.end === 'Disruption'; }).length,
        co = drops.filter(function (t) { return t.end === 'Completion'; }).length, no = drops.length - ex - di - co;
      var d = ex + ' of ' + plural(drops.length, 'droplet') + ' went out on ' + (drops.length === 1 ? 'its' : 'their') + ' own.';
      var t2 = [];
      if (di) t2.push(di + ' broke apart');
      if (co) t2.push(co + ' burned out');
      if (no) t2.push(no + (no === 1 ? ' has' : ' have') + ' no outcome recorded');
      if (t2.length) d += ' ' + t2.join(', ').replace(/^./, function (m) { return m.toUpperCase(); }) + '.';
      out.push({ text: d, chips: invs(drops), lit: true });
    }
    if (solids.length) {
      var lo = Math.min.apply(null, solids.map(function (t) { return t.o2; })), hi = Math.max.apply(null, solids.map(function (t) { return t.o2; }));
      out.push({ text: solids.length + ' solid samples burned at ' + fo2(lo) + '–' + fo2(hi) + ' % oxygen. Their pressure was not recorded.', chips: invs(solids), lit: true });
    } else {
      out.push({ text: 'No solid was burned above ' + fo2(L.max.solid) + ' % oxygen.', chips: ['PSI-25'], lit: false });
    }
    return out;
  }

  // ------------------------------------------------------------------ FLEX what-if helpers
  var FLEX = testsByInv['PSI-69'] || [];
  var PSI_PER_ATM = 14.6959;
  /** Ranges FLEX tested for one fuel: oxygen %, pressure psi, and each diluent's fraction %. */
  function flexRange(fuel) {
    var r = { o2: [Infinity, -Infinity], psi: [Infinity, -Infinity], CO2: [0, 0], He: [0, 0], N2: [0, 0], o2s: [], psis: [] };
    FLEX.forEach(function (t) {
      if (t.fuel !== fuel) return;
      if (t.o2 != null) { r.o2[0] = Math.min(r.o2[0], t.o2); r.o2[1] = Math.max(r.o2[1], t.o2); r.o2s.push(t.o2); }
      if (t.psi != null) { r.psi[0] = Math.min(r.psi[0], t.psi); r.psi[1] = Math.max(r.psi[1], t.psi); r.psis.push(t.psi); }
      if (t.dil !== 'N2') r[t.dil][1] = Math.max(r[t.dil][1], t.dilPct);
    });
    return r;
  }
  /** Stretches of a slider where FLEX has tests for this fuel: values merged when closer than `join`. */
  function testedSpans(values, join) {
    var v = values.slice().sort(function (a, b) { return a - b; }), spans = [];
    v.forEach(function (x) { var s = spans[spans.length - 1]; if (s && x - s[1] <= join) s[1] = x; else spans.push([x, x]); });
    return spans;
  }
  function surrogateK(fuel, cond, d0) {
    var b = DATA.flexFit.beta, x = [1, fuel === 'Heptane' ? 1 : 0, cond.o2 / 100, cond.dil === 'He' ? cond.frac / 100 : 0, cond.dil === 'CO2' ? cond.frac / 100 : 0, cond.psi / PSI_PER_ATM, d0];
    return x.reduce(function (s, v, i) { return s + v * b[i]; }, 0);
  }
  function condOf(t) { return { o2: t.o2, psi: t.psi, dil: t.dil, frac: t.dilPct || 0 }; }
  function sameCond(a, b) {
    return Math.abs(a.o2 - b.o2) <= 0.5 && Math.abs(a.psi - b.psi) <= 0.3 && Math.abs((a.frac || 0) - (b.frac || 0)) <= 1 && ((a.frac || 0) < 0.5 && (b.frac || 0) < 0.5 || a.dil === b.dil);
  }
  // Closest air first; among tests in the same air, the droplet nearest in size. A test with no recorded
  // starting diameter loses that tie.
  function sizeGap(t, d0) { return t.d0 > 0 ? Math.abs(t.d0 - d0) : 1e3; }
  function closest(list, airDist, d0) {
    var best = null, bd = Infinity, bs = Infinity;
    list.forEach(function (t) {
      var d = airDist(t), sg = sizeGap(t, d0);
      if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && sg < bs)) { bd = d; bs = sg; best = t; }
    });
    return best;
  }
  /** A measured FLEX test at these conditions, if there is one. */
  function measuredAt(cond, fuel, d0) {
    var list = FLEX.filter(function (t) { return t.fuel === fuel && t.psi != null && t.o2 != null && sameCond(cond, condOf(t)); });
    return closest(list, function (t) { return Math.abs(t.o2 - cond.o2) + Math.abs(t.psi - cond.psi) + Math.abs((t.dilPct || 0) - (cond.frac || 0)); }, d0);
  }
  /** Closest measured FLEX test with this fuel and diluent gas, and how it differs. One point of oxygen
   *  counts the same as one point of diluent; 2.2 psi (15 kPa) counts as five points. */
  function nearestMeasured(cond, fuel, d0) {
    var dil = (cond.frac || 0) < 0.5 ? 'N2' : cond.dil;
    var list = FLEX.filter(function (t) { return t.fuel === fuel && t.dil === dil && t.psi != null && t.o2 != null; });
    var best = closest(list, function (t) { return Math.hypot((t.o2 - cond.o2) / 5, (t.psi - cond.psi) / 2.2, ((t.dilPct || 0) - (cond.frac || 0)) / 5); }, d0);
    if (!best) return null;
    var diff = [], dO = best.o2 - cond.o2, dP = best.psi - cond.psi, dF = (best.dilPct || 0) - (cond.frac || 0), name = dil === 'CO2' ? 'CO₂' : dil === 'He' ? 'helium' : '';
    if (Math.abs(dO) >= 0.5) diff.push('oxygen ' + fo2(Math.abs(dO)) + (Math.abs(dO) === 1 ? ' point ' : ' points ') + (dO < 0 ? 'lower' : 'higher'));
    if (Math.abs(dF) >= 0.5 && name) diff.push(name + ' ' + fo2(Math.abs(dF)) + ' points ' + (dF < 0 ? 'lower' : 'higher'));
    if (Math.abs(dP) >= 0.35) diff.push(fmt(Math.abs(dP), 1) + ' psi ' + (dP < 0 ? 'lower' : 'higher'));
    return { test: best, diff: diff.length ? diff.join(' · ') : 'same air' };
  }

  return {
    DATA: DATA, tests: TESTS, cabins: CABINS, investigations: INVS, cabinById: cabinById, invById: invById, testsByInv: testsByInv,
    O2_TOL: O2_TOL, P_TOL: P_TOL, fmt: fmt, fo2: fo2, plural: plural,
    flame: flame, gap: gap, inCabin: inCabin, gapText: gapText, condText: condText, outsideText: outsideText, counts: counts, rank: rank, testsFor: testsFor,
    ladder: ladder, level: level, o2Window: o2Window, psiWindow: psiWindow, brief: brief, findings: findings,
    flexRange: flexRange, testedSpans: testedSpans, surrogateK: surrogateK, condOf: condOf, measuredAt: measuredAt, nearestMeasured: nearestMeasured,
    findTest: function (invId, key) {
      var ts = testsByInv[invId] || [];
      for (var i = 0; i < ts.length; i++) if (ts[i].k === key) return ts[i];
      for (var j = 0; j < ts.length; j++) if (ts[j].id === key) return ts[j];
      return null;
    }
  };
});
