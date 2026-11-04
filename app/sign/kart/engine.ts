// The racetrack signing game (three.js). Sam races Judy, the ticket-booth
// lady from the theater (app/sign/game), three laps of a floodlit kart track
// at dusk: a long straight past the grandstand and the start arch, a hairpin
// at each end, a chicane and a sweeping back section, with BFO boards on the
// corners. Everything is built here from boxes, cones and ribbons along a
// Catmull-Rom loop: no model files. Judy's kart follows the spline with a
// rubber band so the race stays close; she talks the whole way (cues in
// public/kart/judy.json). The sounds are synthesized with Web Audio unless
// the manifest names a file for them. The finish, won or lost, hands over to
// the signing page. index.tsx wraps this in React and draws the HUD from
// `onHud`.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type KartSoundKey = "kart-engine" | "kart-drift" | "kart-jump" | "kart-land" | "kart-lap" | "kart-finish" | "kart-bump" | "kart-count" | "kart-go" | "kart-boost";

export type KartManifest = {
  /** The track for laps one and two (loops). */
  music: string | null;
  /** The track for the last lap; without one the same song jumps to its drop. */
  musicFinal: string | null;
  sounds: Partial<Record<KartSoundKey, string | null>>;
  /** Judy's voiced lines by id (public/kart/judy.json, ids begin "k-"). */
  voice: Partial<Record<string, string>>;
};

export type KartCue =
  "start" | "lap1-early" | "lap1-mid" | "judy-passes" | "lap2-start" | "lap2-mid" | "player-ahead" | "lap3-start" | "lap3-mid" | "player-passes" | "bump" | "first-jump" | "player-wins" | "judy-wins";

export type KartLine = { id: string; cue: KartCue; text: string };
/** Judy's script (public/kart/judy.json): one line per cue. */
export type KartScript = { name: string; lines: KartLine[] };

export type KartPhase = "intro" | "ready" | "countdown" | "racing" | "finished" | "done";

export type KartHud = {
  phase: KartPhase;
  lap: number;
  laps: 3;
  position: 1 | 2;
  /** Race time in seconds (to a tenth). */
  time: number;
  /** 3, 2, 1, then 0 for GO; null outside the countdown. */
  countdown: number | null;
  paused: boolean;
  /** 0..1 black over everything (the fade into the signing page). */
  dark: number;
  fps: number;
  dialogue: { speaker: string; text: string } | null;
  result: { won: boolean; time: number } | null;
  /** A hint at the bottom of the screen; "" for nothing. */
  prompt: string;
};

export type KartOptions = {
  signerName: string;
  title: string;
  manifest: KartManifest;
  judy: KartScript | null;
  onHud: (hud: KartHud) => void;
  /** The finish line was crossed and "Go sign" pressed: show the signing page. */
  onDone: () => void;
};

export const EMPTY_KART_MANIFEST: KartManifest = { music: null, musicFinal: null, sounds: {}, voice: {} };

const LAPS = 3;
/** The road: half its width, the curb beyond it, and where the barrier stands. */
const ROAD = { half: 7, curb: 1.3, bound: 14.5 };
/**
 * The loop (meters, y up), scaled so a clean lap is about a minute: a
 * straight along x at z = 0 with the start line at the origin, a hairpin at
 * each end, a chicane across the top and a long sweep round the back.
 */
const CONTROL: Array<[number, number]> = (
  [
    [0, 0],
    [170, 0],
    [214, -20],
    [216, -64],
    [176, -84],
    [104, -72],
    [56, -102],
    [0, -82],
    [-82, -132],
    [-152, -172],
    [-212, -142],
    [-228, -76],
    [-198, -26],
    [-170, 0],
  ] as Array<[number, number]>
).map(([x, z]) => [x * 1.2, z * 1.2]);
/** The player's kart: top speed, how fast it gets there, how it turns and how it slides. */
const KART = { top: 30, accel: 13, brake: 24, reverseTop: 8, r0: 6, k: 0.5, grip: 7.5, driftGrip: 2.3, grassGrip: 3.5, grassTop: 0.5, jump: 6.4, gravity: 18 };
/** Judy: a shade slower flat out, cornering on grip alone, and a rubber band either way. */
const JUDY = { top: 29.2, lat: 11.5, band: 0.11, accel: 11, brake: 22, hop: 5.6 };
/** Speed bumps, as fractions of the lap and a lateral offset; a jump clears them. */
const BUMPS: Array<{ at: number; d: number }> = [
  { at: 0.17, d: -2.5 },
  { at: 0.41, d: 2.5 },
  { at: 0.63, d: 0 },
  { at: 0.86, d: -2 },
];
const BUMP_H = 0.32;

// ── The track: the spline sampled every metre and a half ─────────────────

class Track {
  readonly n: number;
  readonly ds: number;
  readonly length: number;
  readonly px: Float64Array;
  readonly pz: Float64Array;
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  /** The left normal: the road's left edge is at +normal. */
  readonly nx: Float64Array;
  readonly nz: Float64Array;
  /** Signed curvature (positive turning left), smoothed over a few metres. */
  readonly curv: Float64Array;
  readonly corner: Uint8Array;

  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      "catmullrom",
      0.5,
    );
    curve.arcLengthDivisions = 4000;
    this.length = curve.getLength();
    this.n = Math.round(this.length / 1.5);
    this.ds = this.length / this.n;
    const pts = curve.getSpacedPoints(this.n);
    const n = this.n;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.nz = new Float64Array(n);
    this.curv = new Float64Array(n);
    this.corner = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i].x;
      this.pz[i] = pts[i].z;
    }
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const b = (i + 1) % n;
      let dx = this.px[b] - this.px[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.nx[i] = dz;
      this.nz[i] = -dx;
    }
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = (i + 1) % n;
      const cross = this.tx[i] * this.tz[b] - this.tz[i] * this.tx[b];
      const dot = this.tx[i] * this.tx[b] + this.tz[i] * this.tz[b];
      raw[i] = -Math.atan2(cross, dot) / this.ds;
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -4; k <= 4; k++) sum += raw[(i + k + n) % n];
      this.curv[i] = sum / 9;
    }
    for (let i = 0; i < n; i++) {
      let max = 0;
      for (let k = -8; k <= 8; k++) max = Math.max(max, Math.abs(this.curv[(i + k + n) % n]));
      this.corner[i] = max > 1 / 75 ? 1 : 0;
    }
  }

  /** The road's centre at `s` metres round the lap (any value; wraps). */
  at(s: number): { x: number; z: number; tx: number; tz: number; nx: number; nz: number; i: number } {
    const n = this.n;
    let u = s / this.ds;
    u = ((u % n) + n) % n;
    const i = Math.floor(u);
    const f = u - i;
    const j = (i + 1) % n;
    const lerp = (a: Float64Array) => a[i] + (a[j] - a[i]) * f;
    const tx = lerp(this.tx);
    const tz = lerp(this.tz);
    const len = Math.hypot(tx, tz) || 1;
    return { x: lerp(this.px), z: lerp(this.pz), tx: tx / len, tz: tz / len, nx: tz / len, nz: -tx / len, i };
  }

  /** The nearest sample to a point, searched near `hint` (or the whole lap when there is none). */
  nearest(x: number, z: number, hint: number): number {
    const n = this.n;
    let best = -1;
    let bestD = Infinity;
    const check = (i: number) => {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint < 0) for (let i = 0; i < n; i++) check(i);
    else for (let k = -30; k <= 30; k++) check((hint + k + n * 4) % n);
    return best;
  }

  /** Where a point is on the lap: progress `s`, lateral offset `d` (left positive), and the sample it is beside. */
  frame(x: number, z: number, hint: number): { i: number; s: number; d: number } {
    const i = this.nearest(x, z, hint);
    const dx = x - this.px[i];
    const dz = z - this.pz[i];
    const along = dx * this.tx[i] + dz * this.tz[i];
    const d = dx * this.nx[i] + dz * this.nz[i];
    let s = i * this.ds + along;
    if (s < 0) s += this.length;
    if (s >= this.length) s -= this.length;
    return { i, s, d };
  }
}

// ── Karts ──────────────────────────────────────────────────────────────────

type KartModel = {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  fronts: THREE.Group[];
  body: THREE.Group;
  shadow: THREE.Mesh;
  flame: THREE.Mesh;
};

/** Forward is -z in the kart's own frame: `heading` 0 points down -z. */
const forward = (heading: number) => ({ x: -Math.sin(heading), z: -Math.cos(heading) });
const headingOf = (tx: number, tz: number) => Math.atan2(-tx, -tz);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Driver = {
  x: number;
  z: number;
  y: number;
  vy: number;
  heading: number;
  /** The direction the kart is actually travelling; lags the heading in a slide. */
  dir: number;
  v: number;
  /** Lap progress in metres (Judy's is continuous: it never wraps). */
  s: number;
  d: number;
  hint: number;
  lap: number;
  half: boolean;
  grounded: boolean;
  model: KartModel;
  steer: number;
  wheelSpin: number;
};

