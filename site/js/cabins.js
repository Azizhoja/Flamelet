/*
 * Right rail: the oxygen ladder. Evidence is drawn to the left of the axis (one cell per 2 points of
 * oxygen, brighter with more tests), the cabins people live in to the right. Picking a cabin re-ranks
 * the ledger and relights the stage.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$;
  var COLS = [{ kind: 'gas', x: 0, w: 10 }, { kind: 'droplet', x: 14, w: 10 }, { kind: 'solid', x: 28, w: 10 }, { kind: 'burner', x: 43, w: 6 }];
  var AXIS_X = 57, TICKS = [100, 80, 60, 40, 30, 21], RUNG_H = 34, TOP = 8, BOTTOM = 24;
  var WORD = { gas: 'gas flames', droplet: 'droplets', solid: 'solids', burner: 'flames fed oxygen from the burner' };

  function render() {
    var c = C.store.cabin();
    renderCard(c);                               // first: the card's height sets the ladder's
    var box = $('ladder'), H = box.clientHeight, W = box.clientWidth;
    if (!H) return;
    var L = S.ladder(), win = S.o2Window(c);
    var s = (H - TOP - BOTTOM) / 90, y = function (o2) { return TOP + (100 - o2) * s; };
    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Oxygen ladder: tests in PSI by oxygen percentage, 10 to 100 percent">';
    L.bins.forEach(function (b) {
      var out = b.hi <= win[0] || b.lo >= win[1], cy = y(b.hi) + 0.75, ch = Math.max(2, 2 * s - 1.5);
      COLS.forEach(function (col) {
        var n = b[col.kind], title = b.lo + '–' + b.hi + ' % oxygen: ' + (n ? n + ' ' + WORD[col.kind] : 'no ' + WORD[col.kind] + ' in PSI');
        if (col.kind === 'burner') {
          if (n) svg += '<rect class="cell hollow" data-x="cell:burner:' + b.lo + '" x="' + (col.x + 0.5) + '" y="' + (cy + 0.5).toFixed(1) + '" width="' + (col.w - 1) + '" height="' + (ch - 1).toFixed(1) + '" rx="1"><title>' + title + '</title></rect>';
        } else {
          svg += '<rect class="cell l' + S.level(n) + (out ? ' out' : '') + '" data-x="cell:' + col.kind + ':' + b.lo + '" x="' + col.x + '" y="' + cy.toFixed(1) + '" width="' + col.w + '" height="' + ch.toFixed(1) + '" rx="1.5"><title>' + title + '</title></rect>';
        }
      });
    });
    svg += '<line class="axis" x1="' + AXIS_X + '" x2="' + AXIS_X + '" y1="' + y(100) + '" y2="' + y(10) + '"/>';
    svg += '<line class="bracket" x1="' + AXIS_X + '" x2="' + AXIS_X + '" y1="' + (y(win[1]) + 1.5).toFixed(1) + '" y2="' + (y(win[0]) - 1.5).toFixed(1) + '"/>';
    TICKS.forEach(function (t) {
      svg += '<line class="axis" x1="' + AXIS_X + '" x2="' + (AXIS_X + 4) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
        '<text x="' + (AXIS_X + 7) + '" y="' + (y(t) + 4).toFixed(1) + '">' + t + '</text>';
    });
    svg += '<text class="axis-title" transform="translate(' + (AXIS_X + 44) + ' ' + y(55).toFixed(0) + ') rotate(-90)" text-anchor="middle">oxygen in the air, %</text>';
    svg += '<text class="heads" x="0" y="' + (H - 6) + '" data-x="ladder">gas · drops · solids · burner</text>';

    // rungs: each label sits beside its oxygen value and moves only as far as it must to clear a neighbour
    var rungs = S.cabins.slice().sort(function (a, b) { return b.o2 - a.o2; }).map(function (cb) { return { c: cb, y: y(cb.o2) - RUNG_H / 2 }; });
    rungs.forEach(function (r, i) { r.y = Math.max(i ? rungs[i - 1].y + RUNG_H : 0, r.y); });
    for (var i = rungs.length - 1; i >= 0; i--) rungs[i].y = Math.min(rungs[i].y, i === rungs.length - 1 ? H - BOTTOM - RUNG_H + 6 : rungs[i + 1].y - RUNG_H);
    var html = '';
    rungs.forEach(function (r) {
      var cb = r.c, n = S.counts(cb).total, sel = cb.id === c.id, yo = y(cb.o2), yc = r.y + RUNG_H / 2;
      svg += '<path class="lead' + (sel ? ' sel' : '') + (n ? '' : ' dash') + '" d="M' + (AXIS_X + 1) + ' ' + yo.toFixed(1) + ' H' + (AXIS_X - 4) + '"/>' +
        '<line class="lead' + (sel ? ' sel' : '') + '" x1="84.5" x2="84.5" y1="' + (r.y + 3).toFixed(1) + '" y2="' + (r.y + RUNG_H - 3).toFixed(1) + '"' + (sel ? ' stroke-width="2"' : '') + '/>';
      void yc;
      html += '<button type="button" class="rung' + (n ? '' : ' unlit') + '" style="top:' + r.y.toFixed(1) + 'px" data-act="cabin" data-id="' + cb.id + '" data-x="cabin:' + cb.id + '" aria-pressed="' + sel + '">' +
        '<span class="n">' + C.esc(cb.name) + '</span><span class="d">' + C.esc(cb.pressureText) + ' · ' + (n ? '<b>' + n + '</b>' : '∅') + '</span></button>';
    });
    box.innerHTML = svg + '</svg>' + html;
  }

  function renderCard(c) {
    var n = S.counts(c), def = c.def.split(' · ');
    function cell(v, word, kind) {
      return '<div data-x="count:' + kind + '">' + (v ? '<span class="t-numeral-s">' + v + '</span><small>' + word + '</small>' : '<span class="t-numeral-s"><span class="zero">0</span></span><small>∅ ' + word + '</small>') + '</div>';
    }
    $('card').innerHTML = '<div class="card" data-x="cabin:' + c.id + '">' +
      '<span class="t-label">' + C.esc(c.name) + '</span>' +
      '<span class="def">' + def.map(C.esc).join('<br>') + '</span>' +
      '<span class="win" data-x="window">' + C.esc(c.window) + (n.solid ? '. Solids: pressure not recorded' : '') + '</span>' +
      '<div class="three">' + cell(n.gas, 'gas', 'gas') + cell(n.droplet, 'drops', 'droplet') + cell(n.solid, 'solids', 'solid') + '</div>' +
      C.cabinChip(c) + '</div>';
  }

  function renderDock(away) {
    $('dock').innerHTML = (away ? '<i class="away"></i>' : '<i class="flame-dot" id="dock-flame"></i>') + '<span><b>Ask Flamey</b><span>or right-click anything</span></span>';
  }

  C.cabins = { render: render, renderDock: renderDock };
})();
