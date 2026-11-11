/* Card recognizer: find the card outline in a camera frame, flatten it, and match it against
   thumbnails of every printing (data/scan/sprite.jpg). Tuned against a synthetic test set
   (tilt, glare, foil sheen, busy backgrounds). Exposes window.CardScan. */
(function () {
  'use strict';
  const TW = 48, TH = 66, NCD = 24 * 33 * 3;   // thumb size, colour-descriptor length
  const GX = 4, GY = 6, R = 3;                  // cell grid + shift radius for the fine check
  const REF = { ready: null, ids: [], col: null, gray: [], twins: new Map() };

  /* ---------------------------------------------------------------- small image helpers */
  function box2(src, w, h, ch) { // 2x2 average -> (w/2,h/2)
    const W = w >> 1, H = h >> 1, out = new Float32Array(W * H * ch);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) {
      const i = ((2 * y) * w + 2 * x) * ch + c, j = i + w * ch;
      out[(y * W + x) * ch + c] = (src[i] + src[i + ch] + src[j] + src[j + ch]) / 4;
    }
    return out;
  }
  function blur121(src, w, h, ch) { // separable [1 2 1]/4 with edge padding
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = x ? x - 1 : 0, xr = x < w - 1 ? x + 1 : w - 1;
      for (let c = 0; c < ch; c++) tmp[(y * w + x) * ch + c] = (src[(y * w + xl) * ch + c] + 2 * src[(y * w + x) * ch + c] + src[(y * w + xr) * ch + c]) / 4;
    }
    for (let y = 0; y < h; y++) {
      const yu = y ? y - 1 : 0, yd = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(y * w + x) * ch + c] = (tmp[(yu * w + x) * ch + c] + 2 * tmp[(y * w + x) * ch + c] + tmp[(yd * w + x) * ch + c]) / 4;
    }
    return out;
  }
  function zn(arr, off, n, out, ooff, wt) { // zero-mean, unit-norm (scaled by wt)
    let m = 0; for (let i = 0; i < n; i++) m += arr[off + i]; m /= n;
    let s = 0; for (let i = 0; i < n; i++) { const v = arr[off + i] - m; s += v * v; }
    const k = wt / (Math.sqrt(s) + 1e-6);
    for (let i = 0; i < n; i++) out[ooff + i] = (arr[off + i] - m) * k;
  }
  /** thumb: Float32Array TWxTHx3 RGB -> colour descriptor (opponent colour, 24x33) */
  function colorDesc(t) {
    const c = blur121(box2(t, TW, TH, 3), TW / 2, TH / 2, 3), n = (TW / 2) * (TH / 2);
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2]; L[i] = (r + g + b) / 3; A[i] = r - g; B[i] = (r + g) / 2 - b; }
    const out = new Float32Array(NCD);
    zn(L, 0, n, out, 0, 1); zn(A, 0, n, out, n, 0.7); zn(B, 0, n, out, 2 * n, 0.7);
    return out;
  }
  function grayThumb(t) {
    const g = new Float32Array(TW * TH);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * t[i * 3] + 0.587 * t[i * 3 + 1] + 0.114 * t[i * 3 + 2];
    return blur121(g, TW, TH, 1);
  }
  /** fine check: for each cell of the reference, best normalised correlation within +-R px in the frame */
  function cellScore(f, r) {
    const cw = TW / GX, ch = TH / GY, sc = [];
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const x0 = gx * cw, y0 = gy * ch;
      let tm = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) tm += r[(y0 + y) * TW + x0 + x];
      tm /= cw * ch;
      let tn = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const v = r[(y0 + y) * TW + x0 + x] - tm; tn += v * v; }
      tn = Math.sqrt(tn);
      if (tn < 1e-3 * cw * ch) { sc.push(0); continue; }
      let best = -1;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let wm = 0;
        for (let y = 0; y < ch; y++) { const yy = Math.min(TH - 1, Math.max(0, y0 + y + dy)); for (let x = 0; x < cw; x++) wm += f[yy * TW + Math.min(TW - 1, Math.max(0, x0 + x + dx))]; }
        wm /= cw * ch;
        let num = 0, wn = 0;
        for (let y = 0; y < ch; y++) {
          const yy = Math.min(TH - 1, Math.max(0, y0 + y + dy));
          for (let x = 0; x < cw; x++) { const wv = f[yy * TW + Math.min(TW - 1, Math.max(0, x0 + x + dx))] - wm; num += (r[(y0 + y) * TW + x0 + x] - tm) * wv; wn += wv * wv; }
        }
        const v = num / (tn * Math.sqrt(wn) + 1e-6); if (v > best) best = v;
      }
      sc.push(best);
    }
    sc.sort((a, b) => a - b);
    let s = 0; for (let i = 4; i < sc.length; i++) s += sc[i];
    return s / (sc.length - 4);
  }

  /* ---------------------------------------------------------------- geometry */
  function homography(src, dst) { // maps src points -> dst points (4 pairs), returns 3x3 row-major
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) { // gaussian elimination with partial pivot
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((v, i) => v / A[i][i]); h.push(1); return h;
  }
  /** sample an RGBA image (data,w,h) over quad (TL,TR,BR,BL) into W x H float RGB */
  function warpRGB(data, w, h, quad, W, H) {
    const m = homography([[0, 0], [W, 0], [W, H], [0, H]], quad), out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xs = x + 0.5, ys = y + 0.5, d = m[6] * xs + m[7] * ys + m[8];
      let X = (m[0] * xs + m[1] * ys + m[2]) / d - 0.5, Y = (m[3] * xs + m[4] * ys + m[5]) / d - 0.5;
      let x0 = Math.floor(X), y0 = Math.floor(Y);
      x0 = Math.min(w - 2, Math.max(0, x0)); y0 = Math.min(h - 2, Math.max(0, y0));
      const fx = Math.min(1, Math.max(0, X - x0)), fy = Math.min(1, Math.max(0, Y - y0));
      const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4, o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = data[i00 + c] * (1 - fx) * (1 - fy) + data[i10 + c] * fx * (1 - fy) + data[i01 + c] * (1 - fx) * fy + data[i11 + c] * fx * fy;
    }
    return out;
  }
  /** order 4 points TL,TR,BR,BL and make the long side vertical (portrait) */
  function orderQuad(q) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    let p = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let i = 0; for (let k = 1; k < 4; k++) if (p[k][0] + p[k][1] < p[i][0] + p[i][1]) i = k;
    p = p.slice(i).concat(p.slice(0, i));
    const e1 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), e2 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
    if (e1 > e2) p = p.slice(1).concat(p.slice(0, 1));
    return p;
  }
  const scaleQuad = (q, s) => { const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4; return q.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]); };
  const roll2 = (q) => q.slice(2).concat(q.slice(0, 2));

  /* ---------------------------------------------------------------- card outline detection */
  const L = 320, NP = 16;
  function detectQuads(canvas, K = 3) {
    const s = L / Math.max(canvas.width, canvas.height), w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingQuality = 'high'; cx.drawImage(canvas, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, g0 = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g0[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    // gaussian sigma ~1: [1 4 6 4 1]/16 separable
    const k5 = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16], t = new Float32Array(w * h), g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -2; k <= 2; k++) v += k5[k + 2] * g0[y * w + Math.min(w - 1, Math.max(0, x + k))]; t[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -2; k <= 2; k++) v += k5[k + 2] * t[Math.min(h - 1, Math.max(0, y + k)) * w + x]; g[y * w + x] = v; }
    const mag = new Float32Array(w * h), ori = new Float32Array(w * h);
    const at = (x, y) => g[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      mag[y * w + x] = Math.hypot(gx, gy); ori[y * w + x] = Math.atan2(gy, gx);
    }
    let mmax = 0; for (let i = 0; i < mag.length; i++) if (mag[i] > mmax) mmax = mag[i];
    const hist = new Uint32Array(1024); for (let i = 0; i < mag.length; i++) hist[Math.min(1023, (mag[i] / (mmax || 1) * 1023) | 0)]++;
    let acc = 0, bin = 0; const want = mag.length * 0.8; while (bin < 1023 && acc + hist[bin] <= want) acc += hist[bin++];
    const thr = Math.max(1, (bin + 0.5) / 1023 * mmax);
    const xs = [], ys = [], ms = [], os = [];
    for (let i = 0; i < w * h; i++) if (mag[i] > thr) { xs.push(i % w); ys.push((i / w) | 0); ms.push(Math.min(mag[i], thr * 4)); os.push(ori[i]); }
    const N = xs.length, diag = Math.floor(Math.hypot(w, h)) + 1;
    function hough(tmin, tmax) {
      const T = tmax - tmin + 1, ths = [], cs = [], sn = [];
      for (let i = 0; i < T; i++) { const th = (tmin + i) * Math.PI / 180; ths.push(th); cs.push(Math.cos(th)); sn.push(Math.sin(th)); }
      const W2 = 2 * diag, B = new Float32Array(T * W2);  // accumulator, already smoothed with a 3x3 [1 2 1] kernel
      // each edge point votes (weighted by strength) for every aligned angle; remember the votes so they can be withdrawn
      const vstart = new Int32Array(N + 1), votes = [];
      for (let p = 0; p < N; p++) {
        vstart[p] = votes.length;
        for (let i = 0; i < T; i++) if (Math.abs(Math.cos(os[p] - ths[i])) > 0.94) votes.push(i * W2 + Math.round(xs[p] * cs[i] + ys[p] * sn[i]) + diag);
      }
      vstart[N] = votes.length;
      const K3 = [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625];
      function cast(p, sign) {
        const m = ms[p] * sign;
        for (let v = vstart[p]; v < vstart[p + 1]; v++) {
          const cell = votes[v], i = (cell / W2) | 0, j = cell - i * W2;
          for (let a = -1; a <= 1; a++) {
            const ii = i + a; if (ii < 0 || ii >= T) continue;
            for (let b = -1; b <= 1; b++) { const jj = j + b; if (jj < 0 || jj >= W2) continue; B[ii * W2 + jj] += m * K3[(a + 1) * 3 + b + 1]; }
          }
        }
      }
      for (let p = 0; p < N; p++) cast(p, 1);
      const alive = new Uint8Array(N).fill(1), peaks = [];
      for (let it = 0; it < NP; it++) {
        let best = 0, bi = -1;
        for (let k = 0; k < B.length; k++) if (B[k] > best) { best = B[k]; bi = k; }
        if (bi < 0 || best <= 1e-3) break;
        const ti = Math.floor(bi / W2), th = ths[ti], r = (bi % W2) - diag;
        peaks.push([th, r]);
        const c0 = Math.cos(th), s0 = Math.sin(th);
        for (let p = 0; p < N; p++) if (alive[p] && Math.abs(xs[p] * c0 + ys[p] * s0 - r) < 2.5 && Math.abs(Math.cos(os[p] - th)) > 0.9) { alive[p] = 0; cast(p, -1); }
      }
      return peaks;
    }
    const V = hough(-30, 30), Hz = hough(60, 120);
    const inter = (a, b) => { const det = Math.cos(a[0]) * Math.sin(b[0]) - Math.sin(a[0]) * Math.cos(b[0]); if (Math.abs(det) < 1e-6) return null; return [(a[1] * Math.sin(b[0]) - b[1] * Math.sin(a[0])) / det, (Math.cos(a[0]) * b[1] - Math.cos(b[0]) * a[1]) / det]; };
    const xat = (l, y) => (l[1] - y * Math.sin(l[0])) / Math.cos(l[0]), yat = (l, x) => (l[1] - x * Math.cos(l[0])) / Math.sin(l[0]);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    function support(P, Q) {
      const n = 32, dx = Q[0] - P[0], dy = Q[1] - P[1], ln = Math.hypot(dx, dy), nx = -dy / ln, ny = dx / ln, ang = Math.atan2(ny, nx);
      let cnt = 0;
      for (let k = 0; k < n; k++) {
        const tt = (k + 0.5) / n, px = P[0] + dx * tt, py = P[1] + dy * tt;
        for (const off of [-1.5, 0, 1.5]) {
          const xi = Math.min(w - 1, Math.max(0, Math.round(px + nx * off))), yi = Math.min(h - 1, Math.max(0, Math.round(py + ny * off))), i = yi * w + xi;
          if (mag[i] > thr * 0.5 && Math.abs(Math.cos(ori[i] - ang)) > 0.85) { cnt++; break; }
        }
      }
      return cnt / n;
    }
    const scored = [];
    for (let a = 0; a < V.length; a++) for (let b = a + 1; b < V.length; b++) {
      const xa = xat(V[a], h / 2), xb = xat(V[b], h / 2);
      if (Math.abs(xa - xb) < w * 0.2) continue;
      const [left, right] = xa < xb ? [V[a], V[b]] : [V[b], V[a]];
      for (let c2 = 0; c2 < Hz.length; c2++) for (let d2 = c2 + 1; d2 < Hz.length; d2++) {
        const yc = yat(Hz[c2], w / 2), yd = yat(Hz[d2], w / 2);
        if (Math.abs(yc - yd) < h * 0.15) continue;
        const [top, bot] = yc < yd ? [Hz[c2], Hz[d2]] : [Hz[d2], Hz[c2]];
        const P = [inter(left, top), inter(right, top), inter(right, bot), inter(left, bot)];
        if (P.some((p) => !p || p[0] < -3 || p[0] > w + 3 || p[1] < -3 || p[1] > h + 3)) continue;
        const wd = (dist(P[1], P[0]) + dist(P[2], P[3])) / 2, ht = (dist(P[3], P[0]) + dist(P[2], P[1])) / 2;
        const ar = Math.max(ht, wd) / Math.min(ht, wd); if (!(ar > 1.22 && ar < 1.6)) continue;
        const area = wd * ht / (w * h); if (area < 0.1 || area > 0.85) continue;
        const Ls = [0, 1, 2, 3].map((i) => dist(P[(i + 1) % 4], P[i]));
        if (Math.max(Ls[0], Ls[2]) / Math.min(Ls[0], Ls[2]) > 1.3 || Math.max(Ls[1], Ls[3]) / Math.min(Ls[1], Ls[3]) > 1.3) continue;
        let okang = true;
        for (let i = 0; i < 4; i++) {
          const p0 = P[(i + 3) % 4], p1 = P[i], p2 = P[(i + 1) % 4];
          const a1 = [p0[0] - p1[0], p0[1] - p1[1]], a2 = [p2[0] - p1[0], p2[1] - p1[1]];
          if (Math.abs(a1[0] * a2[0] + a1[1] * a2[1]) / (Math.hypot(...a1) * Math.hypot(...a2) + 1e-6) > 0.36) { okang = false; break; }
        }
        if (!okang) continue;
        const sup = [0, 1, 2, 3].map((i) => support(P[i], P[(i + 1) % 4]));
        const sc = sup.reduce((x, y) => x + y, 0) / 4 + 0.6 * Math.min(...sup) - Math.abs(ar - 1.397) * 3 + 0.6 * area - (wd > ht ? 0.12 : 0);
        scored.push([sc, P]);
      }
    }
    scored.sort((x, y) => y[0] - x[0]);
    const picks = [];
    for (const [sc, P] of scored) {
      if (picks.every(([, Q]) => P.some((p, i) => Math.max(Math.abs(p[0] - Q[i][0]), Math.abs(p[1] - Q[i][1])) > 0.06 * h))) picks.push([sc, P]);
      if (picks.length >= K) break;
    }
    return picks.map(([sc, P]) => ({ score: sc, quad: P.map(([x, y]) => [x / s, y / s]) }));
  }

  /* ---------------------------------------------------------------- references */
  function load(base = 'data/scan/') {
    if (REF.ready) return REF.ready;
    REF.ready = (async () => {
      const meta = await (await fetch(base + 'sprite.json', { cache: 'no-cache' })).json();
      const im = new Image(); im.decoding = 'async'; im.src = base + 'sprite.jpg?v=' + (meta.v || '');
      await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
      const all = x.getImageData(0, 0, c.width, c.height).data, cols = meta.cols;
      REF.ids = meta.ids; REF.col = new Float32Array(meta.ids.length * NCD); REF.gray = [];
      for (let n = 0; n < meta.ids.length; n++) {
        const r0 = Math.floor(n / cols) * TH, c0 = (n % cols) * TW, t = new Float32Array(TW * TH * 3);
        for (let y = 0; y < TH; y++) for (let xx = 0; xx < TW; xx++) { const i = ((r0 + y) * c.width + c0 + xx) * 4, o = (y * TW + xx) * 3; t[o] = all[i]; t[o + 1] = all[i + 1]; t[o + 2] = all[i + 2]; }
        REF.col.set(colorDesc(t), n * NCD); REF.gray.push(grayThumb(t));
      }
      for (const grp of meta.twins || []) for (const p of grp) REF.twins.set(String(p), grp.map(String));
      // look-alikes (same art, different frame/stamp) count as the same picture too
      for (const [p, lst] of Object.entries(meta.like || {})) {
        const cur = new Set(REF.twins.get(String(p)) || [String(p)]);
        for (const q of lst) for (const x of REF.twins.get(String(q)) || [String(q)]) cur.add(x);
        REF.twins.set(String(p), [...cur]);
      }
      return REF;
    })().catch((e) => { REF.ready = null; throw e; });
    return REF.ready;
  }

  /** frame side: shrink so the card is ~192 px wide, flatten to 96x132, average to 48x66 */
  function frameThumb(src, quad) {
    const cw = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]), s = Math.min(1, 192 / Math.max(cw, 1));
    let data = src.data, w = src.w, h = src.h;
    if (s < 1) {
      if (!src.small) {
        const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(src.w * s)); c.height = Math.max(2, Math.round(src.h * s));
        const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(src.canvas, 0, 0, c.width, c.height);
        src.small = { data: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, s: c.width / src.w };
      }
      ({ data, w, h } = src.small);
      quad = quad.map(([x, y]) => [x * src.small.s, y * src.small.s]);
    } else if (!data) {
      const x = src.canvas.getContext('2d', { willReadFrequently: true }); src.data = data = x.getImageData(0, 0, w, h).data;
    }
    return box2(warpRGB(data, w, h, quad, 96, 132), 96, 132, 3);
  }

  /**
   * recognise(canvas, {guide}) -> { quad, cands:[{pid, score, twins}], best, margin, score }
   * guide: optional extra quad (the on-screen frame) used as a fallback outline.
   */
  async function recognise(canvas, opts = {}) {
    await load();
    const quads = detectQuads(canvas, 3);
    if (opts.guide) quads.push({ quad: opts.guide, score: 0 });
    const src = { canvas, w: canvas.width, h: canvas.height };
    const N = REF.ids.length, best = new Map();
    for (const { quad: q0, score: dsc } of quads) {
      const q = orderQuad(q0), vars = [];
      for (const f of [0, 2]) for (const s of [1.0, 1.06]) vars.push(f ? roll2(scaleQuad(q, s)) : scaleQuad(q, s));
      const T = vars.map((v) => frameThumb(src, v)), C = T.map(colorDesc), G = T.map(grayThumb);
      const sl = new Float32Array(N), bv = new Uint8Array(N);
      for (let n = 0; n < N; n++) {
        let mx = -9, mi = 0; const off = n * NCD;
        for (let v = 0; v < C.length; v++) { const cv = C[v]; let s = 0; for (let k = 0; k < NCD; k++) s += REF.col[off + k] * cv[k]; if (s > mx) { mx = s; mi = v; } }
        sl[n] = mx; bv[n] = mi;
      }
      const top = Array.from({ length: N }, (_, i) => i).sort((a, b) => sl[b] - sl[a]).slice(0, 12);
      for (const t of top) {
        const vb = bv[t], other = vb ^ 1;  // same flip, other scale
        const sc = Math.max(cellScore(G[vb], REF.gray[t]), cellScore(G[other], REF.gray[t]));
        const prev = best.get(t);
        if (!prev || sc > prev.score) best.set(t, { score: sc, quad: vars[vb], lab: sl[t], det: dsc });
      }
    }
    const list = [...best.entries()].map(([t, v]) => ({ pid: REF.ids[t], score: v.score, quad: v.quad, det: v.det })).sort((a, b) => b.score - a.score);
    if (!list.length) return { cands: [], best: null, score: 0, margin: 0 };
    const top = list[0], tw = new Set(REF.twins.get(String(top.pid)) || [String(top.pid)]);
    const alt = list.find((c) => !tw.has(String(c.pid)));
    for (const c of list) c.twins = REF.twins.get(String(c.pid)) || [String(c.pid)];
    return { cands: list.slice(0, 8), best: top, score: top.score, margin: top.score - (alt ? alt.score : 0), quad: top.quad };
  }

  /** flatten the card at full resolution (for reading the printed number) */
  function flatten(canvas, quad, W = 945, H = 1320) {
    const x = canvas.getContext('2d', { willReadFrequently: true }), im = x.getImageData(0, 0, canvas.width, canvas.height);
    const rgb = warpRGB(im.data, canvas.width, canvas.height, quad, W, H);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'), out = cx.createImageData(W, H);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { out.data[j] = rgb[i]; out.data[j + 1] = rgb[i + 1]; out.data[j + 2] = rgb[i + 2]; out.data[j + 3] = 255; }
    cx.putImageData(out, 0, 0); return c;
  }

  window.CardScan = { twinsOf: (pid) => REF.twins.get(String(pid)) || [String(pid)], load, recognise, detectQuads, flatten, orderQuad, _t: { colorDesc, grayThumb, cellScore, frameThumb, warpRGB, homography } };
})();
