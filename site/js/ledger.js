/*
 * Left column. Level 1: the investigations ranked for the chosen cabin. Level 2: the tests of one
 * investigation, nearest to the cabin first. The cabin is the only filter.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$, esc = C.esc, fmt = S.fmt, fo2 = S.fo2;
  var drawn = null, restOpen = false;

  // ------------------------------------------------------------------ level 1
  function level1(c) {
    var R = S.rank(c), n = S.counts(c);
    $('brief').innerHTML = '<span class="over t-micro">Ranked for</span>' +
      '<div class="line"><span class="t-numeral-s' + (n.total ? '' : ' unlit') + '" data-x="cabin:' + c.id + '">' + esc(c.name) + '</span>' + C.cabinChip(c) + '</div>' +
      '<p class="t-body" data-x="brief">' + esc(S.brief(c)) + '</p>';
    $('thead').innerHTML = '<span class="c-rank" data-x="col:rank">#</span><span class="c-inv" data-x="col:inv">Investigation</span><span class="c-glyph" data-x="col:fuelkind">Fuel</span>' +
      '<span class="c-count" data-x="col:incabin">In this cabin</span><span class="c-near" data-x="col:near">Nearest test</span>';
    var h = '';
    function row(r) {
      var lit = r.n > 0, near = lit
        ? '<span class="bar" title="' + Math.round(r.share * 100) + ' % of this cabin’s tests"><i style="width:' + Math.max(4, Math.round(r.share * 56)) + 'px"></i></span><span class="c-accent">inside</span>'
        : '<span class="two"><b>' + esc(S.condText(r.near)) + '</b><span>' + esc(S.gapText(r.near, c)) + '</span></span>';
      return '<button type="button" class="row' + (lit ? '' : ' unlit') + '" data-act="inv" data-id="' + r.inv.id + '" data-x="rank:' + r.inv.id + '">' +
        '<span class="c-rank">' + r.rank + '</span><span class="c-inv t-body">' + esc(r.inv.name) + '<span class="psi">' + r.inv.id + '</span></span>' +
        '<span class="c-glyph">' + C.glyph(r.inv.kind, lit ? 'lit' : 'dim') + '</span>' +
        '<span class="c-count">' + r.n + ' of ' + r.of + '</span><span class="c-near">' + near + '</span></button>';
    }
    if (R.withTests.length) h += '<div class="group">With tests here</div>' + R.withTests.map(row).join('');
    if (R.without.length) h += '<div class="group">Closest without a test here</div>' + R.without.map(row).join('');
    h += '<div class="group" data-x="rest">Atmosphere not in a row-level table</div>' +
      '<button type="button" class="row rest" data-act="rest" data-x="rest" aria-expanded="' + restOpen + '"><span class="c-rank"></span><span class="t-body">' + R.rest.length + ' investigations</span><span class="chev">›</span></button>';
    if (restOpen) h += R.rest.map(function (i) {
      return '<div class="restrow" data-x="inv:' + i.id + '"><b>' + esc(i.name.length > 34 ? i.name.slice(0, 33) + '…' : i.name) + '</b><span class="psi">' + i.id + '</span><span class="why">' + esc(i.area || '') + '</span></div>';
    }).join('');
    $('rows').innerHTML = h;
    $('foot').innerHTML = '<span data-x="rankrule"><b>' + S.investigations.length + ' investigations</b>Most tests here first, then smallest gap</span><span data-x="badge:computed"><i>ƒ</i> = computed from NASA values</span>';
  }

  // ------------------------------------------------------------------ level 2
  var num = function (v, d) { return v == null ? '–' : fmt(v, d); };
  var COLS = {
    'PSI-69': [
      { h: 'Test', c: 'c-test', x: 'id', v: function (t) { return esc(t.id); } },
      { h: 'Fuel', c: 'c-fuel', x: 'fuel', v: function (t) { return esc(t.fuel); } },
      { h: 'O₂ %', c: 'c-num', x: 'o2', v: function (t) { return fo2(t.o2); } },
      { h: 'psi', c: 'c-num w', x: 'psi', v: function (t) { return t.psi == null ? '∅' : fmt(t.psi, 1); } },
      { h: 'Diluent', c: 'c-dil', x: 'dil', v: function (t) { return C.DIL[t.dil]; } },
      { h: 'End', c: 'c-end', x: 'end', v: function (t) { return esc(t.end || '–'); } },
      { h: '<i style="font-family:var(--serif)">ƒ</i> Fuel left %', c: 'c-left', x: 'left', v: function (t) {
        return t.fuelLeft == null ? '–' : '<span class="bar"><i style="width:' + (56 * t.fuelLeft / 100).toFixed(1) + 'px"></i></span>' + fmt(t.fuelLeft, 1);
      } }
    ],
    'PSI-39': [
      { h: 'Test', c: 'c-test', x: 'id', v: function (t) { return esc(t.id); } },
      { h: 'Fuel', c: 'c-wide', x: 'fuel', v: function (t) { return esc(t.fuel); } },
      { h: 'O₂ %', c: 'c-num', x: 'o2', v: function (t) { return fo2(t.o2); } },
      { h: 'psi', c: 'c-num w', x: 'psi', v: function (t) { return num(t.psi, 1); } },
      { h: 'Diluent', c: 'c-dil', x: 'dil', v: function (t) { return C.DIL[t.dil]; } },
      { h: 'Fiber', c: 'c-num w', x: 'fiber', v: function (t) { return esc(t.fiber || '–'); } }
    ],
    'PSI-159': [
      { h: 'Test', c: 'c-test', x: 'id', v: function (t) { return esc(t.id); } },
      { h: 'Fuel', c: 'c-fuel', x: 'fuel', s: 'width:88px', v: function (t) { return esc(t.fuel); } },
      { h: 'O₂ %', c: 'c-num w', x: 'o2', v: function (t) { return fo2(t.o2); } },
      { h: 'psi', c: 'c-num w', x: 'psi', v: function (t) { return num(t.psi, 1); } },
      { h: 'End', c: 'c-end', x: 'end', s: 'padding-left:14px', v: function (t) { var f = S.flame(t); return esc(t.end || (f === 'none' ? 'no flame' : f === 'cool' ? 'cool flame' : '–')); } },
      { h: 'Burn, s', c: 'c-num w', x: 'burn', s: 'width:52px', v: function (t) { return t.burn == null ? '–' : String(t.burn); } }
    ],
    'PSI-10': [
      { h: 'Test', c: 'c-test', x: 'id', s: 'width:76px', v: function (t) { return esc(t.id); } },
      { h: 'Fuel', c: 'c-fuel', x: 'fuel', v: function (t) { return esc(t.fuel); } },
      { h: 'O₂ %', c: 'c-num w', x: 'o2', v: function (t) { return fo2(t.o2); } },
      { h: 'psi', c: 'c-num w', x: 'psi', v: function (t) { return num(t.psi, 1); } },
      { h: 'Flame temp., K', c: 'c-left', x: 'tad', s: 'flex:1', v: function (t) { return t.tad == null ? (t.ramped ? 'ramped' : '–') : Math.round(t.tad); } }
    ],
    'PSI-25': [
      { h: 'Test', c: 'c-test', x: 'id', s: 'width:48px', v: function (t) { return esc(t.id); } },
      { h: 'Material', c: 'c-wide', x: 'fuel', v: function (t) { return esc(t.fuel || '–'); } },
      { h: 'O₂ % start', c: 'c-num', x: 'o2', s: 'width:70px', v: function (t) { return num(t.o2, 1); } },
      { h: 'end', c: 'c-num', x: 'o2after', s: 'width:44px', v: function (t) { return num(t.o2After, 1); } }
    ],
    'PSI-99': [
      { h: 'Sample', c: 'c-test', x: 'id', s: 'width:52px', v: function (t) { return esc(t.id); } },
      { h: 'Material', c: 'c-wide', x: 'fuel', v: function (t) { return esc(t.fuel || '–'); } },
      { h: 'O₂ %', c: 'c-num w', x: 'o2', v: function (t) { return num(t.o2, 1); } },
      { h: 'Burned in 0 g', c: 'c-num', x: 'uglen', s: 'width:96px', v: function (t) { return esc((t.ugLen || '–').replace(/\s*\(.*\)/, '')); } },
      { h: 'on Earth', c: 'c-num earth', x: 'g1len', s: 'width:76px', v: function (t) { return esc((t.g1Len || '–').replace(/\s*\(.*\)/, '')); } }
    ]
  };

  function level2(c, inv) {
    var T = S.testsFor(inv.id, c), cols = COLS[inv.id], sel = C.store.state.test;
    $('brief').innerHTML = '<button type="button" class="over t-micro" data-act="back">‹ ' + esc(c.name) + ' ranking</button>' +
      '<div class="line"><span class="t-numeral-s" data-x="inv:' + inv.id + '">' + esc(inv.name) + '</span>' + C.chip(inv.id) + '</div>' +
      '<p class="t-body" data-x="inv:' + inv.id + '">' + esc(inv.says) + '</p>';
    $('thead').innerHTML = cols.map(function (k) { return '<span class="' + k.c + '"' + (k.s ? ' style="' + k.s + '"' : '') + ' data-x="col:' + inv.id + ':' + k.x + '">' + k.h + '</span>'; }).join('');
    function row(t, cls) {
      return '<button type="button" class="row t-body ' + cls + '" data-act="test" data-k="' + esc(t.k) + '" data-x="test:' + inv.id + ':' + esc(t.k) + '"' + (t.k === sel ? ' aria-current="true"' : '') + '>' +
        cols.map(function (k) { return '<span class="' + k.c + '"' + (k.s ? ' style="' + k.s + '"' : '') + '>' + k.v(t) + '</span>'; }).join('') + '</button>';
    }
    var h = T.inside.map(function (t) { return row(t, 'in'); }).join('');
    if (T.noflame.length) h += '<div class="group rule" data-x="noflame">in this air but never lit · not counted</div>' + T.noflame.map(function (t) { return row(t, 'out'); }).join('');
    if (T.outside.length) h += (T.inside.length || T.noflame.length ? '<div class="group rule" data-x="outside">outside this cabin</div>' : '<div class="group rule" data-x="outside">all outside this cabin · nearest first</div>') + T.outside.map(function (t) { return row(t, 'out'); }).join('');
    if (T.burner.length) h += '<div class="group rule" data-x="legend:burner">oxygen from the burner · not counted</div>' + T.burner.map(function (t) { return row(t, 'out'); }).join('');
    $('rows').innerHTML = h;
    $('foot').innerHTML = '<span data-x="rankrule">' + T.inside.length + ' of ' + T.counted + ' in this cabin · nearest first</span><span data-x="badge:computed"><i>ƒ</i> = computed from NASA values</span>';
  }

  function render(state, prev) {
    var c = C.store.cabin(), inv = C.store.inv(), key = state.cabin + '|' + (state.inv || '');
    if (key !== drawn) {
      if (inv) level2(c, inv); else level1(c);
      $('rows').scrollTop = 0; drawn = key;
      if (prev && !C.reduced) { $('rows').classList.remove('relight'); void $('rows').offsetWidth; $('rows').classList.add('relight'); }
    }
    // selection
    var rows = $('rows'), cur = rows.querySelector('[aria-current="true"]');
    if (cur && cur.dataset.k !== state.test) cur.removeAttribute('aria-current');
    if (state.test) {
      var el = Array.prototype.find.call(rows.querySelectorAll('[data-act="test"]'), function (b) { return b.dataset.k === state.test; });
      if (el) {
        el.setAttribute('aria-current', 'true');
        var r = el.getBoundingClientRect(), b = rows.getBoundingClientRect();
        if (r.top < b.top || r.bottom > b.bottom) rows.scrollTop += r.top - b.top - (b.height - r.height) / 2 + 60;
      }
    }
  }

  C.ledger = {
    render: render,
    toggleRest: function () { restOpen = !restOpen; drawn = null; var top = $('rows').scrollTop; render(C.store.state); $('rows').scrollTop = top; }
  };
})();
