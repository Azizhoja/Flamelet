// Drives the page like a visitor and checks each step's state. No npm packages.
//   node site_build/interact.mjs           exit code 1 on any failure
import { launch } from './tools/cdp.mjs';
import { serve } from './serve.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 8700 + Math.floor(Math.random() * 80);
const server = await serve(port);
const b = await launch({ port: 9300 + Math.floor(Math.random() * 90) });
let bad = 0;
const state = () => b.eval('JSON.stringify(Codex.store.state)').then(JSON.parse);
async function check(label, fn) {
  try { const r = await fn(); if (r === true) console.log('ok  ', label); else { bad++; console.log('FAIL', label, '→', JSON.stringify(r)); } }
  catch (e) { bad++; console.log('FAIL', label, '→', e.message); }
}
const click = sel => b.eval(`(function(){var el=document.querySelector(${JSON.stringify(sel)}); if(!el) throw new Error('no element ' + ${JSON.stringify(sel)}); el.click(); return true;})()`);

try {
  await b.goto(`http://127.0.0.1:${port}/index.html?i=1`); await sleep(1000);
  await check('opens on Moon base, level 1', async () => { const s = await state(); return s.cabin === 'moon' && !s.inv || s; });
  await check('ranking order', async () => { const r = await b.eval(`[...document.querySelectorAll('#rows [data-act=inv]')].map(e=>e.dataset.id).join(',')`); return r === 'PSI-159,PSI-69,PSI-10,PSI-25,PSI-99,PSI-39' || r; });
  await click('[data-act=cabin][data-id=suit]'); await sleep(300);
  await check('Spacesuit rung → 02', async () => { const s = await state(); const t = await b.eval(`document.querySelector('.plot .empty') && document.querySelector('.plot .empty').textContent`); return s.cabin === 'suit' && t === 'No flame in PSI was lit in this air.' || [s, t]; });
  await click('[data-act=cabin][data-id=moon]'); await sleep(300);
  await click('#rows [data-act=inv][data-id="PSI-69"]'); await sleep(300);
  await check('FLEX row → 03, 17 lit rows then the rule', async () => { const n = await b.eval(`document.querySelectorAll('#rows .row.in').length + '|' + !!document.querySelector('#rows .group.rule')`); return n === '17|true' || n; });
  await click('#rows [data-k="196F001"]'); await sleep(800);
  await check('row 196F001 → 04, test view', async () => { const s = await state(); const v = await b.eval(`document.getElementById('view-test').hidden`); return s.test === '196F001' && v === false || [s, v]; });
  await check('readouts 4.2 s, 0.90 mm²/s, Disruption', async () => { const t = await b.eval(`document.getElementById('readouts').innerText.replace(/\\s+/g,' ')`); return /4\.2 s/.test(t) && /0\.90 mm²\/s/.test(t) && /Disruption/.test(t) || t; });
  const ts = JSON.parse(await b.eval(`(function(){var t0=Codex.burn.t; document.querySelector('[data-dil=CO2]').click(); return JSON.stringify([t0, Codex.burn.t]);})()`)); await sleep(600);
  await check('CO₂ → 05, what-if 20 % CO₂ at 34 % O₂', async () => { const s = await state(); return s.wi && s.wi.dil === 'CO2' && s.wi.frac === 20 && s.wi.o2 === 34 || s; });
  await check('#2 changing the air burns again from ignition (no rewritten past)', async () => ts[0] > 0 && ts[1] === 0 || ts);
  await check('#6 what-if caption: droplet size is a model value', async () => { const t = await b.eval(`document.querySelector('.ov.caption').textContent`); return /^Droplet size: ≈ model/.test(t) || t; });
  await check('strip names C08H201, oxygen 10 points lower', async () => { const t = await b.eval(`document.getElementById('strip').innerText.replace(/\\s+/g,' ')`); return /C08H201 oxygen 10 points lower/.test(t) || t; });
  await check('≈ model outcome arrives: burns away at 16.0 s', async () => { for (let i = 0; i < 300; i++) { const p = await b.eval(`JSON.stringify(Codex.burn.plan.outcome)`); if (p !== 'null') { const o = JSON.parse(p); return o.kind === 'completion' && o.t.toFixed(1) === '16.0' || o; } await sleep(200); } return 'timeout'; });
  await click('[data-x="strip:near"]'); await sleep(800);
  await check('strip link → 06 C08H201, measured, below the rule', async () => { const s = await state(); const out = await b.eval(`document.querySelector('#rows [aria-current=true]').classList.contains('out')`); return s.test === 'C08H201' && !s.wi && out || [s, out]; });
  await check('fuel left 60.2 ƒ computed', async () => { const t = await b.eval(`document.querySelector('[data-x="readout:left"]').innerText.replace(/\\s+/g,' ')`); return /60\.2 %/.test(t) && /computed/.test(t) || t; });
  await click('[data-x="readout:left"]'); await sleep(700);
  await check('fuel-left readout → 07 popover with the formula', async () => { const t = await b.eval(`document.querySelector('.popover') && document.querySelector('.popover').innerText.replace(/\\s+/g,' ')`); return /\(3\.04 ÷ 3\.60\)³ = 60\.2 %/.test(t) && /PSI-69 · line 96 · computed/.test(t) || t; });
  await b.eval(`(function(){var f=document.querySelector('.popover form'); f.q.value='Why did it go out?'; f.dispatchEvent(new Event('submit',{cancelable:true}));})()`); await sleep(1500);
  await check('follow-up without a key says it is off, invents nothing', async () => { const t = await b.eval(`document.querySelector('.popover .answer').innerText`); return /off on this copy|need the site/.test(t) || process.env.GEMINI_API_KEY ? true : t; });
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(400);
  await check('Esc closes the popover → 06', async () => { const p = await b.eval(`!!document.querySelector('.popover')`); const s = await state(); return !p && s.test === 'C08H201' || [p, s]; });
  // slider landing on a measured test snaps to it
  await click('#rows [data-k="196F001"]'); await sleep(600);
  await b.eval(`(function(){var o=document.getElementById('s-o2'); o.value=24; o.dispatchEvent(new Event('input')); var d=document.querySelector('[data-dil=CO2]'); d.click();})()`); await sleep(600);
  await check('sliders onto tested air snap to a measured test', async () => { const s = await state(); return !s.wi && /^C08H/.test(s.test) || s; });
  await b.eval(`(function(){var o=document.getElementById('s-o2'); o.value=45; o.dispatchEvent(new Event('input')); o.dispatchEvent(new Event('change'));})()`); await sleep(600);
  await check('outside the tested range goes unlit', async () => { const t = await b.eval(`(document.querySelector('.unlit-note')||{}).textContent + '|' + document.getElementById('readouts').innerText.replace(/\\s+/g,' ')`); return /Outside the air FLEX tested/.test(t) && /outside tested range/.test(t) || t; });
  // search
  await b.eval(`(function(){var i=document.getElementById('search'); i.focus(); i.value='H10M1'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`); await sleep(600);
  await check('search H10M1 → H10M101', async () => { const s = await state(); return s.test === 'H10M101' || s; });
  // right-click explains a ladder cell
  await b.eval(`(function(){var c=document.querySelector('[data-x="cell:gas:38"]'); var r=c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+3,clientY:r.top+3}));})()`); await sleep(600);
  await check('right-click a ladder cell explains it', async () => { const t = await b.eval(`document.querySelector('.popover').innerText.replace(/\\s+/g,' ')`); return /38–40 % oxygen · gas flames/.test(t) && /135 gas flames/.test(t) || t; });
  // a gas flame opens with NASA's values and an unlit flame
  await b.eval(`location.hash='#cabin=moon&inv=PSI-159&test=21174%20A1'`); await b.eval(`dispatchEvent(new PopStateEvent('popstate'))`); await sleep(600);
  await check('CFI-G test: recorded values, unlit flame', async () => { const t = await b.eval(`document.getElementById('test-console').innerText.replace(/\\s+/g,' ') + '|' + !!document.querySelector('.unlit-flame')`); return /Self-extinguished/.test(t) && /\|true$/.test(t) || t; });
  // back and Escape (the first one closes the popover still open from the ladder step)
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(200);
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(200);
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(300);
  await check('Esc closes, then steps back to the ranking', async () => { const s = await state(); return !s.inv && !s.test || s; });

  // regressions from review/bug-review.md
  const go = async (hash, ms = 700) => { await b.eval(`location.hash=${JSON.stringify(hash)}`); await b.eval(`dispatchEvent(new PopStateEvent('popstate'))`); await sleep(ms); };
  const until = async (expr, ms = 60000) => { for (let i = 0; i < ms / 200; i++) { if (await b.eval(expr)) return true; await sleep(200); } return false; };
  await go('#cabin=iss&inv=PSI-159');
  await check('#1 ISS · CFI-G: 23 lit, then the 12 runs that never lit, not counted', async () => { const r = await b.eval(`document.querySelectorAll('#rows .row.in').length + '|' + (document.querySelector('#rows [data-x=noflame]')||{}).textContent + '|' + document.getElementById('foot').innerText.replace(/\\s+/g,' ')`); return /^23\|in this air but never lit · not counted\|23 of 179/.test(r) || r; });
  await go('#cabin=iss&inv=PSI-159&test=21102%20M3');
  await check('#1 a run that never lit says so', async () => { const t = await b.eval(`document.getElementById('test-head').innerText + '|' + document.getElementById('test-console').innerText.replace(/\\s+/g,' ')`); return /Never lit · counted for no cabin/.test(t) && /No flame: it never lit/.test(t) || t; });
  await go('#cabin=moon&inv=PSI-69&test=264F003');
  await check('#3 264F003 (no burn time, no burning rate) is not replayed', async () => { const t = await b.eval(`(document.querySelector('.unlit-note')||{}).textContent + '|' + document.getElementById('scrub-box').hidden`); return /neither a burn time nor a burning rate/.test(t) && /\|true$/.test(t) || t; });
  await go('#cabin=moon&inv=PSI-69&test=C10M102');
  await check('#3 C10M102 ends by extinction at the d²-law time, marked computed', async () => { const r = JSON.parse(await b.eval(`JSON.stringify([Codex.burn.plan.end, Codex.burn.plan.tEnd.toFixed(1), document.getElementById('t-end').textContent])`)); return r[0] === 'extinction' && r[1] === '21.4' && /ƒ computed/.test(r[2]) || r; });
  await go('#cabin=moon&inv=PSI-69&test=196F001&o2=34&psi=10.4&dil=CO2&frac=20');
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(400);
  await check('#6 back from a what-if to the test: caption says measured again', async () => { const r = await b.eval(`JSON.stringify([!!Codex.store.state.wi, Codex.burn.plan.tested, document.querySelector('.ov.caption').textContent])`); const [wi, tested, cap] = JSON.parse(r); return !wi && tested && /^Droplet size: measured/.test(cap) || r; });
  await b.eval(`(function(){var s=document.getElementById('scrub'); s.value=1000; s.dispatchEvent(new Event('input'));})()`);
  await check('#4 scrubbing to 100 % ends the burn as NASA logged it', async () => { const done = await until(`!Codex.burn.debug.catchUp`); const r = await b.eval(`JSON.stringify([Codex.burn.ended, Codex.burn.t, document.getElementById('ov-status').textContent])`); const [ended, t, st] = JSON.parse(r); return done && ended === 'disruption' && t === 4.2 && /broke apart at 4\.2 s/.test(st) || r; });
  await go('#cabin=moon&inv=PSI-69&test=209F003');
  const pending = await b.eval(`(function(){var s=document.getElementById('scrub'); s.value=Math.round(8/Codex.burn.plan.tEnd*1000); s.dispatchEvent(new Event('input')); return !!Codex.burn.debug.catchUp;})()`);
  await go('#cabin=moon&inv=PSI-69&test=196F001', 300);
  await check('#5 a seek pending on one test does not carry into the next', async () => { const r = await b.eval(`JSON.stringify([Codex.store.state.test, !!Codex.burn.debug.catchUp, Codex.burn.playing, Codex.burn.ended, Codex.burn.t])`); const [test, cu, playing, ended, t] = JSON.parse(r); return pending && test === '196F001' && !cu && playing && !ended && t < 2 || [pending, r]; });
  // file://
  const file = pathToFileURL(fileURLToPath(new URL('../site/index.html', import.meta.url))).href;
  await b.goto(file + '#cabin=iss'); await sleep(1200);
  await check('opens from file:// with no server', async () => { const t = await b.eval(`document.getElementById('brief').innerText`); return /347 tests burned in this air/.test(t) || t; });
  const errs = b.logs.filter(l => /\[error\]|\[exception\]/.test(l) && !/api\/ogonek|Failed to load resource|net::ERR/.test(l));
  await check('no script errors', async () => errs.length === 0 || errs);
} finally { await b.close(); server.close(); }
console.log(bad ? `${bad} failed` : 'all interaction checks passed');
process.exit(bad ? 1 : 0);
