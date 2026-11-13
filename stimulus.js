// 回転軸のずれ R で統一したベクション刺激。
//   ドラム    R = 0   : その場で回転（純粋な回転）
//   ホイール  R 有限  : 半径Rの円軌道（回転 + 並進）= タイヤの内側にいる感じ
//   ストリーム R = ∞  : 並進のみ（放射状オプティカルフロー）
// 世界は静止したドット群で、カメラだけが動く。座標は x:右, y:上, z:前。

export const MODES = {
  drum:   { label: 'ドラム',     R: 0,        unit: 'deg/s', max: 60 },
  wheel:  { label: 'ホイール',   R: 3,        unit: 'deg/s', max: 45 },
  stream: { label: 'ストリーム', R: Infinity, unit: 'm/s',   max: 6 },
};
export const DENSITY = { 1: 500, 2: 1400, 3: 3500 };           // 見える範囲のおよそのドット数（疎・中・密）
export const MOTIONS = { const: '等速', accel: '加速', reverse: '急反転', osc: '往復' };

// 動き方：時間 t（秒）に対する速さの倍率（符号つき）。
export function motionFactor(kind, t) {
  switch (kind) {
    case 'accel':   return 0.2 + 0.8 * Math.min(1, t / 6);   // 20%から6秒で100%まで加速し、以後は一定
    case 'reverse': return t < 4 ? 1 : -1;                    // 4秒で逆向きに急反転（加速度は瞬間的）
    case 'osc':     return Math.sin(2 * Math.PI * t / 4);     // 周期4秒の往復
    default:        return 1;
  }
}
export const REVERSE_AT = 4;

const DEFAULTS = { mode: 'wheel', R: 3, hub: 'up', layout: 'random', shape: 'cloud', density: 2, dotSize: 2.5, fov: 90, clearing: 0.55 };
const ZN = 0.4, ZF = 9, LV = 10, MAXN = 12000, MAXWORLD = 45000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

