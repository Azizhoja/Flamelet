/*
 * WebGL2 volume renderer for the Fire-X lite flame. Ported from Team Nand's nand-flame-rs
 * (crates/flame-render/src/shaders/simvol.wgsl, tonemap.wgsl): the solver fields are ray-marched
 * per pixel instead of being summed into a coarse grid, which is what gives the flame its volume.
 *
 *  - soot: grey-body thermal emission, per-channel Planck at R/G/B = 610/550/465 nm with a 1/lambda
 *    emissivity (G = 1 at 1800 K), translucent: soot also absorbs what is behind it;
 *  - CH* and C2* chemiluminescence: blue, proportional to the heat-release rate;
 *  - every sample is offset by up to +-1 texel at random. In expectation that is the trilinear
 *    lookup convolved with a two-texel box, which removes the texel-aligned bands a plain trilinear
 *    lookup shows on the steep Planck(T) response, and gives the slightly grainy, living look;
 *  - display exposure (soot) and CH* display exposure follow nand-flame's params.rs. They are
 *    camera-style display settings, not physics: a dim 0 g flame stays readable;
 *  - ACES tonemap and a touch of film grain, as in tonemap.wgsl.
 *
 * The flame is axisymmetric, so a pixel's ray runs along y through (r, z) = (hypot(x, y), z): the
 * 2D (r, z) fields are the "volume". Output is an opaque RGBA canvas the caller composites; the
 * caller keeps drawing the droplet and the bloom on top (flame-render.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlameGL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VS = '#version 300 es\n' +
    'const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));\n' +
    'void main(){ gl_Position = vec4(P[gl_VertexID], 0., 1.); }\n';

  var FS = '#version 300 es\n' +
    'precision highp float; precision highp sampler2D;\n' +
    'uniform sampler2D uVol;          // (T [K], soot Y x1000, heat release x1e-7 [W/m3])\n' +
    'uniform vec2  uRes;              // canvas size, device px\n' +
    'uniform float uPxPerM;           // device px per metre\n' +
    'uniform vec2  uAxis;             // axis x (device px), z of the top edge (m)\n' +
    'uniform vec4  uGrid;             // nr, nz, h (m), frame\n' +
    'uniform vec4  uGain;             // soot emission, CH* emission, soot absorption, box length (m)\n' +
    'uniform vec4  uExp;              // soot exposure, CH* exposure, grain, tonemap pre-gain\n' +
    'uniform vec3  uChem;             // chemiluminescence colour\n' +
    'uniform vec3  uBg;               // background (display-referred)\n' +
    'out vec4 o;\n' +
    'const vec3 CH_BLUE = vec3(0.16, 0.34, 1.0);\n' +
    'const vec3 C2_GREEN = vec3(0.10, 0.55, 0.45);\n' +
    'float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }\n' +
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\n' +
    'vec3 planck_rgb(float t){\n' +
    '  float c2 = 1.4388e-2; vec3 lam = vec3(610e-9, 550e-9, 465e-9);\n' +
    '  vec3 x = c2 / (lam * max(t, 300.0)); float x0 = c2 / (550e-9 * 1800.0);\n' +
    '  return pow(lam / 550e-9, vec3(-6.0)) * exp(vec3(x0) - x) * (1.0 - exp(-x0)) / (1.0 - exp(-x));\n' +
    '}\n' +
    'vec3 rrt_odt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }\n' +
    'vec3 aces(vec3 c){\n' +
    '  mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);\n' +
    '  mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);\n' +
    '  return clamp(m2 * rrt_odt(m1 * c), 0.0, 1.0);\n' +
    '}\n' +
    'vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }\n' +
    'void main(){\n' +
    '  vec2 fc = gl_FragCoord.xy;\n' +
    '  float x = abs(fc.x - uAxis.x) / uPxPerM;\n' +
    '  float z = uAxis.y - (uRes.y - fc.y) / uPxPerM;\n' +
    '  float nr = uGrid.x, nz = uGrid.y, h = uGrid.z, frame = uGrid.w;\n' +
    '  float R = nr * h, Z = nz * h;\n' +
    '  vec3 acc = vec3(0.0); float tr = 1.0;\n' +
    '  if (x < R && z > 0.0 && z < Z) {\n' +
    '    float yMax = sqrt(R * R - x * x);\n' +
    '    float n = clamp(1.5 * 2.0 * yMax / h, 24.0, 192.0);\n' +
    '    float dy = 2.0 * yMax / n, dyU = dy / uGain.w;\n' +
    '    float jit = fract(hash12(fc) + frame * 0.6180339);\n' +
    '    vec2 texel = vec2(1.0 / nr, 1.0 / nz);\n' +
    '    vec3 seed = vec3(jit * 97.0, frame * 0.37, fc.x * 311.0 + fc.y * 173.0);\n' +
    '    float y = yMax - dy * jit;                       // front (nearest the viewer) to back\n' +
    '    for (int i = 0; i < 192; i++){\n' +
    '      if (float(i) >= n) break;\n' +
    '      seed += vec3(1.618, 2.414, 3.303);\n' +
    '      vec2 off = vec2(hash13(seed), hash13(seed.yzx + 7.1)) - 0.5;\n' +
    '      float r = sqrt(x * x + y * y);\n' +
    '      vec2 uv = vec2(r / R, z / Z) + off * (1.6 * texel);\n' +
    '      uv.x = abs(uv.x);                              // mirror at the axis\n' +
    '      vec3 v = textureLod(uVol, uv, 0.0).rgb;\n' +
    '      float soot = max(v.y, 0.0), hrr = max(v.z, 0.0);\n' +
    '      vec3 em = soot * uGain.x * planck_rgb(v.x);\n' +
    '      em += hrr * uGain.y * uExp.y * mix(uChem, C2_GREEN, 0.18 * clamp(soot, 0.0, 1.0));\n' +
    '      acc += tr * em * dyU;\n' +
    '      tr *= exp(-soot * uGain.z * dyU);\n' +
    '      y -= dy;\n' +
    '      if (tr < 0.01) break;\n' +
    '    }\n' +
    '  }\n' +
    '  vec3 c = srgb(aces(acc * uExp.x * uExp.w));\n' +
    '  c += (hash12(fc + vec2(frame * 17.0, frame * 3.0)) - 0.5) * uExp.z * step(0.0001, dot(acc, vec3(1.0)));\n' +
    '  o = vec4(max(c + tr * uBg, 0.0), 1.0);\n' +
    '}\n';

  function supported() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  /** sim: the Fire-X lite solver (nr, nz, h). Returns null if WebGL2 or float textures are missing. */
  function create(sim) {
    var cv = document.createElement('canvas');
    var gl = cv.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { if (typeof console !== 'undefined') console.warn('flame-gl: ' + e.message); return null; }
    gl.useProgram(prog);
    var U = {};
    ['uVol', 'uRes', 'uPxPerM', 'uAxis', 'uGrid', 'uGain', 'uExp', 'uChem', 'uBg'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var nr = sim.nr, nz = sim.nz;
    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, nr, nz, 0, gl.RGBA, gl.FLOAT, null);
    if (gl.getError() !== gl.NO_ERROR) return null;
    gl.uniform1i(U.uVol, 0);
    var data = new Float32Array(nr * nz * 4);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    return {
      canvas: cv,
      resize: function (w, h) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } gl.viewport(0, 0, w, h); },
      /**
       * fields: { T, S, Q } Float32Array(nr*nz) already scaled (T in K, S = soot Y x1000, Q = HRR x1e-7);
       * p: { pxPerM, axisX, zTop, frame, gain:[4], exp:[4], chem:[3], bg:[3] }
       */
      draw: function (fields, p) {
        var T = fields.T, S = fields.S, Q = fields.Q, n = nr * nz;
        for (var c = 0, k = 0; c < n; c++, k += 4) { data[k] = T[c]; data[k + 1] = S[c]; data[k + 2] = Q[c]; }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nr, nz, gl.RGBA, gl.FLOAT, data);
        gl.uniform2f(U.uRes, cv.width, cv.height);
        gl.uniform1f(U.uPxPerM, p.pxPerM);
        gl.uniform2f(U.uAxis, p.axisX, p.zTop);
        gl.uniform4f(U.uGrid, nr, nz, sim.h, p.frame);
        gl.uniform4fv(U.uGain, p.gain); gl.uniform4fv(U.uExp, p.exp);
        gl.uniform3fv(U.uChem, p.chem); gl.uniform3fv(U.uBg, p.bg);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }

  return { supported: supported, create: create };
});
