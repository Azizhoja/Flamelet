// Checks that the site's own counting code reproduces the numbers in docs/figma_final_spec.md.
//   node site_build/verify.mjs          exit code 1 on any mismatch
// It loads site/data/codex-data.js and site/js/select.js exactly as the page does.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.CODEX_DATA = require('../site/data/codex-data.js');
const S = require('../site/js/select.js');

let bad = 0, ok = 0;
function eq(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) ok++; else { bad++; console.log('MISMATCH', label, '\n   got ', a, '\n   want', b); }
}
const cab = id => S.cabinById[id];

// 4.2 ladder cells: [lo, gas, droplets, solids, burner]
// The spec counted every CFI-G row; the site leaves out the 59 attempts NASA logged as never lighting (44 gas, 15 burner:
// "Hot ignition" No, burn time 0 or blank, no cool flame noted). Spec values before that rule: 12–14 burner 2, 20–22 gas 120
// and burner 32, 22–24 gas 6, 30–32 burner 12, 36–38 gas 58, 38–40 gas 152, above 42 burner 177, totals gas 386 and burner 263.
const L = S.ladder();
const spec42 = [[12, 0, 17, 1, 1], [14, 0, 31, 16, 7], [16, 1, 55, 42, 0], [18, 8, 43, 25, 3], [20, 101, 147, 32, 22], [22, 2, 19, 22, 0], [24, 0, 25, 0, 3], [26, 0, 0, 0, 4],
  [28, 5, 0, 0, 6], [30, 1, 15, 0, 10], [32, 2, 0, 0, 1], [34, 13, 9, 0, 3], [36, 54, 0, 0, 6], [38, 135, 0, 0, 0], [40, 20, 0, 0, 7]];
for (const [lo, g, d, s, b] of spec42) {
  const bin = L.bins[(lo - 10) / 2];
  eq('ladder ' + lo + '–' + (lo + 2), [bin.gas, bin.droplet, bin.solid, bin.burner], [g, d, s, b]);
}
const above = L.bins.slice(16).reduce((a, b) => ({ gas: a.gas + b.gas, droplet: a.droplet + b.droplet, solid: a.solid + b.solid, burner: a.burner + b.burner }), { gas: 0, droplet: 0, solid: 0, burner: 0 });
eq('ladder above 42', [above.gas, above.droplet, above.solid, above.burner], [0, 0, 0, 175]);
eq('ladder totals', [L.totals.gas, L.totals.droplet, L.totals.solid, L.totals.burner], [342, 361, 138, 248]);   // spec says 136 solids: its parser dropped Saffire-II samples 2-8 and 2-9, whose oxygen cells read "22.1 to 22.0" and "22.0 to 21.9"
eq('max oxygen', [S.fo2(L.max.solid), S.fo2(L.max.droplet), S.fo2(L.max.gas), S.fo2(L.max.burner)], ['22.2', '34', '40', '85']);

// 4.4 cabin counts: gas, droplets, solids, total. ISS: 12 CFI-G attempts in its air never lit (burn time 0), so 94 gas flames, not 106.
for (const [id, want] of [['iss', [94, 147, 106, 347]], ['eva', [0, 43, 0, 43]], ['moon', [20, 17, 0, 37]], ['suit', [0, 0, 0, 0]], ['apollo1', [0, 0, 0, 0]]]) {
  const n = S.counts(cab(id));
  eq('cabin ' + id, [n.gas, n.droplet, n.solid, n.total], want);
}

// 5.2 Moon-base ranking
const rm = S.rank(cab('moon'));
const row = r => [r.rank, r.inv.name, r.n + ' of ' + r.of, r.n ? 'inside' : S.condText(r.near) + ': ' + S.gapText(r.near, cab('moon'))];
eq('moon ranking', [...rm.withTests, ...rm.without].map(row), [
  [1, 'CFI-G', '20 of 179', 'inside'], [2, 'FLEX', '17 of 274', 'inside'],
  [3, 'Flame Design', '0 of 207', '40 % O₂ at 13.7 psi: 3.5 psi over'], [4, 'BASS-II', '0 of 129', '22.2 % O₂: 7.8 points short'],
  [5, 'Saffire-II', '0 of 9', '22.1 % O₂: 7.9 points short'], [6, 'CFI', '0 of 87', '21 % O₂ at 7.3 psi: 9.0 points short']]);
eq('moon rest', rm.rest.length, 18);
// frame 02 Spacesuit ranking
const rs = S.rank(cab('suit'));
eq('suit ranking', rs.without.map(r => [r.rank, r.inv.name, S.condText(r.near), S.gapText(r.near, cab('suit'))]), [
  [1, 'Flame Design', '40 % O₂ at 13.7 psi', '60.0 points short'], [2, 'CFI-G', '40 % O₂ at 14.7 psi', '60.0 points short'],
  [3, 'FLEX', '34 % O₂ at 10.3 psi', '66.0 points short'], [4, 'BASS-II', '22.2 % O₂', '77.8 points short'],
  [5, 'Saffire-II', '22.1 % O₂', '77.9 points short'], [6, 'CFI', '21 % O₂ at 7.3 psi', '79.0 points short']]);

