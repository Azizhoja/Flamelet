// Screenshots of the seven prototype states in headless Edge/Chrome, for comparison with the Figma frames.
//   node site_build/shots.mjs [name ...]      → site_build/shots/<name>.png   (all seven when no name is given)
// Uses the DevTools-protocol driver in site_build/tools/cdp.mjs; no npm packages.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch } from './tools/cdp.mjs';
import { serve } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const STATES = {
  '01-moon': { hash: 'cabin=moon' },
  '02-suit': { hash: 'cabin=suit' },
  '03-flex': { hash: 'cabin=moon&inv=PSI-69' },
  '04-196F001': { hash: 'cabin=moon&inv=PSI-69&test=196F001', seek: 2.1 },
  '05-whatif': { hash: 'cabin=moon&inv=PSI-69&test=196F001&dil=CO2&frac=20', seek: 4.0, wait: 1500, outcome: true },
  '06-C08H201': { hash: 'cabin=moon&inv=PSI-69&test=C08H201', seek: 4.0 },
  '07-ogonek': { hash: 'cabin=moon&inv=PSI-69&test=C08H201', seek: 4.0, explain: '[data-x="readout:left"]' },
  '08-iss': { hash: 'cabin=iss' },
  '09-cfig': { hash: 'cabin=moon&inv=PSI-159&test=21088A1' },
  '10-eva': { hash: 'cabin=eva&inv=PSI-99' }
};

const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
const size = (process.argv.find(a => a.startsWith('--size=')) || '--size=1440x900').slice(7).split('x').map(Number);
const port = 8790 + Math.floor(Math.random() * 100);
const server = await serve(port);
const b = await launch({ port: 9400 + Math.floor(Math.random() * 200), width: size[0], height: size[1] });
let failed = false;
try {
  for (const [name, st] of Object.entries(STATES)) {
    if (want.length ? !want.includes(name) : +name.slice(0, 2) > 7) continue;
    b.logs.length = 0;
    await b.goto(`http://127.0.0.1:${port}/index.html?shot=${name}#${st.hash}`);
    await sleep(900);
    if (st.seek != null) { await b.eval(`Codex.stageTest.seekTo(${st.seek})`); await b.eval(`new Promise(function(ok){var n=0;(function w(){var f=Codex.stageTest.frame();if((f&&!f.catching&&f.t>=${st.seek}-0.05)||n++>400)ok();else setTimeout(w,100);})();})`); await sleep(st.wait || 600); }
    if (st.outcome) await b.eval(`new Promise(function(ok){var n=0;(function w(){var p=Codex.burn.plan;if((p&&p.outcome)||n++>900)ok();else setTimeout(w,100);})();})`);
    if (st.explain) { await b.eval(`(function(){var el=document.querySelector(${JSON.stringify(st.explain)});var r=el.getBoundingClientRect();Codex.ogonek.explain(el,r.left+20,r.top+10);})()`); await sleep(900); }
    const file = join(OUT, name + (size[0] === 1440 ? '' : '-' + size[0]) + '.png');
    await b.screenshot(file);
    const errs = b.logs.filter(l => /\[error\]|\[exception\]/.test(l));
    if (errs.length) { failed = true; console.log(name, 'ERRORS:\n  ' + errs.join('\n  ')); } else console.log(name, 'ok →', file);
  }
} finally { await b.close(); server.close(); }
process.exit(failed ? 1 : 0);
