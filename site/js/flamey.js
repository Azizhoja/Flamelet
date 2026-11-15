/*
 * Flamey: right-click anything (or press the dock, then click). The flame flies to the spot and
 * explains it: a plain sentence for a student, the formula with this row's numbers for a scientist,
 * and the source. All of that is written here by code from the data, so no number is invented.
 * Optional follow-up questions use the same facts via api/flamey.mjs.
 */
(function () {
  'use strict';
  var C = window.Codex, S = C.select, $ = C.$, esc = C.esc, fmt = S.fmt, fo2 = S.fo2;
  var pop = null, fly = null, asking = false, current = null;

  function cabinFacts() {
    var c = C.store.cabin(), n = S.counts(c);
    return 'Chosen cabin: ' + c.name + ' (' + c.def + '; ' + c.window + '). Tests in it: ' + n.gas + ' gas flames, ' + n.droplet + ' droplets, ' + n.solid + ' solids.';
  }
  function testFacts(t) {
    if (!t) return '';
    var inv = S.invById[t.inv], f = [inv.name + ' (' + inv.id + ') test ' + t.id + ', ' + t.file + ' line ' + t.line + '.', 'Kind: ' + C.KIND_VIEW[t.kind] + '. Fuel: ' + (t.fuel || 'not recorded') + '.',
      'Oxygen: ' + fo2(t.o2) + ' %' + (t.kind === 'burner' ? ' in the burner flow' : '') + '. Pressure: ' + (t.psi != null ? fmt(t.psi, 2) + ' psi (NASA: ' + t.pSrc + ')' : 'not recorded') + '.'];
    if (t.inv === 'PSI-69') f.push('Diluent: ' + t.dil + (t.dilPct ? ' ' + t.dilPct + ' %' : '') + '. Start diameter D0 ' + t.d0 + ' mm; visible-flame extinction diameter ' + (t.dext == null ? 'not recorded' : t.dext + ' mm') +
      '; burning rate ' + (t.rate != null ? t.rate + ' mm²/s' : 'not recorded') + '; burn time ' + (t.burnRaw ? t.burnRaw + ' s' : 'not recorded') + '; ended by ' + t.end + '.' + (t.fuelLeft != null ? ' Fuel left at flame-out (computed) ' + fmt(t.fuelLeft, 1) + ' %.' : ''));
    if (t.tad != null) f.push('Adiabatic flame temperature ' + Math.round(t.tad) + ' K; stoichiometric mixture fraction ' + (t.zst != null ? t.zst.toFixed(3) : 'n/a') + '.');
    if (t.end && t.inv !== 'PSI-69') f.push('Outcome: ' + t.end + '.');
    if (S.flame(t) === 'none') f.push('Ignition: NASA logged no hot ignition, no burn time and no cool flame: this attempt never lit, so it counts for no cabin.');
    if (S.flame(t) === 'cool') f.push('Ignition: no hot ignition; NASA notes a cool flame ("direct cool").');
    f.push('Relative to the chosen cabin: ' + (S.inCabin(t, C.store.cabin()) ? 'inside' : S.outsideText(t, C.store.cabin()) || 'outside') + '.');
    return f.join(' ');
  }
  function modelFacts() {
    var p = C.burn.plan, s = C.store.state;
    if (!p || !s.wi) return '';
    var o = p.outcome;
    return 'What-if (model, not measured): ' + fo2(s.wi.o2) + ' % oxygen, ' + s.wi.frac + ' % ' + s.wi.dil + ', ' + s.wi.psi + ' psi. Model burning rate ' + fmt(p.K, 2) + ' mm²/s from a least-squares fit to ' + S.DATA.flexFit.n + ' FLEX tests (r² ' + S.DATA.flexFit.r2 + ').' +
      (!p.lit ? ' Outside the range FLEX tested: no model result shown.' : o ? ' Model outcome: ' + o.kind + ' at ' + fmt(o.t, 1) + ' s' + (o.fuelLeft != null ? ', fuel left ' + fmt(o.fuelLeft, 1) + ' %' : '') + '.' : ' Model outcome still running.');
  }

  // ------------------------------------------------------------------ explanations
  var COL = {
    id: ['Test', 'NASA’s own identifier for the run, as written in the experimental table.'],
    fuel: ['Fuel', 'What burned.'],
    o2: ['O₂ %', 'Oxygen in the gas around the flame, as a percentage of the molecules (mole fraction × 100).'],
    psi: ['psi', 'Chamber pressure. NASA recorded it in mmHg, atm or bar; the site converts every one to psi because the challenge defines its cabins in psi.'],
    dil: ['Diluent', 'The inert gas mixed into the air: nitrogen as on Earth, or carbon dioxide or helium, which FLEX added to put the flame out.'],
    end: ['End', 'How NASA logged the end of the burn. Extinction: the flame went out with fuel left. Disruption: the droplet broke apart. Completion: the droplet burned away.'],
    left: ['ƒ Fuel left %', 'How much of the droplet was still liquid when its visible flame went out. Shown only when the test ended in extinction.'],
    burn: ['Burn, s', 'How long the flame burned, in seconds.'],
    tad: ['Flame temperature', 'The adiabatic flame temperature NASA computed for the mixture: the hottest the flame could be if no heat were lost.'],
    fiber: ['Fiber', 'Whether the droplet was held on a thin support fiber or free-floating.'],
    o2after: ['O₂ at end', 'BASS-II burned in a closed box, so each burn used up oxygen. This is the oxygen at the end of the run.'],
    uglen: ['Burned in 0 g', 'How much of the sample burned in orbit.'],
    g1len: ['Burned on Earth', 'How much of the same material burned in NASA’s ground test at 1 g.'],
    rank: ['#', 'Rank for the chosen cabin: most tests inside it first, then the smallest gap to it.'],
    inv: ['Investigation', 'A NASA PSI investigation: one experiment campaign with its own data set and DOI.'],
    fuelkind: ['Fuel', 'Ring: gas flame. Dot: droplet. Bar: solid sample.'],
    incabin: ['In this cabin', 'How many of the investigation’s tests burned inside the chosen cabin’s window, out of all its tests with a recorded atmosphere.'],
    near: ['Nearest test', 'The investigation’s test closest to the cabin: smallest oxygen gap first, then the smallest pressure gap.']
  };
  var KIND = { gas: 'gas flames', droplet: 'droplets', solid: 'solid samples', burner: 'burner-oxygen flames' };
  var flex = function (k) { return S.findTest('PSI-69', k); };

  function entry(key, el) {
    var parts = key.split(':'), head = parts[0], c = C.store.cabin(), t = C.store.test(), p = C.burn.plan, inv;
    switch (head) {
      case 'brand': return { term: 'Flamelet', plain: 'A map of what NASA knows about fire in the air people will breathe in space.', numbers: S.tests.length + ' tests from 6 row-level tables, ' + S.investigations.length + ' combustion investigations, all from NASA’s Physical Sciences Informatics repository.', chips: '<a class="chip" href="https://psi.nasa.gov/" target="_blank" rel="noopener">psi.nasa.gov</a>' };
      case 'search': return { term: 'Search', plain: 'Find an investigation, a cabin or a test by its name or id.', numbers: 'Press Ctrl K (⌘K on a Mac) from anywhere.' };
      case 'flamey': return { term: 'Flamey', plain: 'The little flame that explains things. Right-click anything, or press here and then click.', numbers: 'Explanations are written by code from NASA’s rows. Follow-up answers use the same facts and may require independent verification.' };
      case 'cabin': case 'cabinsrc': {
        var cb = S.cabinById[parts[1]], n = S.counts(cb);
        return { term: cb.name, badge: n.total ? null : 'nodata', plain: { iss: 'The air on the International Space Station: the same mix and pressure as at sea level.', moon: 'The air NASA expects in a Moon base and pressurized rovers: richer in oxygen and thinner, so crews can go out in spacesuits without long pre-breathing.', eva: 'The Space Shuttle’s air before a spacewalk: thinner and a little richer in oxygen, to wash nitrogen out of the crew’s blood.', suit: 'Pure oxygen at low pressure, inside a spacesuit.', apollo1: 'The pure-oxygen cabin of Apollo 1, where a fire killed three astronauts in 1967.' }[cb.id],
          numbers: cb.def + '. ' + cb.window + '. In PSI: ' + n.gas + ' gas flames, ' + n.droplet + ' droplets, ' + n.solid + ' solid samples.' + (cb.id === 'moon' ? ' The window reaches 10.5 psi because FLEX ran its 0.7 atm tests at 10.3–10.5 psi as measured.' : ''), chips: C.cabinChip(cb) };
      }
      case 'ladder': return { term: 'Oxygen ladder', plain: 'Every flame in PSI, stacked by how much oxygen was in the air. Brighter cells hold more tests; dark means nothing was burned there. Attempts NASA logged as never lighting are left out.', numbers: 'Gas flames reach ' + fo2(S.ladder().max.gas) + ' %, droplets ' + fo2(S.ladder().max.droplet) + ' %, solids ' + fo2(S.ladder().max.solid) + ' %. Hollow cells are burner-oxygen flames, up to ' + fo2(S.ladder().max.burner) + ' %. One cell = 2 points of oxygen. Fill: 1–9, 10–39, 40–99, 100 or more tests.' };
      case 'cell': {
        var lo = +parts[2], b = S.ladder().bins[(lo - 10) / 2], k = parts[1];
        return { term: lo + '–' + (lo + 2) + ' % oxygen · ' + KIND[k], badge: b[k] ? null : 'nodata', plain: b[k] ? 'NASA burned ' + b[k] + ' ' + KIND[k] + ' with this much oxygen in the air.' : 'No test in PSI burned ' + KIND[k] + ' at this oxygen level.', numbers: k === 'burner' ? 'Here the oxygen came out of the burner into fuel, so these flames count for no cabin.' : 'Counted from every row-level table: FLEX, CFI, CFI-G, Flame Design, BASS-II, Saffire-II.' };
      }
      case 'window': return { term: 'Counting rule', plain: 'A test counts for a cabin if its air was close enough to the cabin’s air.', numbers: 'Point cabins: oxygen within ' + S.O2_TOL + ' points and pressure within ' + S.P_TOL * 100 + ' %. Moon base: oxygen 30 % or more, pressure up to 10.5 psi. Solids have no recorded pressure and count by oxygen alone. Burner-oxygen flames never count, nor do attempts that never lit.' };
      case 'noflame': return { term: 'Never lit', badge: 'nodata', plain: 'These runs were in this cabin’s air, but the flame did not light, so they count for no cabin.', numbers: 'CFI-G logged “Hot ignition: No” with a burn time of 0 s or none, and no cool flame. NASA’s comments on such runs say “No ignition”, “Failed to ignite” or “Aborted”.' };
      case 'count': { var nn = S.counts(c)[parts[1]]; return { term: KIND[parts[1]] + ' in ' + c.name, badge: nn ? null : 'nodata', plain: nn ? nn + ' ' + KIND[parts[1]] + ' burned in this air.' : 'No test in PSI burned ' + KIND[parts[1]] + ' in this air.', numbers: c.window + '.' }; }
      case 'brief': return { term: c.name, plain: S.brief(c), numbers: 'The numbers are counted by code from NASA’s tables; nothing is typed by hand.' };
      case 'rankrule': return { term: 'Ranking rule', plain: 'Most tests inside the cabin first. Then the smallest gap between the cabin and the investigation’s nearest test.', numbers: 'No weighted score: a count and a gap that anyone can check against the tables.' };
      case 'rank': {
        var R = S.rank(c), r = R.withTests.concat(R.without).filter(function (x) { return x.inv.id === parts[1]; })[0];
        return { term: r.inv.name + ' · ' + r.inv.id, badge: r.n ? null : 'nodata', plain: r.n ? r.n + ' of its ' + r.of + ' tests burned in ' + c.name + ' air: ' + Math.round(r.share * 100) + ' % of all the tests in this cabin.' : 'None of its ' + r.of + ' tests burned in ' + c.name + ' air.',
          numbers: r.n ? 'Rank ' + r.rank + ' of ' + (R.withTests.length + R.without.length) + '.' : 'Nearest: ' + r.near.id + ', ' + S.condText(r.near) + ': ' + S.gapText(r.near, c) + '.', chips: C.chip(r.inv.id) };
      }
      case 'inv': inv = S.invById[parts[1]];
        return { term: inv.name + ' · ' + inv.id, plain: inv.says || inv.title, numbers: (inv.objective ? inv.objective + ' ' : '') + (inv.platform ? 'Flown on: ' + inv.platform + '. ' : '') + inv.pubs + ' publications listed.', chips: C.chip(inv.id) };
      case 'rest': return { term: 'Not ranked', badge: 'nodata', plain: 'These investigations publish their atmosphere only inside per-test files or day logs, not in a table with one row per test.', numbers: 'BRE and s-Flame record oxygen in their day logs; parsing them would move both into the ranking.' };
      case 'col': { var x = COL[parts[parts.length - 1]] || COL[parts[1]]; return { term: x[0], badge: /left/.test(key) ? 'computed' : null, plain: x[1], numbers: /left/.test(key) ? 'Fuel left = (D_ext ÷ D₀)³ × 100, from NASA’s starting diameter D₀ and the diameter D_ext at which the visible flame went out.' : '' }; }
      case 'outside': return t ? { term: 'Outside this cabin', plain: S.inCabin(t, c) ? 'This test burned inside the ' + c.name + ' window.' : S.flame(t) === 'none' ? 'This run never lit: NASA logged no ignition, no burn time and no cool flame, so it counts for no cabin.' : 'This test burned in different air from ' + c.name + '.', numbers: S.condText(t) + ' against ' + c.def + '. ' + c.window + '.' } : null;
      case 'test': {
        var tt = S.findTest(parts[1], parts.slice(2).join(':'));
        if (!tt) return null;
        return { term: tt.id + ' · ' + S.invById[tt.inv].name, plain: (tt.fuel || 'A sample') + (S.flame(tt) === 'none' ? ' did not light in ' : ' burned in ') + S.condText(tt) + (tt.kind === 'burner' ? ', with the oxygen coming from the burner' : '') + '.' + (tt.end ? ' It ended by ' + tt.end.toLowerCase() + '.' : ''),
          numbers: (S.inCabin(tt, c) ? 'Inside ' + c.name + '.' : (S.outsideText(tt, c) || 'Outside ' + c.name) + '.') + ' From ' + tt.file + ', line ' + tt.line + '.', chips: C.chip(tt.inv, tt), facts: testFacts(tt) };
      }
      case 'src': { inv = S.invById[parts[1]]; var st = parts[2] ? S.findTest(parts[1], parts.slice(2).join(':')) : null;
        return { term: 'Source', plain: st ? 'The row this came from in NASA’s experimental table.' : 'The investigation’s record in NASA PSI. The chip opens its DOI.', numbers: st ? st.file + ', line ' + st.line + ' (line 1 is the header).' : inv.title + ' · doi ' + inv.doi, chips: C.chip(parts[1], st) }; }
      case 'badge': return { term: { computed: 'ƒ computed', model: '≈ model', nodata: '∅ no data' }[parts[1]], badge: parts[1], plain: { computed: 'Worked out by us from NASA’s own values, with a formula you can check.', model: 'From the site’s flame model, not measured. Treat it as an estimate.', nodata: 'No test in PSI covers this.' }[parts[1]], numbers: 'No badge means NASA recorded the value.' };
      case 'legend': return { term: { gas: 'Gas flame', droplet: 'Droplet', solid: 'Solid', burner: 'Burner oxygen', lit: 'Light means evidence' }[parts[1]], plain: { gas: 'Fuel gas flowing out of a small porous sphere, burning in the surrounding air.', droplet: 'A drop of liquid fuel, a few millimetres across, burning as a sphere in microgravity.', solid: 'A strip of solid material such as acrylic or fabric.', burner: 'An inside-out flame: oxygen flows from the burner into fuel. Real tests, but not a cabin’s air, so never counted.', lit: 'A mark glows only if NASA burned it in the chosen cabin’s air. Everything else is graphite.' }[parts[1]], numbers: parts[1] === 'burner' ? 'CFI-G and Flame Design lit ' + S.ladder().totals.burner + ' of these, with up to ' + fo2(S.ladder().max.burner) + ' % oxygen in the burner flow.' : '' };
      case 'plot': return { term: 'Cabin plot', plain: 'Each mark is one test, placed by the oxygen and pressure it burned in. The dashed box is the cabin.', numbers: 'Marks at the same spot fan out sideways only; they never move along an axis. Counts above five are written beside the group.' };
      case 'gutter': return { term: 'Pressure not recorded', badge: 'nodata', plain: 'BASS-II and Saffire-II did not record chamber pressure, so these solids sit below the plot, placed by oxygen only.', numbers: 'They count for a cabin by oxygen alone.' };
      case 'count-label': return { term: 'Group count', plain: 'This many tests sit at the same oxygen and pressure.', numbers: 'Click the number to open the investigation.' };
      case 'finding': { var fd = S.findings(c)[+parts[1]]; return { term: 'What they found', plain: fd.text, numbers: 'Counted from NASA’s outcome columns: FLEX “Test end”, CFI-G “Self-ext or flow term”.', chips: fd.chips.map(function (i) { return C.chip(i); }).join('') }; }
      case 'whatif': return { term: 'What-if', badge: 'model', plain: 'You moved the air away from what NASA tested. The flame and readouts now come from the model.', numbers: modelFacts(), facts: modelFacts() };
      case 'truescale': return { term: 'True scale', plain: 'The droplet and flame are drawn at their real size.', numbers: '1 mm = ' + Math.round((C.stageTest.frame() || { ppm: 16 }).ppm) + ' px on this screen. The rings are 5 mm and 10 mm from the droplet’s centre.' };
      case 'flame': case 'viewport': return { term: 'The flame', badge: 'model', plain: 'The droplet is measured; the flame around it is a physics model fed by the droplet’s measured burning rate.',
        numbers: 'A reduction of Fire-X (Wrede et al., ACM TOG 2025): heat, species and a one-step reaction on an axisymmetric grid. Its radiation constant is fitted per test so the model’s flame-out matches NASA’s time.', chips: '<a class="chip" href="https://doi.org/10.1145/3763338" target="_blank" rel="noopener">Wrede et al. 2025</a>' };
      case 'unlit': return { term: 'Unlit', badge: 'nodata', plain: 'No flame is drawn, because the site has no model it trusts for this test.', numbers: 'Unknown stays unlit: no guess is drawn to look like data.' };
      case 'time': return { term: 'Time since ignition', plain: 'Drag to replay any moment of the burn.', numbers: p && p.tested ? 'The burn ends where NASA logged it: ' + p.end + ' at ' + fmt(p.tEnd, 1) + ' s' + (p.tComputed ? ' (time worked out by the d² law from NASA’s burning rate and diameters).' : '.') : 'In a what-if the model decides when it ends. Changing the air burns the droplet again from ignition.' };
      case 'gravity': return { term: 'Gravity', badge: 'nodata', plain: 'Every flame here burned in microgravity. PSI has no test at Moon or Mars gravity.', numbers: 'NASA plans partial-gravity flame tests (LUCI, FM2). Until then microgravity and Earth results bound what happens in between.' };
      case 'strip': {
        var bt = C.store.test(), w = C.store.state.wi; if (!bt || !w) return null;
        if (parts[1] === 'start') return { term: 'Started from', plain: 'The real test you began with, before moving a slider.', numbers: bt.id + ': ' + S.condText(bt) + ', ' + bt.end.toLowerCase() + '.', chips: C.chip(bt.inv, bt) };
        var nm = S.nearestMeasured(w, bt.fuel, bt.d0);
        return { term: 'Nearest measured', plain: 'The real FLEX test closest to the air you set. Open it to see what actually happened.', numbers: nm.test.id + ' (' + nm.diff + '): ' + nm.test.end.toLowerCase() + (nm.test.burnRaw ? ' after ' + nm.test.burnRaw + ' s' : ', burn time not recorded') + (nm.test.fuelLeft != null ? ', ' + fmt(nm.test.fuelLeft, 1) + ' % of the fuel left' : '') + '.', chips: C.chip(nm.test.inv, nm.test), facts: testFacts(nm.test) };
      }
      case 'slider': {
        var sk = parts[1], r = t ? S.flexRange(t.fuel) : null;
        if (!r) return null;
        if (sk === 'o2') return { term: 'Oxygen', plain: 'Change how much oxygen is in the air around the droplet.', numbers: 'FLEX burned ' + t.fuel.toLowerCase() + ' at ' + fo2(r.o2[0]) + '–' + fo2(r.o2[1]) + ' % oxygen. The solid part of the track is where it has tests; the dashed part is model only. Ticks mark the ISS (21 %) and the Moon base (30 %).' };
        if (sk === 'psi') return { term: 'Pressure', plain: 'Change the chamber pressure.', numbers: 'FLEX burned ' + t.fuel.toLowerCase() + ' at ' + fmt(r.psi[0], 1) + '–' + fmt(r.psi[1], 1) + ' psi. Ticks: spacesuit 4.3, Moon base 10.2, ISS 14.7 psi.' };
        return { term: 'Diluent', plain: 'Add carbon dioxide or helium to the air, as FLEX did to find out how much it takes to put the flame out.', numbers: 'FLEX used up to ' + fo2(r.CO2[1]) + ' % CO₂ and ' + fo2(r.He[1]) + ' % helium with ' + t.fuel.toLowerCase() + '. NASA lowered the oxygen as it added CO₂, so the sliders do not move together by themselves.' };
      }
      case 'readout': {
        if (!t) return null;
        var tested = !C.store.state.wi, o = p && p.outcome, which = parts[1];
        if (which === 'left') {
          if (tested && t.fuelLeft != null) return { term: 'Fuel left at flame-out', badge: 'computed', plain: 'How much of the droplet was still liquid when its visible flame went out.',
            numbers: '(' + fmt(t.dext, 2) + ' ÷ ' + fmt(t.d0, 2) + ')³ = ' + fmt(t.fuelLeft, 1) + ' %. ' + (t.fuelLeft >= 50 ? 'The flame stopped; most of the fuel did not burn.' : 'The flame stopped with fuel still there.'), chips: C.chip(t.inv, t, 'computed'), facts: testFacts(t) };
          if (tested) return { term: 'Fuel left at flame-out', badge: t.end === 'Extinction' ? 'nodata' : null, plain: t.end === 'Extinction' ? 'NASA logged no flame-out diameter for this test, so the fuel left cannot be worked out.' : 'This droplet had no flame-out: it ' + (t.end === 'Disruption' ? 'broke apart while still burning.' : 'burned away.'), numbers: 'Fuel left = (D_ext ÷ D₀)³, only for tests that ended in extinction.', chips: C.chip(t.inv, t), facts: testFacts(t) };
          return { term: 'Fuel left at flame-out', badge: 'model', plain: o && o.kind === 'model' ? 'In the model the flame goes out with this much of the droplet still liquid.' : 'In the model the flame does not go out before the droplet is gone.', numbers: o && o.kind === 'model' ? '(' + fmt(o.D, 2) + ' ÷ ' + fmt(t.d0, 2) + ')³ = ' + fmt(o.fuelLeft, 1) + ' %, with the droplet shrinking by the d² law at ' + fmt(p.K, 2) + ' mm²/s.' : modelFacts(), facts: modelFacts() };
        }
        if (which === 'burn') return tested ? { term: 'Burn time', plain: 'How long the droplet burned, from ignition to the end NASA logged.', numbers: t.burnRaw ? t.burnRaw + ' s, as recorded.' : 'Not recorded.' + (p && p.tComputed ? ' The replay ends at ' + fmt(p.tEnd, 1) + ' s, worked out by the d² law from NASA’s burning rate and diameters.' : ''), chips: C.chip(t.inv, t), facts: testFacts(t) } : { term: 'Burn time', badge: 'model', plain: 'How long the flame lasts in the model.', numbers: modelFacts(), facts: modelFacts() };
        if (which === 'rate') return tested ? { term: 'Burning rate', plain: 'How fast the droplet shrinks: the square of its diameter drops by this much every second (the d² law).', numbers: 'K = ' + t.rate + ' mm²/s. ' + (t.dext > 0 ? 'Check: (' + t.d0 + '² − ' + t.dext + '²) ÷ ' + t.burn + ' s = ' + fmt((t.d0 * t.d0 - t.dext * t.dext) / t.burn, 2) + ' mm²/s from NASA’s diameters.' : ''), chips: C.chip(t.inv, t), facts: testFacts(t) }
          : { term: 'Burning rate', badge: 'model', plain: 'Estimated from all of FLEX: a straight-line fit of burning rate against fuel, oxygen, helium, CO₂, pressure and droplet size.', numbers: 'K ≈ ' + fmt(p.K, 2) + ' mm²/s. Fit to ' + S.DATA.flexFit.n + ' tests, r² = ' + S.DATA.flexFit.r2 + ': it explains about ' + Math.round(S.DATA.flexFit.r2 * 100) + ' % of the spread.', facts: modelFacts() };
        if (which === 'end') return tested ? { term: 'Ended by', plain: 'NASA’s word for how the burn ended: ' + t.end + ', ' + (END[t.end] || '') + '.', numbers: 'Extinction: the flame went out with fuel left. Disruption: the droplet broke apart, often from bubbles boiling inside it. Completion: the droplet burned away.', chips: C.chip(t.inv, t), facts: testFacts(t) }
          : { term: 'Ended by', badge: 'model', plain: 'How the burn ends in the model. The model can say whether the flame goes out; it cannot predict a droplet breaking apart.', numbers: modelFacts(), facts: modelFacts() };
        if (which === 'd0') return { term: 'Starting diameter', plain: 'The droplet’s size at ignition, measured by NASA.', numbers: 'D₀ = ' + t.d0 + ' mm.', chips: C.chip(t.inv, t) };
        if (which === 'dext') return { term: 'Flame-out diameter', plain: 'The droplet’s size when its visible flame went out.', numbers: t.dext ? 'D_ext = ' + t.dext + ' mm.' : '', chips: C.chip(t.inv, t) };
        return null;
      }
    }
    return null;
  }
  var END = { Disruption: 'the droplet broke apart', Extinction: 'the flame went out', Completion: 'the droplet burned away' };
  function fallback(el) {
    var txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { term: txt || 'This part of the page', plain: 'Flamey has no note for this yet. Right-click a number, a row, a mark or a label for its source.', numbers: '' };
  }

  // ------------------------------------------------------------------ popover and flight
  function dockPoint() { var d = $('dock-flame') || $('dock'); var r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function close() {
    if (!pop) return false;
    pop.remove(); pop = null; current = null;
    document.querySelectorAll('.explained').forEach(function (e) { e.classList.remove('explained'); });
    if (fly) {
      var f = fly, to = dockPoint(); fly = null;
      f.style.transform = 'translate(' + to.x + 'px,' + to.y + 'px)';
      setTimeout(function () { f.remove(); C.cabins.renderDock(false); }, C.reduced ? 0 : 320);
    } else C.cabins.renderDock(false);
    return true;
  }
  function explain(target, x, y) {
    if (pop) { pop.remove(); pop = null; }
    document.querySelectorAll('.explained').forEach(function (e) { e.classList.remove('explained'); });
    var el = target && target.closest ? target.closest('[data-x]') : null, e = null;
    if (el) { try { e = entry(el.dataset.x, el); } catch (err) { e = null; } }
    e = e || fallback(el || target);
    current = e;
    if (el && /^readout:/.test(el.dataset.x)) el.classList.add('explained');
    // the flame leaves the dock and flies to the click
    if (!fly) {
      var from = dockPoint();
      fly = document.createElement('div'); fly.className = 'flamey-fly'; fly.innerHTML = '<span class="flame-dot"></span>';
      fly.style.transition = 'none'; fly.style.transform = 'translate(' + from.x + 'px,' + from.y + 'px)';
      document.body.appendChild(fly); void fly.offsetWidth; fly.style.transition = '';
      C.cabins.renderDock(true);
    }
    pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Flamey explains: ' + e.term);
    pop.innerHTML = '<div class="term">' + esc(e.term) + (e.badge ? C.badge(e.badge) : '') + '</div>' +
      '<p class="plain">' + esc(e.plain) + '</p>' + (e.numbers ? '<p class="numbers">' + esc(e.numbers) + '</p>' : '') +
      (e.chips ? '<div class="src">' + e.chips + '</div>' : '') +
      '<form><input name="q" type="text" placeholder="Ask a follow-up" autocomplete="off" maxlength="400" aria-label="Ask Flamey a follow-up question"></form><div class="answer" hidden></div>';
    pop.style.visibility = 'hidden'; pop.style.left = '0px'; pop.style.top = '0px';
    document.body.appendChild(pop);
    // place it beside what it explains, never over it: above, else below, else to the side of the click
    var W = pop.offsetWidth, PH = pop.offsetHeight, VW = window.innerWidth, VH = window.innerHeight, px, py;
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && r.height > VH * 0.5) r = null;              // a whole panel: anchor to the click instead
    if (r && r.top - PH - 16 >= 8) { px = r.left + Math.min(r.width, 40) - 24; py = r.top - PH - 16; }
    else if (r && r.bottom + PH + 16 <= VH - 8) { px = r.left + Math.min(r.width, 40) - 24; py = r.bottom + 16; }
    else { px = x + 16 + W < VW - 8 ? x + 16 : x - W - 16; py = y - PH / 2; }
    px = Math.max(8, Math.min(VW - W - 8, px)); py = Math.max(8, Math.min(VH - PH - 8, py));
    pop.style.left = px + 'px'; pop.style.top = py + 'px';
    fly.style.transform = 'translate(' + (px - 8) + 'px,' + (py - 8) + 'px)';
    setTimeout(function () { if (pop) pop.style.visibility = ''; }, C.reduced ? 0 : 300);
    pop.querySelector('form').addEventListener('submit', function (ev) { ev.preventDefault(); ask(this.q.value); });
  }
  function ask(q) {
    q = (q || '').trim();
    if (!q || !pop || !current) return;
    var out = pop.querySelector('.answer'); out.hidden = false; out.className = 'answer wait'; out.textContent = 'Thinking…';
    var facts = ['On screen: ' + current.term + '. ' + current.plain + ' ' + (current.numbers || ''), current.facts || '', cabinFacts(), testFacts(C.store.test()), modelFacts()].filter(Boolean).join('\n');
    var mine = pop;
    fetch('api/flamey', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, facts: facts }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        if (pop !== mine) return;
        out.className = 'answer';
        if (res.ok && res.j.answer) out.innerHTML = esc(res.j.answer);
        else out.textContent = res.status === 429 && res.j && res.j.error === 'daily limit' ? 'Flamey has answered all the follow-ups it can today. Everything above comes straight from NASA’s rows.'
          : res.status === 429 ? 'Too many questions at once. Try again in a minute.' :'Follow-up answers are off on this copy of the site. Everything above comes straight from NASA’s rows.';
      })
      .catch(function () { if (pop === mine) { out.className = 'answer'; out.textContent = 'Follow-up answers need the site’s server (node site_build/serve.mjs). Everything above comes straight from NASA’s rows.'; } });
  }

  C.flamey = {
    init: function () {
      $('dock').addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (pop) { close(); return; }
        asking = !asking; document.body.classList.toggle('asking', asking);
      });
      document.addEventListener('mousedown', function (ev) { if (pop && !pop.contains(ev.target) && ev.button === 0 && !ev.target.closest('#dock')) close(); }, true);
      window.addEventListener('resize', function () { close(); });
    },
    explain: explain, close: close,
    /** In "Ask Flamey" mode the next click explains instead of acting. */
    intercept: function (ev) {
      if (ev.target.closest('.popover')) return true;
      var ex = ev.target.closest('[data-act="explain"]');
      if (asking || ex) {
        if (ev.target.closest('#dock')) return true;
        asking = false; document.body.classList.remove('asking');
        ev.preventDefault(); explain(ex || ev.target, ev.clientX, ev.clientY); return true;
      }
      return false;
    }
  };
})();
