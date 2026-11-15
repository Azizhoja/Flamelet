/* Search: cabins, investigations and tests by name or id. Ctrl K / ⌘K from anywhere. */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$, esc = C.esc;
  var items = [], sel = 0;

  function results(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var out = [];
    S.cabins.forEach(function (c) { if (c.name.toLowerCase().indexOf(q) >= 0) out.push({ label: c.name, note: 'cabin · ' + c.def, go: { cabin: c.id, inv: null, test: null } }); });
    S.investigations.forEach(function (i) {
      if ((i.name + ' ' + i.id + ' ' + i.title).toLowerCase().indexOf(q) >= 0)
        out.push({ label: i.name.length > 30 ? i.name.slice(0, 29) + '…' : i.name, note: i.id + (i.rowLevel ? '' : ' · not ranked'), go: i.rowLevel ? { inv: i.id, test: null } : null, x: 'inv:' + i.id });
    });
    var n = 0;
    for (var k = 0; k < S.tests.length && n < 40; k++) {
      var t = S.tests[k];
      if (String(t.id).toLowerCase().indexOf(q) === 0) { out.push({ label: t.id, note: S.invById[t.inv].name + ' · ' + (t.fuel || C.KIND_VIEW[t.kind]) + ' · ' + S.fo2(t.o2) + ' % O₂', go: { inv: t.inv, test: t.k } }); n++; }
    }
    return out.slice(0, 40);
  }
  function draw() {
    var box = $('search-list'), inp = $('search');
    if (!inp.value.trim()) { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
    box.innerHTML = items.length ? items.map(function (it, i) {
      return '<button type="button" role="option" data-i="' + i + '" aria-selected="' + (i === sel) + '"' + (it.x ? ' data-x="' + it.x + '"' : '') + '><span class="t-body">' + esc(it.label) + '</span><span class="t-micro">' + esc(it.note) + '</span></button>';
    }).join('') : '<div class="none t-micro">Nothing in PSI matches.</div>';
    box.hidden = false; inp.setAttribute('aria-expanded', 'true');
  }
  function choose(i) {
    var it = items[i]; if (!it) return;
    $('search').value = ''; items = []; draw(); $('search').blur();
    if (it.go) C.store.set(it.go);
    else { var b = $('search').getBoundingClientRect(); C.flamey.explain({ closest: function () { return { dataset: { x: it.x } }; } }, b.left, b.bottom + 8); }
  }

  C.search = {
    init: function () {
      var inp = $('search'), mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
      $('search-kbd').textContent = mac ? '⌘K' : 'Ctrl K';
      inp.addEventListener('input', function () { items = results(inp.value); sel = 0; draw(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
        else if (e.key === 'Escape') { inp.value = ''; items = []; draw(); inp.blur(); }
      });
      inp.addEventListener('blur', function () { setTimeout(function () { $('search-list').hidden = true; }, 150); });
      inp.addEventListener('focus', function () { if (inp.value) draw(); });
      $('search-list').addEventListener('mousedown', function (e) { var b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); choose(+b.dataset.i); } });
      document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inp.focus(); inp.select(); } });
    }
  };
})();