export class StimulusRenderer {
  constructor(cv, cfg, seed = 1) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.seed = seed >>> 0;
    this.W = 1; this.H = 1; this.theta = 0; this.Z = 0; this.n = 0;
    this.bx = new Float32Array(MAXN); this.by = new Float32Array(MAXN); this.br = new Float32Array(MAXN); this.bl = new Uint8Array(MAXN); this.bn = 0;
    this.cfg = { ...DEFAULTS, ...cfg };
    this.resize();
  }

  configure(cfg) { this.cfg = { ...DEFAULTS, ...cfg }; this.theta = 0; this.Z = 0; this.build(); }

  resize() {
    const cv = this.cv, box = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = Math.max(1, box.width); this.H = Math.max(1, box.height);
    cv.width = Math.round(this.W * dpr); cv.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.build();
  }

  build() {
    const { cfg, W, H } = this;
    let rs = this.seed || 1;
    const rnd = () => { rs = (Math.imul(1664525, rs) + 1013904223) >>> 0; return rs / 4294967296; };
    const f = (H / 2) / Math.tan(cfg.fov * Math.PI / 360);
    this.f = f; this.cx = W / 2; this.cy = H / 2;
    const tH = (W / 2) / f, tV = (H / 2) / f;
    const visVol = 4 / 3 * tH * tV * (ZF ** 3 - ZN ** 3);
    const nVis = DENSITY[cfg.density] ?? DENSITY[2];
    const grid = cfg.layout === 'grid';
    const mode = MODES[cfg.mode] ? cfg.mode : 'wheel';
    this.kind = mode;
    this.R = mode === 'drum' ? 0 : mode === 'wheel' ? Math.max(0.5, cfg.R) : Infinity;
    const pts = [];                                        // flat x,y,z

    if (mode === 'stream') {
      const hx = ZF * tH * 1.15, hy = ZF * tV * 1.15, L = ZF - ZN;
      this.L = L;
      const boxVol = 4 * hx * hy * L;
      const n = Math.min(MAXWORLD, Math.round(nVis * boxVol / visVol));
      if (grid) {
        const s = Math.cbrt(boxVol / n), nx = Math.max(2, Math.round(2 * hx / s)), ny = Math.max(2, Math.round(2 * hy / s)), nz = Math.max(2, Math.round(L / s));
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++)
          pts.push(-hx + (i + 0.5) * 2 * hx / nx, -hy + (j + 0.5) * 2 * hy / ny, ZN + (k + 0.5) * L / nz);
      } else {
        for (let i = 0; i < n; i++) pts.push((rnd() * 2 - 1) * hx, (rnd() * 2 - 1) * hy, ZN + rnd() * L);
      }
    } else if (mode === 'wheel' && cfg.shape === 'tube') {
      // タイヤの管。観測者は管の中心線上（半径Rの円）にいて、壁にドットが張りついている。
      const R = this.R, rt = Math.min(1.6, 0.45 * R);
      const phiMax = 2 * Math.asin(Math.min(1, ZF / (2 * R)));
      const n = Math.min(MAXWORLD, Math.round(nVis * 1.5 * TAU / phiMax));
      const P = (phi, psi) => { const q = R + rt * Math.cos(psi); pts.push(rt * Math.sin(psi), -q * Math.cos(phi), q * Math.sin(phi)); };
      if (grid) {
        const area = TAU * R * TAU * rt, s = Math.sqrt(area / n), np = Math.max(8, Math.round(TAU * R / s)), nq = Math.max(6, Math.round(TAU * rt / s));
        for (let i = 0; i < np; i++) for (let j = 0; j < nq; j++) P(i * TAU / np, j * TAU / nq);
      } else {
        for (let i = 0; i < n; i++) {
          let psi; for (;;) { psi = rnd() * TAU; if (rnd() * (R + rt) <= R + rt * Math.cos(psi)) break; }
          P(rnd() * TAU, psi);
        }
      }
    } else {
      // 軸（ハブ）を中心とする球状の点群。回転軸のずれ R が大きいほど球も大きくなる。
      const R = this.R, Rb = R + ZF, ballVol = 4 / 3 * Math.PI * Rb ** 3;
      const n = Math.min(MAXWORLD, Math.round(nVis * ballVol / visVol));
      if (grid) {
        const s = Math.cbrt(ballVol / n), m = Math.ceil(Rb / s);
        for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) for (let k = -m; k <= m; k++) {
          const x = i * s, y = j * s, z = k * s;
          if (x * x + y * y + z * z <= Rb * Rb) pts.push(x, y, z);
        }
      } else {
        while (pts.length < 3 * n) {
          const x = (rnd() * 2 - 1) * Rb, y = (rnd() * 2 - 1) * Rb, z = (rnd() * 2 - 1) * Rb;
          if (x * x + y * y + z * z <= Rb * Rb) pts.push(x, y, z);
        }
      }
    }
    this.n = pts.length / 3;
    this.w = Float32Array.from(pts);
    this.flip = cfg.hub === 'down' ? -1 : 1;                // 軸が下（観測者はホイールの上側）なら上下反転
  }

  emit(sx, sy, r, a) {
    const { W, H } = this;
    if (a <= 0.03 || this.bn >= MAXN || sx < -r || sx > W + r || sy < -r || sy > H + r) return;
    const k = this.bn++;
    this.bx[k] = sx; this.by[k] = sy; this.br[k] = r; this.bl[k] = Math.min(LV - 1, (a * LV) | 0);
  }

  flush() {
    const { ctx, bx, by, br, bl, bn } = this;
    ctx.fillStyle = '#fff';
    for (let l = 0; l < LV; l++) {
      ctx.globalAlpha = (l + 1) / LV;
      ctx.beginPath();
      for (let k = 0; k < bn; k++) {
        if (bl[k] !== l) continue;
        ctx.moveTo(bx[k] + br[k], by[k]); ctx.arc(bx[k], by[k], br[k], 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1; this.bn = 0;
  }

  // rate: 回転系は度/秒（符号つき、＋＝前進）、ストリームは m/秒。
  draw(dt, rate) {
    const { ctx, W, H, cfg, w, n, f, cx, cy } = this;
    ctx.clearRect(0, 0, W, H);
    dt = Math.min(dt, 0.05);
    const clearing = clamp(cfg.clearing ?? 0, 0, 1), r0 = clearing * 0.8, r1 = r0 + 0.3, rad0 = cfg.dotSize / 2;
    const stream = this.kind === 'stream';
    let s = 0, c = 1, cyw = 0, czw = 0;
    if (stream) {
      this.Z = (this.Z + rate * dt) % this.L;
    } else {
      this.theta = (this.theta + rate * Math.PI / 180 * dt) % TAU;
      s = Math.sin(this.theta); c = Math.cos(this.theta);
      cyw = -this.R * c; czw = this.R * s;                   // カメラ位置（軸は原点）
    }
    const fl = this.flip, L = this.L, Z = this.Z;
    for (let i = 0; i < n; i++) {
      const px = w[3 * i], py = w[3 * i + 1], pz = w[3 * i + 2];
      let xc = px, yc, zc;
      if (stream) {
        yc = py;
        zc = ZN + ((((pz - Z - ZN) % L) + L) % L);
      } else {
        const dy = py - cyw, dz = pz - czw;
        yc = (dy * c - dz * s) * fl; zc = dy * s + dz * c;
      }
      if (zc < ZN || zc > ZF) continue;
      const sx = cx + f * xc / zc, sy = cy - f * yc / zc;
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
      const d = Math.sqrt(xc * xc + yc * yc + zc * zc);
      // 遠いほど薄く・小さく、近いほどはっきり・大きく（奥行き感）
      let a = clamp(2 * (1 - d / ZF), 0, 1) * clamp((zc - ZN) / 0.5, 0, 1);
      if (clearing > 0) {
        const rho = Math.hypot((sx - cx) / (W / 2), (sy - cy) / (H / 2));
        a *= smooth(r0, r1, rho);                            // 中央をなだらかに空ける
      }
      this.emit(sx, sy, rad0 * clamp(4 / d, 0.6, 3.5), a);
    }
    this.flush();
  }
}
