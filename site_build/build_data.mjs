// Builds site/data/codex-data.js from the official NASA PSI tables in data/psi/ (see data/README.md).
//   node site_build/build_data.mjs
// No npm packages. Cells NASA left blank or unreadable stay null; nothing is filled in.
// Every test keeps the file and the line it came from (line 1 is the header).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PSI = join(ROOT, 'data', 'psi');
const OUT = join(ROOT, 'site', 'data', 'codex-data.js');

const PSI_PER_MMHG = 0.0193368, PSI_PER_ATM = 14.6959, PSI_PER_BAR = 14.5038;

// ---------------------------------------------------------------- reading
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function table(acc, name) {
  const file = `${acc}_Experimental table_${name}.csv`;
  const buf = readFileSync(join(PSI, file));
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('windows-1252').decode(buf); }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = parseCSV(text);
  return { file, head: rows[0].map(s => s.trim()), rows: rows.slice(1).map((r, i) => ({ line: i + 2, c: r.map(s => s.trim()) })) };
}
const num = v => { if (v == null) return null; const m = /-?\d+(\.\d+)?/.exec(String(v)); return m && /^[~\s]*-?\d/.test(String(v)) ? parseFloat(m[0]) : null; };
const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;
const pct = x => x == null ? null : r4(x * 100);
const sub2 = s => s.replace(/CO2/g, 'CO₂').replace(/N2/g, 'N₂').replace(/O2/g, 'O₂');

const tests = [];
function add(t) { tests.push(t); }

