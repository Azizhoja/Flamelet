/*
 * The burn: one FLEX droplet, replayed or imagined. Ported from the earlier Twin prototype.
 *
 * As tested: the droplet shrinks along the d² law through NASA's two measured diameters and the test
 * ends the way NASA logged it. The flame around it is the Fire-X lite model fed with that measured
 * fuel supply; its radiation constant is fitted to this test's flame-out time (data/calibration.js).
 * What-if: the sliders move the model's air. The burning rate comes from a least-squares fit to the
 * FLEX table (data.flexFit) and the model decides if and when the flame goes out. A second, off-screen
 * solver runs ahead of the playback to find that outcome, so the readouts do not have to wait for it.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, FX = window.FireXLite, FR = window.FlameRender;
  var CAL = window.FLEX_CALIBRATION || { rows: {}, trends: {} };
  var KPA_PER_PSI = 6.894757;
  var qs = new URLSearchParams(location.search), QUALITY = qs.get('quality') || 'auto';
  // Solver grids by quality tier: 0.5 mm (converged within 3 % of 0.375 mm) and 0.75 mm for weak devices.
  var SIM_HI = { nr: 60, nz: 129, h: 0.5e-3 }, SIM_LO = { nr: 40, nz: 86, h: 0.75e-3 };
  var app = { test: null, plan: null, t: 0, playing: false, ended: null, endT: 0, fadeLeft: 0, catchUp: null, sim: null, ren: null, lit: false,
    modelOut: null, frags: null, perf: { n: 0, ms: 0, level: QUALITY === 'low' ? 1 : 0, skip: false, frame: 0 }, last: 0, raf: 0, ppm: 16, job: null, active: false };
  var canvas, viewport, hooks = {};

  function simGrid() { return app.perf.level >= 1 ? SIM_LO : SIM_HI; }
  function fuelKey(t) { return String(t.fuel || '').toLowerCase(); }
  function trendK(group, o2) {          // fitted radiation constant against oxygen for a fuel/diluent group
    var t = CAL.trends && CAL.trends[group];
    if (!t) return null;
    var x = Math.max(t.o2min, Math.min(t.o2max, o2 / 100));
    return Math.max(0.05, t.a + t.b * x);
  }
  /**
   * NASA's own numbers for a replay: the burning rate K (from the two diameters, else as recorded) and when the
   * burn ended (as recorded, else worked out by the d² law from K and the flame-out or zero diameter). Missing
   * pieces stay null; nothing here is a model value.
   */
  function measured(t) {
    var D0 = t.d0, K = null, tEnd = null, computed = false;
    if (t.dext > 0 && t.dext < D0 && t.burn > 0) K = (D0 * D0 - t.dext * t.dext) / t.burn;
    else if (t.rate > 0) K = t.rate;
    if (t.burn > 0) tEnd = t.burn;
    else if (K && t.end === 'Extinction' && t.dext > 0 && t.dext < D0) { tEnd = (D0 * D0 - t.dext * t.dext) / K; computed = true; }
    else if (K && t.end === 'Completion') { tEnd = D0 * D0 / K; computed = true; }
    return { K: K, tEnd: tEnd, computed: computed };
  }
  /** Can this test be replayed? It needs a starting diameter, a pressure, a fuel the model knows, and an end
   *  time NASA recorded or that follows from NASA's values (264F003 has neither burn time nor burning rate). */
  function canBurn(t) { return !!(t && t.inv === 'PSI-69' && t.d0 > 0 && t.psi != null && t.o2 != null && FX.FUELS[fuelKey(t)] && measured(t).tEnd != null); }
  /** Is this air inside what FLEX tested for the fuel, one slider at a time? */
  function inRange(t, c) {
    var r = S.flexRange(t.fuel);
    if (c.o2 < r.o2[0] - 0.01 || c.o2 > r.o2[1] + 0.01) return false;
    if (c.psi < r.psi[0] - 0.3 || c.psi > r.psi[1] + 0.3) return false;
    if (c.frac > 0 && c.dil !== 'N2' && c.frac > r[c.dil][1] + 0.01) return false;
    return true;
  }

  /** Everything a burn needs, from the row (as tested) or from the model (what-if). */
  function makePlan(t, wi) {
    var fuel = fuelKey(t), D0 = t.d0, tested = !wi, c = wi || S.condOf(t), x;
    if (tested) x = { o2: t.x.o2, n2: t.x.n2 || 0, co2: t.x.co2 || 0, he: t.x.he || 0 };
    else {
      var f = c.dil === 'N2' ? 0 : c.frac / 100;
      x = { o2: c.o2 / 100, n2: Math.max(0, 1 - c.o2 / 100 - f), co2: c.dil === 'CO2' ? f : 0, he: c.dil === 'He' ? f : 0 };
    }
    var plan = { tested: tested, cond: c, x: x, D0: D0, fuel: fuel, pKpa: Math.max(5, c.psi * KPA_PER_PSI), lit: tested || inRange(t, c) };
    var group = fuel + '/' + t.dil, cal = CAL.rows && CAL.rows[t.id + '@' + t.line];
    var kRow = cal && cal.k != null ? cal.k : (trendK(group, t.o2) || 1);
    if (tested) {
      // The burn always ends when and how NASA logged it. Only the shrink rate may be missing (256F007, 256F008,
      // 240R003): then it comes from the FLEX fit and the droplet's size is labelled a model value (kModel).
      var m = measured(t);
      plan.radK = kRow;
      plan.K = m.K != null ? m.K : Math.max(0.05, S.surrogateK(t.fuel, c, D0)); plan.kModel = m.K == null;
      plan.tEnd = m.tEnd; plan.tComputed = m.computed;
      plan.end = String(t.end || 'completion').toLowerCase(); plan.forced = true;
    } else {
      var dil = c.frac > 0 ? c.dil : 'N2', kNew = trendK(fuel + '/' + dil, c.o2), kOld = trendK(group, t.o2);
      plan.radK = kNew && kOld ? kRow * kNew / kOld : kRow;
      plan.K = Math.max(0.05, S.surrogateK(t.fuel, c, D0));
      plan.tEnd = D0 * D0 / plan.K; plan.end = 'completion'; plan.forced = false; plan.outcome = null;
    }
    return plan;
  }

  // ------------------------------------------------------------------ solver
  function simSettings() { var low = app.perf.level >= 1; return { dtMax: low ? 1 / 60 : 1 / 120, maxSub: low ? 1 : 4 }; }
  function simOpts(p, G, dtMax) { return Object.assign({ fuel: p.fuel, pKpa: p.pKpa, x: p.x, g: 0, radiation: p.radK, zDrop: G.nz * G.h * 0.5, dtMax: dtMax }, G); }
  function ensureSim() {
    var p = app.plan, s = simSettings(), G = simGrid();
    if (app.sim && app.sim.nr !== G.nr) { app.sim = null; app.ren = null; }
    if (!app.sim) app.sim = FX.createSim(simOpts(p, G, s.dtMax));
    else { app.sim.setConditions({ fuel: p.fuel, pKpa: p.pKpa, x: p.x, g: 0 }); app.sim.opts.radiation = p.radK; app.sim.opts.dtMax = s.dtMax; }
    if (app.ren) app.ren.setFuelColour(app.sim.mix.fuel.c2ch);
  }
  function dropletAt(t) {
    var p = app.plan;
    if (app.ended === 'disruption' || app.ended === 'completion') return 0;
    return Math.sqrt(Math.max(0, p.D0 * p.D0 - p.K * (app.ended ? app.endT : t)));
  }
  function resetBurn() {
    ensureSim();
    app.sim.reset(); app.sim.setReacting(true);
    app.t = 0; app.ended = null; app.fadeLeft = 0; app.lit = false; app.modelOut = null; app.frags = null;
    var D = app.plan.D0 * 1e-3;
    app.sim.setDroplet({ D: D, mdot: FX.massBurningRate(app.plan.fuel, D, app.plan.K * 1e-6), on: true });
    app.sim.ignite(1.5);
  }
  function endBurn(kind, t) {
    app.ended = kind; app.endT = t;
    var sim = app.sim, stays = kind === 'extinction' || kind === 'model' || kind === 'noignite';
    if (stays) sim.setReacting(false);
    sim.setDroplet({ on: false, mdot: 0, D: stays ? dropletAt(t) * 1e-3 : 0 });
    if (kind === 'disruption') {
      var D = Math.sqrt(Math.max(0, app.plan.D0 * app.plan.D0 - app.plan.K * t)), n = 9;
      app.frags = [];
      for (var i = 0; i < n; i++) {
        var a = (i / n) * 2 * Math.PI + 0.3 * Math.sin(i * 7.1);
        app.frags.push({ a0: a, r: D / 2 / Math.sqrt(n) * (0.7 + 0.6 * ((i * 37) % 10) / 10), v: 2.5 + (i % 3), age: 0 });
      }
    }
    app.fadeLeft = 2.0;   // keep the gas solver running while the hot gas cools and fades
  }
  /** End the burn if it has reached its end: NASA's (or the model's) end time, or the droplet is gone. */
  function checkEnd() {
    var p = app.plan;
    if (app.ended) return;
    if (p.forced && app.t >= p.tEnd - 1e-9) { app.t = p.tEnd; endBurn(p.end, p.tEnd); }
    else if (!p.forced && p.D0 * p.D0 - p.K * app.t <= 0) endBurn('completion', app.t);
  }
  /** Advance the burn by dt seconds of test time. Returns the time actually simulated. */
  function advance(dt, maxSub) {
    var p = app.plan, sim = app.sim;
    checkEnd();
    if (!app.ended) { var D = dropletAt(app.t) * 1e-3; sim.setDroplet({ D: D, mdot: FX.massBurningRate(p.fuel, D, p.K * 1e-6) }); }
    var done = sim.step(dt, maxSub);
    if (app.ended) app.fadeLeft -= done;
    else {
      app.t = Math.min(app.t + done, p.forced ? p.tEnd : Infinity);
      var d = sim.diagnostics(), power = sim.state.mdot * sim.mix.Q;
      if (d.hrrW > 0.2 * power) app.lit = true;
      if (app.modelOut == null && app.t > 0.3 && app.lit && d.hrrW < 0.05 * power) app.modelOut = app.t;
      checkEnd();   // a step that lands on the end applies it at once, so a paused seek to 100 % shows the ending
    }
    if (app.frags) for (var i = 0; i < app.frags.length; i++) app.frags[i].age += done;
    return done;
  }

  // ------------------------------------------------------------------ what-if outcome, found ahead of the playback
  function cancelOutcome() { app.job = null; }
  function startOutcome() {
    cancelOutcome();
    var p = app.plan;
    if (!p || p.tested || !p.lit) return;
    var G = SIM_LO, sim = FX.createSim(simOpts(p, G, 1 / 120));   // the grid and step the calibration used
    sim.reset(); sim.setReacting(true);
    sim.setDroplet({ D: p.D0 * 1e-3, mdot: FX.massBurningRate(p.fuel, p.D0 * 1e-3, p.K * 1e-6), on: true });
    sim.ignite(1.5);
    var job = app.job = { t: 0, lit: false };
    function finish(o) {
      if (app.job !== job) return;
      app.job = null;
      o.D = o.kind === 'completion' ? 0 : Math.sqrt(Math.max(0, p.D0 * p.D0 - p.K * o.t));
      o.fuelLeft = o.kind === 'model' ? Math.pow(o.D / p.D0, 3) * 100 : null;
      p.outcome = o; p.forced = true; p.tEnd = Math.max(0.2, o.t); p.end = o.kind;
      if (hooks.onOutcome) hooks.onOutcome(o);
      schedule();
    }
    (function slice() {
      if (app.job !== job) return;
      var start = performance.now();
      while (performance.now() - start < 8) {
        var D2 = p.D0 * p.D0 - p.K * job.t;
        if (D2 <= 0) { finish({ kind: 'completion', t: p.D0 * p.D0 / p.K }); return; }
        var D = Math.sqrt(D2) * 1e-3;
        sim.setDroplet({ D: D, mdot: FX.massBurningRate(p.fuel, D, p.K * 1e-6) });
        job.t += sim.step(1 / 120, 1);
        var d = sim.diagnostics(), power = sim.state.mdot * sim.mix.Q;
        if (d.hrrW > 0.2 * power) job.lit = true;
        if (job.t > 0.3 && job.lit && d.hrrW < 0.05 * power) { finish({ kind: 'model', t: job.t }); return; }
        if (job.t > 2.0 && !job.lit) { finish({ kind: 'noignite', t: 1.5 }); return; }
      }
      setTimeout(slice, 0);
    })();
  }

  // ------------------------------------------------------------------ rendering
  function fitScale() {
    var w = viewport.clientWidth || 754, h = viewport.clientHeight || 472;
    app.ppm = Math.max(6, Math.min(16, w / 34, h / 27));
  }
  function ensureRenderer() {
    fitScale();
    if (!app.sim) return;
    if (!app.ren) {
      var low = app.perf.level >= 1;
      app.ren = FR.create(canvas, app.sim, { gl: qs.get('gl') !== '0', supersample: low ? 1 : 3, bloom: low ? 0.35 : 0.45, dprCap: low ? 1 : 2,
        background: '#0a0908', dropFill: '#7f9fd6', dropEdge: '#cfc8ba' });
    }
    app.ren.resize();
    app.ren.setView({ widthMm: viewport.clientWidth / app.ppm, heightMm: viewport.clientHeight / app.ppm, dropFromTop: 0.46 });
  }
  function draw() {
    if (!app.ren) return;
    var frags = null;
    if (app.frags) frags = app.frags.map(function (f) { var d = f.v * f.age; return { x: Math.cos(f.a0) * d, y: Math.sin(f.a0) * d, r: f.r, a: Math.max(0, 1 - f.age / 1.2) }; });
    app.ren.render({ D: dropletAt(app.t) * 1e-3, D0: app.plan.D0 * 1e-3, fragments: frags });
  }
  function report() {
    if (!hooks.onFrame || !app.plan) return;
    var p = app.plan, d = app.sim ? app.sim.diagnostics() : null;
    var burning = d && d.Tflame > 1000 && d.rSheet > 0 && !app.ended;
    hooks.onFrame({ t: app.t, tEnd: p.tEnd, D: dropletAt(app.t), ended: app.ended, endT: app.endT, flameR: burning ? d.rSheet * 1e3 : 0,
      playing: app.playing, catching: !!app.catchUp, layout: app.ren ? app.ren.layout() : null, ppm: app.ppm, modelOut: app.modelOut, slow: app.perf.skip });
  }

  // ------------------------------------------------------------------ loop
  function frame(now) {
    app.raf = 0;
    if (!app.active || !app.plan || !app.plan.lit) return;
    var dtw = Math.min(0.05, Math.max(0, (now - (app.last || now)) / 1000)); app.last = now;
    var a = performance.now(), s = simSettings();
    if (app.catchUp) {
      var start = performance.now();
      while (app.t < app.catchUp.target - 1e-6 && performance.now() - start < 40) {
        advance(Math.min(1 / 30, app.catchUp.target - app.t), 1);
        if (app.ended) break;
      }
      if (app.t >= app.catchUp.target - 1e-6 || app.ended) { var resume = app.catchUp.resume; app.catchUp = null; app.playing = resume && !app.ended; }
    } else if (app.playing || (app.ended && app.fadeLeft > 0)) {
      if (app.perf.skip && (app.perf.frame++ & 1)) { /* weakest tier: simulate every other frame at twice the step */ }
      else advance(app.perf.skip ? 2 * dtw : dtw, s.maxSub);
      if (app.ended && app.fadeLeft <= 0) app.playing = false;
    }
    if (!app.catchUp) draw();   // while catching up to a scrubbed time, only the solver runs
    report();
    var ms = performance.now() - a;   // adaptive quality: the measured cost of solver and renderer on this device
    if (QUALITY === 'auto' && app.playing && !app.catchUp) {
      app.perf.n++; app.perf.ms += ms;
      if (app.perf.n >= 30) {
        var avg = app.perf.ms / app.perf.n; app.perf.n = 0; app.perf.ms = 0;
        if (avg > 12 && app.perf.level === 0) { app.perf.level = 1; var t = app.t; app.sim = null; app.ren = null; resetBurn(); ensureRenderer(); seek(t, true); }
        else if (avg > 20 && app.perf.level === 1) app.perf.skip = true;
      }
    }
    if (app.playing || app.catchUp || (app.ended && app.fadeLeft > 0)) schedule();
  }
  function schedule() { if (!app.raf && app.active) app.raf = requestAnimationFrame(frame); }

  // ------------------------------------------------------------------ actions
  function seek(t, resume) {
    if (!app.plan || !app.plan.lit) return;
    t = Math.max(0, Math.min(t, app.plan.tEnd));
    if (t < app.t || app.ended) resetBurn();
    app.catchUp = { target: t, resume: !!resume }; app.playing = false; app.last = 0; schedule();
  }
  function begin() {
    app.catchUp = null;   // a seek pending from the previous burn must not steer this one
    resetBurn(); ensureRenderer();
    if (C.reduced) { seek(Math.min(3, app.plan.tEnd * 0.5), false); return; }
    app.playing = true; app.last = 0; schedule();
  }

  C.burn = {
    init: function (cv, vp, h) { canvas = cv; viewport = vp; hooks = h || {}; },
    canBurn: canBurn, inRange: inRange,
    get plan() { return app.plan; }, get t() { return app.t; }, get playing() { return app.playing; }, get ended() { return app.ended; },
    /** Start a burn of this test, as tested or under what-if conditions. */
    load: function (t, wi) {
      app.test = t; app.active = true;
      return C.burn.retune(t, wi);
    },
    /**
     * The air changed: burn again from ignition in the new air. A what-if is one burn from ignition, and the
     * readouts, the scrubber and the outcome solver all describe that burn, so the playback restarts with it.
     * Keeping the old flame and switching the burning rate mid-burn would rewrite the droplet's past (the d² law
     * from D₀ with the new rate) and the forecast would describe a different burn from the one on screen.
     */
    retune: function (t, wi) {
      cancelOutcome();
      app.plan = makePlan(t, wi);
      if (!app.plan.lit) { app.playing = false; app.catchUp = null; report(); return app.plan; }
      begin(); startOutcome();
      return app.plan;
    },
    seek: seek,
    toggle: function () {
      if (!app.plan || !app.plan.lit) return;
      if (app.ended && app.fadeLeft <= 0) { begin(); return; }
      if (app.catchUp) { app.catchUp.resume = !app.catchUp.resume; return; }
      app.playing = !app.playing; app.last = 0; if (app.playing) schedule(); else report();
    },
    resize: function () { if (app.plan && app.plan.lit && app.sim) { ensureRenderer(); draw(); report(); } },
    leave: function () { app.active = false; app.playing = false; app.catchUp = null; cancelOutcome(); if (app.raf) { cancelAnimationFrame(app.raf); app.raf = 0; } },
    debug: app
  };
})();
