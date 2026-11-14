/*
 * Flame renderer for Fire-X lite (Canvas 2D, no WebGL needed).
 *
 * Follows Fire-X Sec. 5.6: colour = blackbody emission of soot ("residuals") at the local
 * temperature + chemiluminescence of CH* (431 nm) and C2* (516 nm) where the flame reacts.
 * The paper ray-marches 3D grids; here the field is axisymmetric, so each pixel's line of sight
 * through the 3D flame is an exact sum over rings (forward Abel transform), precomputed as weights.
 *
 * Exposure is fixed, never auto: a dim methanol flame should look dim.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlameRender = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- colour science
  // CIE 1931 2-degree observer, multi-lobe Gaussian fit (Wyman, Sloan & Shirley 2013).
  function g(x, mu, s1, s2) { var t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
  function cmf(l) {
    return [
      1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
      0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
      1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8)
    ];
  }
  function xyzToLinearSRGB(X, Y, Z) {
    return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
  }
  function gamutClip(rgb) { // desaturate toward the luminance instead of clipping hue
    var Y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], m = Math.min(rgb[0], rgb[1], rgb[2]);
    if (m >= 0) return rgb;
    var k = Y / (Y - m);
    return [Y + (rgb[0] - Y) * k, Y + (rgb[1] - Y) * k, Y + (rgb[2] - Y) * k];
  }
  var HC_K = 1.438777e-2; // h c / k, m K
  // soot emission colour per kelvin, Rayleigh soot emissivity ~ 1/lambda, luminance 1 at 2000 K
  var BB_T0 = 600, BB_DT = 10, BB_N = 241, BB = new Float32Array(BB_N * 3);
  (function () {
    var ref = 0, rows = [];
    for (var k = 0; k < BB_N; k++) {
      var T = BB_T0 + k * BB_DT, X = 0, Y = 0, Z = 0;
      for (var l = 380; l <= 780; l += 5) {
        var lm = l * 1e-9, B = 1 / (Math.pow(lm, 5) * (Math.exp(HC_K / (lm * T)) - 1)) / lm;
        var c = cmf(l); X += B * c[0]; Y += B * c[1]; Z += B * c[2];
      }
      rows.push(gamutClip(xyzToLinearSRGB(X, Y, Z)));
      if (T === 2000) ref = Y;
    }
    for (k = 0; k < BB_N; k++) {
      var rgb = rows[k], s = 1 / (0.2126 * rows[(2000 - BB_T0) / BB_DT][0] + 0.7152 * rows[(2000 - BB_T0) / BB_DT][1] + 0.0722 * rows[(2000 - BB_T0) / BB_DT][2]);
      BB[3 * k] = Math.max(0, rgb[0] * s); BB[3 * k + 1] = Math.max(0, rgb[1] * s); BB[3 * k + 2] = Math.max(0, rgb[2] * s);
    }
    void ref;
  })();
  // Chemiluminescence spectrum, weighted by radiant power (not luminance): CH* 431 nm,
  // C2* Swan bands (516, 473, 563 nm) scaled by the fuel's C2/CH ratio, and the broad CO2*
  // continuum. Normalised so the brightest channel is 1. Weighting each line to unit luminance
  // instead turns the near-invisible CH* line into saturated magenta.
  function bandColour(c2ch) {
    var X = 0, Y = 0, Z = 0, ln = function (l, mu) { var t = (l - mu) / 3; return Math.exp(-0.5 * t * t); };
    for (var l = 360; l <= 780; l += 1) {
      var sp = ln(l, 431) + c2ch * (ln(l, 516) + 0.5 * ln(l, 473) + 0.4 * ln(l, 563)) +
               1.5 * Math.exp(-0.5 * Math.pow((l - 420) / 70, 2));
      var c = cmf(l); X += sp * c[0]; Y += sp * c[1]; Z += sp * c[2];
    }
    var rgb = gamutClip(xyzToLinearSRGB(X, Y, Z)), m = Math.max(rgb[0], rgb[1], rgb[2]);
    return [Math.max(0, rgb[0] / m), Math.max(0, rgb[1] / m), Math.max(0, rgb[2] / m)];
  }
  var GAMMA = new Uint8ClampedArray(1024);
  for (var gi = 0; gi < 1024; gi++) {
    var v = gi / 1023;
    GAMMA[gi] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }

  // ---------------------------------------------------------------- renderer
  /**
   * opts: mode 'los' (line of sight, default) or 'slice'; exposure; chemGain; sootGain;
   *       bloom 0..1; background css colour; dprCap; droplet colours.
   */
  function create(canvas, sim, opts) {
    var o = Object.assign({
      mode: 'los', exposure: 2.0, chemGain: 2.2e-6, sootGain: 8e4, bloom: 0.45, background: '#251e18',
      dprCap: 1.5, dropFill: '#c9ab91', dropEdge: '#5b422c', supersample: 2,
      sheet: 0.6e-3,  // Burke-Schumann sheet width (m) for chemiluminescence; 0 = raw heat release
      // WebGL2 volume path (flame-gl.js, from nand-flame-rs). The Canvas 2D path below is the fallback.
      gl: true, sootEmission: 2.6, chEmission: 0.55, sootAbsorption: 0.5, boxLength: 0.06, grain: 0.012, tonePre: 1.6
    }, opts || {});
    var ctx = canvas.getContext('2d', { alpha: false });
    var small = document.createElement('canvas'), sctx = small.getContext('2d');
    var glow = document.createElement('canvas'), gctx = glow.getContext('2d');
    var glow2 = document.createElement('canvas'), g2ctx = glow2.getContext('2d');
    var vol = (o.gl && typeof FlameGL !== 'undefined' && FlameGL.supported()) ? FlameGL.create(sim) : null;
    var GF = vol ? { T: new Float32Array(sim.nr * sim.nz), S: new Float32Array(sim.nr * sim.nz), Q: new Float32Array(sim.nr * sim.nz) } : null;
    var dbg = null, frameNo = 0, expSoot = 0, expCH = 0, glChem = [0.16, 0.34, 1.0], bg3 = [0, 0, 0];
    function parseBg(c) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.145, 0.118, 0.094]; }
    var nr = sim.nr, nz = sim.nz, h = sim.h;
    var Er = new Float32Array(nr * nz), Eg = new Float32Array(nr * nz), Eb = new Float32Array(nr * nz);
    var Qw = new Float32Array(nr * nz), Sb = new Float32Array(nr * nz), Qb = new Float32Array(nr * nz);
    var view = { widthMm: 44, heightMm: 40, dropFromTop: 0.5 };
    var lay = null, W = null, Wi0 = null, img = null, I3 = null;
    var cssW = 0, cssH = 0, dpr = 1;
    var chemCol = [0, 0, 0];

    function setFuelColour(c2ch) {
      chemCol = bandColour(c2ch);
      var m = Math.min(0.3, 0.15 * c2ch);   // nand-flame's CH-star blue, nudged toward the C2-star green for sooty fuels
      glChem = [0.16 + (0.10 - 0.16) * m, 0.34 + (0.55 - 0.34) * m, 1.0 + (0.45 - 1.0) * m];
    }
    setFuelColour(sim.mix.fuel.c2ch);

    function resize() {
      var r = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.round(r.width)); cssH = Math.max(1, Math.round(r.height));
      dpr = Math.min(o.dprCap, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      build();
    }

    function setView(v) { Object.assign(view, v); build(); }

    // Precompute the projection for the current view: columns at half the cell size.
    function build() {
      if (!cssW) return;
      var pxPerMm = Math.min(cssW / view.widthMm, cssH / view.heightMm);
      var halfW = cssW / 2 / pxPerMm * 1e-3;             // m from the axis to the canvas edge
      var zTop = sim.opts.zDrop + view.dropFromTop * (cssH / pxPerMm) * 1e-3;
      var zBot = zTop - cssH / pxPerMm * 1e-3;
      var ss = o.supersample, dx = h / ss;
      var nx = Math.max(4, Math.ceil(halfW / dx)), ny = Math.max(4, Math.ceil((zTop - zBot) / dx));
      lay = { pxPerMm: pxPerMm, halfW: halfW, zTop: zTop, zBot: zBot, nx: nx, ny: ny, dx: dx,
              cx: cssW / 2, cy: (zTop - sim.opts.zDrop) * 1e3 * pxPerMm };
      if (vol) {   // per-pixel ray march: no coarse projection grid, bloom works on the full-size image
        bg3 = parseBg(o.background);
        vol.resize(canvas.width, canvas.height);
        glow.width = Math.max(2, Math.round(canvas.width / 6)); glow.height = Math.max(2, Math.round(canvas.height / 6));
        glow2.width = Math.max(2, Math.round(canvas.width / 14)); glow2.height = Math.max(2, Math.round(canvas.height / 14));
        return;
      }
      // Abel weights: path length of the ray at offset x through each ring [i h, (i+1) h]
      W = new Float32Array(nx * nr); Wi0 = new Int32Array(nx);
      for (var k = 0; k < nx; k++) {
        var x = (k + 0.5) * dx, x2 = x * x, i0 = Math.min(nr, Math.floor(x / h));
        Wi0[k] = i0;
        for (var i = i0; i < nr; i++) {
          var a = Math.max(i * h, x), b = (i + 1) * h;
          W[k * nr + i] = o.mode === 'slice' ? (i === i0 ? h : 0) : 2 * (Math.sqrt(b * b - x2) - Math.sqrt(a * a - x2));
        }
      }
      small.width = 2 * nx; small.height = ny;
      img = sctx.createImageData(2 * nx, ny);
      I3 = new Float32Array(nx * ny * 3);
      glow.width = Math.max(2, Math.round(nx / 2)); glow.height = Math.max(2, Math.round(ny / 4));
      glow2.width = Math.max(2, Math.round(nx / 4)); glow2.height = Math.max(2, Math.round(ny / 8));
    }

    // Chemiluminescence source per cell. With o.sheet > 0 the heat release is moved onto the
    // stoichiometric surface of the Burke-Schumann mixture fraction
    //   Z = (s Yf - Yo + Yo_inf) / (s + Yo_inf),   Z_st = Yo_inf / (s + Yo_inf)
    // weighting each cell by exp(-n^2 / 2 sigma^2), n = (Z - Z_st) / |grad Z| its distance to the
    // sheet, then rescaling so the total emitted power (sum of q dV) is unchanged.
    function chemSource() {
      var F = sim.fields, q = F.q, N = nr * nz, c, i, j;
      if (!(o.sheet > 0)) { for (c = 0; c < N; c++) Qw[c] = q[c]; return; }
      var Yf = F.Yf, Yo = F.Yo, s = sim.mix.sO, Yinf = sim.mix.YO_amb, den = 1 / (s + Yinf), Zst = Yinf * den;
      var sig2 = 2 * o.sheet * o.sheet, vol = sim.vol, tot = 0, totW = 0;
      for (j = 0; j < nz; j++) for (i = 0; i < nr; i++) {
        c = j * nr + i;
        if (q[c] <= 0) { Qw[c] = 0; continue; }
        var Z = (s * Yf[c] - Yo[c] + Yinf) * den;
        var cE = i < nr - 1 ? c + 1 : c, cW = i > 0 ? c - 1 : c, cN = j < nz - 1 ? c + nr : c, cS = j > 0 ? c - nr : c;
        var dZr = ((s * Yf[cE] - Yo[cE]) - (s * Yf[cW] - Yo[cW])) * den / ((cE - cW) * h || h);
        var dZz = ((s * Yf[cN] - Yo[cN]) - (s * Yf[cS] - Yo[cS])) * den / (((cN - cS) / nr) * h || h);
        var gz = Math.sqrt(dZr * dZr + dZz * dZz) + 1e-9, n = (Z - Zst) / gz;
        var w = Math.exp(-n * n / sig2);
        Qw[c] = q[c] * w; tot += q[c] * vol[i]; totW += Qw[c] * vol[i];
      }
      var k = totW > 0 ? tot / totW : 0;
      for (c = 0; c < N; c++) Qw[c] *= k;
    }

    function blur121(src, dst) {
      for (var j = 0; j < nz; j++) for (var i = 0; i < nr; i++) {
        var acc = 0, wsum = 0;
        for (var dj = -1; dj <= 1; dj++) {
          var jj = j + dj; if (jj < 0 || jj >= nz) continue;
          for (var di = -1; di <= 1; di++) {
            var ii = i + di; if (ii < 0) ii = -ii - 1; if (ii >= nr) continue;   // mirror at the axis
            var wv = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1); acc += wv * src[jj * nr + ii]; wsum += wv;
          }
        }
        dst[j * nr + i] = acc / wsum;
      }
    }

    function emission() {
      var F = sim.fields, T = F.T, q = Qw, Ys = F.Ys, mix = sim.mix, p = mix.p, R = 8.314462618;
      var cg = o.chemGain, sg = o.sootGain, cr = chemCol[0], cgc = chemCol[1], cb = chemCol[2];
      chemSource();
      // Display-only 1-2-1 blur of both sources: soot is advected without diffusion (grainy), and
      // the piecewise-constant rings of the line-of-sight sum show cell-sized steps otherwise.
      blur121(Ys, Sb); blur121(Qw, Qb); q = Qb;
      for (var c = 0; c < nr * nz; c++) {
        var t = T[c], er = 0, eg = 0, eb = 0;
        var qc = q[c];
        if (qc > 0) { var e = cg * qc; er = e * cr; eg = e * cgc; eb = e * cb; }
        var ys = Sb[c];
        if (ys > 1e-9 && t > BB_T0) {
          var k = (t - BB_T0) / BB_DT, k0 = k | 0; if (k0 > BB_N - 2) k0 = BB_N - 2; var f = k - k0; if (f > 1) f = 1;
          var rho = p * mix.Mamb / (R * t), s = sg * ys * rho, b = 3 * k0;   // soot mass per volume
          er += s * (BB[b] + f * (BB[b + 3] - BB[b])); eg += s * (BB[b + 1] + f * (BB[b + 4] - BB[b + 1]));
          eb += s * (BB[b + 2] + f * (BB[b + 5] - BB[b + 2]));
        }
        Er[c] = er; Eg[c] = eg; Eb[c] = eb;
      }
    }

    function project() {
      var nx = lay.nx, ny = lay.ny, dx = lay.dx, zTop = lay.zTop, k, i, y, base;
      for (y = 0; y < ny; y++) {
        // sample the sim row at this height (linear between cell centres)
        var z = zTop - (y + 0.5) * dx, fz = z / h - 0.5;
        if (fz < 0 || fz > nz - 1) { for (k = 0; k < nx; k++) { base = 3 * (y * nx + k); I3[base] = I3[base + 1] = I3[base + 2] = 0; } continue; }
        var j0 = fz | 0, az = fz - j0, j1 = Math.min(nz - 1, j0 + 1), r0 = j0 * nr, r1 = j1 * nr;
        for (k = 0; k < nx; k++) {
          var sr = 0, sgv = 0, sb = 0, wrow = k * nr;
          for (i = Wi0[k]; i < nr; i++) {
            var w = W[wrow + i]; if (w === 0) continue;
            var c0 = r0 + i, c1 = r1 + i;
            sr += w * (Er[c0] + az * (Er[c1] - Er[c0]));
            sgv += w * (Eg[c0] + az * (Eg[c1] - Eg[c0]));
            sb += w * (Eb[c0] + az * (Eb[c1] - Eb[c0]));
          }
          base = 3 * (y * nx + k); I3[base] = sr; I3[base + 1] = sgv; I3[base + 2] = sb;
        }
      }
    }

    function tonemap() {
      var nx = lay.nx, ny = lay.ny, d = img.data, ex = o.exposure, w2 = 2 * nx;
      for (var y = 0; y < ny; y++) {
        for (var k = 0; k < nx; k++) {
          // Hue-preserving tone curve: compress luminance, scale RGB alike, then desaturate toward
          // white only as far as needed to stay in gamut. Per-channel curves turn a bright blue
          // flame white and red soot plus blue light pink.
          var b = 3 * (y * nx + k), r = I3[b], gg = I3[b + 1], bl = I3[b + 2];
          var L = 0.2126 * r + 0.7152 * gg + 0.0722 * bl;
          if (L > 1e-12) {
            var Lt = 1 - Math.exp(-ex * L), sc = Lt / L;
            r *= sc; gg *= sc; bl *= sc;
            var m = r > gg ? (r > bl ? r : bl) : (gg > bl ? gg : bl);
            if (m > 1) { var kd = (1 - Lt) / (m - Lt); r = Lt + (r - Lt) * kd; gg = Lt + (gg - Lt) * kd; bl = Lt + (bl - Lt) * kd; }
            if (r < 0) r = 0; if (gg < 0) gg = 0; if (bl < 0) bl = 0;
          } else { r = gg = bl = 0; }
          var R8 = GAMMA[(r * 1023) | 0], G8 = GAMMA[(gg * 1023) | 0], B8 = GAMMA[(bl * 1023) | 0];
          var pr = 4 * (y * w2 + nx + k), pl = 4 * (y * w2 + nx - 1 - k);  // mirror about the axis
          d[pr] = d[pl] = R8; d[pr + 1] = d[pl + 1] = G8; d[pr + 2] = d[pl + 2] = B8; d[pr + 3] = d[pl + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);
    }

    // nand-flame params.rs: display-only exposures. Soot: sqrt of the 550 nm Planck ratio between 1800 K
    // and the peak temperature (0.5-8). CH*: (5e7 W/m3 / peak heat release)^0.75 (1-8). Eased in time.
    function glFrame() {
      var F = sim.fields, T = F.T, Ys = F.Ys, n = nr * nz, c, peakT = 0, peakQ = 0;
      chemSource();
      for (c = 0; c < n; c++) {
        var t = T[c]; if (t > peakT) peakT = t;
        if (Qw[c] > peakQ) peakQ = Qw[c];
        GF.T[c] = t; GF.S[c] = 1000 * Ys[c]; GF.Q[c] = 1e-7 * Qw[c];
      }
      var pt = Math.min(3000, Math.max(900, peakT)), eS = Math.min(8, Math.max(0.5, Math.exp(0.5 * (1.4388e-2 / 550e-9) * (1 / pt - 1 / 1800))));
      var eC = peakQ > 0 ? Math.min(8, Math.max(1, Math.pow(5e7 / peakQ, 0.75))) : 1;
      if (!expSoot) { expSoot = eS; expCH = eC; } else { expSoot += 0.12 * (eS - expSoot); expCH += 0.12 * (eC - expCH); }
      dbg = { peakT: peakT, peakQ: peakQ, expSoot: expSoot, expCH: expCH };
      var ppm = lay.pxPerMm * dpr * 1e3;   // device px per metre
      vol.draw(GF, { pxPerM: ppm, axisX: canvas.width / 2, zTop: lay.zTop, frame: (frameNo++) % 4096,
        gain: [o.sootEmission, o.chEmission, o.sootAbsorption, o.boxLength], exp: [expSoot, expCH, o.grain, o.tonePre],
        chem: glChem, bg: bg3 });
    }

    /** state: { D (m), D0 (m), fragments [{x,y,r}] in mm from the droplet, showDroplet } */
    function render(state) {
      if (!lay) resize();
      var s = dpr, wpx, hpx, x0, src;
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      if (vol) {
        glFrame(); src = vol.canvas; wpx = canvas.width; hpx = canvas.height; x0 = 0;
        ctx.drawImage(src, 0, 0);
      } else {
        emission(); project(); tonemap(); src = small;
        wpx = 2 * lay.nx * lay.dx * 1e3 * lay.pxPerMm * s; hpx = lay.ny * lay.dx * 1e3 * lay.pxPerMm * s;
        x0 = (cssW * s - wpx) / 2;
        ctx.fillStyle = o.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(small, x0, 0, wpx, hpx);
      }
      if (o.bloom > 0) { // two-level downsample bloom: wide, soft halo of the brightest light
        ctx.globalCompositeOperation = 'lighter';
        gctx.clearRect(0, 0, glow.width, glow.height); gctx.drawImage(src, 0, 0, glow.width, glow.height);
        g2ctx.clearRect(0, 0, glow2.width, glow2.height); g2ctx.drawImage(glow, 0, 0, glow2.width, glow2.height);
        var bl = vol ? 0.2 * o.bloom : o.bloom;   // the full-size GL image needs far less halo than the coarse 2D one (nand: 0.09)
        ctx.globalAlpha = 0.6 * bl; ctx.drawImage(glow, x0, 0, wpx, hpx);
        ctx.globalAlpha = 0.5 * bl; ctx.drawImage(glow2, x0 - wpx * 0.05, -hpx * 0.05, wpx * 1.1, hpx * 1.1);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      var cx = lay.cx * s, cy = lay.cy * s, ppm = lay.pxPerMm * s;
      if (state && state.D0 > 0) {
        ctx.strokeStyle = o.dropEdge; ctx.lineWidth = s; ctx.beginPath();
        ctx.arc(cx, cy, state.D0 * 1e3 / 2 * ppm + 1.5 * s, 0, 2 * Math.PI); ctx.stroke();
      }
      if (state && state.showDroplet !== false && state.D > 0) {
        ctx.fillStyle = o.dropFill; ctx.beginPath();
        ctx.arc(cx, cy, state.D * 1e3 / 2 * ppm, 0, 2 * Math.PI); ctx.fill();
      }
      if (state && state.fragments) {
        ctx.fillStyle = o.dropFill;
        for (var f = 0; f < state.fragments.length; f++) {
          var fr = state.fragments[f]; ctx.globalAlpha = fr.a == null ? 1 : fr.a;
          ctx.beginPath(); ctx.arc(cx + fr.x * ppm, cy - fr.y * ppm, Math.max(0.6 * s, fr.r * ppm), 0, 2 * Math.PI); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    return {
      resize: resize, setView: setView, render: render, opts: o, usesGL: !!vol, debug: function () { return dbg; },
      setFuelColour: setFuelColour,
      layout: function () { return lay; },
      /** peak projected intensity, for calibrating exposure in experiments */
      peak: function () { var m = 0; if (I3) for (var i = 0; i < I3.length; i++) if (I3[i] > m) m = I3[i]; return m; }
    };
  }

  return { create: create, blackbodyLUT: BB, BB_T0: BB_T0, BB_DT: BB_DT, bandColour: bandColour };
});
