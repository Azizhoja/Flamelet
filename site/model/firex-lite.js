/*
 * Fire-X lite: a droplet-flame reduction of
 *   H. Wrede et al., "Fire-X: Extinguishing Fire with Stoichiometric Heat Release",
 *   ACM Trans. Graph. 44(6), Art. 268, 2025. doi:10.1145/3763338 (CC BY 4.0)
 *
 * Taken from the paper (equation numbers are the paper's):
 *   Eq. 1  Boussinesq momentum: buoyancy a = g (1 - T_amb / T), incompressible projection.
 *   Eq. 2  Heat: diffusion + radiative exchange + combustion source.
 *   Eq. 3  Species transport with per-species diffusion and a phase-change source.
 *   Eq. 4  Heat of combustion from the fuel formula: 417 (c + h/4 - o/2) kJ/mol.
 *   Eq. 5  One-step Arrhenius rate  w = A exp(-Ea/RT) [F]^a [O]^b  (Westbrook & Dryer 1981 values).
 *   Eq. 6  Heat release q = eta * dH * w.
 *   Eq. 7  Species change = stoichiometric coefficient * molar mass * w.
 *   Eq. 8  Density from the ideal gas law with the local mixture.
 *   Sec. 5.6 rendering: soot ("residual") blackbody + CH* and C2* chemiluminescence (see flame-render.js).
 *
 * Left out (not needed for one droplet): SPH liquids, water evaporation, solids, path tracing.
 *
 * Changed for speed and for this geometry (each was tested in development experiments that are not part of this repo):
 *   - Axisymmetric (r, z) grid instead of 3D: a 3D sphere or plume for the price of 2D.
 *   - Implicit, line-by-line (LOD) diffusion, so the time step is not tied to dx^2/D.
 *   - The droplet is a fuel source at NASA's measured burning rate (d^2 law), not an SPH liquid.
 *   - Low-Mach dilatation: heat release and evaporation enter the projection as a volume source.
 *   - In 0 g nothing makes vorticity, so the flow is the potential flow of those sources, re-projected
 *     from rest each step (self-advection only bred spurious swirl).
 *   - Under gravity, a sub-grid flame holder keeps the flame base on the drop (the real base sits
 *     < 1 mm away, below the grid size; without it the coarse flame blows off).
 *   - Radiation is optically thin (TNF Planck-mean CO2/H2O) times one constant per test, fitted to
 *     NASA's flame-out time; that constant absorbs reabsorption, soot and grid effects.
 *   - Far-field boundary decays like 1/distance (exact for spherical diffusion) instead of a wall.
 *
 * No DOM; runs in browsers and in Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FireXLite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 8.314462618;        // J/(mol K)
  var SIGMA = 5.670374419e-8; // W/(m^2 K^4)
  var ATM = 101325;           // Pa

  // Gas data. M kg/mol; k300 W/(m K); molar cp J/(mol K) at 300 K and 2000 K (JANAF);
  // fv = Fuller diffusion volume (Fuller, Schettler & Giddings 1966).
  var GASES = {
    O2:  { M: 0.031998, k300: 0.0263, cp300: 29.38, cp2000: 37.78, fv: 16.3 },
    N2:  { M: 0.028014, k300: 0.0259, cp300: 29.12, cp2000: 35.97, fv: 18.5 },
    CO2: { M: 0.044009, k300: 0.0166, cp300: 37.22, cp2000: 60.35, fv: 26.7 },
    H2O: { M: 0.018015, k300: 0.0186, cp300: 33.60, cp2000: 51.18, fv: 13.1 },
    He:  { M: 0.004003, k300: 0.1513, cp300: 20.79, cp2000: 20.79, fv: 2.67 }
  };

  // Fuels. rhoL: liquid density, LHV: lower heating value.
  // wd = Westbrook & Dryer (1981) one-step parameters: A in cgs units, Ea in kcal/mol.
  // cpVap: vapour heat capacity, J/(kg K), mid-range. sootiness: 0 = no soot (oxygenated, no C-C bond).
  // c2ch: C2*/CH* chemiluminescence ratio used only for colour (visual, not data).
  var FUELS = {
    heptane: { label: 'n-heptane', c: 7, h: 16, o: 0, M: 0.100205, rhoL: 684, Tb: 371.6, LHV: 44.6e6,
               wd: { A: 5.1e11, Ea: 30.0, a: 0.25, b: 1.5 }, cpVap: 2900, sootiness: 1.0, c2ch: 0.8 },
    methanol: { label: 'methanol', c: 1, h: 4, o: 1, M: 0.032042, rhoL: 792, Tb: 337.8, LHV: 19.9e6,
               wd: { A: 3.2e12, Ea: 30.0, a: 0.25, b: 1.5 }, cpVap: 1900, sootiness: 0.0, c2ch: 0.15 }
  };

  // Fire-X Eq. 4: lower heat of combustion from the formula, J/mol (positive = released).
  function heatOfCombustionMolar(f) { return 417e3 * (f.c + 0.25 * f.h - 0.5 * f.o); }

  // Planck-mean absorption coefficients, 1/(m atm), TNF workshop fits (Barlow et al.), 300-2500 K.
  function aH2O(T) {
    var x = 1000 / T;
    return -0.23093 + x * (-1.12390 + x * (9.41530 + x * (-2.99880 + x * (0.51382 + x * -1.86840e-5))));
  }
  function aCO2(T) {
    var x = 1000 / T;
    return 18.741 + x * (-121.310 + x * (273.500 + x * (-194.050 + x * (56.310 + x * -5.8169))));
  }

  function fullerD(T, pAtm, M1, v1, M2, v2) { // binary diffusion, m^2/s (Fuller 1966)
    var Mi = Math.sqrt(1 / (M1 * 1000) + 1 / (M2 * 1000));
    var s = Math.cbrt(v1) + Math.cbrt(v2);
    return 1.013e-3 * Math.pow(T, 1.75) * Mi / (pAtm * s * s) * 1e-4;
  }

  /**
   * Gas-phase properties for an ambient of mole fractions x {o2,n2,co2,he} at p (kPa).
   * The inert part (everything but O2) keeps the ambient mix. Products are the fuel's
   * stoichiometric CO2 + H2O, lumped into one species.
   */
  function mixture(fuelName, pKpa, x) {
    var f = FUELS[fuelName];
    if (!f) throw new Error('unknown fuel ' + fuelName);
    var p = pKpa * 1000, pAtm = p / ATM;
    var xo = x.o2 || 0, xn = x.n2 || 0, xc = x.co2 || 0, xh = x.he || 0;
    var sum = xo + xn + xc + xh; xo /= sum; xn /= sum; xc /= sum; xh /= sum;
    var G = GASES;
    // inert (ambient minus O2)
    var xi = xn + xc + xh, inN = xn / xi, inC = xc / xi, inH = xh / xi;
    if (!(xi > 0)) { inN = 1; inC = 0; inH = 0; }
    var M_I = inN * G.N2.M + inC * G.CO2.M + inH * G.He.M;
    var yCO2_I = inC * G.CO2.M / M_I;           // mass fraction of CO2 inside the inert
    var cpI300 = (inN * G.N2.cp300 + inC * G.CO2.cp300 + inH * G.He.cp300) / M_I;
    var cpI2000 = (inN * G.N2.cp2000 + inC * G.CO2.cp2000 + inH * G.He.cp2000) / M_I;
    // ambient mass fractions
    var Mamb = xo * G.O2.M + xi * M_I;
    var YO_amb = xo * G.O2.M / Mamb;
    // stoichiometry: CcHhOo + nO2 O2 -> c CO2 + h/2 H2O
    var nO2 = f.c + 0.25 * f.h - 0.5 * f.o;
    var mP = f.c * G.CO2.M + 0.5 * f.h * G.H2O.M;   // kg products per mol fuel
    var M_P = mP / (f.c + 0.5 * f.h);
    var yCO2_P = f.c * G.CO2.M / mP;
    var cpP300 = (f.c * G.CO2.cp300 + 0.5 * f.h * G.H2O.cp300) / mP;
    var cpP2000 = (f.c * G.CO2.cp2000 + 0.5 * f.h * G.H2O.cp2000) / mP;
    var sO = nO2 * G.O2.M / f.M;                    // kg O2 per kg fuel
    var dHmol = heatOfCombustionMolar(f);           // J/mol, Eq. 4
    // transport. Mixture conductivity: mole-fraction mean (adequate here), k ~ T^0.75.
    var k300 = xo * G.O2.k300 + xn * G.N2.k300 + xc * G.CO2.k300 + xh * G.He.k300;
    var cpAmb300 = (xo * G.O2.cp300 + xn * G.N2.cp300 + xc * G.CO2.cp300 + xh * G.He.cp300) / Mamb;
    var alpha300 = k300 * R * 300 / (p * Mamb * cpAmb300);
    // fuel vapour in the ambient (Blanc's law over Fuller binaries), and O2 in the ambient
    var vF = 15.9 * f.c + 2.31 * f.h + 6.11 * f.o;
    var inv = 0, parts = [[xo, G.O2], [xn, G.N2], [xc, G.CO2], [xh, G.He]];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i][0] > 0) inv += parts[i][0] / fullerD(300, pAtm, f.M, vF, parts[i][1].M, parts[i][1].fv);
    }
    var DF300 = 1 / inv;
    return {
      fuel: f, fuelName: fuelName, p: p, pAtm: pAtm, x: { o2: xo, n2: xn, co2: xc, he: xh },
      Mamb: Mamb, M_I: M_I, M_P: M_P, YO_amb: YO_amb, yCO2_I: yCO2_I, yCO2_P: yCO2_P,
      cpI300: cpI300, cpI2000: cpI2000, cpP300: cpP300, cpP2000: cpP2000,
      cpO300: G.O2.cp300 / G.O2.M, cpO2000: G.O2.cp2000 / G.O2.M,
      nO2: nO2, sO: sO, sP: mP / f.M, dHmol: dHmol, Q: dHmol / f.M,  // J/kg fuel (Eq. 4)
      alpha300: alpha300, DF300: DF300, LeF: alpha300 / DF300,
      // Burke-Schumann check: classical quasi-steady flame radius factor ln(1 + Y_O,inf / s)
      lnOxidizer: Math.log(1 + YO_amb / sO)
    };
  }

  /** d^2-law mass burning rate, kg/s: (pi/4) rhoL D K. */
  function massBurningRate(fuelName, dMeters, kM2s) {
    return Math.PI / 4 * FUELS[fuelName].rhoL * dMeters * kM2s;
  }

  // ------------------------------------------------------------------ solver
  /**
   * opts: nr, nz, h (m), zDrop (m from bottom), geometry 'axisym'|'planar',
   *       diffusion 'lod'|'explicit', dilatation (bool), viscosity (bool),
   *       fuel, pKpa, x {o2,n2,co2,he}, g (m/s^2), Tamb (K),
   *       eta (Fire-X heat efficiency), radiation (multiplier), pressureIters, cflMax, dtMax
   */
  function createSim(opts) {
    var o = Object.assign({
      nr: 40, nz: 86, h: 0.75e-3, zDrop: null, geometry: 'axisym', diffusion: 'lod',
      dilatation: true, viscosity: 'auto', fuel: 'heptane', pKpa: 101.3,
      x: { o2: 0.21, n2: 0.79, co2: 0, he: 0 }, g: 0, Tamb: 298, eta: 1, radiation: 1,
      pressureIters: 24, pressureIters0: 12, sor: 1.7, depth: 3.5e-3, potential0g: true, igniteMin: 0.1, anchor: true, diffNumber: 16, cflMax: 2.5, dtMax: 0.02, sootForm: 2.2e4, sootOx: 4e5, stefan: true
    }, opts || {});
    var nr = o.nr, nz = o.nz, h = o.h, N = nr * nz;
    var axisym = o.geometry === 'axisym';
    if (o.zDrop == null) o.zDrop = nz * h * 0.5;

    // geometry weights (r at faces and centres); planar: all 1 except the symmetry face.
    var rf = new Float64Array(nr + 1), rc = new Float64Array(nr), vol = new Float64Array(nr);
    for (var i = 0; i <= nr; i++) rf[i] = axisym ? i * h : (i === 0 ? 0 : 1);
    for (i = 0; i < nr; i++) {
      rc[i] = axisym ? (i + 0.5) * h : 1;
      vol[i] = axisym ? 2 * Math.PI * (i + 0.5) * h * h * h : h * h * o.depth; // planar: a slab o.depth thick
    }

    var F = {
      T: new Float32Array(N), Yf: new Float32Array(N), Yo: new Float32Array(N),
      Yp: new Float32Array(N), Ys: new Float32Array(N), q: new Float32Array(N),
      ur: new Float32Array((nr + 1) * nz), uz: new Float32Array(nr * (nz + 1)),
      p: new Float32Array(N), div: new Float32Array(N), src: new Float32Array(N)
    };
    var tmp = new Float32Array(Math.max(N, (nr + 1) * (nz + 1)));
    // Diffusion is (1/rho) div(rho D grad phi), with rho D ~ T^0.75 and rho = p M / (R T) local.
    // So: base * (rho_amb,300 / rho_c) * div((T_f/300)^0.75 grad phi). Gc = face weight,
    // Mc = rho_amb,300 / rho_c = (T_c/300) (M_amb / M_c). Using air density in fuel-rich cells
    // (M 3.4x higher for heptane) leaks mass.
    var T0 = new Float32Array(N), Gc = new Float32Array(N), Mc = new Float32Array(N);
    var isDrop = new Uint8Array(N), srcW = new Float32Array(N);
    var urTmp = new Float32Array((nr + 1) * nz), uzTmp = new Float32Array(nr * (nz + 1));
    var L = Math.max(nr, nz) + 2;
    var ta = new Float64Array(L), tb = new Float64Array(L), tc = new Float64Array(L),
        td = new Float64Array(L), tx = new Float64Array(L);
    // far-field ratio: ghost cell sits one cell further from the droplet (1/distance decay)
    var betaR = new Float32Array(nz), betaS = new Float32Array(nr), betaN = new Float32Array(nr);

    var mix, state = {
      t: 0, g: o.g, react: true, dropD: 0, mdot: 0, dropOn: false, igniteLeft: 0,
      steps: 0, lastSub: 0, maxU: 0
    };
    var g075 = new Float32Array(300); // (T/300)^0.75 per 10 K, 0..2990 K

    function computeBetas() {
      var zd = o.zDrop, zc;
      for (var j = 0; j < nz; j++) {
        zc = (j + 0.5) * h - zd;
        var ri = Math.hypot((nr - 0.5) * h, zc), rg = Math.hypot((nr + 0.5) * h, zc);
        betaR[j] = axisym ? ri / rg : 0;   // planar (naive port): fixed ambient at the boundary
      }
      for (var i2 = 0; i2 < nr; i2++) {
        var x = (i2 + 0.5) * h;
        var dS = Math.hypot(x, 0.5 * h - zd), gS = Math.hypot(x, -0.5 * h - zd);
        var dN = Math.hypot(x, (nz - 0.5) * h - zd), gN = Math.hypot(x, (nz + 0.5) * h - zd);
        betaS[i2] = axisym ? dS / gS : 0;
        betaN[i2] = axisym ? dN / gN : 0;
      }
    }

    function setConditions(c) {
      if (c.fuel) o.fuel = c.fuel;
      if (c.pKpa != null) o.pKpa = c.pKpa;
      if (c.x) o.x = c.x;
      if (c.g != null) { o.g = c.g; state.g = c.g; }
      mix = mixture(o.fuel, o.pKpa, o.x);
      for (var k = 0; k < 300; k++) g075[k] = Math.pow(Math.max(k * 10, 200) / 300, 0.75);
    }

    function reset() {
      F.T.fill(o.Tamb); F.Yf.fill(0); F.Yo.fill(mix.YO_amb); F.Yp.fill(0); F.Ys.fill(0);
      F.q.fill(0); F.ur.fill(0); F.uz.fill(0); F.p.fill(0); F.src.fill(0);
      state.t = 0; state.steps = 0; state.igniteLeft = 0; state.react = true;
    }

    setConditions({});
    computeBetas();
    reset();

    // ---------------------------------------------------------------- helpers
    function lutG(T) { var k = (T * 0.1) | 0; return g075[k < 0 ? 0 : (k > 299 ? 299 : k)]; }
    function lutAlpha(T) { return mix.alpha300 * lutG(T) * T / 300; } // = alpha300 (T/300)^1.75

    function sampleUr(x, z) { // ur lives at (i h, (j+.5) h), i = 0..nr; odd across the axis
      var sgn = 1; if (x < 0) { x = -x; sgn = -1; }
      var fx = x / h, fz = z / h - 0.5, w = nr + 1;
      if (fx > nr - 0.0001) fx = nr - 0.0001;
      if (fz < 0) fz = 0; else if (fz > nz - 1.0001) fz = nz - 1.0001;
      var i0 = fx | 0, j0 = fz | 0, ax = fx - i0, az = fz - j0, b = j0 * w + i0, u = F.ur;
      return sgn * ((u[b] * (1 - ax) + u[b + 1] * ax) * (1 - az) + (u[b + w] * (1 - ax) + u[b + w + 1] * ax) * az);
    }
    function sampleUz(x, z) { // uz lives at ((i+.5) h, j h), j = 0..nz; even across the axis
      if (x < 0) x = -x;
      var fx = x / h - 0.5, fz = z / h;
      if (fx < 0) fx = 0; else if (fx > nr - 1.0001) fx = nr - 1.0001;
      if (fz > nz - 0.0001) fz = nz - 0.0001; else if (fz < 0) fz = 0;
      var i0 = fx | 0, j0 = fz | 0, ax = fx - i0, az = fz - j0, b = j0 * nr + i0, u = F.uz;
      return (u[b] * (1 - ax) + u[b + 1] * ax) * (1 - az) + (u[b + nr] * (1 - ax) + u[b + nr + 1] * ax) * az;
    }

    // ------------------------------------------------------------- advection
    // Semi-Lagrangian advection of all cell scalars. The back-traced sample point is the same
    // for every scalar, so its index and weights are computed once and reused.
    var advIdx = new Int32Array(N), advAx = new Float32Array(N), advAz = new Float32Array(N);
    var advMove = new Uint8Array(N);
    function advectScalars(list, dt) {
      var ur = F.ur, uz = F.uz, w = nr + 1, any = false, still = 1e-4 * h / dt;
      for (var j = 0; j < nz; j++) {
        for (var i = 0; i < nr; i++) {
          var c = j * nr + i;
          var vr = 0.5 * (ur[j * w + i] + ur[j * w + i + 1]);
          var vz = 0.5 * (uz[j * nr + i] + uz[(j + 1) * nr + i]);
          if ((vr < 0 ? -vr : vr) + (vz < 0 ? -vz : vz) < still) { advMove[c] = 0; continue; }
          var x = (i + 0.5) * h - dt * vr, z = (j + 0.5) * h - dt * vz;
          if (x < 0) x = -x;
          var fx = x / h - 0.5, fz = z / h - 0.5;
          if (fx < 0) fx = 0; else if (fx > nr - 1.0001) fx = nr - 1.0001;
          if (fz < 0) fz = 0; else if (fz > nz - 1.0001) fz = nz - 1.0001;
          var i0 = fx | 0, j0 = fz | 0;
          advIdx[c] = j0 * nr + i0; advAx[c] = fx - i0; advAz[c] = fz - j0; advMove[c] = 1; any = true;
        }
      }
      if (!any) return;
      for (var k = 0; k < list.length; k++) {
        var f = list[k];
        for (var c2 = 0; c2 < N; c2++) {
          if (advMove[c2] === 0) { tmp[c2] = f[c2]; continue; }
          var b = advIdx[c2], ax = advAx[c2], az = advAz[c2];
          tmp[c2] = (f[b] * (1 - ax) + f[b + 1] * ax) * (1 - az) + (f[b + nr] * (1 - ax) + f[b + nr + 1] * ax) * az;
        }
        f.set(tmp.subarray(0, N));
      }
    }
    function advectVelocity(dt) {
      var w = nr + 1, i, j, x, z, vr, vz;
      for (j = 0; j < nz; j++) {
        for (i = 1; i <= nr; i++) {
          x = i * h; z = (j + 0.5) * h;
          vr = F.ur[j * w + i]; vz = sampleUz(x, z);
          urTmp[j * w + i] = sampleUr(x - dt * vr, z - dt * vz);
        }
        urTmp[j * w] = 0;
      }
      for (j = 0; j <= nz; j++) {
        for (i = 0; i < nr; i++) {
          x = (i + 0.5) * h; z = j * h;
          vz = F.uz[j * nr + i]; vr = sampleUr(x, z);
          uzTmp[j * nr + i] = sampleUz(x - dt * vr, z - dt * vz);
        }
      }
      F.ur.set(urTmp); F.uz.set(uzTmp);
    }

    // ----------------------------------------------------- implicit diffusion
    function thomas(n) { // solves a x[i-1] + b x[i] + c x[i+1] = d
      for (var k = 1; k < n; k++) {
        var m = ta[k] / tb[k - 1];
        tb[k] -= m * tc[k - 1]; td[k] -= m * td[k - 1];
      }
      tx[n - 1] = td[n - 1] / tb[n - 1];
      for (k = n - 2; k >= 0; k--) tx[k] = (td[k] - tc[k] * tx[k + 1]) / tb[k];
    }
    // Implicit LOD diffusion of several fields that share one diffusivity (one matrix per line,
    // factored once, solved for each field). phis: fields; fars: far-field values;
    // base: diffusivity at 300 K and this pressure; topOpen: zero-gradient top (outflow).
    var fInv = new Float64Array(L), fCp = new Float64Array(L), fLo = new Float64Array(L), fDp = new Float64Array(L);
    function factorLine(n) { // ta, tb, tc -> fLo, fInv, fCp
      var den = tb[0]; fInv[0] = 1 / den; fCp[0] = tc[0] / den; fLo[0] = 0;
      for (var k = 1; k < n; k++) {
        den = tb[k] - ta[k] * fCp[k - 1];
        fLo[k] = ta[k]; fInv[k] = 1 / den; fCp[k] = tc[k] / den;
      }
    }
    function diffuseGroup(phis, fars, base, dt, topOpen) {
      var i, j, c, k, f, n, h2 = h * h, dE, dW, G = Gc, m, phi, far, nf = phis.length, bLo, bHi, x;
      for (j = 0; j < nz; j++) {            // r sweep
        bHi = 0;
        for (i = 0; i < nr; i++) {
          c = j * nr + i; m = base * Mc[c] / (rc[i] * h2);
          dW = i > 0 ? 0.5 * (G[c] + G[c - 1]) * rf[i] * m : 0;
          dE = (i < nr - 1 ? 0.5 * (G[c] + G[c + 1]) : G[c]) * rf[i + 1] * m;
          ta[i] = -dt * dW; tc[i] = i < nr - 1 ? -dt * dE : 0; tb[i] = 1 + dt * (dW + dE);
          if (i === nr - 1) { tb[i] -= dt * dE * betaR[j]; bHi = dt * dE * (1 - betaR[j]); }
        }
        factorLine(nr);
        for (f = 0; f < nf; f++) {
          phi = phis[f]; far = fars[f]; c = j * nr;
          x = phi[c] * fInv[0]; fDp[0] = x;
          for (k = 1; k < nr; k++) {
            var rhs = phi[c + k]; if (k === nr - 1) rhs += bHi * far;
            x = (rhs - fLo[k] * x) * fInv[k]; fDp[k] = x;
          }
          phi[c + nr - 1] = x;
          for (k = nr - 2; k >= 0; k--) { x = fDp[k] - fCp[k] * x; phi[c + k] = x; }
        }
      }
      for (i = 0; i < nr; i++) {            // z sweep
        bLo = 0; bHi = 0;
        for (j = 0; j < nz; j++) {
          c = j * nr + i; m = base * Mc[c] / h2;
          var dS = 0.5 * (G[c] + (j > 0 ? G[c - nr] : G[c])) * m;
          var dN = 0.5 * (G[c] + (j < nz - 1 ? G[c + nr] : G[c])) * m;
          ta[j] = j > 0 ? -dt * dS : 0; tc[j] = j < nz - 1 ? -dt * dN : 0; tb[j] = 1 + dt * (dS + dN);
          if (j === 0) { tb[j] -= dt * dS * betaS[i]; bLo = dt * dS * (1 - betaS[i]); }
          if (j === nz - 1) {
            if (topOpen) tb[j] -= dt * dN;
            else { tb[j] -= dt * dN * betaN[i]; bHi = dt * dN * (1 - betaN[i]); }
          }
        }
        factorLine(nz);
        for (f = 0; f < nf; f++) {
          phi = phis[f]; far = fars[f];
          x = (phi[i] + bLo * far) * fInv[0]; fDp[0] = x;
          for (k = 1; k < nz; k++) {
            var r2 = phi[k * nr + i]; if (k === nz - 1) r2 += bHi * far;
            x = (r2 - fLo[k] * x) * fInv[k]; fDp[k] = x;
          }
          phi[(nz - 1) * nr + i] = x;
          for (k = nz - 2; k >= 0; k--) { x = fDp[k] - fCp[k] * x; phi[k * nr + i] = x; }
        }
      }
    }
    // Plain explicit diffusion (the naive port; stable only for dt < h^2 / (4 D)).
    function diffuseExplicit(phi, base, far, dt) {
      var h2 = h * h, G = Gc;
      for (var j = 0; j < nz; j++) for (var i = 0; i < nr; i++) {
        var c = j * nr + i, v = phi[c], g = G[c];
        var gE = i < nr - 1 ? 0.5 * (g + G[c + 1]) : g, gW = i > 0 ? 0.5 * (g + G[c - 1]) : 0;
        var gS = j > 0 ? 0.5 * (g + G[c - nr]) : g, gN = j < nz - 1 ? 0.5 * (g + G[c + nr]) : g;
        var e = i < nr - 1 ? phi[c + 1] : far, w = i > 0 ? phi[c - 1] : v;
        var s = j > 0 ? phi[c - nr] : far, n = j < nz - 1 ? phi[c + nr] : far;
        var div = (rf[i + 1] * gE * (e - v) - rf[i] * gW * (v - w)) / (rc[i] * h2) + (gN * (n - v) - gS * (v - s)) / h2;
        tmp[c] = v + dt * base * Mc[c] * div;
      }
      phi.set(tmp.subarray(0, N));
    }
    function diffuseVelocity(dt) { // implicit, constant nu, each component on its own grid
      var nu = 0.7 * lutAlpha(1200), h2 = h * h, i, j, w = nr + 1, a = dt * nu / h2;
      // ur: r sweeps over faces 1..nr (axis face fixed 0), z sweeps per face column
      for (j = 0; j < nz; j++) {
        var n = nr; // unknowns i = 1..nr
        for (var k = 0; k < n; k++) {
          ta[k] = k > 0 ? -a : 0; tc[k] = k < n - 1 ? -a : 0;
          tb[k] = 1 + 2 * a - (k === n - 1 ? a : 0); td[k] = F.ur[j * w + k + 1];
        }
        thomas(n);
        for (k = 0; k < n; k++) F.ur[j * w + k + 1] = tx[k];
      }
      for (i = 1; i <= nr; i++) {
        for (j = 0; j < nz; j++) {
          ta[j] = j > 0 ? -a : 0; tc[j] = j < nz - 1 ? -a : 0;
          tb[j] = 1 + 2 * a - ((j === 0 || j === nz - 1) ? a : 0); td[j] = F.ur[j * w + i];
        }
        thomas(nz);
        for (j = 0; j < nz; j++) F.ur[j * w + i] = tx[j];
      }
      // uz
      for (j = 0; j <= nz; j++) {
        for (i = 0; i < nr; i++) {
          ta[i] = i > 0 ? -a : 0; tc[i] = i < nr - 1 ? -a : 0;
          tb[i] = 1 + 2 * a - ((i === 0 || i === nr - 1) ? a : 0); td[i] = F.uz[j * nr + i];
        }
        thomas(nr);
        for (i = 0; i < nr; i++) F.uz[j * nr + i] = tx[i];
      }
      for (i = 0; i < nr; i++) {
        for (j = 0; j <= nz; j++) {
          ta[j] = j > 0 ? -a : 0; tc[j] = j < nz ? -a : 0;
          tb[j] = 1 + 2 * a - ((j === 0 || j === nz) ? a : 0); td[j] = F.uz[j * nr + i];
        }
        thomas(nz + 1);
        for (j = 0; j <= nz; j++) F.uz[j * nr + i] = tx[j];
      }
    }

    // --------------------------------------------------------------- droplet
    function updateDropletCells() {
      isDrop.fill(0); srcW.fill(0);
      if (!state.dropOn && state.dropD <= 0) return;
      var rd = 0.5 * state.dropD, zd = o.zDrop, wsum = 0;
      var shell = Math.max(rd, 0.5 * h) + 0.75 * h; // inject into the first gas layer around the drop
      var jlo = Math.max(0, Math.floor((zd - shell) / h) - 1), jhi = Math.min(nz - 1, Math.ceil((zd + shell) / h) + 1);
      var ihi = Math.min(nr - 1, Math.ceil(shell / h) + 1);
      for (var j = jlo; j <= jhi; j++) for (var i = 0; i <= ihi; i++) {
        var d = Math.hypot((i + 0.5) * h, (j + 0.5) * h - zd), c = j * nr + i;
        if (d < rd) isDrop[c] = 1;
        else if (d < shell) { srcW[c] = vol[i]; wsum += vol[i]; }
      }
      if (wsum === 0) { // sub-cell droplet: use the cell that contains it
        var c0 = Math.min(nz - 1, Math.max(0, Math.floor(zd / h))) * nr;
        srcW[c0] = vol[0]; wsum = vol[0];
      }
      for (var c2 = 0; c2 < N; c2++) srcW[c2] /= wsum;
    }

    function injectFuel(dt) {
      F.src.fill(0);
      if (!state.dropOn || state.mdot <= 0) return;
      var dm = state.mdot * dt, f = mix.fuel, p = mix.p;
      for (var j = 0; j < nz; j++) for (var i = 0; i < nr; i++) {
        var c = j * nr + i, w = srcW[c];
        if (w === 0) continue;
        var T = F.T[c], Mm = mixMolar(c), rho = p * Mm / (R * T), m = rho * vol[i], add = dm * w;
        var s = m / (m + add);
        F.Yf[c] = F.Yf[c] * s + add / (m + add); F.Yo[c] *= s; F.Yp[c] *= s; F.Ys[c] *= s;
        // Stefan flow: the added mass needs room. Volume source = added mass / local density.
        if (o.stefan) F.src[c] += state.mdot * w / (rho * vol[i]);
      }
    }

    function invMolar(c) { // mol per kg of the local mixture
      var yf = F.Yf[c], yo = F.Yo[c], yp = F.Yp[c], yi = 1 - yf - yo - yp;
      if (yi < 0) yi = 0;
      return yf / mix.fuel.M + yo / GASES.O2.M + yp / mix.M_P + yi / mix.M_I;
    }
    function mixMolar(c) { return 1 / invMolar(c); }

    // ----------------------------------------------- reaction and radiation
    function reactAndRadiate(dt) {
      var f = mix.fuel, wd = f.wd, A = wd.A * (state.react ? o.eta > 0 ? 1 : 0 : 0);
      var EaR = wd.Ea * 4184 / R, a = wd.a, b = wd.b, MF = f.M, MO = GASES.O2.M;
      var sO = mix.sO, sP = mix.sP, Q = mix.Q * o.eta, p = mix.p, pAtm = mix.pAtm;
      var Tamb = o.Tamb, Tamb4 = Tamb * Tamb * Tamb * Tamb, radK = o.radiation;
      // no soot inception while the igniter holds a hot shell in fuel-rich gas (an artefact pulse)
      var sootK = state.igniteLeft > 0 ? 0 : o.sootForm * f.sootiness, sootOx = o.sootOx;
      var MI = mix.M_I, MP = mix.M_P, yCI = mix.yCO2_I, yCP = mix.yCO2_P;
      var MCO2 = GASES.CO2.M, MH2O = GASES.H2O.M;
      var fastA = a === 0.25, fastB = b === 1.5;
      var T = F.T, Yf = F.Yf, Yo = F.Yo, Yp = F.Yp, Ys = F.Ys, q = F.q, radSum = 0, hrrSum = 0;
      for (var c = 0; c < N; c++) {
        var t = T[c], yf = Yf[c], yo = Yo[c], yp = Yp[c];
        var yi = 1 - yf - yo - yp; if (yi < 0) yi = 0;
        var nmol = yf / MF + yo / MO + yp / MP + yi / MI;  // mol per kg
        var rho = p / (R * t * nmol);                       // Eq. 8
        var sT = (t - 300) / 1700; sT = sT < 0 ? 0 : (sT > 1 ? 1 : sT);
        var cp = yf * f.cpVap + yo * (mix.cpO300 + sT * (mix.cpO2000 - mix.cpO300)) +
                 yp * (mix.cpP300 + sT * (mix.cpP2000 - mix.cpP300)) +
                 yi * (mix.cpI300 + sT * (mix.cpI2000 - mix.cpI300));
        var dYf = 0, qc = 0;
        if (A > 0 && t > 550 && yf > 1e-7 && yo > 1e-7 && isDrop[c] === 0) {
          var cF = rho * yf / MF * 1e-6, cO = rho * yo / MO * 1e-6; // mol/cm^3
          var pa = fastA ? Math.sqrt(Math.sqrt(cF)) : Math.pow(cF, a);
          var pb = fastB ? cO * Math.sqrt(cO) : Math.pow(cO, b);
          var w = A * Math.exp(-EaR / t) * pa * pb * 1e6;          // Eq. 5, mol/(m^3 s)
          dYf = w * MF * dt / rho;
          if (dYf > yf) dYf = yf;
          if (dYf * sO > yo) dYf = yo / sO;                         // stoichiometric limit
          Yf[c] = yf - dYf; Yo[c] = yo - dYf * sO; Yp[c] = yp + dYf * sP;   // Eq. 7
          qc = dYf * Q * rho / dt;                                  // Eq. 6, W/m^3
          t += dYf * Q / cp;
        }
        q[c] = qc;
        // soot ("residual"): forms from hot fuel vapour, burns with O2. Visual only.
        if (t > 1100 && (sootK > 0 || Ys[c] > 0)) {
          var ys = Ys[c];
          ys += dt * sootK * pAtm * Yf[c] * Math.exp(-20000 / t);   // more soot at higher pressure
          ys -= ys * (1 - Math.exp(-dt * sootOx * Yo[c] * Math.exp(-17000 / t)));
          Ys[c] = ys;
        }
        // optically thin radiation (Eq. 2 radiative term): 4 sigma kappa_P (T^4 - Tamb^4)
        if (radK > 0 && t > Tamb + 20) {
          var xCO2 = (yp * yCP + yi * yCI) / MCO2 / nmol, xH2O = yp * (1 - yCP) / MH2O / nmol;
          // gas bands only; soot is a visual tracer here (its radiation is folded into radK,
          // which is fitted to FLEX flame-out times: data/calibration.js)
          var kap = pAtm * (xH2O * aH2O(t) + xCO2 * aCO2(t));
          var t2 = t * t, loss = 4 * SIGMA * kap * (t2 * t2 - Tamb4) * radK;
          var dT = dt * loss / (rho * cp);
          if (dT > 0.5 * (t - Tamb)) dT = 0.5 * (t - Tamb);
          t -= dT;
          radSum += dT * rho * cp / dt * vol[c % nr];
        }
        T[c] = t;
        if (qc > 0) hrrSum += qc * vol[c % nr];
      }
      state.radW = radSum; state.hrrW = hrrSum;
    }

    // ------------------------------------------------------------ projection
    function project(dt) {
      var w = nr + 1, h2 = h * h, i, j, c, ur = F.ur, uz = F.uz, p = F.p, dv = F.div, src = F.src;
      for (j = 0; j < nz; j++) for (i = 0; i < nr; i++) {
        c = j * nr + i;
        var d = (rf[i + 1] * ur[j * w + i + 1] - rf[i] * ur[j * w + i]) / (rc[i] * h) +
                (uz[(j + 1) * nr + i] - uz[j * nr + i]) / h;
        dv[c] = (d - src[c]) / dt;
      }
      var om = o.sor, iters = state.g !== 0 ? o.pressureIters : o.pressureIters0;
      for (var it = 0; it < iters; it++) {
        for (var color = 0; color < 2; color++) {
          for (j = 0; j < nz; j++) {
            for (i = (j + color) & 1; i < nr; i += 2) {
              c = j * nr + i;
              var cE = rf[i + 1] / (rc[i] * h2), cW = rf[i] / (rc[i] * h2), cZ = 1 / h2;
              var num = -dv[c], diag = cW + 2 * cZ;
              if (i > 0) num += cW * p[c - 1];
              if (i < nr - 1) { num += cE * p[c + 1]; diag += cE; } else diag += 2 * cE;
              if (j > 0) num += cZ * p[c - nr]; else diag += cZ;
              if (j < nz - 1) num += cZ * p[c + nr]; else diag += cZ;
              p[c] += om * (num / diag - p[c]);
            }
          }
        }
      }
      for (j = 0; j < nz; j++) {
        for (i = 1; i < nr; i++) ur[j * w + i] -= dt * (p[j * nr + i] - p[j * nr + i - 1]) / h;
        ur[j * w + nr] -= dt * (-2 * p[j * nr + nr - 1]) / h;
        ur[j * w] = 0;
      }
      for (i = 0; i < nr; i++) {
        for (j = 1; j < nz; j++) uz[j * nr + i] -= dt * (p[j * nr + i] - p[(j - 1) * nr + i]) / h;
        uz[i] -= dt * (2 * p[i]) / h;
        uz[nz * nr + i] -= dt * (-2 * p[(nz - 1) * nr + i]) / h;
      }
    }

    // ----------------------------------------------------------------- step
    function maxVelocity() {
      var m = 0, a = F.ur, b = F.uz, k, v;
      for (k = 0; k < a.length; k++) { v = a[k] < 0 ? -a[k] : a[k]; if (v > m) m = v; }
      for (k = 0; k < b.length; k++) { v = b[k] < 0 ? -b[k] : b[k]; if (v > m) m = v; }
      return m;
    }

    var groupA = [null, null, null], farA = [0, 0, 0], groupF = [null], farF = [0];
    var scalarList = [F.T, F.Yf, F.Yo, F.Yp, F.Ys];
    var prof = o.profile ? {} : null, pt = 0;
    function tick(name) {
      if (!prof) return;
      var n = (typeof performance !== 'undefined' ? performance : Date).now();
      if (name) prof[name] = (prof[name] || 0) + n - pt;
      pt = n;
    }
    function substep(dt) {
      var c, i, j, T = F.T, topOpen = state.g > 0;
      tick();
      // In 0 g nothing creates vorticity (no buoyancy), so the flow is the potential flow of the
      // current expansion sources. Self-advecting it only breeds spurious swirl that never decays
      // (found in a development check), so 0 g skips it and re-projects from rest below.
      var potential = state.g === 0 && o.potential0g;
      if (!potential) advectVelocity(dt);
      tick('advectU');
      advectScalars(scalarList, dt); tick('advectS');
      T0.set(T);
      injectFuel(dt);
      if (state.igniteLeft > 0) { // FLEX hot-wire igniters, modelled as a hot shell around the drop
        var rd = 0.5 * state.dropD, r0 = rd + 0.25 * h, r1 = rd + 3.0e-3;
        for (j = 0; j < nz; j++) for (i = 0; i < nr; i++) {
          var d = Math.hypot((i + 0.5) * h, (j + 0.5) * h - o.zDrop);
          if (d > r0 && d < r1) { c = j * nr + i; if (T[c] < 1600) T[c] = 1600; }
        }
        state.igniteLeft -= dt;
      }
      tick('inject');
      // Under gravity the real flame base sits < 1 mm from the drop, below this grid's size, and
      // cold inflow lifts and blows off the coarse flame (found in a development check). A sub-grid
      // flame holder keeps the first gas layer lit where the mixture there is flammable. Off in 0 g,
      // where it could relight a dying flame and spoil the extinction physics the calibration uses.
      if (state.g !== 0 && state.react && state.dropOn && o.anchor) {
        for (c = 0; c < N; c++) {
          if (srcW[c] > 0 && F.Yf[c] > 0.005 && F.Yo[c] > 0.005 && T[c] < 1500) T[c] = 1500;
        }
      }
      reactAndRadiate(dt); tick('react');
      // The igniter stays on until the flame has carried 40% of the fuel supply for 0.15 s in a row
      // (self-sustaining, not just the first burst of premixed vapour) or its time runs out.
      // Helium flames need longer.
      if (state.igniteLeft > 0) {
        state.igniteOn += dt;
        state.igniteHeld = state.hrrW > 0.4 * state.mdot * mix.Q ? (state.igniteHeld || 0) + dt : 0;
        if (state.igniteOn > o.igniteMin && state.igniteHeld >= 0.15) state.igniteLeft = 0;
      }
      // transport coefficients from the local temperature (lagged one sub-step)
      var Mamb = mix.Mamb;
      for (c = 0; c < N; c++) { Gc[c] = lutG(T[c]); Mc[c] = T[c] / 300 * Mamb * invMolar(c); }
      var aB = mix.alpha300, fB = mix.DF300;
      if (o.diffusion === 'explicit') {
        diffuseExplicit(T, aB, o.Tamb, dt); diffuseExplicit(F.Yf, fB, 0, dt);
        diffuseExplicit(F.Yo, aB, mix.YO_amb, dt); diffuseExplicit(F.Yp, aB, 0, dt);
      } else {
        groupA[0] = T; groupA[1] = F.Yo; groupA[2] = F.Yp;
        farA[0] = o.Tamb; farA[1] = mix.YO_amb; farA[2] = 0;
        // Split (r then z) implicit diffusion has a cross-term error ~ (dt D / h^2)^2 that turns
        // round flames into diamonds when the diffusion number is large (helium: ~19 per step).
        // Sub-cycle diffusion alone so that number stays <= o.diffNumber.
        var Tmax = 0; for (c = 0; c < N; c++) if (T[c] > Tmax) Tmax = T[c];
        var dnum = dt * aB * Math.pow(Tmax / 300, 1.75) / (h * h);
        var nd = Math.max(1, Math.ceil(dnum / o.diffNumber)), ddt = dt / nd;
        for (var kd = 0; kd < nd; kd++) {
          diffuseGroup(groupA, farA, aB, ddt, topOpen);   // Le = 1 for heat, O2 and products
          groupF[0] = F.Yf; diffuseGroup(groupF, farF, fB, ddt, topOpen);
        }
        state.diffSub = nd;
        tick('diffuseS');
        // viscosity: 'auto' = only under gravity. In 0 g the flow is source-driven and close to
        // irrotational, so the viscous term does almost nothing (checked during development).
        if (!potential && (o.viscosity === true || (o.viscosity === 'auto' && state.g !== 0))) diffuseVelocity(dt);
        tick('diffuseU');
      }
      var Tb = mix.fuel.Tb;
      for (c = 0; c < N; c++) {
        // liquid surface: held at the boiling point (the heat sink that drives evaporation).
        // Fuel enters only through injectFuel at the measured rate, so no concentration is pinned here.
        if (isDrop[c]) { T[c] = Tb; F.Ys[c] = 0; }
        if (F.Yf[c] < 0) F.Yf[c] = 0; if (F.Yo[c] < 0) F.Yo[c] = 0; if (F.Yp[c] < 0) F.Yp[c] = 0;
        if (T[c] < 200) T[c] = 200;
      }
      if (o.dilatation) {
        var cap = 0.5 / dt;
        for (c = 0; c < N; c++) {
          if (isDrop[c]) continue;
          var s = (T[c] - T0[c]) / (T[c] * dt);
          F.src[c] += s > cap ? cap : (s < -cap ? -cap : s);
        }
      } else F.src.fill(0);
      if (state.g !== 0) { // Eq. 1 buoyancy on the z faces: a = g (1 - Tamb / T)
        var g = state.g, Ta = o.Tamb;
        for (j = 1; j < nz; j++) for (i = 0; i < nr; i++) {
          var tf = 0.5 * (T[j * nr + i] + T[(j - 1) * nr + i]);
          F.uz[j * nr + i] += dt * g * (1 - Ta / tf);
        }
      }
      if (potential) { F.ur.fill(0); F.uz.fill(0); }
      tick('misc');
      project(dt); tick('project');
      state.t += dt; state.steps++;
    }

    /** Advance by dt seconds, sub-stepping for CFL. maxSub caps work per call. */
    function step(dt, maxSub) {
      if (!(dt > 0)) return 0;
      var vmax = maxVelocity(); state.maxU = vmax;
      var lim = o.dtMax;
      if (vmax > 1e-6) lim = Math.min(lim, o.cflMax * h / vmax);
      if (o.diffusion === 'explicit') lim = Math.min(lim, 0.24 * h * h / lutAlpha(2400));
      var n = Math.max(1, Math.ceil(dt / lim));
      if (maxSub && n > maxSub) n = maxSub;   // run slower than real time rather than stall
      var sub = Math.min(dt / n, lim);
      for (var k = 0; k < n; k++) substep(sub);
      state.lastSub = n;
      return sub * n;
    }

    function setDroplet(d) {
      if (d.D != null) state.dropD = Math.max(0, d.D);
      if (d.mdot != null) state.mdot = Math.max(0, d.mdot);
      if (d.on != null) state.dropOn = !!d.on;
      updateDropletCells();
    }

    function diagnostics() {
      var T = F.T, q = F.q, peakT = 0, hrr = 0, c, i, j;
      for (c = 0; c < N; c++) if (T[c] > peakT) peakT = T[c];
      for (j = 0; j < nz; j++) for (i = 0; i < nr; i++) hrr += q[j * nr + i] * vol[i];
      // flame position on the droplet's row: radius of peak temperature and of peak heat release,
      // and the peak-temperature distance above and below the drop on the axis.
      var jd = Math.min(nz - 1, Math.max(0, Math.floor(o.zDrop / h)));
      var bestT = 0, rFlame = 0, bestQ = 0, rSheet = 0;
      for (i = 0; i < nr; i++) {
        var t = T[jd * nr + i], qq = q[jd * nr + i];
        if (t > bestT) { bestT = t; rFlame = (i + 0.5) * h; }
        if (qq > bestQ) { bestQ = qq; rSheet = (i + 0.5) * h; }   // where heat release peaks: the flame sheet
      }
      var top = 0, bottom = 0, bt = 0, bb = 0;
      for (j = jd; j < nz; j++) if (T[j * nr] > bt) { bt = T[j * nr]; top = (j + 0.5) * h - o.zDrop; }
      for (j = jd; j >= 0; j--) if (T[j * nr] > bb) { bb = T[j * nr]; bottom = o.zDrop - (j + 0.5) * h; }
      return { t: state.t, peakT: peakT, hrrW: hrr, radW: state.radW || 0, rFlame: rFlame, rSheet: rSheet, Tflame: bestT,
               top: top, bottom: bottom, maxU: state.maxU, sub: state.lastSub };
    }

    return {
      opts: o, fields: F, state: state, rf: rf, rc: rc, vol: vol, nr: nr, nz: nz, h: h,
      get mix() { return mix; },
      setConditions: setConditions, reset: reset, step: step, setDroplet: setDroplet,
      ignite: function (s) { state.igniteLeft = s; state.igniteOn = 0; state.igniteHeld = 0; },
      setReacting: function (on) { state.react = !!on; },
      diagnostics: diagnostics, isDrop: isDrop, profile: function () { return prof; }
    };
  }

  return {
    GASES: GASES, FUELS: FUELS, mixture: mixture, massBurningRate: massBurningRate,
    heatOfCombustionMolar: heatOfCombustionMolar, createSim: createSim, aH2O: aH2O, aCO2: aCO2
  };
});