// ---------------------------------------------------------------- FLEX (PSI-69): droplets
{
  const T = table('PSI-69', 'FLEX');
  for (const { line, c } of T.rows) {
    const mmHg = num(c[5]), xo2 = num(c[6]), xn2 = num(c[7]), xco2 = num(c[8]), xhe = num(c[9]);
    const d0 = num(c[10]), dext = num(c[11]), k = num(c[12]), burn = num(c[13]);
    const dil = xco2 > 0 ? 'CO2' : xhe > 0 ? 'He' : 'N2';
    // NASA logged 0 mmHg for C11M201: a droplet cannot burn in a vacuum, so the pressure is treated as not recorded.
    const pOk = mmHg != null && mmHg > 1;
    add({
      inv: 'PSI-69', kind: 'droplet', id: c[1], line, file: T.file, date: c[2],
      fuel: c[4], o2: pct(xo2), psi: pOk ? r4(mmHg * PSI_PER_MMHG) : null,
      pSrc: c[5] === '' ? null : c[5] + ' mmHg', pNote: pOk ? null : 'recorded as ' + c[5] + ' mmHg',
      dil, dilPct: dil === 'CO2' ? pct(xco2) : dil === 'He' ? pct(xhe) : 0,
      x: { o2: xo2, n2: xn2, co2: xco2, he: xhe },
      d0, dext, rate: k, burn, burnRaw: c[13], end: c[14] || null,
      // ƒ computed: share of the droplet's volume still liquid when the visible flame went out
      fuelLeft: c[14] === 'Extinction' && d0 > 0 && dext > 0 && dext <= d0 ? r4(Math.pow(dext / d0, 3) * 100) : null
    });
  }
}
// ---------------------------------------------------------------- CFI (PSI-39): droplets, conditions only
{
  const T = table('PSI-39', 'CFI');
  for (const { line, c } of T.rows) {
    const atm = num(c[4]), xhe = num(c[7]);
    add({
      inv: 'PSI-39', kind: 'droplet', id: c[0], line, file: T.file, date: c[1], cir: c[3],
      fuel: c[9].replace(/C12H26/g, 'C₁₂H₂₆'), o2: pct(num(c[5])), psi: atm == null ? null : r4(atm * PSI_PER_ATM), pSrc: c[4],
      dil: xhe > 0 ? 'He' : 'N2', dilPct: xhe > 0 ? pct(xhe) : 0, fiber: c[8] || null, end: null
    });
  }
}
// ---------------------------------------------------------------- CFI-G (PSI-159): gas flames
{
  const END = { SE: 'Self-extinguished', FT: 'Flow terminated' };
  const T = table('PSI-159', 'CFI-G_Normal Flames');
  for (const { line, c } of T.rows) {
    const bar = num(c[7]);
    add({
      inv: 'PSI-159', kind: 'gas', id: c[3].replace(/\s+/g, ' '), line, file: T.file,
      fuel: c[2], o2: pct(num(c[5])), o2After: pct(num(c[6])), psi: bar == null ? null : r4(bar * PSI_PER_BAR), pSrc: c[7] + ' bar',
      dil: 'N2', dilPct: null, tad: num(c[11]), zst: num(c[12]), hot: c[13] || null, burn: num(c[14]),
      end: END[c[15]] || null, endRaw: c[15], cool: c[4] || null, note: c[17] || null
    });
  }
  const I = table('PSI-159', 'CFI-G_Inverse Flames');
  for (const { line, c } of I.rows) {
    if (!c.some(Boolean)) continue;                       // 861 blank spreadsheet rows
    const bar = num(c[6]);
    add({
      inv: 'PSI-159', kind: 'burner', id: c[3].replace(/\s+/g, ' '), line, file: I.file,
      fuel: c[2], o2: pct(num(c[7])), psi: bar == null ? null : r4(bar * PSI_PER_BAR), pSrc: c[6] + ' bar',
      xf: num(c[4]), tad: num(c[11]), zst: num(c[12]), hot: c[13] || null, burn: num(c[14]),
      end: END[c[15]] || null, endRaw: c[15], colour: c[18] && c[18] !== '-' ? c[18] : null, note: c[19] || null
    });
  }
}
// ---------------------------------------------------------------- Flame Design (PSI-10): gas flames
{
  const FUEL = { C2H4: 'Ethylene', C3H8: 'Propane' };
  const T = table('PSI-10', 'Flame Design_Normal Flame');
  for (const { line, c } of T.rows) {
    const atm = num(c[10]);
    add({
      inv: 'PSI-10', kind: 'gas', id: c[3], line, file: T.file,
      fuel: FUEL[c[2]] || c[2], o2: pct(num(c[8])), o2After: pct(num(c[9])), psi: atm == null ? null : r4(atm * PSI_PER_ATM), pSrc: c[10] + ' atm',
      dil: 'N2', dilPct: null, xfuel: num(c[4]), tad: num(c[14]), zst: num(c[13]), ramped: c[4] === 'RAMPED', end: null
    });
  }
  const I = table('PSI-10', 'Flame Design_Inverse Flame');
  for (const { line, c } of I.rows) {
    const atm = num(c[9]);
    add({
      inv: 'PSI-10', kind: 'burner', id: c[2], line, file: I.file,
      fuel: 'Ethylene', o2: pct(num(c[3])), psi: atm == null ? null : r4(atm * PSI_PER_ATM), pSrc: c[9] + ' atm',
      xf: num(c[7]), tad: num(c[13]), zst: num(c[12]), end: null
    });
  }
}
// ---------------------------------------------------------------- BASS-II (PSI-25): solids, no pressure column
{
  const T = table('PSI-25', 'BASS-II');
  for (const { line, c } of T.rows) {
    add({
      inv: 'PSI-25', kind: 'solid', id: c[1], line, file: T.file, date: c[2], pi: c[0],
      fuel: c[5].replace(/\s{2,}/g, ' · ') || null, o2: num(c[11]), o2After: num(c[12]), psi: null, pSrc: null,
      co2: num(c[13]), co2After: num(c[14]), co: num(c[15]), coAfter: num(c[16]), sample: c[4] || null, end: null
    });
  }
}
// ---------------------------------------------------------------- Saffire-II (PSI-99): solids, no pressure column
{
  const T = table('PSI-99', 'SAFFIRE-2');
  for (const { line, c } of T.rows) {
    if (!/^2-\d+$/.test(c[0])) continue;                  // flow-visualisation rows and notes
    add({
      inv: 'PSI-99', kind: 'solid', id: c[0], line, file: T.file,
      fuel: c[1] || null, o2: num(c[6]), o2Raw: c[6], psi: null, pSrc: null,
      thick: c[2] || null, flow: c[5] || null, dir: c[10] || null, burnRaw: c[9] || null,
      ugLen: c[11] || null, ugRate: c[12] || null, g1Len: c[13] || null, g1Rate: c[14] || null, end: null
    });
  }
}