export class KartRace {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly track = new Track();
  private readonly disposers: Array<() => void> = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private raf = 0;
  private last = 0;

  private phase: KartPhase = "intro";
  private hud: KartHud = { phase: "intro", lap: 1, laps: 3, position: 2, time: 0, countdown: null, paused: false, dark: 0, fps: 0, dialogue: null, result: null, prompt: "" };
  private readonly keys = new Set<string>();
  private paused = false;
  /** Race time, counted from GO while not paused. */
  private time = 0;
  private clock = 0;
  private readyAt = 0;
  private countdownClock = 0;
  private countdownShown = -1;
  private goAt = -1;

  private player!: Driver;
  private judy!: Driver;
  private drifting: { dir: number; since: number } | null = null;
  private boostUntil = 0;
  private jumped = false;
  private onGrassSince = -1;
  private wrongWaySince = -1;
  private lastWall = -10;
  private lastBump = -10;
  private lastBumpAt = -1;
  private lastJudyBump = -1;
  private aheadSince = -1;
  private playerAhead = false;
  private finishedAt = -1;
  private judyDone = false;
  private won: boolean | null = null;
  private judyOffsetPhase = 0;
  private auto = false;

  // Camera and the picture
  private camYaw = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private fov = 68;
  private frames = 0;
  private fpsAt = 0;
  private scale = 1;
  private goodReadings = 0;
  private readonly base = Math.min(window.devicePixelRatio || 1, 2);
  private readonly dust: Array<{ sprite: THREE.Sprite; vx: number; vz: number; life: number }> = [];
  private dustMat!: THREE.SpriteMaterial;
  private bumpMeshes: THREE.Mesh[] = [];

  // Judy's lines
  private readonly said = new Set<string>();
  private speaking: KartLine | null = null;
  private readonly queue: KartLine[] = [];
  private lineTimers: Array<ReturnType<typeof setTimeout>> = [];
  private lineAudio: HTMLAudioElement | null = null;
  private radio: AudioContext | null = null;

