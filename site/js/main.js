/* Wires the three columns to the store and to the page's events. */
(function () {
  'use strict';
  var C = window.Codex, $ = C.$;

  function render(state, prev) {
    C.cabins.render();
    C.ledger.render(state, prev);
    var t = C.store.test();
    $('view-cabin').hidden = !!t; $('view-test').hidden = !t;
    if (t) C.stageTest.render(state, prev);
    else { C.stageTest.leave(); C.stageCabin.render(state, prev); }
  }
  C.store.on(render);

  document.addEventListener('click', function (e) {
    if (C.ogonek.intercept(e)) return;                    // "Ask Ogonek" mode: the next click explains
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var s = C.store.state;
    switch (a.dataset.act) {
      case 'cabin': C.store.set({ cabin: a.dataset.id }); break;
      case 'inv': C.store.set({ inv: a.dataset.id, test: null }); break;
      case 'back': C.store.set({ inv: null, test: null }); break;
      case 'test': {
        var inv = a.dataset.inv || s.inv, k = a.dataset.k;
        C.store.set(s.inv === inv && s.test === k && !s.wi ? { test: null } : { inv: inv, test: k, wi: null });
        break;
      }
      case 'untest': C.store.set({ test: null }); break;
      case 'rest': C.ledger.toggleRest(); break;
    }
  });
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest('input[type=search], .popover input')) return;
    e.preventDefault(); C.ogonek.explain(e.target, e.clientX, e.clientY);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (C.ogonek.close()) return;
      if (document.activeElement && document.activeElement.id === 'search') return;
      var s = C.store.state;
      if (s.wi) C.store.set({ wi: null }); else if (s.test) C.store.set({ test: null }); else if (s.inv) C.store.set({ inv: null });
    }
    // Shift+F10 or the menu key: explain the focused element
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && document.activeElement && document.activeElement !== document.body) {
      e.preventDefault(); var r = document.activeElement.getBoundingClientRect(); C.ogonek.explain(document.activeElement, r.left + 12, r.top + r.height / 2);
    }
  });
  $('view-cabin').addEventListener('mousemove', C.stageCabin.tip);
  $('view-cabin').addEventListener('mouseleave', function () { $('tip').hidden = true; });

  var rz = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(function () {
      C.cabins.render();
      if (C.store.test()) C.stageTest.resize(); else C.stageCabin.render(C.store.state);
    });
  });

  C.cabins.renderDock(false);
  C.search.init();
  C.stageTest.init();
  C.ogonek.init();
  function start() { C.store.init(); }
  // lay out once the fonts are in, so text measurements and the ladder are right the first time
  if (document.fonts && document.fonts.ready) { var done = false, go = function () { if (!done) { done = true; start(); } }; document.fonts.ready.then(go); setTimeout(go, 600); }
  else start();
})();
