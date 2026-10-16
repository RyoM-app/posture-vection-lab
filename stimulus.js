export class StimulusRenderer {
constructor(cv,settings,seed=1){
const ctx=cv.getContext('2d'),cfg={dots:settings.dotCount,dotSize:settings.dotSize,fov:settings.renderFov,pattern:settings.pattern};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),TAU=Math.PI*2;
let W=1,H=1,cx=0,cy=0,f=1;
let rng=seed>>>0;const random=()=>{rng=(Math.imul(1664525,rng)+1013904223)>>>0;return rng/4294967296;};
// dot draw buffer, bucketed by alpha so one fill() per level
const LV = 6, MAXN = 8000;
const bx = new Float32Array(MAXN), by = new Float32Array(MAXN), br = new Float32Array(MAXN), bl = new Uint8Array(MAXN);
let bn = 0;
function emit(sx, sy, r, a) {
  if (a <= 0.03 || bn >= MAXN || sx < -r || sx > W + r || sy < -r || sy > H + r) return;
  bx[bn] = sx; by[bn] = sy; br[bn] = r; bl[bn] = Math.min(LV - 1, (a * LV) | 0); bn++;
}
function flush() {
  ctx.fillStyle = '#fff';
  for (let l = 0; l < LV; l++) {
    ctx.globalAlpha = (l + 1) / LV;
    ctx.beginPath();
    for (let k = 0; k < bn; k++) {
      if (bl[k] !== l) continue;
      ctx.moveTo(bx[k] + br[k], by[k]);
      ctx.arc(bx[k], by[k], br[k], 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  bn = 0;
}

// ---------- stimuli ----------
// Camera at origin looking +z, y up. Screen: sx = cx + f*x/z, sy = cy - f*y/z.
// Sign convention: speed > 0 = forward translation (radial) / forward pitch (drum, torus: scene ahead flows upward).

const radial = {
  zN: 0.3, zF: 14,
  init(n) {
    this.n = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    for (let i = 0; i < n; i++) this.spawn(i, this.zN + random() * (this.zF - this.zN));
  },
  spawn(i, z) {
    const sx = this.zF * (W / 2) / f, sy = this.zF * (H / 2) / f;
    this.x[i] = (random() * 2 - 1) * sx;
    this.y[i] = (random() * 2 - 1) * sy;
    this.z[i] = z;
  },
  update(dt, v) {  // v: m/s
    const range = this.zF - this.zN, dz = v * dt;
    for (let i = 0; i < this.n; i++) {
      let z = this.z[i] - dz;
      if (z < this.zN) this.spawn(i, z + range);
      else if (z > this.zF) this.spawn(i, z - range);
      else this.z[i] = z;
    }
  },
  draw() {
    const range = this.zF - this.zN, rad = cfg.dotSize / 2;
    for (let i = 0; i < this.n; i++) {
      const z = this.z[i];
      const a = clamp((this.zF - z) / (0.3 * range), 0, 1) * clamp((z - this.zN) / 0.4, 0, 1);
      emit(cx + f * this.x[i] / z, cy - f * this.y[i] / z, rad * clamp(3 / z, 0.5, 3), a);
    }
  },
};

const drum = {
  // Observer at the centre of a cylinder (radius R) whose axis is the left-right (x) axis.
  R: 5,
  init(n) {
    this.n = n;
    this.tm = Math.min(1.45, Math.atan((H / 2) / f) + 0.15);   // visible theta window (+margin)
    this.lx = this.R * (W / 2) / f * 1.05;                      // visible half-width at theta = 0
    this.x = new Float32Array(n); this.t = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = (random() * 2 - 1) * this.lx;
      this.t[i] = (random() * 2 - 1) * this.tm;
    }
  },
  update(dt, w) {  // w: deg/s
    const d = w * Math.PI / 180 * dt, tm = this.tm;
    for (let i = 0; i < this.n; i++) {
      let t = this.t[i] + d;
      if (t > tm || t < -tm) {
        t += t > tm ? -2 * tm : 2 * tm;
        this.x[i] = (random() * 2 - 1) * this.lx;
      }
      this.t[i] = t;
    }
  },
  draw() {
    const R = this.R, rad = cfg.dotSize / 2;
    for (let i = 0; i < this.n; i++) {
      const t = this.t[i], z = R * Math.cos(t), y = R * Math.sin(t);
      const a = clamp((this.tm - Math.abs(t)) / 0.15, 0, 1);
      emit(cx + f * this.x[i] / z, cy - f * y / z, rad * clamp(R / z, 1, 3), a);
    }
  },
};

// Observer on the centre line of a tyre tube (wheel radius Rm, tube radius r), looking forward along the tube.
// side = +1: at the bottom of the wheel, hub C = (0, Rm, 0) above, tube ahead curves up.
// side = -1: at the top of the wheel,    hub C = (0, -Rm, 0) below, tube ahead curves down.
// p is the angle along the wheel measured from the observer. The wheel turns about the x axis through C in the
// same sense for both (front of the wheel moves up for speed > 0), so at the bottom the walls stream away from
// the observer and at the top they stream toward the observer; in both cases the scene ahead flows upward.
const makeTorus = side => ({
  side, Rm: 8, r: 1.6, p0: -0.12, p1: 1.9,
  init(n) {
    this.n = n;
    this.p = new Float32Array(n); this.s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.p[i] = this.p0 + random() * (this.p1 - this.p0);
      this.s[i] = this.sampleTube();
    }
  },
  sampleTube() {  // area-uniform on the torus: weight by (Rm + r cos psi)
    const { Rm, r } = this;
    for (;;) {
      const s = random() * TAU;
      if (random() * (Rm + r) <= Rm + r * Math.cos(s)) return s;
    }
  },
  update(dt, w) {
    const d = this.side * w * Math.PI / 180 * dt, span = this.p1 - this.p0;
    for (let i = 0; i < this.n; i++) {
      let p = this.p[i] + d;
      if (p > this.p1 || p < this.p0) {
        p += p > this.p1 ? -span : span;
        this.s[i] = this.sampleTube();
      }
      this.p[i] = p;
    }
  },
  draw() {
    const { Rm, r } = this, rad = cfg.dotSize / 2;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i], s = this.s[i], q = Rm + r * Math.cos(s);
      const x = r * Math.sin(s), y = this.side * (Rm - q * Math.cos(p)), z = q * Math.sin(p);
      if (z < 0.05) continue;
      const d = Math.hypot(x, y, z);
      const a = clamp(1.3 - d / 14, 0.15, 1) * clamp((p - this.p0) / 0.1, 0, 1) * clamp((this.p1 - p) / 0.2, 0, 1);
      emit(cx + f * x / z, cy - f * y / z, rad * clamp(4 / d, 0.4, 3), a);
    }
  },
});

const PATTERNS = { radial, drum, torus: makeTorus(1), torusTop: makeTorus(-1) };
const pattern = () => PATTERNS[cfg.pattern];


this.resize=()=>{const box=cv.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);W=box.width;H=box.height;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);cx=W/2;cy=H/2;f=(H/2)/Math.tan(cfg.fov*Math.PI/360);pattern().init(cfg.dots);};
this.draw=(dt,speed)=>{ctx.fillStyle='#10151d';ctx.fillRect(0,0,W,H);pattern().update(Math.min(dt,.05),speed);pattern().draw();flush();};
this.resize();
}
}