  // Sound and music
  private sound: RaceSound | null = null;
  private music: HTMLAudioElement | null = null;
  private musicFinal: HTMLAudioElement | null = null;
  private musicFade: number | null = null;
  private lastLap = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: KartOptions,
  ) {
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 1400);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(this.base);
    this.renderer.setClearColor(0x1a1434, 1);
    Object.assign(this.renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
    container.appendChild(this.renderer.domElement);
    this.build();
    this.media();
    this.listen();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.placeCamera(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.emit();
    // In development only: the browser checks drive the race from the console, and ?auto=1 drives the kart.
    if (import.meta.env.DEV) {
      (window as unknown as { __kartRace?: KartRace }).__kartRace = this;
      this.auto = new URLSearchParams(window.location.search).get("auto") === "1";
    }
  }

  /** Development only: where everyone is. */
  get debug() {
    const p = this.player;
    const j = this.judy;
    return {
      phase: this.phase,
      time: +this.time.toFixed(1),
      length: +this.track.length.toFixed(1),
      player: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), v: +p.v.toFixed(1), s: +p.s.toFixed(1), d: +p.d.toFixed(2), lap: p.lap, half: p.half, grounded: p.grounded },
      judy: { s: +j.s.toFixed(1), v: +j.v.toFixed(1), lap: Math.floor(j.s / this.track.length) + 1 },
      position: this.hud.position,
      speaking: this.speaking?.id ?? null,
      queue: this.queue.map((l) => l.id),
      said: [...this.said],
      auto: this.auto,
      scale: this.scale,
    };
  }

  /** Development only: the kart drives itself along the racing line. */
  setAuto(on: boolean) {
    if (import.meta.env.DEV) this.auto = on;
  }

  /** Development only: runs the race on for `seconds` without drawing (the browser checks finish a race in software GL). */
  warp(seconds: number) {
    if (!import.meta.env.DEV) return;
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) this.step(step);
  }

  // ── Building the world ──────────────────────────────────────────────────

  private build() {
    const s = this.scene;
    const T = this.track;
    s.fog = new THREE.Fog(0x2b2142, 260, 820);
    // The sky: a gradient from indigo overhead to a warm band at the horizon.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
    s.add(sky);
    s.add(new THREE.HemisphereLight(0x7f8fd6, 0x2e3a22, 1.1));
    s.add(new THREE.AmbientLight(0xffd9b0, 0.35));
    const flood = new THREE.DirectionalLight(0xffd3a0, 1.7);
    flood.position.set(-120, 160, 90);
    s.add(flood);
    const fill = new THREE.DirectionalLight(0x8fa8ff, 0.5);
    fill.position.set(140, 90, -200);
    s.add(fill);

    // Grass everywhere, a run-off ring of darker ground beside the road, and hills on the horizon.
    const grassTex = noiseTexture(0x3d7a30, 16);
    grassTex.repeat.set(110, 90);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1400), new THREE.MeshLambertMaterial({ map: grassTex }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.05, -80);
    s.add(grass);
    const dirtTex = noiseTexture(0x7d7250, 12);
    dirtTex.repeat.set(1, 60);
    const runoff = this.ribbon(
      (i) => -ROAD.bound - 0.4,
      (i) => ROAD.bound + 0.4,
      0,
      null,
      null,
      1 / 24,
    );
    s.add(new THREE.Mesh(runoff, new THREE.MeshLambertMaterial({ map: dirtTex, color: 0xcbbf90 })));
    const hills: THREE.BufferGeometry[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
      const r = 620 + rnd() * 120;
      const h = 60 + rnd() * 90;
      const g = new THREE.ConeGeometry(120 + rnd() * 120, h, 7);
      g.translate(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r - 80);
      hills.push(colored(g, 0x241c45));
    }
    s.add(new THREE.Mesh(mergeGeometries(hills, false), new THREE.MeshLambertMaterial({ vertexColors: true })));

    // The road, its curbs (red and white through the corners), the edge lines, and the barrier (blue and white).
    const asphalt = noiseTexture(0x606068, 9);
    asphalt.repeat.set(1, 1);
    const road = this.ribbon(
      (i) => -ROAD.half,
      (i) => ROAD.half,
      0.01,
      null,
      null,
      1 / 6,
    );
    s.add(new THREE.Mesh(road, new THREE.MeshLambertMaterial({ map: asphalt })));
    const curbColor = (i: number) => (Math.floor((i * T.ds) / 4) % 2 === 0 ? 0xd8343a : 0xf2f0e8);
    for (const side of [-1, 1]) {
      const curb = this.ribbon(
        (i) => side * ROAD.half,
        (i) => side * (ROAD.half + ROAD.curb),
        0.03,
        (i) => T.corner[i] === 1,
        curbColor,
        0,
      );
      s.add(new THREE.Mesh(curb, new THREE.MeshLambertMaterial({ vertexColors: true })));
      const line = this.ribbon(
        (i) => side * ROAD.half,
        (i) => side * (ROAD.half + 0.3),
        0.025,
        (i) => T.corner[i] === 0,
        () => 0xf4f1e6,
        0,
      );
      s.add(new THREE.Mesh(line, new THREE.MeshLambertMaterial({ vertexColors: true })));
      const wall = this.wall(side * ROAD.bound, 0.9, (i) => (Math.floor((i * T.ds) / 6) % 2 === 0 ? 0x2b5bd6 : 0xf2f0e8));
      s.add(new THREE.Mesh(wall, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }
    // The start line, checkered.
    const check = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.half * 2, 3), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
    check.rotation.x = -Math.PI / 2;
    check.position.set(0, 0.04, 0);
    s.add(check);
    // The speed bumps: yellow and black, with a jump over them.
    for (const b of BUMPS) {
      const a = T.at(b.at * T.length);
      const m = new THREE.Mesh(new THREE.BoxGeometry(6, BUMP_H, 1.4), new THREE.MeshLambertMaterial({ map: stripeTexture() }));
      m.position.set(a.x + a.nx * b.d, BUMP_H / 2, a.z + a.nz * b.d);
      m.rotation.y = headingOf(a.tx, a.tz);
      s.add(m);
      this.bumpMeshes.push(m);
    }

    this.startArch();
    this.grandstand();
    this.boards();
    this.lamps();
    this.trees(rnd);

    // The karts on the grid: Judy on pole, Sam behind.
    const first = this.opts.signerName.trim().split(/\s+/)[0] || "Sam";
    this.player = this.driver(this.kart("sam", first.toUpperCase(), 0x15151a), -14, -3);
    this.judy = this.driver(this.kart("judy", "JUDY", 0xd9c38a), -7, 3);
    this.dustMat = new THREE.SpriteMaterial({ map: puffTexture(), color: 0xcfc2a8, transparent: true, opacity: 0.6, depthWrite: false });
  }

  /** A strip along the lap between two lateral offsets, optionally only where `mask` says, with a colour per quad. */
  private ribbon(a: (i: number) => number, b: (i: number) => number, y: number, mask: ((i: number) => boolean) | null, color: ((i: number) => number) | null, uvAlong: number): THREE.BufferGeometry {
    const T = this.track;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < T.n; i++) {
      if (mask && !mask(i)) continue;
      const j = (i + 1) % T.n;
      const base = pos.length / 3;
      for (const [k, ai, bi] of [
        [i, a(i), b(i)],
        [j, a(j), b(j)],
      ] as const) {
        pos.push(T.px[k] + T.nx[k] * ai, y, T.pz[k] + T.nz[k] * ai, T.px[k] + T.nx[k] * bi, y, T.pz[k] + T.nz[k] * bi);
        nor.push(0, 1, 0, 0, 1, 0);
        const v = uvAlong ? k * T.ds * uvAlong : 0;
        uv.push(0, v, 1, v);
        if (color) {
          c.setHex(color(i));
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (color) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  /** A low wall standing along the lap at a lateral offset. */
  private wall(offset: number, h: number, color: (i: number) => number): THREE.BufferGeometry {
    const T = this.track;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < T.n; i++) {
      const j = (i + 1) % T.n;
      const base = pos.length / 3;
      c.setHex(color(i));
      for (const k of [i, j]) {
        const x = T.px[k] + T.nx[k] * offset;
        const z = T.pz[k] + T.nz[k] * offset;
        pos.push(x, 0, z, x, h, z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Where the start line is, and which way the straight runs. */
  private startArch() {
    const T = this.track;
    const a = T.at(0);
    const s = this.scene;
    const steel = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), steel);
      post.position.set(a.x + a.nx * side * (ROAD.bound - 2), 4.5, a.z + a.nz * side * (ROAD.bound - 2));
      s.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry((ROAD.bound - 2) * 2 + 1, 3.4, 1.2), steel);
    beam.position.set(a.x, 7.6, a.z);
    beam.rotation.y = headingOf(a.tx, a.tz);
    s.add(beam);
    const banner = (lines: string[], dir: 1 | -1, fg: string) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry((ROAD.bound - 2) * 2, 3), new THREE.MeshBasicMaterial({ map: textTexture(lines, 1800, 220, "#14101f", fg) }));
      m.position.set(a.x - a.tx * 0.62 * dir, 7.6, a.z - a.tz * 0.62 * dir);
      m.lookAt(a.x - a.tx * 50 * dir, 7.6, a.z - a.tz * 50 * dir);
      s.add(m);
    };
    banner(["ANYTHING IS POSSIBLE", this.opts.title.toUpperCase().slice(0, 44)], 1, "#ffd166");
    banner(["BFO", "GO SIGN"], -1, "#f4ede0");
    // Bulbs along the beam.
    const bulbs: THREE.BufferGeometry[] = [];
    for (let i = -10; i <= 10; i++) {
      const g = new THREE.SphereGeometry(0.22, 6, 5);
      g.translate(a.x + a.nx * i * 1.15, 9.45, a.z + a.nz * i * 1.15);
      bulbs.push(g);
    }
    s.add(new THREE.Mesh(mergeGeometries(bulbs, false), new THREE.MeshBasicMaterial({ color: 0xfff1c0 })));
  }

  /** The grandstand along the main straight, on the outside, with its crowd and floodlights. */
  private grandstand() {
    const s = this.scene;
    const z0 = ROAD.bound + 4;
    const tiers: THREE.BufferGeometry[] = [];
    const crowd: THREE.BufferGeometry[] = [];
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const palette = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x8ecae6, 0xffb703, 0xffffff, 0x9b5de5];
    for (let t = 0; t < 6; t++) {
      const g = new THREE.BoxGeometry(120, 1.2, 3);
      g.translate(0, 0.6 + t * 1.2, z0 + 1.5 + t * 3);
      tiers.push(colored(g, t % 2 ? 0x3c3c48 : 0x46465a));
      for (let k = 0; k < 44; k++) {
        if (rnd() < 0.25) continue;
        const p = new THREE.BoxGeometry(0.9, 1.4, 0.9);
        p.translate(-58 + k * 2.7 + rnd() * 0.8, 1.9 + t * 1.2, z0 + 1.5 + t * 3 + (rnd() - 0.5));
        crowd.push(colored(p, palette[Math.floor(rnd() * palette.length)]));
      }
    }
    const back = new THREE.BoxGeometry(122, 9, 1);
    back.translate(0, 4.5, z0 + 19.5);
    tiers.push(colored(back, 0x2a2a36));
    const roof = new THREE.BoxGeometry(124, 0.5, 20);
    roof.translate(0, 10.2, z0 + 10);
    tiers.push(colored(roof, 0x1d1d26));
    for (const x of [-60, -20, 20, 60]) {
      const post = new THREE.BoxGeometry(0.6, 10, 0.6);
      post.translate(x, 5, z0 + 19);
      tiers.push(colored(post, 0x2a2a36));
    }
    s.add(new THREE.Mesh(mergeGeometries(tiers, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
    s.add(new THREE.Mesh(mergeGeometries(crowd, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 4), new THREE.MeshBasicMaterial({ map: textTexture(["BURTON FAMILY OFFICE"], 1600, 160, "#0d1a33", "#ffffff") }));
    sign.position.set(0, 12.6, z0 + 10);
    sign.rotation.y = Math.PI;
    s.add(sign);
    // Floodlight masts at both ends of the stand.
    const masts: THREE.BufferGeometry[] = [];
    const heads: THREE.BufferGeometry[] = [];
    for (const x of [-70, 70]) {
      const m = new THREE.CylinderGeometry(0.4, 0.6, 26, 6);
      m.translate(x, 13, z0 + 14);
      masts.push(colored(m, 0x3a3a46));
      const h = new THREE.BoxGeometry(6, 2.2, 1);
      h.translate(x, 25.5, z0 + 13);
      heads.push(h);
    }
    s.add(new THREE.Mesh(mergeGeometries(masts, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
    s.add(new THREE.Mesh(mergeGeometries(heads, false), new THREE.MeshBasicMaterial({ color: 0xfff6dc })));
  }

  /** BFO boards on the outside of the corners, facing the road. */
  private boards() {
    const T = this.track;
    const planes: THREE.BufferGeometry[] = [];
    const posts: THREE.BufferGeometry[] = [];
    const o = new THREE.Object3D();
    let count = 0;
    for (let s = 60; s < T.length - 40; s += 92) {
      const a = T.at(s);
      const k = T.curv[a.i];
      // On the outside of a bend; on a straight, alternate sides.
      const side = Math.abs(k) > 1 / 120 ? (k > 0 ? -1 : 1) : count % 2 ? 1 : -1;
      const off = side * (ROAD.bound + 3.5);
      const x = a.x + a.nx * off;
      const z = a.z + a.nz * off;
      o.position.set(x, 1.6, z);
      o.lookAt(a.x, 1.6, a.z);
      o.updateMatrix();
      const g = new THREE.PlaneGeometry(9, 2.2);
      g.applyMatrix4(o.matrix);
      planes.push(g);
      for (const dx of [-3.6, 3.6]) {
        const p = new THREE.BoxGeometry(0.25, 2.8, 0.25);
        p.translate(dx, -0.4, -0.15);
        p.applyMatrix4(o.matrix);
        posts.push(colored(p, 0x2a2a33));
      }
      count++;
    }
    const tex = textTexture(["BFO"], 900, 220, "#0d1a33", "#ffffff");
    this.scene.add(new THREE.Mesh(mergeGeometries(planes, false), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
    this.scene.add(new THREE.Mesh(mergeGeometries(posts, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  /** Lamp posts along the barrier: a post and a warm head, every so often, alternating sides. */
  private lamps() {
    const T = this.track;
    const posts: THREE.BufferGeometry[] = [];
    const heads: THREE.BufferGeometry[] = [];
    let k = 0;
    for (let s = 20; s < T.length - 20; s += 48) {
      const a = T.at(s);
      const side = k++ % 2 ? 1 : -1;
      const off = side * (ROAD.bound + 1.2);
      const x = a.x + a.nx * off;
      const z = a.z + a.nz * off;
      const p = new THREE.CylinderGeometry(0.12, 0.18, 7, 6);
      p.translate(x, 3.5, z);
      posts.push(colored(p, 0x3a3a46));
      const h = new THREE.SphereGeometry(0.45, 8, 6);
      h.translate(x - a.nx * side * 0.8, 7.1, z - a.nz * side * 0.8);
      heads.push(h);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(posts, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
    this.scene.add(new THREE.Mesh(mergeGeometries(heads, false), new THREE.MeshBasicMaterial({ color: 0xffe3a8 })));
  }

  /** Low-poly trees scattered clear of the track, in one mesh. */
  private trees(rnd: () => number) {
    const T = this.track;
    const parts: THREE.BufferGeometry[] = [];
    const greens = [0x2f6b34, 0x3a7a3c, 0x27603a, 0x4a8a3a, 0x8a5a2a];
    let placed = 0;
    let tries = 0;
    while (placed < 170 && tries++ < 3000) {
      const x = -330 + rnd() * 640;
      const z = -260 + rnd() * 330;
      // Not on the road or its run-off, and not in the grandstand.
      let near = Infinity;
      for (let i = 0; i < T.n; i += 3) near = Math.min(near, Math.hypot(T.px[i] - x, T.pz[i] - z));
      if (near < ROAD.bound + 8) continue;
      if (z > 8 && Math.abs(x) < 80) continue;
      const h = 5 + rnd() * 7;
      const trunk = new THREE.CylinderGeometry(0.25, 0.4, h * 0.35, 5);
      trunk.translate(x, h * 0.17, z);
      parts.push(colored(trunk, 0x4a3220));
      const top = new THREE.ConeGeometry(1.8 + rnd() * 2, h * 0.75, 6);
      top.translate(x, h * 0.3 + h * 0.37, z);
      parts.push(colored(top, greens[Math.floor(rnd() * greens.length)]));
      placed++;
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(parts, false), new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  /** A kart with its driver: Sam in black, Judy in champagne gold with her bun and glasses. */
  private kart(who: "sam" | "judy", name: string, paint: number): KartModel {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const paintMat = new THREE.MeshPhongMaterial({ color: paint, shininess: 60, specular: 0x666666 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a1f });
    const chrome = new THREE.MeshPhongMaterial({ color: 0xbfbfc8, shininess: 90, specular: 0xffffff });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 2.1), paintMat);
    chassis.position.y = 0.32;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.7), paintMat);
    nose.position.set(0, 0.42, -1.2);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.4), paintMat);
    wing.position.set(0, 0.36, -1.45);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.3), dark);
    rear.position.set(0, 0.4, 1.15);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), chrome);
    engine.position.set(0.35, 0.55, 0.75);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.25), dark);
    seat.position.set(0, 0.75, 0.55);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 6, 14), dark);
    wheel.position.set(0, 0.8, -0.35);
    wheel.rotation.x = -0.5;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), chrome);
    pipe.position.set(0.55, 0.5, 1.0);
    pipe.rotation.x = Math.PI / 2;
    body.add(chassis, nose, wing, rear, engine, seat, wheel, pipe);
    // Name plates on both sides and a number on the nose.
    const plate = textTexture([name], 420, 128, who === "judy" ? "#f4ede0" : "#f4ede0", who === "judy" ? "#8c2a2f" : "#15151a");
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.3), new THREE.MeshBasicMaterial({ map: plate }));
      p.position.set(side * 0.61, 0.38, -0.1);
      p.rotation.y = (side * Math.PI) / 2;
      body.add(p);
    }
    const number = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: textTexture([who === "judy" ? "1" : "2"], 128, 128, "#f4ede0", "#15151a") }));
    number.position.set(0, 0.56, -1.2);
    number.rotation.x = -Math.PI / 2;
    body.add(number);
    // The driver.
    const skin = new THREE.MeshLambertMaterial({ color: who === "judy" ? 0xe8c4a8 : 0xd9a98a });
    const suit = new THREE.MeshLambertMaterial({ color: who === "judy" ? 0x9b7bb8 : 0x2b2b33 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), suit);
    torso.position.set(0, 0.95, 0.35);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
    head.position.set(0, 1.4, 0.35);
    body.add(torso, head);
    for (const ax of [-0.32, 0.32]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), suit);
      arm.position.set(ax, 0.95, 0.05);
      arm.rotation.x = 0.3;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), skin);
      hand.position.set(ax * 0.6, 0.86, -0.3);
      body.add(arm, hand);
    }
    if (who === "judy") {
      const hair = new THREE.MeshLambertMaterial({ color: 0xc9c4bd });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), hair);
      top.position.set(0, 1.62, 0.34);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), hair);
      bun.position.set(0, 1.64, 0.55);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.08), hair);
      back.position.set(0, 1.44, 0.54);
      body.add(top, bun, back);
      const gold = new THREE.MeshBasicMaterial({ color: 0xd4af37 });
      for (const ex of [-0.08, 0.08]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.5 }));
        lens.position.set(ex, 1.42, 0.17);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), gold);
        rim.position.set(ex, 1.47, 0.17);
        body.add(lens, rim);
      }
      const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.3), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
      scarf.position.set(0, 1.22, 0.36);
      body.add(scarf);
    } else {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), new THREE.MeshLambertMaterial({ color: 0x2a1c12 }));
      hair.position.set(0, 1.6, 0.35);
      const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
      helmet.position.set(0, 1.57, 0.35);
      body.add(hair, helmet);
    }
    for (const ex of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), dark);
      eye.position.set(ex, 1.42, 0.17);
      body.add(eye);
    }
    // Wheels: the front pair turn with the steering.
    const tyre = new THREE.MeshLambertMaterial({ color: 0x151518 });
    const hub = new THREE.MeshPhongMaterial({ color: who === "judy" ? 0xd4af37 : 0xc8c8d0, shininess: 80 });
    const wheels: THREE.Mesh[] = [];
    const fronts: THREE.Group[] = [];
    for (const [wx, wz, r] of [
      [-0.68, -0.72, 0.26],
      [0.68, -0.72, 0.26],
      [-0.72, 0.75, 0.3],
      [0.72, 0.75, 0.3],
    ] as const) {
      const g = new THREE.CylinderGeometry(r, r, 0.3, 12);
      g.rotateZ(Math.PI / 2);
      const w = new THREE.Mesh(g, tyre);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 8).rotateZ(Math.PI / 2), hub);
      w.add(cap);
      const pivot = new THREE.Group();
      pivot.position.set(wx, r, wz);
      pivot.add(w);
      group.add(pivot);
      wheels.push(w);
      if (wz < 0) fronts.push(pivot);
    }
    // The shadow under it, and the flame from the pipe on a boost.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 7), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85 }));
    flame.position.set(0.55, 0.5, 1.6);
    flame.rotation.x = -Math.PI / 2;
    flame.visible = false;
    group.add(flame);
    this.scene.add(group);
    return { group, wheels, fronts, body, shadow, flame };
  }

  private driver(model: KartModel, s: number, d: number): Driver {
    const T = this.track;
    const a = T.at(s);
    const heading = headingOf(a.tx, a.tz);
    const x = a.x + a.nx * d;
    const z = a.z + a.nz * d;
    const dr: Driver = { x, z, y: 0, vy: 0, heading, dir: heading, v: 0, s: s < 0 ? s + T.length : s, d, hint: a.i, lap: 0, half: false, grounded: true, model, steer: 0, wheelSpin: 0 };
    this.place(dr);
    return dr;
  }

  // ── Media ────────────────────────────────────────────────────────────────

  private media() {
    const { manifest } = this.opts;
    if (manifest.music) {
      const a = new Audio(manifest.music);
      a.loop = true;
      a.volume = 0;
      a.preload = "auto";
      this.music = a;
    }
    if (manifest.musicFinal) {
      const a = new Audio(manifest.musicFinal);
      a.loop = true;
      a.volume = 0;
      a.preload = "auto";
      this.musicFinal = a;
    }
  }

  private listen() {
    const on = (target: Document | HTMLElement | Window, type: string, fn: (e: any) => void) => {
      target.addEventListener(type, fn);
      this.disposers.push(() => target.removeEventListener(type, fn));
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && this.phase !== "intro") e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Escape" && this.inPlay()) {
        if (this.paused) this.resume();
        else this.pause();
      }
      if (e.code === "Space" && this.phase === "racing" && !this.paused && !this.auto) this.jump();
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());
    on(document, "visibilitychange", () => {
      if (document.hidden && this.inPlay() && !this.paused) this.pause();
    });
  }

  private inPlay() {
    return this.phase === "ready" || this.phase === "countdown" || this.phase === "racing";
  }

  /** The HUD's "Start signing": the grid, the controls, Judy's opening line, then the countdown. */
  begin() {
    if (this.phase !== "intro") return;
    this.sound = new RaceSound(this.opts.manifest.sounds);
    this.readyAt = performance.now();
    this.setPhase("ready");
    this.setHud({ prompt: "" });
    this.cue("start", "high");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.setHud({ paused: false });
    if (this.phase === "racing") {
      void this.music?.play().catch(() => {});
      void this.musicFinal?.play().catch(() => {});
    }
    void this.sound?.ctx.resume().catch(() => {});
    this.lineAudio?.play().catch(() => {});
  }

  private pause() {
    if (this.paused || !this.inPlay()) return;
    this.paused = true;
    this.setHud({ paused: true });
    this.music?.pause();
    this.musicFinal?.pause();
    this.sound?.quiet();
    this.lineAudio?.pause();
  }

  /** The result card's "Go sign": fade to black and hand over. */
  goSign() {
    if (this.phase !== "finished") return;
    this.setPhase("done");
    this.setHud({ dark: 1, prompt: "" });
    this.fadeMusic(0, 600);
    const t = setTimeout(() => this.opts.onDone(), 650);
    this.timers.push(t);
  }

  // ── Each frame ──────────────────────────────────────────────────────────

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.pace(now);
    if (!this.paused) this.step(dt);
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Every second the fps is read; a machine that can't hold 50 draws at a lower resolution, and one with headroom steps back up. */
  private pace(now: number) {
    this.frames++;
    if (now - this.fpsAt < 1000) return;
    const fps = this.frames / ((now - this.fpsAt) / 1000);
    this.frames = 0;
    this.fpsAt = now;
    let scale = this.scale;
    const warm = this.phase !== "intro" && now - this.readyAt > 3000;
    if (warm && fps < 48 && scale > 0.5) {
      scale = Math.max(0.5, scale - 0.15);
      this.goodReadings = 0;
    } else if (warm && fps >= 57 && scale < 1 && ++this.goodReadings >= 4) {
      scale = Math.min(1, scale + 0.1);
      this.goodReadings = 0;
    }
    if (scale !== this.scale) {
      this.scale = scale;
      this.renderer.setPixelRatio(this.base * scale);
      this.resize();
    }
    if (Math.round(fps) !== this.hud.fps) this.setHud({ fps: Math.round(fps) });
  }

  /** The race itself, `dt` seconds on: the flow, the karts, the laps, Judy's cues. Drawing is elsewhere so the browser checks can run it fast. */
  private step(dt: number) {
    this.clock += dt;
    if (this.phase === "ready") {
      // The controls, Judy's hello, and after four seconds the lights.
      if (this.clock >= 4) {
        this.setPhase("countdown");
        this.countdownClock = 0;
        this.countdownShown = -1;
      }
    } else if (this.phase === "countdown") {
      this.countdownClock += dt;
      const n = 3 - Math.floor(this.countdownClock);
      if (n !== this.countdownShown) {
        this.countdownShown = n;
        if (n > 0) {
          this.setHud({ countdown: n });
          this.sound?.play("kart-count");
        } else {
          this.go();
        }
      }
    } else if (this.phase === "racing" || this.phase === "finished") {
      if (this.phase === "racing") this.time += dt;
      if (this.phase === "racing" && this.goAt >= 0 && this.clock - this.goAt > 1.2 && this.hud.countdown !== null) this.setHud({ countdown: null });
      if (this.auto || this.phase === "finished") this.drivePlayerAuto(dt);
      else this.drivePlayer(dt);
      this.driveJudy(dt);
      this.collide(dt);
      this.laps(dt);
      this.cues(dt);
      const t = Math.round(this.time * 10) / 10;
      if (t !== this.hud.time) this.setHud({ time: t });
    }
    const frac = clamp(Math.abs(this.player.v) / KART.top, 0, 1.3);
    this.sound?.engine(this.phase === "racing" || this.phase === "finished" ? frac : 0, this.throttle() > 0 ? 1 : 0, dt);
  }

  private go() {
    this.goAt = this.clock;
    this.setPhase("racing");
    this.setHud({ countdown: 0 });
    this.sound?.play("kart-go");
    if (this.music) {
      this.music.volume = 0;
      void this.music.play().catch(() => {});
      this.fadeMusic(0.45, 1200);
    }
  }

  private throttle() {
    const k = this.keys;
    if (this.auto) return 1;
    if (k.has("KeyW") || k.has("ArrowUp")) return 1;
    if (k.has("KeyS") || k.has("ArrowDown")) return -1;
    return 0;
  }

  private steerInput() {
    const k = this.keys;
    let s = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) s += 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s -= 1;
    return s;
  }

  private jump() {
    const p = this.player;
    if (!p.grounded) return;
    p.vy = KART.jump;
    p.grounded = false;
    this.sound?.play("kart-jump");
    if (this.drifting) this.drifting = null;
    if (!this.jumped) {
      this.jumped = true;
      this.cue("first-jump", "high");
    }
  }

  /** The player's kart: arcade physics. */
  private drivePlayer(dt: number) {
    const p = this.player;
    const T = this.track;
    const now = this.clock;
    const throttle = this.throttle();
    const steer = this.steerInput();
    p.steer += (steer - p.steer) * Math.min(1, dt * 9);
    const fr = T.frame(p.x, p.z, p.hint);
    p.hint = fr.i;
    const onGrass = Math.abs(fr.d) > ROAD.half + ROAD.curb;
    const boosting = now < this.boostUntil;
    const top = KART.top * (onGrass ? KART.grassTop : 1) * (boosting ? 1.22 : 1);

    // Speed.
    if (throttle > 0) {
      if (p.v < top) p.v = Math.min(top, p.v + KART.accel * dt * (p.v < 0 ? 2 : 1));
      else p.v -= (p.v - top) * Math.min(1, dt * 2.5);
    } else if (throttle < 0) {
      if (p.v > 0.3) p.v = Math.max(0, p.v - KART.brake * dt);
      else p.v = Math.max(-KART.reverseTop, p.v - 7 * dt);
    } else {
      const drag = 2.5 + Math.abs(p.v) * 0.12;
      p.v -= Math.sign(p.v) * Math.min(Math.abs(p.v), drag * dt);
    }
    if (onGrass) p.v -= p.v * 0.9 * dt;

    // Drifting: Shift with some speed and a steer; let go after a second for a boost.
    const shift = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    if (!this.drifting && shift && p.grounded && p.v > 10 && steer !== 0) this.drifting = { dir: steer, since: now };
    if (this.drifting && (!shift || p.v < 6 || !p.grounded)) {
      if (now - this.drifting.since >= 1 && p.grounded && shift === false) {
        this.boostUntil = now + 1.3;
        p.v = Math.min(KART.top * 1.22, p.v + 5);
        this.sound?.play("kart-boost");
      }
      this.drifting = null;
    }
    this.sound?.skid(!!this.drifting && p.grounded);

    // Heading: tighter at low speed, looser with pace; a drift turns harder and lets the tail out.
    const rate = p.v / (KART.r0 + KART.k * Math.abs(p.v));
    let yaw: number;
    if (this.drifting) yaw = this.drifting.dir * Math.abs(rate) * (0.85 + 0.75 * clamp(p.steer * this.drifting.dir, -0.6, 1));
    else yaw = p.steer * rate;
    p.heading += yaw * dt;
    const grip = this.drifting ? KART.driftGrip : onGrass ? KART.grassGrip : KART.grip;
    p.dir += wrapAngle(p.heading - p.dir) * Math.min(1, grip * dt);
    const f = forward(p.dir);
    p.x += f.x * p.v * dt;
    p.z += f.z * p.v * dt;

    // The air.
    if (!p.grounded) {
      p.vy -= KART.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
        this.sound?.play("kart-land");
        this.puff(p, 6);
      }
    }

    // The barrier pushes a kart that reaches it back toward the road.
    const fr2 = T.frame(p.x, p.z, p.hint);
    p.hint = fr2.i;
    p.s = fr2.s;
    p.d = fr2.d;
    if (Math.abs(fr2.d) > ROAD.bound - 1) {
      const side = Math.sign(fr2.d);
      const a = T.at(fr2.s);
      p.x = a.x + a.nx * side * (ROAD.bound - 1);
      p.z = a.z + a.nz * side * (ROAD.bound - 1);
      p.d = side * (ROAD.bound - 1);
      const along = headingOf(a.tx, a.tz);
      // Travel carries on along the wall; the nose is turned back toward the road.
      p.dir = along + (p.v >= 0 ? 0 : Math.PI);
      p.heading += wrapAngle(along - p.heading) * 0.5;
      if (now - this.lastWall > 0.4) {
        p.v *= 0.6;
        this.sound?.play("kart-bump");
        this.lastWall = now;
      }
    }

    // Speed bumps: slow and jolt a kart that drives over one; a jump clears it.
    if (p.grounded)
      for (const [bi, b] of BUMPS.entries()) {
        const bs = b.at * T.length;
        let ds = p.s - bs;
        if (ds > T.length / 2) ds -= T.length;
        if (ds < -T.length / 2) ds += T.length;
        if (Math.abs(ds) < 1.2 && Math.abs(p.d - b.d) < 3.3 && this.lastBumpAt !== bi) {
          this.lastBumpAt = bi;
          if (Math.abs(p.v) > 4) {
            p.v *= 0.55;
            p.vy = 2.6;
            p.grounded = false;
            this.sound?.play("kart-bump", 0.5);
          }
        } else if (Math.abs(ds) > 4 && this.lastBumpAt === bi) this.lastBumpAt = -1;
      }

    // Hints: off the road, or going the wrong way.
    if (onGrass && Math.abs(p.v) > 3) {
      if (this.onGrassSince < 0) this.onGrassSince = now;
      if (Math.abs(p.v) > 6 && p.grounded) this.puff(p, 1);
    } else this.onGrassSince = -1;
    const a = T.at(p.s);
    const wrong = p.v > 3 && f.x * a.tx + f.z * a.tz < -0.3;
    if (wrong) {
      if (this.wrongWaySince < 0) this.wrongWaySince = now;
    } else this.wrongWaySince = -1;
    let prompt = "";
    if (this.wrongWaySince >= 0 && now - this.wrongWaySince > 1.5) prompt = "Wrong way! Turn around.";
    else if (this.onGrassSince >= 0 && now - this.onGrassSince > 1.5) prompt = "Back on the track: the grass is slow.";
    else if (this.time < 8 && p.v < 2) prompt = "Hold W to go.";
    if (prompt !== this.hud.prompt) this.setHud({ prompt });

    if (this.drifting && p.grounded && Math.abs(p.v) > 6) this.puff(p, 1);
    p.wheelSpin += (p.v / 0.28) * dt;
    this.place(p);
  }

  /** The player's kart on its own: after the finish it coasts along the line; in development ?auto=1 races it. */
  private drivePlayerAuto(dt: number) {
    const p = this.player;
    if (this.phase === "finished") {
      p.v = Math.max(0, p.v - 9 * dt);
      const f = forward(p.heading);
      p.x += f.x * p.v * dt;
      p.z += f.z * p.v * dt;
      p.dir = p.heading;
      const fr = this.track.frame(p.x, p.z, p.hint);
      p.hint = fr.i;
      p.s = fr.s;
      p.d = fr.d;
    } else {
      this.followLine(p, dt, 1.0, -2.2, this.judyOffsetPhase + 2);
      // Judy's and the auto kart's progress never wrap; the player's does.
      p.s = ((p.s % this.track.length) + this.track.length) % this.track.length;
      p.d = -2.2;
    }
    this.sound?.skid(false);
    p.wheelSpin += (p.v / 0.28) * dt;
    this.place(p);
  }

  /** Judy follows the line, braking for the bends on grip alone, with a rubber band so the race stays close. */
  private driveJudy(dt: number) {
    const j = this.judy;
    const T = this.track;
    const gap = this.playerProgress() - j.s;
    let scale = clamp(1 + (gap / 45) * JUDY.band, 1 - JUDY.band, 1 + JUDY.band);
    if (this.judyDone) scale = 0.6;
    this.followLine(j, dt, scale, 0, this.judyOffsetPhase);
    if (!this.judyDone && j.s >= LAPS * T.length) {
      this.judyDone = true;
      if (this.phase === "racing") this.setHud({ prompt: "Judy's across the line. Finish your laps." });
    }
    // She hops the bumps too.
    if (j.grounded)
      for (const b of BUMPS) {
        const bs = b.at * T.length;
        const ds = (((j.s - bs) % T.length) + T.length) % T.length;
        const lateral = Math.abs(j.d - b.d) < 3.3;
        if (lateral && ds > T.length - 4 && ds < T.length - 2) {
          j.vy = JUDY.hop;
          j.grounded = false;
        }
      }
    if (!j.grounded) {
      j.vy -= KART.gravity * dt;
      j.y += j.vy * dt;
      if (j.y <= 0) {
        j.y = 0;
        j.vy = 0;
        j.grounded = true;
      }
    }
    j.wheelSpin += (j.v / 0.3) * dt;
    this.place(j);
  }

  /** Drives a kart along the spline: speed from the curvature ahead, a lateral offset that wanders, the heading from the tangent. */
  private followLine(k: Driver, dt: number, scale: number, offsetBase: number, phase: number) {
    const T = this.track;
    const look = 10 + k.v * 0.9;
    let kmax = 0;
    const i0 = Math.floor((k.s + look) / T.ds);
    for (let n = 0; n < 26; n++) kmax = Math.max(kmax, Math.abs(T.curv[(((i0 + n) % T.n) + T.n) % T.n]));
    const target = Math.min(JUDY.top * scale, Math.sqrt(JUDY.lat / Math.max(kmax, 1e-4)));
    if (k.v < target) k.v = Math.min(target, k.v + JUDY.accel * dt);
    else k.v = Math.max(target, k.v - JUDY.brake * dt);
    k.s += k.v * dt;
    const want = clamp(offsetBase + 2.4 * Math.sin(k.s / 61 + phase), -(ROAD.half - 1.5), ROAD.half - 1.5);
    k.d += (want - k.d) * Math.min(1, dt * 1.5);
    const a = T.at(k.s);
    k.x = a.x + a.nx * k.d;
    k.z = a.z + a.nz * k.d;
    const h = headingOf(a.tx, a.tz);
    k.heading += wrapAngle(h - k.heading) * Math.min(1, dt * 6);
    k.dir = k.heading;
    k.hint = a.i;
    k.steer = clamp(T.curv[a.i] * 40, -1, 1);
  }

  /** The karts bump: the player is shoved off, both lose a little, Judy objects. */
  private collide(dt: number) {
    const p = this.player;
    const j = this.judy;
    const dx = p.x - j.x;
    const dz = p.z - j.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.1 || Math.abs(p.y - j.y) > 0.8) return;
    const push = 2.1 - dist + 0.05;
    const ux = dist > 0.01 ? dx / dist : 1;
    const uz = dist > 0.01 ? dz / dist : 0;
    p.x += ux * push;
    p.z += uz * push;
    p.v *= 1 - 0.6 * dt * 10;
    j.v *= 0.97;
    // Nudge Judy's line away.
    const T = this.track;
    const a = T.at(j.s);
    const side = (p.x - j.x) * a.nx + (p.z - j.z) * a.nz;
    j.d = clamp(j.d - Math.sign(side) * 1.5 * dt * 10, -(ROAD.half - 1), ROAD.half - 1);
    if (this.clock - this.lastJudyBump > 1.5) {
      this.lastJudyBump = this.clock;
      this.sound?.play("kart-bump");
      if (this.phase === "racing") this.cue("bump", "low");
    }
  }

  /** How far the player has come in metres; on the grid, just short of the line, it is a little under zero. */
  private playerProgress() {
    const p = this.player;
    const L = this.track.length;
    return p.lap * L + p.s - (!p.half && p.s > L * 0.5 ? L : 0);
  }

  /** Laps and the finish: the line counts once a kart has been round the far side. */
  private laps(dt: number) {
    const p = this.player;
    const T = this.track;
    const L = T.length;
    if (!p.half && p.s > L * 0.5 && p.s < L * 0.9) p.half = true;
    const prev = this.prevS;
    if (prev >= 0) {
      if (prev > L * 0.9 && p.s < L * 0.1) {
        // Over the line, forward.
        if (p.half) {
          p.half = false;
          p.lap++;
          if (p.lap >= LAPS) this.finish();
          else {
            this.sound?.play("kart-lap");
            this.setHud({ lap: p.lap + 1 });
            this.cue(p.lap === 1 ? "lap2-start" : "lap3-start", "high");
            if (p.lap === LAPS - 1) this.lastLapMusic();
          }
        }
      } else if (prev < L * 0.1 && p.s > L * 0.9 && p.lap > 0) {
        // Backed over it.
        p.lap--;
        p.half = true;
        this.setHud({ lap: p.lap + 1 });
      }
    }
    this.prevS = p.s;
    if (this.phase === "racing") {
      const pos: 1 | 2 = this.playerProgress() + 1.5 >= this.judy.s ? 1 : 2;
      if (pos !== this.hud.position) this.setHud({ position: pos });
    }
  }
  private prevS = -1;

  private finish() {
    if (this.phase !== "racing") return;
    this.finishedAt = this.clock;
    this.won = !this.judyDone;
    this.setPhase("finished");
    this.keys.clear();
    this.drifting = null;
    this.sound?.skid(false);
    this.sound?.play("kart-finish");
    const time = Math.round(this.time * 10) / 10;
    this.setHud({ result: { won: this.won, time }, prompt: "", lap: LAPS, position: this.won ? 1 : 2 });
    this.queue.length = 0;
    this.cue(this.won ? "player-wins" : "judy-wins", "high");
    // The song goes down over the result card.
    const t = setTimeout(() => this.fadeMusic(0, 4000), 1500);
    this.timers.push(t);
  }

  /** Judy's cues as the race runs: the clock, the halfway marks, who is in front. */
  private cues(dt: number) {
    if (this.phase !== "racing") return;
    const p = this.player;
    const L = this.track.length;
    if (this.time > 12) this.cue("lap1-early", "high");
    if (p.s > L * 0.5 && p.s < L * 0.9) {
      if (p.lap === 0) this.cue("lap1-mid", "high");
      if (p.lap === 1) this.cue("lap2-mid", "high");
      if (p.lap === 2) this.cue("lap3-mid", "high");
    }
    const diff = this.playerProgress() - this.judy.s;
    if (this.time > 4) {
      if (this.playerAhead && diff < -2.5) {
        this.playerAhead = false;
        this.cue("judy-passes", "high");
      } else if (!this.playerAhead && diff > 2.5) {
        this.playerAhead = true;
        if (this.time > 6) this.cue("player-passes", "high");
      }
    }
    if (diff > 28 && this.time > 20) {
      if (this.aheadSince < 0) this.aheadSince = this.clock;
      else if (this.clock - this.aheadSince > 3) this.cue("player-ahead", "low");
    } else this.aheadSince = -1;
  }

  // ── Judy's lines ────────────────────────────────────────────────────────

  /** Plays the line for a cue once: queued behind the one playing, or dropped if it matters less. */
  private cue(name: KartCue, priority: "high" | "low") {
    const line = this.opts.judy?.lines.find((l) => l.cue === name);
    if (!line || this.said.has(line.id)) return;
    if (this.speaking || this.queue.length) {
      if (priority === "low") return;
      if (!this.queue.includes(line)) this.queue.push(line);
      return;
    }
    this.say(line);
  }

  private say(line: KartLine) {
    this.said.add(line.id);
    this.speaking = line;
    const speaker = this.opts.judy?.name ?? "Judy";
    const chunks = subtitleChunks(line.text);
    const words = chunks.map((c) => c.split(/\s+/).length);
    const total = words.reduce((a, b) => a + b, 0);
    const later = (fn: () => void, ms: number) => this.lineTimers.push(setTimeout(fn, ms));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of this.lineTimers) clearTimeout(t);
      this.lineTimers = [];
      this.lineAudio = null;
      this.speaking = null;
      this.setHud({ dialogue: null });
      const next = this.queue.shift();
      if (next && this.phase !== "done") later(() => this.say(next), 400);
    };
    const schedule = (seconds: number) => {
      let at = 0;
      chunks.forEach((text, i) => {
        later(() => this.setHud({ dialogue: { speaker, text } }), at * 1000);
        at += (seconds * words[i]) / total;
      });
      later(finish, seconds * 1000 + 350);
    };
    const url = this.opts.manifest.voice[line.id];
    if (!url) return schedule(total * 0.42 + 0.4);
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.src = url;
    a.preload = "auto";
    a.volume = 0.95;
    this.lineAudio = a;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const seconds = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total * 0.42 + 0.4;
      schedule(seconds);
    };
    a.addEventListener("loadedmetadata", () => {
      this.overRadio(a);
      a.play().then(start, () => start());
    });
    a.addEventListener("error", () => start());
    // A clip that never loads shouldn't hold the line.
    later(start, 4000);
    a.load();
  }

  /** Judy's voice as a pit radio would carry it: the lows and highs gone, a push in the middle, a touch of drive. */
  private overRadio(a: HTMLAudioElement) {
    try {
      if (!this.radio) {
        const ctx = new AudioContext();
        this.radio = ctx;
        this.disposers.push(() => void ctx.close().catch(() => {}));
      }
      const ctx = this.radio;
      const src = ctx.createMediaElementSource(a);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 320;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 4200;
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1800;
      mid.Q.value = 1.2;
      mid.gain.value = 4;
      const drive = ctx.createWaveShaper();
      drive.curve = softClip(1.5);
      const out = ctx.createGain();
      out.gain.value = 1.1;
      src.connect(hp).connect(lp).connect(mid).connect(drive).connect(out).connect(ctx.destination);
      void ctx.resume().catch(() => {});
    } catch {
      /* the line plays as it is */
    }
  }

  // ── Music ───────────────────────────────────────────────────────────────

  private fadeMusic(to: number, ms: number, which: HTMLAudioElement | null = this.music) {
    const a = which;
    if (!a) return;
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = from + (to - from) * k;
      if (k < 1) this.musicFade = requestAnimationFrame(step);
      else {
        this.musicFade = null;
        if (to === 0) a.pause();
      }
    };
    if (this.musicFade !== null) cancelAnimationFrame(this.musicFade);
    this.musicFade = requestAnimationFrame(step);
  }

  /** The last lap: the final track takes over, or the same song jumps to its drop and comes up. */
  private lastLapMusic() {
    if (this.lastLap) return;
    this.lastLap = true;
    if (this.musicFinal) {
      const f = this.musicFinal;
      f.volume = 0;
      void f.play().catch(() => {});
      const m = this.music;
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 2000);
        f.volume = 0.62 * k;
        if (m) m.volume = 0.45 * (1 - k);
        if (k < 1) this.musicFade = requestAnimationFrame(step);
        else {
          this.musicFade = null;
          m?.pause();
        }
      };
      if (this.musicFade !== null) cancelAnimationFrame(this.musicFade);
      this.musicFade = requestAnimationFrame(step);
    } else if (this.music) {
      try {
        this.music.currentTime = 43;
      } catch {
        /* not seekable: it plays on */
      }
      this.fadeMusic(0.65, 2000);
    }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** Puts a kart's model where the driver is, leaning into the slide. */
  private place(k: Driver) {
    const g = k.model.group;
    g.position.set(k.x, k.y, k.z);
    g.rotation.y = k.heading;
    const slip = wrapAngle(k.heading - k.dir);
    k.model.body.rotation.z = clamp(-slip * 0.6 - k.steer * Math.abs(k.v) * 0.004, -0.22, 0.22);
    k.model.body.rotation.x = k.grounded ? 0 : clamp(-k.vy * 0.04, -0.3, 0.3);
    for (const w of k.model.wheels) w.rotation.x = k.wheelSpin;
    for (const f of k.model.fronts) f.rotation.y = k.steer * 0.45;
    k.model.shadow.position.y = -k.y + 0.02;
    const sh = 1 / (1 + k.y * 0.6);
    k.model.shadow.scale.set(sh, sh, 1);
    (k.model.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * sh;
  }

  private puff(k: Driver, count: number) {
    for (let n = 0; n < count; n++) {
      if (this.dust.length >= 60) {
        const old = this.dust.shift()!;
        this.scene.remove(old.sprite);
      }
      const sprite = new THREE.Sprite(this.dustMat);
      const f = forward(k.heading);
      const side = n % 2 ? 0.7 : -0.7;
      sprite.position.set(k.x - f.x * 0.9 + f.z * side, 0.25, k.z - f.z * 0.9 - f.x * side);
      sprite.scale.setScalar(0.5);
      this.scene.add(sprite);
      this.dust.push({ sprite, vx: -f.x * 3 + (Math.random() - 0.5) * 2, vz: -f.z * 3 + (Math.random() - 0.5) * 2, life: 0.7 });
    }
  }

  private animate(dt: number) {
    const p = this.player;
    // The chase camera.
    this.placeCamera(false, dt);
    // Boost: the pipe flames and the view widens.
    const boosting = this.clock < this.boostUntil && this.phase === "racing";
    p.model.flame.visible = boosting;
    if (boosting) p.model.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    const wantFov = 68 + (boosting ? 10 : 0) + clamp(p.v / KART.top, 0, 1) * 5;
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // Dust.
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      d.sprite.position.x += d.vx * dt;
      d.sprite.position.z += d.vz * dt;
      d.sprite.position.y += 0.6 * dt;
      d.sprite.scale.setScalar(0.5 + (0.7 - d.life) * 2.2);
      if (d.life <= 0) {
        this.scene.remove(d.sprite);
        this.dust.splice(i, 1);
      }
    }
    if (this.phase === "done" && this.hud.dark < 1) this.setHud({ dark: 1 });
  }

  /** Behind and above the player's kart, the heading following with a lag; on the grid, a slow swing round from the front. */
  private placeCamera(snap: boolean, dt = 0) {
    const p = this.player;
    if (this.phase === "intro" || this.phase === "ready") {
      // From a three-quarter front view round to the chase position, over the ready seconds.
      const k = this.phase === "intro" ? 0 : clamp(this.clock / 4, 0, 1);
      const e = k * k * (3 - 2 * k);
      const ang = p.heading + Math.PI * 0.75 * (1 - e);
      const f = forward(ang);
      const dist = 5 + 2.5 * e;
      this.camPos.set(p.x - f.x * dist, 2.2 + 1.2 * e, p.z - f.z * dist);
      this.camLook.set(p.x + forward(p.heading).x * 2, 0.9, p.z + forward(p.heading).z * 2);
      this.camYaw = p.heading;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }
    this.camYaw += wrapAngle(p.heading - this.camYaw) * (snap ? 1 : Math.min(1, dt * 4.5));
    const f = forward(this.camYaw);
    const speed = clamp(Math.abs(p.v) / KART.top, 0, 1.2);
    const dist = 7 + speed * 1.5;
    const want = new THREE.Vector3(p.x - f.x * dist, 3.4 + p.y * 0.5, p.z - f.z * dist);
    if (snap) this.camPos.copy(want);
    else this.camPos.lerp(want, Math.min(1, dt * 7));
    const ff = forward(p.heading);
    const look = new THREE.Vector3(p.x + ff.x * 4, 1.1 + p.y * 0.5, p.z + ff.z * 4);
    if (snap) this.camLook.copy(look);
    else this.camLook.lerp(look, Math.min(1, dt * 8));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private setPhase(phase: KartPhase) {
    this.phase = phase;
    this.setHud({ phase });
  }

  private setHud(patch: Partial<KartHud>) {
    this.hud = { ...this.hud, ...patch };
    this.emit();
  }

  private emit() {
    this.opts.onHud(this.hud);
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const t of this.lineTimers) clearTimeout(t);
    for (const t of this.timers) clearTimeout(t);
    if (this.musicFade !== null) cancelAnimationFrame(this.musicFade);
    this.lineAudio?.pause();
    this.music?.pause();
    this.musicFinal?.pause();
    this.sound?.dispose();
    for (const d of this.disposers) d();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (import.meta.env.DEV) delete (window as unknown as { __kartRace?: KartRace }).__kartRace;
  }
}

