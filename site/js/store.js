/*
 * App state: cabin, investigation, test and the what-if conditions. It lives in the URL hash, so every
 * view is a link:  #cabin=moon&inv=PSI-69&test=196F001&dil=CO2&frac=20
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, subs = [];
  var state = { cabin: 'moon', inv: null, test: null, wi: null };

  function normalise(s) {
    if (!S.cabinById[s.cabin]) s.cabin = 'moon';
    var inv = s.inv && S.invById[s.inv];
    if (!inv || !inv.rowLevel) { s.inv = null; s.test = null; }
    var t = s.inv && s.test ? S.findTest(s.inv, s.test) : null;
    s.test = t ? t.k : null;
    if (s.wi && !C.burn.canBurn(t)) s.wi = null;           // a what-if needs a test that can be replayed
    if (s.wi) {
      var w = s.wi, base = S.condOf(t);
      w.o2 = isFinite(w.o2) ? C.clamp(+w.o2, 10, 45) : base.o2;
      w.psi = isFinite(w.psi) ? C.clamp(+w.psi, 0, 45) : Math.round(base.psi * 10) / 10;
      w.dil = C.DIL[w.dil] ? w.dil : base.dil;
      w.frac = w.dil === 'N2' ? 0 : C.clamp(isFinite(w.frac) ? +w.frac : base.frac, 0, Math.min(50, 100 - w.o2));
      if (w.frac === 0) w.dil = 'N2';
      // back on the test's own air: no what-if
      if (Math.abs(w.o2 - base.o2) < 0.26 && Math.abs(w.psi - base.psi) < 0.06 && w.frac === base.frac && (w.frac === 0 || w.dil === base.dil)) s.wi = null;
    }
    return s;
  }
  function toHash(s) {
    var p = ['cabin=' + s.cabin];
    if (s.inv) p.push('inv=' + s.inv);
    if (s.test) p.push('test=' + encodeURIComponent(s.test));
    if (s.wi) p.push('o2=' + s.wi.o2, 'psi=' + s.wi.psi, 'dil=' + s.wi.dil, 'frac=' + s.wi.frac);
    return '#' + p.join('&');
  }
  function fromHash() {
    var q = new URLSearchParams(location.hash.replace(/^#/, '')), s = { cabin: q.get('cabin') || 'moon', inv: q.get('inv'), test: q.get('test'), wi: null };
    if (q.has('o2') || q.has('psi') || q.has('dil') || q.has('frac')) {
      s.wi = { o2: q.has('o2') ? +q.get('o2') : NaN, psi: q.has('psi') ? +q.get('psi') : NaN, dil: q.get('dil'), frac: q.has('frac') ? +q.get('frac') : NaN };
    }
    return normalise(s);
  }
  function notify(prev) { subs.forEach(function (f) { f(state, prev); }); }

  C.store = {
    get state() { return state; },
    on: function (f) { subs.push(f); },
    /** Patch the state. opts.replace: no new history entry (slider drags). Changing the test drops the what-if. */
    set: function (patch, opts) {
      var prev = state, wi;
      if ('wi' in patch) wi = patch.wi ? Object.assign({}, patch.wi) : null;
      else wi = ('test' in patch && patch.test !== state.test) || ('inv' in patch && patch.inv !== state.inv) ? null : state.wi;
      var next = normalise(Object.assign({}, state, patch, { wi: wi }));
      var h = toHash(next);
      if (h === toHash(prev)) return;
      state = next;
      try { history[opts && opts.replace ? 'replaceState' : 'pushState'](null, '', h); } catch (e) { /* some browsers on file:// */ }
      notify(prev);
    },
    init: function () {
      state = fromHash();
      window.addEventListener('popstate', function () { var prev = state; state = fromHash(); notify(prev); });
      notify(null);
    },
    cabin: function () { return S.cabinById[state.cabin]; },
    inv: function () { return state.inv ? S.invById[state.inv] : null; },
    test: function () { return state.test ? S.findTest(state.inv, state.test) : null; }
  };
})();