// test keys: the id when it is unique inside its investigation and kind, else id@line
{
  const seen = {};
  for (const t of tests) { const k = t.inv + '|' + t.id; seen[k] = (seen[k] || 0) + 1; }
  for (const t of tests) t.k = seen[t.inv + '|' + t.id] > 1 ? t.id + '@' + t.line : t.id;
}

// ---------------------------------------------------------------- investigations
const ROWLEVEL = {
  'PSI-159': { name: 'CFI-G', kind: 'gas', says: 'Burns gas flames around a porous sphere to find where a hot flame turns into a cool flame, in oxygen up to 40 % around it and 85 % from the burner.' },
  'PSI-69': { name: 'FLEX', kind: 'droplet', says: 'Maps the flammability limits of liquid fuel droplets in microgravity, and how well CO₂ and helium put them out.' },
  'PSI-10': { name: 'Flame Design', kind: 'gas', says: 'Burns spherical gas flames to learn what makes a flame sooty and what makes it go out.' },
  'PSI-25': { name: 'BASS-II', kind: 'solid', says: 'Burns small solid samples in a fan-driven flow and lowers the oxygen until the flame goes out.' },
  'PSI-99': { name: 'Saffire-II', kind: 'solid', says: 'Burns nine material samples in an uncrewed Cygnus cargo ship and compares each with the same test on Earth.' },
  'PSI-39': { name: 'CFI', kind: 'droplet', says: 'Burns droplets of dodecane blends to study cool flames, the faint low-temperature burning that can follow a hot flame.' }
};
const index = parseCSV(readFileSync(join(PSI, 'investigations_index.csv'), 'utf8').replace(/^﻿/, ''));
const OBJECTIVES = JSON.parse(readFileSync(join(PSI, 'investigations_objectives.json'), 'utf8'));
const ih = index[0];
const investigations = [];
for (const r of index.slice(1)) {
  const o = Object.fromEntries(ih.map((h, i) => [h, (r[i] || '').trim()]));
  if (o.is_combustion_science_area !== 'True') continue;
  const rl = ROWLEVEL[o.accession];
  let objective = null;
  objective = OBJECTIVES[o.accession] || null;
  if (objective) objective = objective.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  investigations.push({
    id: o.accession, name: rl ? rl.name : (o.acronym || o.title), title: o.title, area: o.sub_research_area || null,
    platform: o.flight_platform || null, doi: o.doi || null, pubs: +o.publications || 0,
    rowLevel: !!rl, kind: rl ? rl.kind : null, says: rl ? rl.says : null,
    objective: objective ? (objective.length > 420 ? objective.slice(0, objective.lastIndexOf('.', 420) + 1) || objective.slice(0, 420) + '…' : objective) : null
  });
}