// ── Sound ──────────────────────────────────────────────────────────────────

/**
 * The race's sounds. Each has a synthesized version, so the game is whole
 * without files; a file named in the manifest plays instead. The engine is
 * a loop whose pitch and volume follow the speed (through four "gears").
 */
class RaceSound {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly engineGain: GainNode;
  private synth: { osc: OscillatorNode[]; lp: BiquadFilterNode; sub: GainNode } | null = null;
  private loop: { src: AudioBufferSourceNode } | null = null;
  private readonly skidGain: GainNode;
  private readonly noise: AudioBuffer;
  private readonly files: Partial<Record<string, HTMLAudioElement>> = {};
  private engineLevel = 0;

  constructor(sounds: KartManifest["sounds"]) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const [key, url] of Object.entries(sounds)) {
      if (!url || key === "kart-engine") continue;
      const a = new Audio(url);
      a.preload = "auto";
      this.files[key] = a;
    }
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.startSynthEngine();
    if (sounds["kart-engine"]) void this.loadEngine(sounds["kart-engine"]);
    // The skid: noise through a band, up only while sliding.
    const skid = this.ctx.createBufferSource();
    skid.buffer = this.noise;
    skid.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(bp).connect(this.skidGain).connect(this.master);
    skid.start();
    void this.ctx.resume().catch(() => {});
  }

  private startSynthEngine() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    lp.Q.value = 1.4;
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    const tri = ctx.createOscillator();
    tri.type = "triangle";
    tri.detune.value = 9;
    const subOsc = ctx.createOscillator();
    subOsc.type = "square";
    const sub = ctx.createGain();
    sub.gain.value = 0.35;
    saw.connect(lp);
    tri.connect(lp);
    subOsc.connect(sub).connect(lp);
    lp.connect(this.engineGain);
    saw.start();
    tri.start();
    subOsc.start();
    this.synth = { osc: [saw, tri, subOsc], lp, sub };
  }

  private async loadEngine(url: string) {
    try {
      const res = await fetch(url);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.engineGain);
      src.start();
      this.loop = { src };
      if (this.synth) {
        for (const o of this.synth.osc) o.stop();
        this.synth.lp.disconnect();
        this.synth = null;
      }
    } catch {
      /* the synthesized engine stays */
    }
  }

  /** The engine at a fraction of top speed (0 for silence), with the throttle open or not. */
  engine(frac: number, throttle: number, dt: number) {
    const t = this.ctx.currentTime;
    const want = frac > 0 ? 0.07 + 0.08 * Math.min(1, frac) + 0.03 * throttle : 0;
    this.engineLevel += (want - this.engineLevel) * Math.min(1, dt * 6);
    this.engineGain.gain.setTargetAtTime(this.engineLevel, t, 0.05);
    if (this.loop) {
      this.loop.src.playbackRate.setTargetAtTime(0.55 + 1.35 * frac, t, 0.08);
      return;
    }
    if (!this.synth) return;
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(frac * gears));
    const within = clamp(frac * gears - g, 0, 1);
    const f = 58 + 150 * within + 18 * g;
    const [saw, tri, sub] = this.synth.osc;
    saw.frequency.setTargetAtTime(f, t, 0.06);
    tri.frequency.setTargetAtTime(f * 1.005, t, 0.06);
    sub.frequency.setTargetAtTime(f / 2, t, 0.06);
    this.synth.lp.frequency.setTargetAtTime(450 + 1500 * frac, t, 0.1);
  }

  skid(on: boolean) {
    this.skidGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.08);
  }

  /** Paused: everything continuous goes quiet. */
  quiet() {
    this.engineLevel = 0;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.skid(false);
  }

  play(key: KartSoundKey, volume = 0.8) {
    const file = this.files[key];
    if (file) {
      try {
        file.volume = volume;
        file.currentTime = 0;
        void file.play().catch(() => {});
      } catch {
        /* no sound */
      }
      return;
    }
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + at);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      o.connect(g).connect(this.master);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    const burst = (at: number, dur: number, lp: number, vol: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      s.connect(f).connect(g).connect(this.master);
      s.start(t + at);
      s.stop(t + at + dur + 0.05);
    };
    switch (key) {
      case "kart-count":
        tone("square", 660, 660, 0, 0.16, 0.18);
        break;
      case "kart-go":
        tone("square", 990, 990, 0, 0.55, 0.2);
        tone("square", 1320, 1320, 0, 0.55, 0.1);
        break;
      case "kart-jump":
        tone("sine", 260, 980, 0, 0.32, 0.3);
        tone("triangle", 520, 1960, 0, 0.3, 0.12);
        break;
      case "kart-land":
        tone("sine", 95, 40, 0, 0.2, 0.5);
        burst(0, 0.08, 900, 0.3);
        break;
      case "kart-lap":
        tone("sine", 880, 880, 0, 0.4, 0.22);
        tone("sine", 1760, 1760, 0, 0.3, 0.06);
        tone("sine", 1318, 1318, 0.18, 0.55, 0.22);
        tone("sine", 2636, 2636, 0.18, 0.35, 0.05);
        break;
      case "kart-finish":
        [523, 659, 784, 1046, 1318].forEach((f, i) => tone("triangle", f, f, i * 0.11, 0.6, 0.2));
        [523, 659, 784].forEach((f) => tone("triangle", f, f, 0.7, 1.4, 0.14));
        tone("sawtooth", 1046, 1046, 0.7, 1.4, 0.05);
        break;
      case "kart-bump":
        burst(0, 0.12, 700, 0.4 * volume);
        tone("sine", 130, 50, 0, 0.16, 0.4 * volume);
        break;
      case "kart-boost":
        tone("sawtooth", 180, 760, 0, 0.5, 0.12);
        burst(0, 0.5, 2500, 0.1);
        break;
      case "kart-drift":
        burst(0, 0.3, 1800, 0.15);
        break;
      case "kart-engine":
        break;
    }
  }

  dispose() {
    try {
      this.synth?.osc.forEach((o) => o.stop());
      this.loop?.src.stop();
    } catch {
      /* already stopped */
    }
    void this.ctx.close().catch(() => {});
  }
}

