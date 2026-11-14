/* Shared helpers: escaping, chemistry names, chips and badges. */
(function () {
  'use strict';
  var C = window.Codex = window.Codex || {}, S = C.select;
  C.$ = function (id) { return document.getElementById(id); };
  C.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); };
  C.DIL = { N2: 'N₂', CO2: 'CO₂', He: 'He' };
  C.DIL_WORD = { N2: 'nitrogen', CO2: 'CO₂', He: 'helium' };
  C.KIND_VIEW = { gas: 'gas flame', droplet: 'droplet burn', solid: 'solid sample', burner: 'burner-oxygen flame' };
  C.glyph = function (kind, cls) { return '<i class="glyph ' + kind + (cls ? ' ' + cls : '') + '" aria-hidden="true"></i>'; };
  C.doi = function (inv) { return inv && inv.doi ? 'https://doi.org/' + inv.doi : 'https://psi.nasa.gov/'; };
  /** Source chip of an investigation; with a test it names the line of NASA's table. */
  C.chip = function (invId, t, extra) {
    var inv = S.invById[invId], text = invId + ' · ' + (t ? 'line ' + t.line : inv.name) + (extra ? ' · ' + extra : '');
    return '<a class="chip" href="' + C.doi(inv) + '" target="_blank" rel="noopener" data-x="src:' + invId + (t ? ':' + C.esc(t.k) : '') + '" title="' +
      C.esc(t ? t.file + ', line ' + t.line : inv.title) + '">' + C.esc(text) + '</a>';
  };
  C.cabinChip = function (c) {
    return '<a class="chip" href="' + c.src.url + '" target="_blank" rel="noopener" data-x="cabinsrc:' + c.id + '">' + C.esc(c.src.label) + '</a>';
  };
  C.badge = function (kind) {
    var t = { computed: '<i style="font-family:var(--serif)">ƒ</i> computed', model: '≈ model', nodata: '∅ no data' }[kind];
    return '<span class="badge ' + kind + '" data-x="badge:' + kind + '">' + t + '</span>';
  };
  C.ordinal = function (n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'); };
  C.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  C.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
})();