// 5.3 FLEX in the Moon-base cabin
const tf = S.testsFor('PSI-69', cab('moon'));
eq('FLEX inside count', [tf.inside.length, tf.counted], [17, 274]);
eq('FLEX first 12', tf.inside.slice(0, 12).map(t => [t.id, t.fuel, S.fo2(t.o2), S.fmt(t.psi, 1), t.dil, t.end]).sort(), [
  ['220R001', 'Methanol', '34', '10.3', 'N2', 'Disruption'], ['219F001', 'Methanol', '30', '10.3', 'N2', 'Disruption'], ['220R002', 'Methanol', '34', '10.3', 'N2', 'Disruption'],
  ['224F001', 'Heptane', '34', '10.3', 'N2', 'Disruption'], ['223F002', 'Heptane', '30', '10.3', 'N2', 'Disruption'], ['223F001', 'Heptane', '30', '10.3', 'N2', 'Disruption'],
  ['219R001', 'Methanol', '30', '10.3', 'N2', 'Disruption'], ['191R001', 'Methanol', '30', '10.4', 'N2', 'Completion'], ['191F001', 'Methanol', '30', '10.4', 'N2', 'Disruption'],
  ['196F001', 'Heptane', '34', '10.4', 'N2', 'Disruption'], ['192F001', 'Methanol', '34', '10.4', 'N2', 'Completion'], ['195F002', 'Heptane', '30', '10.4', 'N2', 'Disruption']].sort());
const ends = {}; tf.inside.forEach(t => { ends[t.end] = (ends[t.end] || 0) + 1; });
eq('FLEX moon ends', ends, { Disruption: 15, Completion: 2 });

// 6.1 findings and brief
eq('moon brief', S.brief(cab('moon')), '37 tests burned in this air: 20 gas flames and 17 droplets. No solid material.');
// 21106 F2 and F5 have no outcome column value; NASA's comment on both is "direct cool - no hot ignition"
eq('moon findings', S.findings(cab('moon')).map(f => f.text), [
  '13 of 20 gas flames went out on their own. 5 burned until the fuel was shut off; 2 burned only as cool flames.',
  '0 of 17 droplets went out on their own. 15 broke apart, 2 burned out.',
  'No solid was burned above 22.2 % oxygen.']);
eq('suit brief', S.brief(cab('suit')), 'No test in PSI burned in this air. The nearest flame had 40 % oxygen around it.');
eq('suit finding', S.findings(cab('suit'))[0].text, 'Nearest: 40 % oxygen in surrounding gas; 85 % from a burner.');
// attempts that never lit: counted for no cabin, listed in a group of their own, said so in the header
const issCfig = S.testsFor('PSI-159', cab('iss'));
eq('ISS CFI-G: lit inside / never lit / all', [issCfig.inside.length, issCfig.noflame.length, issCfig.counted], [23, 12, 179]);
eq('21102 M3 never lit', [S.flame(S.findTest('PSI-159', '21102 M3')), S.inCabin(S.findTest('PSI-159', '21102 M3'), cab('iss'))], ['none', false]);
eq('21106 F2 cool flame, F4 burned', [S.flame(S.findTest('PSI-159', '21106 F2')), S.flame(S.findTest('PSI-159', '21106 F4'))], ['cool', 'lit']);
eq('21102 M3 header', S.outsideText(S.findTest('PSI-159', '21102 M3'), cab('iss')), 'Never lit · counted for no cabin');

// 6.2 readouts
const t196 = S.findTest('PSI-69', '196F001'), tC08 = S.findTest('PSI-69', 'C08H201');
eq('196F001', [t196.line, t196.burn, t196.rate, t196.end, t196.fuelLeft, t196.d0], [20, 4.2, 0.9, 'Disruption', null, 3.39]);
eq('C08H201', [tC08.line, tC08.burn, tC08.rate, tC08.end, S.fmt(tC08.fuelLeft, 1), tC08.d0, tC08.dext], [96, 8, 0.58, 'Extinction', '60.2', 3.6, 3.04]);
eq('C08H201 outside', S.outsideText(tC08, cab('moon')), 'Outside Moon base: 6 points of oxygen below');

// 6.3 CO₂ stops for heptane at 10.3 psi
for (const [co2, o2, id, burn, left] of [[0, 34, '196F001', 4.2, null], [20, 24, 'C08H201', 8, '60.2'], [30, 21, 'C10H101', 4.2, '88.7'], [35, 20, 'C11H101', 2.4, '94.6'], [40, 18, 'C12H201', 1.43, '92.8'], [45, 17, 'C13H201', 0.6, '98.0']]) {
  const t = S.findTest('PSI-69', id);
  eq('CO₂ stop ' + id, [t.dil === 'CO2' ? t.dilPct : 0, t.o2, t.burn, t.fuelLeft == null ? null : S.fmt(t.fuelLeft, 1), S.fmt(t.psi, 1) <= '10.5'], [co2, o2, burn, left, true]);
}
// what-if of frame 05: started from 196F001, CO₂ 20 % at 34 % oxygen
const near = S.nearestMeasured({ o2: 34, psi: t196.psi, dil: 'CO2', frac: 20 }, 'Heptane', t196.d0);
eq('frame 05 nearest measured', [near.test.id, near.diff], ['C08H201', 'oxygen 10 points lower']);
eq('frame 05 no measured test here', S.measuredAt({ o2: 34, psi: t196.psi, dil: 'CO2', frac: 20 }, 'Heptane', t196.d0), null);
eq('snap back to 196F001', S.measuredAt(S.condOf(t196), 'Heptane', t196.d0).id, '196F001');
const K = S.surrogateK('Heptane', { o2: 34, psi: t196.psi, dil: 'CO2', frac: 20 }, t196.d0);
eq('frame 05 burning rate ≈', K.toFixed(2), '0.72');
eq('frame 05 burns away at ≈', (t196.d0 * t196.d0 / K).toFixed(1), '16.0');

console.log(bad ? `\n${bad} mismatch(es), ${ok} checks passed` : `all ${ok} checks passed`);
process.exit(bad ? 1 : 0);