// ── Subtitles ─────────────────────────────────────────────────────────────

/** A line split at sentence ends into pieces of a dozen or so words, as subtitles go. */
export function subtitleChunks(text: string): string[] {
  const sentences = text
    .match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)
    ?.map((x) => x.trim())
    .filter(Boolean) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const sentence of sentences) {
    const joined = cur ? `${cur} ${sentence}` : sentence;
    if (cur && joined.split(/\s+/).length > 14) {
      out.push(cur);
      cur = sentence;
    } else cur = joined;
    while (cur.split(/\s+/).length > 22) {
      const words = cur.split(/\s+/);
      let cut = -1;
      for (let i = 8; i < Math.min(words.length - 4, 16); i++) if (/[,;:]$/.test(words[i])) cut = i;
      if (cut < 0) cut = 13;
      out.push(words.slice(0, cut + 1).join(" "));
      cur = words.slice(cut + 1).join(" ");
    }
  }
  if (cur) out.push(cur);
  return out;
}

function softClip(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  const top = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / top;
  }
  return c;
}

// ── Geometry and textures ─────────────────────────────────────────────────

/** Gives a geometry one flat colour as a vertex attribute, so many pieces can share a material in one mesh. */
function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** A tile of speckled colour, repeated. */
function noiseTexture(base: number, variance: number): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const r0 = (base >> 16) & 255;
  const g0 = (base >> 8) & 255;
  const b0 = base & 255;
  const img = ctx.createImageData(128, 128);
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 2 * variance;
    img.data[i] = clamp(r0 + v, 0, 255);
    img.data[i + 1] = clamp(g0 + v, 0, 255);
    img.data[i + 2] = clamp(b0 + v, 0, 255);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function checkerTexture(): THREE.Texture {
  const [c, ctx] = canvas(256, 64);
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? "#111114" : "#f4f1e6";
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture(): THREE.Texture {
  const [c, ctx] = canvas(256, 32);
  for (let x = 0; x < 8; x++) {
    ctx.fillStyle = x % 2 ? "#15151a" : "#ffd23a";
    ctx.fillRect(x * 32, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dusk: indigo overhead down to a warm band at the horizon. */
function skyTexture(): THREE.Texture {
  const [c, ctx] = canvas(4, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#0d0a24");
  g.addColorStop(0.3, "#2a1f5e");
  g.addColorStop(0.46, "#7a3f78");
  g.addColorStop(0.5, "#ff9a5c");
  g.addColorStop(0.53, "#f6c27a");
  g.addColorStop(0.6, "#2b2142");
  g.addColorStop(1, "#1a1434");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  g.addColorStop(0, "rgba(0,0,0,0.9)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function puffTexture(): THREE.Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function textTexture(lines: string[], w: number, h: number, bg: string, fg: string): THREE.Texture {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const px = Math.min(h / (lines.length + 0.6), w / 9);
  ctx.font = `700 ${px}px "Playfair Display", Georgia, serif`;
  const gap = px * 1.2;
  const top = h / 2 - ((lines.length - 1) * gap) / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * gap, w - 24));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