// ---------------------------------------------------------------- FLEX burning-rate surrogate (for what-if only)
// K [mm²/s] = b0 + b1·heptane + b2·xO2 + b3·xHe + b4·xCO2 + b5·p[atm] + b6·D0[mm], ordinary least squares.
function ols(X, y) {
  const n = X[0].length, A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let r = 0; r < X.length; r++) for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j]; A[i][n] += X[r][i] * y[r]; }
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let j = i; j <= n; j++) A[r][j] -= f * A[i][j]; }
  }
  return A.map((row, i) => row[n] / row[i]);
}
const fitRows = tests.filter(t => t.inv === 'PSI-69' && t.rate > 0 && t.d0 > 0 && t.psi != null);
const FX = fitRows.map(t => [1, t.fuel === 'Heptane' ? 1 : 0, t.x.o2, t.x.he, t.x.co2, t.psi / PSI_PER_ATM, t.d0]);
const Fy = fitRows.map(t => t.rate);
const beta = ols(FX, Fy);
const mean = Fy.reduce((a, b) => a + b, 0) / Fy.length;
let ssr = 0, sst = 0;
FX.forEach((x, i) => { const p = x.reduce((s, v, j) => s + v * beta[j], 0); ssr += (Fy[i] - p) ** 2; sst += (Fy[i] - mean) ** 2; });
const flexFit = { terms: ['1', 'heptane', 'xO2', 'xHe', 'xCO2', 'p_atm', 'D0_mm'], beta: beta.map(b => Math.round(b * 1e4) / 1e4), n: Fy.length, r2: Math.round((1 - ssr / sst) * 1e3) / 1e3 };

// ---------------------------------------------------------------- cabins
const cabins = [
  { id: 'apollo1', name: 'Apollo 1', o2: 100, psi: null, type: 'point', def: '100 % O₂', pressureText: 'not stated',
    window: 'Counted within 4 points of oxygen; NASA’s page gives no pressure', src: { label: 'NASA · Apollo 1', url: 'https://sma.nasa.gov/sma-disciplines/accllp/apollo-1' } },
  { id: 'suit', name: 'Spacesuit', o2: 100, psi: 4.3, type: 'point', def: '100 % O₂ · 4.3 psi', pressureText: '4.3 psi',
    window: 'Counted within 4 points of oxygen, 20 % of pressure', src: { label: 'Challenge brief', url: 'https://www.spaceappschallenge.org/' } },
  { id: 'moon', name: 'Moon base', o2: 30, psi: 10.2, psiMax: 10.5, type: 'range', def: '≥ 30 % O₂ · ≤ 10.2 psi', pressureText: '≤ 10.2 psi',
    window: 'Counted up to 10.5 psi', src: { label: 'Challenge brief', url: 'https://www.spaceappschallenge.org/' } },
  { id: 'eva', name: 'EVA prep', o2: 26.5, psi: 10.2, type: 'point', def: '26.5 % O₂ · 10.2 psi', pressureText: '10.2 psi',
    window: 'Counted within 4 points of oxygen, 20 % of pressure', src: { label: 'NASA NTRS 20150021491', url: 'https://ntrs.nasa.gov/citations/20150021491' } },
  { id: 'iss', name: 'ISS', o2: 21, psi: 14.7, type: 'point', def: '21 % O₂ · 14.7 psi', pressureText: '14.7 psi',
    window: 'Counted within 4 points of oxygen, 20 % of pressure', src: { label: 'Challenge brief', url: 'https://www.spaceappschallenge.org/' } }
];

const data = {
  built: new Date().toISOString().slice(0, 10),
  source: 'NASA Physical Sciences Informatics (PSI), psi.nasa.gov, downloaded 2026-11-13',
  cabins, investigations, tests, flexFit
};
mkdirSync(dirname(OUT), { recursive: true });
const banner = '// Generated by site_build/build_data.mjs from the official NASA PSI experimental tables. Do not edit by hand.\n' +
  '// Code-assisted build: the parsing script was written with an AI coding assistant; every value is NASA’s or computed from NASA’s by the rules in js/select.js.\n';
writeFileSync(OUT, banner + '(function (g) { g.CODEX_DATA = ' + JSON.stringify(data) + '; if (typeof module === "object" && module.exports) module.exports = g.CODEX_DATA; })(typeof self !== "undefined" ? self : globalThis);\n');
const by = {};
for (const t of tests) { const k = t.inv + ' ' + t.kind; by[k] = (by[k] || 0) + 1; }
console.log('wrote', OUT.replace(ROOT, '.'), (JSON.stringify(data).length / 1024).toFixed(0) + ' KB');
console.log(by);
console.log('investigations', investigations.length, 'row-level', investigations.filter(i => i.rowLevel).length);
console.log('FLEX fit', JSON.stringify(flexFit));
void sub2;
