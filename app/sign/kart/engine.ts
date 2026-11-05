// The racetrack signing game (three.js). Sam races Judy, the ticket-booth
// lady from the theater (app/sign/game), two laps of a floodlit kart track at
// dusk: a long straight past the grandstand and the start arch, a hairpin at
// each end, a chicane and a sweeping back section, with BFO boards on the
// corners. The track is built here from boxes, cones and ribbons along a
// Catmull-Rom loop; Judy herself is the theater's Meshy model (manifest
// models.judy) seated in a cowl of her kart, with a box figure while it loads
// or if it can't. She is a menace, not a racer: she keeps up with Sam whatever
// he does and rams him from behind and from the side all race, talking smack
// (cues in public/kart/judy.json). In the last stretch of lap two her next hit
// flips her own kart: a slow-motion cinematic, she lands on the grass and her
// arm comes off; Sam gets out (first person), finds the arm by its sparkle,
// carries it back and tapes it on; she climbs back in and drives over the line
// to win, and the race fades into the signing page. The sounds are
// synthesized with Web Audio unless the manifest names a file for them.
// index.tsx wraps this in React and draws the HUD from `onHud`.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type KartSoundKey =
  "kart-engine" | "kart-drift" | "kart-jump" | "kart-land" | "kart-lap" | "kart-finish" | "kart-bump" | "kart-count" | "kart-go" | "kart-boost" | "kart-crash" | "kart-pop" | "kart-tape";

export type KartManifest = {
  /** The track for laps one and two (loops). */
  music: string | null;
  /** The track for the last lap; without one the same song jumps to its drop. */
  musicFinal: string | null;
  sounds: Partial<Record<KartSoundKey, string | null>>;
  /** Judy's voiced lines by id (public/kart/judy.json, ids begin "k-"). */
  voice: Partial<Record<string, string>>;
  /** Models from the game studio: Judy is the theater's Meshy model (a GLB, facing +z). */
  models?: { judy?: string | null };
};

export type KartCue =
  | "start"
  | "lap1-early"
  | "lap1-mid"
  | "lap1-late"
  | "judy-passes"
  | "player-ahead"
  | "player-passes"
  | "last-lap"
  | "last-lap-mid"
  | "bump"
  | "first-jump"
  | "flip"
  | "arm-off"
  | "arm-wait"
  | "arm-found"
  | "taped"
  | "laugh"
  | "judy-wins";

/** The cues of the finale: once it starts, only these play, and none is dropped. */
const FINALE_CUES: ReadonlySet<KartCue> = new Set<KartCue>(["flip", "arm-off", "arm-wait", "arm-found", "taped", "laugh", "judy-wins"]);

export type KartLine = { id: string; cue: KartCue; text: string };
/** Judy's script (public/kart/judy.json): a line or more per cue ("bump" has eight, "arm-wait" three). */
export type KartScript = { name: string; lines: KartLine[] };

/** "finale" runs from the flip to Judy crossing the line; "finished" is her win, until the fade. */
export type KartPhase = "intro" | "ready" | "countdown" | "racing" | "finale" | "finished" | "done";

export type KartHud = {
  phase: KartPhase;
  lap: number;
  laps: 2;
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
  /** Judy's win (it is always hers), once she is over the line: Sam's race time. */
  result: { time: number } | null;
  /** A hint at the bottom of the screen; "" for nothing. */
  prompt: string;
  /** The finale's cut scenes: letterbox bars, everything but the subtitles hidden. */
  cinematic: boolean;
  /** On foot after the crash, through Sam's eyes. */
  firstPerson: boolean;
  /** What to do on foot ("Get Judy's arm"); "" for nothing. */
  objective: string;
  /** A small prompt by the crosshair when something is in reach; "" for nothing. */
  reach: string;
  /** Taping the arm on: 0..1 while E is held near her; null otherwise. */
  progress: number | null;
};

export type KartOptions = {
  signerName: string;
  title: string;
  manifest: KartManifest;
  judy: KartScript | null;
  onHud: (hud: KartHud) => void;
  /** Judy is over the line and her last line is over (or "Go sign" was pressed): show the signing page. */
  onDone: () => void;
};

export const EMPTY_KART_MANIFEST: KartManifest = { music: null, musicFinal: null, sounds: {}, voice: {} };

const LAPS = 2;
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
/** The racing line, for the auto kart in development: a shade under top speed, braking for the bends on grip alone. */
const LINE = { top: 29.2, lat: 11.5, accel: 11, brake: 22 };
/**
 * Judy: whatever Sam's speed is, plus whatever it takes to catch him (she can
 * always go faster than he can, and corners harder while she chases); the
 * lateral spring that steers her into him; how often she comes again.
 */
const JUDY = { accel: 17, brake: 26, lat: 32, chaseLat: 60, cap: 40, hop: 5.6, spring: 9, damp: 5.5, latMax: 7.5, every: [2, 4] as const };
/** A hit: the cooldown, the shove (m/s sideways, and forward from behind), what it costs, the roll and the shake. */
const HIT = { cooldown: 0.6, side: 6.4, rear: 3.2, push: 3.4, cost: 0.92, roll: 1.1, shake: 0.38 };
/** The finale: where on lap two it arms and is forced, the slow motion, and Sam on foot. */
const FINALE = {
  armAt: 0.7,
  forceAt: 0.88,
  latestAt: 0.93,
  slow: 0.35,
  slowFor: 2,
  g: 16,
  eye: 1.65,
  walk: 3.4,
  run: 5.6,
  turn: 1.9,
  pick: 1.8,
  tape: 2.1,
  tapeFor: 2.5,
  waitEvery: 10,
};
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
  /** The box driver (Sam's always; Judy's until her model loads). */
  driver: THREE.Group;
  paint: THREE.Material;
  seat: THREE.Mesh;
  steering: THREE.Mesh;
};

/**
 * Judy as a figure that can leave her kart: `root` is pivoted at her middle
 * and sits at `seat` in the kart's body while she drives; `arm` (pivoted at
 * the shoulder) is the one that comes off, and `home` is where it goes back.
 */
type Figure = {
  root: THREE.Group;
  seat: THREE.Vector3;
  arm: THREE.Group;
  home: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 };
  /** The arm's bounds and its shoulder-to-hand direction, in the arm's own frame. */
  armBox: THREE.Box3;
  armAxis: THREE.Vector3;
  /** Caps over the shoulder while the arm is off. */
  stumps: THREE.Object3D[];
  /** The root's height above the ground standing, and lying on her back. */
  standH: number;
  lieH: number;
  isModel: boolean;
};

type Hop = { from: THREE.Vector3; to: THREE.Vector3; dur: number; h: number; spin: number };

/** The finale's state, from the flip to the hand-over. `t` runs slow in the slow motion; `real` doesn't. */
type Finale = {
  stage: "flip" | "down" | "search" | "getin" | "drive" | "line" | "over";
  t: number;
  real: number;
  stageAt: number;
  side: 1 | -1;
  scale: number;
  view: "chase" | "cine" | "fp";
  kart: { com: THREE.Vector3; vel: THREE.Vector3; roll: number; rollV: number; yaw: number; yawV: number; landed: boolean; still: boolean };
  fly: number;
  thrown: boolean;
  fig: { vel: THREE.Vector3; spin: THREE.Vector3; landed: 0 | 1 | 2; landAt: number; from: THREE.Quaternion | null; fromAt: number; lieQ: THREE.Quaternion };
  arm: { off: boolean; at: number; hops: Hop[]; hop: number; hopT: number; axis: THREE.Vector3; restQ: THREE.Quaternion; slideFrom: THREE.Quaternion | null; rest: boolean; scale: THREE.Vector3 };
  sam: { x: number; z: number; yaw: number; pitch: number; look: number; bob: number; home: THREE.Vector3 };
  held: boolean;
  found: boolean;
  tape: number;
  lastWait: number;
  lineEnd: number;
  blinkAt: number;
  getin: {
    lieP: THREE.Vector3;
    lieQ: THREE.Quaternion;
    standQ: THREE.Quaternion;
    roll0: number;
    jumpFrom: THREE.Vector3 | null;
    jumpQ: THREE.Quaternion | null;
    seated: boolean;
    upright: boolean;
    music: boolean;
    runTo: THREE.Vector3;
    jumpAt: number;
    /** Where on the run (0..1) she hurdles the barrier, if she has to. */
    hurdle: number;
  } | null;
  crossed: boolean;
  crossedAt: number;
  camPos: THREE.Vector3;
  camLook: THREE.Vector3;
  camFov: number;
  /** The stage the lens was last set for: a new one is a cut. */
  lens: string;
};

/** Forward is -z in the kart's own frame: `heading` 0 points down -z. */
const forward = (heading: number) => ({ x: -Math.sin(heading), z: -Math.cos(heading) });
const headingOf = (tx: number, tz: number) => Math.atan2(-tx, -tz);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 0..1 eased in and out. */
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

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
  /** The body's roll after a hit (a damped spring) and its rate. */
  roll: number;
  rollV: number;
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
  private hud: KartHud = {
    phase: "intro",
    lap: 1,
    laps: 2,
    position: 2,
    time: 0,
    countdown: null,
    paused: false,
    dark: 0,
    fps: 0,
    dialogue: null,
    result: null,
    prompt: "",
    cinematic: false,
    firstPerson: false,
    objective: "",
    reach: "",
    progress: null,
  };
  private readonly keys = new Set<string>();
  private paused = false;
  private disposed = false;
  /** Race time, counted from GO while not paused (it runs on through the finale: it's Judy's time). */
  private time = 0;
  /** Seconds of play since "Start signing" (stops while paused); lines and the finale run on it. */
  private clock = 0;
  private readyAt = 0;
  private countdownClock = 0;
  private countdownShown = -1;
  private goAt = -1;
  private readonly jobs: Array<{ at: number; fn: () => void; tag: string }> = [];

  private player!: Driver;
  private judy!: Driver;
  private fig!: Figure;
  private drifting: { dir: number; since: number } | null = null;
  private boostUntil = 0;
  private jumped = false;
  private onGrassSince = -1;
  private wrongWaySince = -1;
  private lastWall = -10;
  private lastBumpAt = -1;
  private aheadSince = -1;
  private playerAhead = false;
  private judyOffsetPhase = 0;
  private auto = false;
  private autoKnock = 0;

  // Judy the menace, and her hits
  private readonly ai = { mode: "chase" as "chase" | "attack" | "recoil", since: 0, hold: 0.8, nextAt: 6, side: 1 as 1 | -1, kind: "rear" as "rear" | "side" };
  /** Her lateral speed across the road. */
  private jdv = 0;
  private judyWobble = 0;
  private lastHit = -10;
  /** The shove from the last hit, a velocity (m/s) that fades. */
  private readonly shove = { x: 0, z: 0 };
  private shake = 0;
  private finaleArmed = false;
  private forceRam = false;
  private finale: Finale | null = null;

  // Camera and the picture
  private camYaw = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private fov = 68;
  private wantFov = 68;
  private frames = 0;
  private fpsAt = 0;
  private scale = 1;
  private goodReadings = 0;
  private readonly base = Math.min(window.devicePixelRatio || 1, 2);
  private readonly dust: Array<{ sprite: THREE.Sprite; vx: number; vz: number; life: number; size: number }> = [];
  private dustMat!: THREE.SpriteMaterial;
  private readonly sparkList: Array<{ sprite: THREE.Sprite; v: THREE.Vector3; life: number; max: number }> = [];
  private sparkMat!: THREE.SpriteMaterial;
  private bumpMeshes: THREE.Mesh[] = [];
  /** The finale's props: shadows for her flipped kart, her and the arm; the arm's glint; Sam's hand. */
  private kartShadow!: THREE.Mesh;
  private figShadow!: THREE.Mesh;
  private armShadow!: THREE.Mesh;
  private glint!: THREE.Group;
  private hand!: THREE.Group;
  private readonly handRest = new THREE.Vector3();
  private locked = false;
  private leash = 45;

  // Judy's lines
  private readonly said = new Set<string>();
  private speaking: KartLine | null = null;
  private readonly queue: KartLine[] = [];
  private lineToken = 0;
  private lineAudio: HTMLAudioElement | null = null;
  private radio: AudioContext | null = null;
  private lastBumpLine = -10;
  private waitIndex = 0;

  // Sound and music
  private sound: RaceSound | null = null;
  private music: HTMLAudioElement | null = null;
  private musicFinal: HTMLAudioElement | null = null;
  private readonly musicGoal = new Map<HTMLAudioElement, { to: number; rate: number }>();
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
    this.loadJudy();
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
    const f = this.finale;
    const v3 = (v: THREE.Vector3) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    return {
      phase: this.phase,
      time: +this.time.toFixed(1),
      clock: +this.clock.toFixed(2),
      length: +this.track.length.toFixed(1),
      player: {
        x: +p.x.toFixed(1),
        z: +p.z.toFixed(1),
        v: +p.v.toFixed(1),
        s: +p.s.toFixed(1),
        d: +p.d.toFixed(2),
        lap: p.lap,
        half: p.half,
        grounded: p.grounded,
        frac: +(p.s / this.track.length).toFixed(3),
      },
      judy: {
        x: +j.x.toFixed(2),
        z: +j.z.toFixed(2),
        heading: +j.heading.toFixed(3),
        s: +j.s.toFixed(1),
        d: +j.d.toFixed(2),
        v: +j.v.toFixed(1),
        lap: Math.floor(j.s / this.track.length) + 1,
        gap: +(this.playerProgress() - j.s).toFixed(1),
        mode: this.ai.mode,
        kind: this.ai.kind,
      },
      model: this.fig?.isModel ?? false,
      lastHit: +this.lastHit.toFixed(2),
      armed: this.finaleArmed,
      finale: f
        ? {
            stage: f.stage,
            t: +f.t.toFixed(2),
            real: +f.real.toFixed(2),
            scale: +f.scale.toFixed(2),
            view: f.view,
            kart: v3(f.kart.com),
            roll: +f.kart.roll.toFixed(2),
            judy: v3(this.fig.root.getWorldPosition(new THREE.Vector3())),
            arm: v3(this.fig.arm.getWorldPosition(new THREE.Vector3())),
            armRest: f.arm.rest,
            sam: [+f.sam.x.toFixed(2), +f.sam.z.toFixed(2), +f.sam.yaw.toFixed(2)],
            held: f.held,
            tape: +f.tape.toFixed(2),
            crossed: f.crossed,
          }
        : null,
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
    // The picture catches up with the warp (the camera's lag, the particles).
    this.animate(0.5);
  }

  /** Development only: straight to lap `lap` (0 or 1) at `frac` of the way round, racing, Judy just behind. */
  jumpTo(lap: number, frac: number) {
    if (!import.meta.env.DEV) return;
    if (this.phase === "intro") this.begin();
    if (this.phase === "ready" || this.phase === "countdown") this.go();
    const T = this.track;
    const L = T.length;
    const p = this.player;
    const s = frac * L;
    const a = T.at(s);
    p.lap = lap;
    p.half = frac > 0.5;
    p.s = s;
    p.d = -2.2;
    p.x = a.x + a.nx * p.d;
    p.z = a.z + a.nz * p.d;
    p.heading = p.dir = headingOf(a.tx, a.tz);
    p.v = 26;
    p.hint = a.i;
    this.prevS = s;
    const j = this.judy;
    j.s = lap * L + s - 10;
    j.d = 1.5;
    j.v = 26;
    this.time = lap * 55 + frac * 55;
    this.setHud({ lap: lap + 1, countdown: null });
    if (lap >= 1) {
      for (const l of this.opts.judy?.lines ?? []) if (["start", "lap1-early", "lap1-mid", "lap1-late", "last-lap", "judy-passes", "player-passes"].includes(l.cue)) this.said.add(l.id);
      this.lastLapMusic();
    }
    this.placeCamera(true);
  }

  /** Development only: stops the clock between the harness's warps, so a still shows exactly the moment warped to. */
  freeze(on: boolean) {
    if (import.meta.env.DEV) this.frozen = on;
  }
  private frozen = false;

  /** Development only: holds the camera at `pos` looking at `look` (null lets it go), for close-up stills. */
  camAt(pos: [number, number, number] | null, look?: [number, number, number], fov = 50) {
    if (!import.meta.env.DEV) return;
    this.devCam = pos && look ? { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), fov } : null;
  }
  private devCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;

  /** Development only: on foot, stands Sam 1.2 m short of the arm or of Judy, facing it. */
  fpGo(what: "arm" | "judy") {
    if (!import.meta.env.DEV) return;
    const f = this.finale;
    if (!f || f.stage !== "search") return;
    const t = what === "arm" ? this.fig.arm.getWorldPosition(new THREE.Vector3()) : this.fig.root.position.clone();
    const dx = t.x - f.sam.x;
    const dz = t.z - f.sam.z;
    const d = Math.hypot(dx, dz) || 1;
    f.sam.x = t.x - (dx / d) * 1.2;
    f.sam.z = t.z - (dz / d) * 1.2;
    f.sam.yaw = Math.atan2(-dx, -dz);
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
    // Judy's progress is continuous from the grid: just short of the line is a little under zero.
    this.judy.s = -7;
    this.fig = this.boxFigure(this.judy.model);
    this.dustMat = new THREE.SpriteMaterial({ map: puffTexture(), color: 0xcfc2a8, transparent: true, opacity: 0.6, depthWrite: false });
    this.sparkMat = new THREE.SpriteMaterial({ map: sparkTexture(), color: 0xffc46b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.props();
  }

  /** The finale's props, built hidden: blob shadows, the arm's golden glint, Sam's hand in first person. */
  private props() {
    const s = this.scene;
    const blob = (w: number, h: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      s.add(m);
      return m;
    };
    this.kartShadow = blob(3.2, 3.6);
    this.figShadow = blob(1.4, 1.9);
    this.armShadow = blob(0.7, 0.7);
    // The glint: a soft golden glow over the arm, a faint beam above it and sparkles turning round it.
    const g = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture(), color: 0xffa83a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(1.1);
    glow.position.y = 0.7;
    glow.name = "glow";
    g.add(glow);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.22, 5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb760, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.y = 2.9;
    g.add(beam);
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture(), color: 0xffc977, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.scale.setScalar(0.22);
      sp.name = "twinkle";
      g.add(sp);
    }
    g.visible = false;
    s.add(g);
    this.glint = g;
    // Sam's right hand and sleeve, at the bottom right of first person, holding the arm.
    const hand = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.46), new THREE.MeshLambertMaterial({ color: 0x2b2b33 }));
    sleeve.position.set(0.44, -0.44, -0.5);
    sleeve.rotation.set(0.35, 0.3, 0);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.13), new THREE.MeshLambertMaterial({ color: 0xd9a98a }));
    palm.position.set(0.35, -0.36, -0.72);
    palm.rotation.set(0.35, 0.3, 0.2);
    hand.add(sleeve, palm);
    hand.visible = false;
    this.camera.add(hand);
    this.hand = hand;
    s.add(this.camera);
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
    // The driver, in a group of its own so it can be hidden (Sam on foot, Judy's model seated).
    const driver = new THREE.Group();
    body.add(driver);
    const skin = new THREE.MeshLambertMaterial({ color: who === "judy" ? 0xe8c4a8 : 0xd9a98a });
    const suit = new THREE.MeshLambertMaterial({ color: who === "judy" ? 0x9b7bb8 : 0x2b2b33 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), suit);
    torso.position.set(0, 0.95, 0.35);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
    head.position.set(0, 1.4, 0.35);
    driver.add(torso, head);
    for (const ax of [-0.32, 0.32]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), suit);
      arm.position.set(ax, 0.95, 0.05);
      arm.rotation.x = 0.3;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), skin);
      hand.position.set(ax * 0.6, 0.86, -0.3);
      driver.add(arm, hand);
      if (who === "judy" && ax > 0) {
        arm.name = "judy-arm";
        hand.name = "judy-hand";
      }
    }
    if (who === "judy") {
      const hair = new THREE.MeshLambertMaterial({ color: 0xc9c4bd });
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), hair);
      top.position.set(0, 1.62, 0.34);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), hair);
      bun.position.set(0, 1.64, 0.55);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.08), hair);
      back.position.set(0, 1.44, 0.54);
      driver.add(top, bun, back);
      const gold = new THREE.MeshBasicMaterial({ color: 0xd4af37 });
      for (const ex of [-0.08, 0.08]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.5 }));
        lens.position.set(ex, 1.42, 0.17);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), gold);
        rim.position.set(ex, 1.47, 0.17);
        driver.add(lens, rim);
      }
      const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.3), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
      scarf.position.set(0, 1.22, 0.36);
      // Legs, still bent as if seated: hidden in the kart, comic when she's thrown out.
      const trousers = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
      for (const lx of [-0.13, 0.13]) {
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.5), trousers);
        thigh.position.set(lx, 0.7, 0.12);
        const shin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.42, 0.15), trousers);
        shin.position.set(lx, 0.5, -0.12);
        driver.add(thigh, shin);
      }
      driver.add(scarf);
    } else {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), new THREE.MeshLambertMaterial({ color: 0x2a1c12 }));
      hair.position.set(0, 1.6, 0.35);
      const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
      helmet.position.set(0, 1.57, 0.35);
      driver.add(hair, helmet);
    }
    for (const ex of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), dark);
      eye.position.set(ex, 1.42, 0.17);
      driver.add(eye);
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
    return { group, wheels, fronts, body, shadow, flame, driver, paint: paintMat, seat, steering: wheel };
  }

  private driver(model: KartModel, s: number, d: number): Driver {
    const T = this.track;
    const a = T.at(s);
    const heading = headingOf(a.tx, a.tz);
    const x = a.x + a.nx * d;
    const z = a.z + a.nz * d;
    const dr: Driver = {
      x,
      z,
      y: 0,
      vy: 0,
      heading,
      dir: heading,
      v: 0,
      s: s < 0 ? s + T.length : s,
      d,
      hint: a.i,
      lap: 0,
      half: false,
      grounded: true,
      model,
      steer: 0,
      wheelSpin: 0,
      roll: 0,
      rollV: 0,
    };
    this.place(dr);
    return dr;
  }

  /** Judy's box driver as a figure that can be thrown out: her middle as the pivot, her right arm (and hand) loose. */
  private boxFigure(model: KartModel): Figure {
    const seat = new THREE.Vector3(0, 1.0, 0.35);
    const root = new THREE.Group();
    root.position.copy(seat);
    model.body.add(root);
    root.add(model.driver);
    model.driver.position.set(-seat.x, -seat.y, -seat.z);
    const pivot = new THREE.Vector3(0.32, 1.12, 0.3);
    const arm = new THREE.Group();
    arm.position.copy(pivot);
    model.driver.add(arm);
    for (const name of ["judy-arm", "judy-hand"]) {
      const m = model.driver.getObjectByName(name);
      if (!m) continue;
      model.driver.remove(m);
      m.position.sub(pivot);
      arm.add(m);
    }
    arm.updateMatrixWorld(true);
    const armBox = new THREE.Box3();
    for (const c of arm.children) {
      const b = new THREE.Box3().setFromObject(c);
      // Back into the arm's own frame (the group is only translated).
      const world = new THREE.Vector3();
      arm.getWorldPosition(world);
      b.min.sub(world);
      b.max.sub(world);
      armBox.union(b);
    }
    const stump = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshLambertMaterial({ color: 0x9b7bb8 }));
    stump.position.copy(pivot).add(new THREE.Vector3(-0.02, -0.04, 0.02));
    stump.visible = false;
    model.driver.add(stump);
    return {
      root,
      seat,
      arm,
      home: { parent: model.driver, pos: arm.position.clone(), quat: arm.quaternion.clone(), scale: arm.scale.clone() },
      armBox,
      armAxis: new THREE.Vector3(-0.2, -0.26, -0.6).normalize(),
      stumps: [stump],
      standH: 0.95,
      lieH: 0.22,
      isModel: false,
    };
  }

  /**
   * The theater's Meshy Judy (manifest models.judy) seated in her kart: turned
   * to face the kart's -z, scaled so the top of her head is 1.35 m above the
   * floor, her standing legs hidden in a champagne cowl, and her right arm
   * split off the mesh so it can come off in the finale. The box driver stays
   * if the model never loads.
   */
  private loadJudy() {
    const url = this.opts.manifest.models?.judy;
    if (!url) return;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (this.disposed || this.finale) return;
        try {
          this.seatJudy(gltf.scene);
        } catch (err) {
          console.warn("kart: Judy's model couldn't be seated", err);
        }
      },
      undefined,
      () => {
        /* the box driver stays */
      },
    );
  }

  private seatJudy(src: THREE.Object3D) {
    const k = this.judy.model;
    const fig = this.fig;
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const dims = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const H = 1.6;
    const scale = H / (dims.y || 1);
    const inner = new THREE.Group();
    // Meshy models face +z; the kart's forward is -z.
    inner.rotation.y = Math.PI;
    inner.scale.setScalar(scale);
    src.position.sub(center);
    inner.add(src);
    const meshes: THREE.Mesh[] = [];
    src.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const m of meshes) {
      // A Meshy texture is all base colour; without an environment map its metalness only darkens it.
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && "metalness" in mat) {
        mat.metalness = 0;
        mat.metalnessMap = null;
        mat.roughness = 0.85;
        mat.needsUpdate = true;
      }
    }

    // The arm: split off the one mesh by where its triangles are.
    let arm: THREE.Group | null = null;
    let armBox = new THREE.Box3();
    let armAxis = new THREE.Vector3(0, -1, 0);
    const stumps: THREE.Object3D[] = [];
    const only = meshes.length === 1 ? meshes[0] : null;
    const geo = only?.geometry;
    const sleeve = new THREE.MeshLambertMaterial({ color: 0xb1a6cc });
    if (only && geo && geo.index && geo.getAttribute("position") && geo.getAttribute("normal") && only.matrix.equals(new THREE.Matrix4())) {
      geo.computeBoundingBox();
      const split = splitArm(geo.getAttribute("position").array as ArrayLike<number>, geo.getAttribute("normal").array as ArrayLike<number>, geo.index.array as ArrayLike<number>, geo.boundingBox!);
      if (split) {
        const body = new THREE.BufferGeometry();
        const limb = new THREE.BufferGeometry();
        for (const name of Object.keys(geo.attributes)) {
          body.setAttribute(name, geo.getAttribute(name));
          limb.setAttribute(name, geo.getAttribute(name));
        }
        body.setIndex(new THREE.BufferAttribute(split.body, 1));
        limb.setIndex(new THREE.BufferAttribute(split.arm, 1));
        body.boundingBox = geo.boundingBox!.clone();
        limb.boundingBox = geo.boundingBox!.clone();
        body.computeBoundingSphere();
        limb.computeBoundingSphere();
        only.geometry = body;
        arm = new THREE.Group();
        arm.position.copy(split.pivot);
        const limbMesh = new THREE.Mesh(limb, only.material);
        limbMesh.position.copy(split.pivot).negate();
        arm.add(limbMesh);
        only.add(arm);
        armBox = split.box;
        armAxis = split.axis;
        // Sleeve caps over the open shoulder, on her and on the arm, shown once it's off.
        const r = split.unit * 0.07;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), sleeve);
        cap.scale.set(0.9, 1.5, 1.1);
        cap.position.copy(split.pivot).add(new THREE.Vector3(split.unit * 0.02, -split.unit * 0.06, 0));
        cap.visible = false;
        only.add(cap);
        const end = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 12, 8), sleeve);
        end.scale.set(0.9, 0.7, 1.1);
        arm.add(end);
        stumps.push(cap);
        geo.dispose();
      }
    }
    if (!arm) {
      // No split: a sleeve and a hand of her colours, kept out of sight until it comes off.
      arm = new THREE.Group();
      const u = (dims.y || 1) / 1.9;
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * u, 0.045 * u, 0.5 * u, 10), sleeve);
      sl.position.y = -0.25 * u;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045 * u, 10, 8), new THREE.MeshLambertMaterial({ color: 0xe2b99c }));
      hand.position.y = -0.53 * u;
      arm.add(sl, hand);
      arm.position.set(-0.2 * u, 0.5 * u, -0.05 * u).add(center);
      arm.visible = false;
      src.add(arm);
      armBox = new THREE.Box3(new THREE.Vector3(-0.06 * u, -0.58 * u, -0.06 * u), new THREE.Vector3(0.06 * u, 0, 0.06 * u));
      armAxis = new THREE.Vector3(0, -1, 0);
    }

    // Seat her: the top of her head 1.35 m above the kart's floor (its top is at 0.43).
    const seat = new THREE.Vector3(0, 0.43 + 1.35 - H / 2, 0.3);
    fig.root.position.copy(seat);
    fig.root.add(inner);
    k.driver.visible = false;
    // The cowl round her lower body, in her kart's paint: a tub, a sloping dash down to the nose, a dark band below the rim.
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.54, 0.96), k.paint);
    cowl.position.set(0, 0.43 + 0.27, 0.27);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.07, 0.8), k.paint);
    dash.position.set(0, 0.735, -0.53);
    dash.rotation.x = -0.63;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 0.98), new THREE.MeshLambertMaterial({ color: 0x1a1a1f }));
    band.position.set(0, 0.925, 0.27);
    k.body.add(cowl, dash, band);
    k.steering.position.set(0, 1.02, -0.12);
    k.steering.rotation.x = -0.95;
    k.seat.position.set(0, 0.86, 0.66);

    fig.seat = seat;
    fig.arm = arm;
    fig.home = { parent: arm.parent!, pos: arm.position.clone(), quat: arm.quaternion.clone(), scale: arm.scale.clone() };
    fig.armBox = armBox;
    fig.armAxis = armAxis;
    fig.stumps = stumps;
    fig.standH = H / 2;
    fig.lieH = Math.max(0.12, (dims.z * scale) / 2);
    fig.isModel = true;
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
    const on = <E extends Event>(target: Document | HTMLElement | Window, type: string, fn: (e: E) => void) => {
      const h = fn as EventListener;
      target.addEventListener(type, h);
      this.disposers.push(() => target.removeEventListener(type, h));
    };
    let unlockedAt = -1;
    on<KeyboardEvent>(window, "keydown", (e) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && this.phase !== "intro") e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Escape" && this.inPlay()) {
        // Escape that just freed the pointer has already paused.
        if (this.paused && performance.now() - unlockedAt > 350) this.resume();
        else this.pause();
      }
      if (e.code === "Space" && this.phase === "racing" && !this.paused && !this.auto) this.jump();
      if (e.code === "KeyE") this.interact();
    });
    on<KeyboardEvent>(window, "keyup", (e) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());
    on(document, "visibilitychange", () => {
      if (document.hidden && this.inPlay() && !this.paused) this.pause();
    });
    // On foot the mouse can turn him too, once a click has locked the pointer (the keys alone are enough).
    const canvas = this.renderer.domElement;
    on(canvas, "click", () => {
      if (this.finale?.view !== "fp" || this.paused || document.pointerLockElement) return;
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        void r?.catch?.(() => {});
      } catch {
        /* no pointer lock: the keys still work */
      }
    });
    on<MouseEvent>(document, "mousemove", (e) => {
      const f = this.finale;
      if (!f || f.view !== "fp" || this.paused || document.pointerLockElement !== canvas) return;
      f.sam.yaw -= e.movementX * 0.0024;
      f.sam.look = clamp(f.sam.look - e.movementY * 0.002, -0.7, 0.6);
    });
    on(document, "pointerlockchange", () => {
      const now = document.pointerLockElement === canvas;
      if (this.locked && !now) {
        unlockedAt = performance.now();
        // Losing the pointer on foot (Escape, mostly) pauses, unless we let it go ourselves.
        if (this.finale?.view === "fp" && !this.releasing) this.pause();
      }
      this.locked = now;
      this.releasing = false;
    });
  }
  private releasing = false;

  private releasePointer() {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  private inPlay() {
    return this.phase === "ready" || this.phase === "countdown" || this.phase === "racing" || this.phase === "finale" || this.phase === "finished";
  }

  /** The HUD's "Start signing": the grid, the controls, Judy's opening line, then the countdown. */
  begin() {
    if (this.phase !== "intro") return;
    this.sound = new RaceSound(this.opts.manifest.sounds);
    this.readyAt = performance.now();
    this.clock = 0;
    this.setPhase("ready");
    this.setHud({ prompt: "" });
    this.cue("start", "high");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.setHud({ paused: false });
    for (const a of [this.music, this.musicFinal]) if (a && (a.volume > 0.001 || (this.musicGoal.get(a)?.to ?? 0) > 0)) void a.play().catch(() => {});
    this.sound?.wake();
    if (this.lineAudio && !this.lineAudio.ended && this.lineAudio.currentTime > 0) this.lineAudio.play().catch(() => {});
  }

  private pause() {
    if (this.paused || !this.inPlay()) return;
    this.paused = true;
    this.setHud({ paused: true });
    this.music?.pause();
    this.musicFinal?.pause();
    this.sound?.quiet();
    this.sound?.sleep();
    this.lineAudio?.pause();
    this.keys.clear();
    this.releasePointer();
  }

  /** Judy is over the line: fade to black and hand over (after her last line, or the "Go sign" button). */
  goSign() {
    if (this.phase !== "finished") return;
    this.setPhase("done");
    this.setHud({ dark: 1, prompt: "" });
    this.stopLine();
    this.musicTo(this.music, 0, 0.6);
    this.musicTo(this.musicFinal, 0, 0.6);
    this.releasePointer();
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
    const still = this.paused || (import.meta.env.DEV && this.frozen);
    if (!still) this.step(dt);
    this.animate(still ? 0 : dt);
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

  /** The race itself, `dt` seconds on: the flow, the karts, the laps, Judy's cues, the finale. Drawing is elsewhere so the browser checks can run it fast. */
  private step(dt: number) {
    this.clock += dt;
    this.runJobs();
    this.updateMusic(dt);
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
    } else if (this.phase === "racing") {
      this.time += dt;
      if (this.goAt >= 0 && this.clock - this.goAt > 1.2 && this.hud.countdown !== null) this.setHud({ countdown: null });
      if (this.auto) this.drivePlayerAuto(dt);
      else this.drivePlayer(dt);
      this.driveJudy(dt);
      this.collide();
      this.laps();
      this.cues();
      this.armFinale();
    } else if (this.finale) {
      if (!this.finale.crossed) this.time += dt;
      this.stepFinale(dt);
    }
    const t = Math.round(this.time * 10) / 10;
    if (t !== this.hud.time && this.phase === "racing") this.setHud({ time: t });
    // The engine is his while he drives, hers once she's driving off to win.
    const f = this.finale;
    const hers = f && (f.stage === "drive" || f.stage === "line" || f.stage === "over");
    const frac = clamp(Math.abs((hers ? this.judy : this.player).v) / KART.top, 0, 1.3);
    const on = this.phase === "racing" || this.phase === "finale" || this.phase === "finished" || this.phase === "done";
    this.sound?.engine(on ? frac : 0, hers ? 1 : this.throttle() > 0 ? 1 : 0, dt);
    this.sound?.tick(dt);
  }

  private go() {
    this.goAt = this.clock;
    this.setPhase("racing");
    this.setHud({ countdown: 0 });
    this.sound?.play("kart-go");
    this.ai.nextAt = this.clock + 5;
    if (this.music) {
      this.music.volume = 0;
      this.musicTo(this.music, 0.45, 1.2);
    }
  }

  private throttle() {
    const k = this.keys;
    if (this.phase !== "racing") return 0;
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
    p.x += (f.x * p.v + this.shove.x) * dt;
    p.z += (f.z * p.v + this.shove.z) * dt;
    this.decayShove(dt);

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
    this.springRoll(p, dt);
    this.place(p);
  }

  /** Development only: ?auto=1 races the player's kart along the line (a hit still knocks it aside). */
  private drivePlayerAuto(dt: number) {
    const p = this.player;
    const T = this.track;
    // The shove moves it across the road, then the line pulls it back.
    const a = T.at(p.s);
    this.autoKnock += (this.shove.x * a.nx + this.shove.z * a.nz) * dt;
    this.autoKnock -= this.autoKnock * Math.min(1, dt * 2);
    this.decayShove(dt);
    this.followLine(p, dt, 1.0, -2.2, this.judyOffsetPhase + 2);
    p.d = clamp(p.d + this.autoKnock, -(ROAD.bound - 1), ROAD.bound - 1);
    const b = T.at(p.s);
    p.x = b.x + b.nx * p.d;
    p.z = b.z + b.nz * p.d;
    // Judy's progress never wraps; the player's does.
    p.s = ((p.s % T.length) + T.length) % T.length;
    this.sound?.skid(false);
    p.wheelSpin += (p.v / 0.28) * dt;
    this.springRoll(p, dt);
    this.place(p);
  }

  /** The shove from a hit fades out over a fraction of a second. */
  private decayShove(dt: number) {
    const k = Math.exp(-5.5 * dt);
    this.shove.x *= k;
    this.shove.z *= k;
  }

  /**
   * Judy rams him. Her speed is his, plus whatever closes the gap when she's
   * behind (so she always catches up), minus a little when she's ahead (so he
   * comes back alongside). Near him she holds a slot behind or beside him,
   * and every two to four seconds she attacks: from behind she drives into
   * his tail, from the side she swerves into him.
   */
  private driveJudy(dt: number) {
    const j = this.judy;
    const p = this.player;
    const T = this.track;
    const ai = this.ai;
    const now = this.clock;
    const pp = this.playerProgress();
    const pv = Math.max(0, p.v);
    const near = Math.abs(pp - j.s);
    if (ai.mode === "recoil" && now - ai.since > ai.hold) this.setMode("chase");
    if (ai.mode === "chase" && (now >= ai.nextAt || this.forceRam) && near < 10) this.setMode("attack");
    if (ai.mode === "attack" && now - ai.since > 3.5 && !this.forceRam) {
      this.setMode("chase");
      ai.nextAt = now + 0.6;
    }
    // Where she wants to be.
    const edge = ROAD.half + ROAD.curb - 0.7;
    let slotS = -2.8;
    let slotD = p.d + ai.side * 2.7;
    if (ai.mode === "attack") {
      if (ai.kind === "rear") {
        slotS = 0.6;
        slotD = p.d + ai.side * 0.3;
      } else {
        slotS = -0.5;
        slotD = p.d - ai.side * 0.5;
      }
    } else if (ai.mode === "recoil") {
      slotS = -4.2;
      slotD = p.d + ai.side * 3;
    }
    // Off the road he's fair game out to the barrier; on it she keeps to the asphalt and curbs.
    const reach = Math.min(ROAD.bound - 1.5, Math.max(edge + 0.6, Math.abs(p.d) + 3));
    if (ai.mode !== "attack" && Math.abs(slotD) > reach) {
      ai.side = -ai.side as 1 | -1;
      slotD = p.d + ai.side * 2.7;
    }
    slotD = clamp(slotD, -reach, reach);
    // How fast: his speed, and what closes on her slot.
    const gap = pp + slotS - j.s;
    let target: number;
    let lat = JUDY.lat;
    if (j.s > pp + 3 && ai.mode !== "attack") {
      target = Math.max(0, pv - clamp(1.5 + (j.s - pp) * 0.12, 1.5, 6));
    } else if (gap > 6) {
      target = pv + clamp(gap * 0.3, 2, 9);
      lat = JUDY.chaseLat;
    } else if (ai.mode === "attack") target = pv + clamp(gap * 1.7, -3, 7);
    else target = pv + clamp(gap * 0.9, -5, 4);
    // Off the grid with him, whatever.
    if (this.time < 4) target = Math.max(target, Math.min(13, this.time * 5));
    // The bends: she brakes for them, far less than a racer, and less still when she's chasing.
    const look = 8 + j.v * 0.6;
    let kmax = 0;
    const i0 = Math.floor((j.s + look) / T.ds);
    for (let n = 0; n < 22; n++) kmax = Math.max(kmax, Math.abs(T.curv[(((i0 + n) % T.n) + T.n) % T.n]));
    target = Math.min(target, JUDY.cap, Math.sqrt(lat / Math.max(kmax, 1e-4)));
    if (j.v < target) j.v = Math.min(target, j.v + JUDY.accel * dt);
    else j.v = Math.max(target, j.v - JUDY.brake * dt);
    j.s += j.v * dt;
    // Across the road: a spring toward the slot, which is a swerve when she attacks.
    const acc = clamp((slotD - j.d) * JUDY.spring - this.jdv * JUDY.damp, -30, 30);
    this.jdv = clamp(this.jdv + acc * dt, -JUDY.latMax, JUDY.latMax);
    j.d = clamp(j.d + this.jdv * dt, -(ROAD.bound - 1.4), ROAD.bound - 1.4);
    const a = T.at(j.s);
    j.x = a.x + a.nx * j.d;
    j.z = a.z + a.nz * j.d;
    const vx = a.tx * j.v + a.nx * this.jdv;
    const vz = a.tz * j.v + a.nz * this.jdv;
    const h = j.v > 1 ? headingOf(vx, vz) : headingOf(a.tx, a.tz);
    this.judyWobble *= Math.exp(-4 * dt);
    j.dir = h;
    j.heading += wrapAngle(h + this.judyWobble - j.heading) * Math.min(1, dt * 9);
    j.hint = a.i;
    j.steer = clamp(T.curv[a.i] * 40 + this.jdv * 0.15, -1, 1);
    // She hops the bumps.
    if (j.grounded)
      for (const b of BUMPS) {
        const bs = b.at * T.length;
        const ds = (((j.s - bs) % T.length) + T.length) % T.length;
        if (Math.abs(j.d - b.d) < 3.3 && ds > T.length - 4 && ds < T.length - 2) {
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
    this.springRoll(j, dt);
    this.place(j);
  }

  private setMode(mode: "chase" | "attack" | "recoil") {
    const ai = this.ai;
    const p = this.player;
    const j = this.judy;
    ai.mode = mode;
    ai.since = this.clock;
    if (mode === "chase") {
      ai.side = j.d - p.d > 0.4 ? 1 : j.d - p.d < -0.4 ? -1 : ai.side;
      // Pinned toward an edge, he gets one from the outside now and then, back into the road.
      if (Math.abs(p.d) > ROAD.half - 2 && Math.random() < 0.5) ai.side = Math.sign(p.d) as 1 | -1;
    }
    if (mode === "attack") {
      const beside = Math.abs(this.playerProgress() - j.s) < 3 && Math.abs(j.d - p.d) > 1.5;
      ai.kind = beside || Math.random() < 0.45 ? "side" : "rear";
      ai.side = j.d - p.d >= 0 ? 1 : -1;
    }
  }

  /** Drives a kart along the spline: speed from the curvature ahead, a lateral offset that wanders, the heading from the tangent. */
  private followLine(k: Driver, dt: number, scale: number, offsetBase: number, phase: number) {
    const T = this.track;
    const look = 10 + k.v * 0.9;
    let kmax = 0;
    const i0 = Math.floor((k.s + look) / T.ds);
    for (let n = 0; n < 26; n++) kmax = Math.max(kmax, Math.abs(T.curv[(((i0 + n) % T.n) + T.n) % T.n]));
    const target = Math.min(LINE.top * scale, Math.sqrt(LINE.lat / Math.max(kmax, 1e-4)));
    if (k.v < target) k.v = Math.min(target, k.v + LINE.accel * dt);
    else k.v = Math.max(target, k.v - LINE.brake * dt);
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

  /** The kart body's roll after a hit: a stiff spring, back level in half a second. */
  private springRoll(k: Driver, dt: number) {
    k.rollV += (-140 * k.roll - 10 * k.rollV) * dt;
    k.roll += k.rollV * dt;
  }

  /** The karts touch: they're pushed apart along the shallower overlap, and if the cooldown allows it's a hit. */
  private collide() {
    const p = this.player;
    const j = this.judy;
    if (Math.abs(p.y - j.y) > 0.9) return;
    const ds = j.s - this.playerProgress();
    const dd = j.d - p.d;
    const LEN = 2.6;
    const WID = 1.55;
    if (Math.abs(ds) > LEN || Math.abs(dd) > WID) return;
    const penS = LEN - Math.abs(ds);
    const penD = WID - Math.abs(dd);
    const a = this.track.at(p.s);
    const beside = penD < penS * 1.2;
    if (beside) {
      const push = penD + 0.02;
      const away = dd >= 0 ? -1 : 1;
      if (this.auto) this.autoKnock += away * push * 0.7;
      else {
        p.x += a.nx * away * push * 0.7;
        p.z += a.nz * away * push * 0.7;
      }
      p.d += away * push * 0.7;
      j.d -= away * push * 0.3;
    } else {
      const push = penS + 0.02;
      const dir = ds < 0 ? 1 : -1;
      j.s -= dir * push * 0.7;
      if (!this.auto) {
        p.x += a.tx * dir * push * 0.3;
        p.z += a.tz * dir * push * 0.3;
      }
    }
    if (this.clock - this.lastHit >= HIT.cooldown) this.hit(ds, dd, beside);
  }

  /**
   * One hit: Sam is shoved sideways (and on a bit, from behind), loses at
   * most 8% of his speed, his kart rolls and the camera jolts; sparks, a
   * crunch that is never quite the same twice, and Judy, now and then, has
   * something to say. In the last stretch of lap two this is the hit that
   * flips her.
   */
  private hit(ds: number, dd: number, beside: boolean) {
    const p = this.player;
    const j = this.judy;
    const ai = this.ai;
    this.lastHit = this.clock;
    const rear = !beside && ds < 0;
    const away = Math.abs(dd) > 0.15 ? (dd >= 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    const a = this.track.at(p.s);
    const lat = (rear ? HIT.rear : HIT.side) * away;
    this.shove.x += a.nx * lat + (rear ? a.tx * HIT.push : 0);
    this.shove.z += a.nz * lat + (rear ? a.tz * HIT.push : 0);
    if (rear) p.v = Math.min(KART.top * 1.05, p.v * 0.97 + 0.8);
    else p.v *= HIT.cost;
    if (!this.auto) p.heading += away * (rear ? 0.05 : 0.1);
    p.rollV += away * HIT.roll;
    j.rollV -= away * HIT.roll * 0.6;
    this.shake = HIT.shake;
    j.v *= 0.95;
    this.jdv = -away * 3;
    this.judyWobble = -away * 0.18;
    this.sparks(new THREE.Vector3((p.x + j.x) / 2, 0.45, (p.z + j.z) / 2), 14, new THREE.Vector3(a.nx * away, 0.6, a.nz * away));
    this.sound?.hit();
    this.setMode("recoil");
    ai.hold = 0.7 + Math.random() * 0.4;
    ai.nextAt = this.clock + JUDY.every[0] + Math.random() * (JUDY.every[1] - JUDY.every[0]);
    if (this.finaleArmed) this.startFinale();
    else if (this.phase === "racing") this.cue("bump", "low");
  }

  /** How far the player has come in metres; on the grid, just short of the line, it is a little under zero. */
  private playerProgress() {
    const p = this.player;
    const L = this.track.length;
    return p.lap * L + p.s - (!p.half && p.s > L * 0.5 ? L : 0);
  }

  /** Laps: the line counts once a kart has been round the far side; lap two brings the last-lap music. */
  private laps() {
    const p = this.player;
    const L = this.track.length;
    if (!p.half && p.s > L * 0.5 && p.s < L * 0.9) p.half = true;
    const prev = this.prevS;
    if (prev >= 0) {
      if (prev > L * 0.9 && p.s < L * 0.1) {
        // Over the line, forward.
        if (p.half) {
          p.half = false;
          p.lap++;
          // The finale always comes first; this is only the backstop.
          if (p.lap >= LAPS) this.startFinale();
          else {
            this.sound?.play("kart-lap");
            this.setHud({ lap: p.lap + 1 });
            this.cue("last-lap", "high");
            this.lastLapMusic();
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

  /** The last stretch of lap two: from 70% her next hit flips her; from 88% she goes for it; by 93% it happens regardless. */
  private armFinale() {
    const p = this.player;
    const L = this.track.length;
    if (p.lap !== LAPS - 1 || !p.half) return;
    const f = p.s / L;
    if (f > FINALE.armAt) this.finaleArmed = true;
    if (f > FINALE.forceAt && !this.forceRam) {
      this.forceRam = true;
      // Too far off to get to him in time: she's put just behind him, out of shot.
      const j = this.judy;
      const pp = this.playerProgress();
      if (Math.abs(pp - j.s) > 40) {
        j.s = pp - 14;
        j.d = p.d;
        j.v = p.v + 6;
      }
      this.setMode("attack");
      this.ai.kind = "side";
    }
    if (f > FINALE.latestAt) this.startFinale();
  }

  /** Judy's cues as the race runs: the clock, the marks round the lap, who is in front. */
  private cues() {
    const p = this.player;
    const L = this.track.length;
    if (this.time > 12 && p.lap === 0) this.cue("lap1-early", "high");
    if (p.lap === 0 && p.half) {
      if (p.s > L * 0.5) this.cue("lap1-mid", "high");
      if (p.s > L * 0.75) this.cue("lap1-late", "high");
    }
    if (p.lap === 1 && p.s > L * 0.45 && p.s < L * 0.9) this.cue("last-lap-mid", "high");
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

  /**
   * Plays a cue's next unsaid line ("arm-wait" cycles its three): queued
   * behind the one playing, or dropped if it matters less. "bump" is at most
   * every seven seconds and starts over once all eight are said. Once the
   * finale is on, only its cues play.
   */
  private cue(name: KartCue, priority: "high" | "low") {
    const lines = this.opts.judy?.lines.filter((l) => l.cue === name) ?? [];
    if (!lines.length) return;
    if (this.finale && !FINALE_CUES.has(name)) return;
    let line: KartLine | undefined;
    if (name === "arm-wait") line = lines[this.waitIndex % lines.length];
    else {
      line = lines.find((l) => !this.said.has(l.id));
      if (!line && name === "bump") {
        for (const l of lines) this.said.delete(l.id);
        line = lines[0];
      }
    }
    if (!line) return;
    if (name === "bump" && this.clock - this.lastBumpLine < 7) return;
    if (this.speaking || this.queue.length) {
      if (priority === "low") return;
      if (!this.queue.includes(line)) this.queue.push(line);
      return;
    }
    this.say(line);
  }

  /** Runs `fn` after `seconds` of play (the clock stops while paused). */
  private after(seconds: number, fn: () => void, tag = "") {
    this.jobs.push({ at: this.clock + seconds, fn, tag });
  }

  private cancel(tag: string) {
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].tag === tag) this.jobs.splice(i, 1);
  }

  private runJobs() {
    if (!this.jobs.length) return;
    const due: Array<() => void> = [];
    for (let i = this.jobs.length - 1; i >= 0; i--)
      if (this.jobs[i].at <= this.clock) {
        due.unshift(this.jobs[i].fn);
        this.jobs.splice(i, 1);
      }
    for (const fn of due) fn();
  }

  /** Cuts off the line playing (the finale's first line doesn't wait). */
  private stopLine() {
    this.lineToken++;
    this.cancel("line");
    this.lineAudio?.pause();
    this.lineAudio = null;
    this.speaking = null;
    if (this.hud.dialogue) this.setHud({ dialogue: null });
  }

  private say(line: KartLine) {
    this.said.add(line.id);
    if (line.cue === "arm-wait") {
      this.waitIndex++;
      if (this.finale) this.finale.lastWait = this.clock;
    }
    if (line.cue === "bump") this.lastBumpLine = this.clock;
    this.speaking = line;
    const token = ++this.lineToken;
    const speaker = this.opts.judy?.name ?? "Judy";
    const chunks = subtitleChunks(line.text);
    const words = chunks.map((c) => c.split(/\s+/).length);
    const total = words.reduce((a, b) => a + b, 0);
    const later = (fn: () => void, ms: number) => this.after(ms / 1000, () => token === this.lineToken && fn(), "line");
    let done = false;
    const finish = () => {
      if (done || token !== this.lineToken) return;
      done = true;
      this.cancel("line");
      this.lineAudio = null;
      this.speaking = null;
      this.setHud({ dialogue: null });
      this.lineEnded(line);
      const next = this.queue.shift();
      if (next && this.phase !== "done") later(() => this.say(next), 400);
    };
    let scheduled = false;
    const schedule = (seconds: number) => {
      if (scheduled || token !== this.lineToken) return;
      scheduled = true;
      this.lineStarted(line, seconds);
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
    const start = () => {
      if (token !== this.lineToken) return;
      const seconds = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total * 0.42 + 0.4;
      schedule(seconds);
    };
    a.addEventListener("loadedmetadata", () => {
      if (token !== this.lineToken) return;
      this.overRadio(a);
      if (this.paused) start();
      else a.play().then(start, () => start());
    });
    a.addEventListener("error", () => start());
    // A clip that never loads shouldn't hold the line.
    later(start, 4000);
    a.load();
  }

  /** A line has begun, `seconds` long: the last one takes the music down with it. */
  private lineStarted(line: KartLine, seconds: number) {
    if (line.cue === "judy-wins") this.musicTo(this.activeMusic(), 0, Math.max(1.5, seconds));
  }

  /** A line is over: the last one hands over to the signing page a moment later. */
  private lineEnded(line: KartLine) {
    if (line.cue === "judy-wins") this.after(1.5, () => this.goSign());
    if (this.finale) this.finale.lineEnd = this.clock;
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

  /** Takes a track to a volume over `seconds` of play; it pauses once it reaches silence. */
  private musicTo(a: HTMLAudioElement | null, to: number, seconds: number) {
    if (!a) return;
    this.musicGoal.set(a, { to, rate: Math.abs(to - a.volume) / Math.max(0.05, seconds) });
    if (to > 0 && a.paused && !this.paused) void a.play().catch(() => {});
  }

  private updateMusic(dt: number) {
    for (const [a, g] of this.musicGoal) {
      const v = a.volume;
      const next = v < g.to ? Math.min(g.to, v + g.rate * dt) : Math.max(g.to, v - g.rate * dt);
      a.volume = clamp(next, 0, 1);
      if (next === g.to) {
        this.musicGoal.delete(a);
        if (g.to === 0) a.pause();
      }
    }
  }

  /** The track playing now, and the level it plays at in the race. */
  private activeMusic() {
    return this.lastLap && this.musicFinal ? this.musicFinal : this.music;
  }

  private raceLevel() {
    return this.lastLap ? (this.musicFinal ? 0.62 : 0.65) : 0.45;
  }

  /** The last lap: the final track takes over, or the same song jumps to its drop and comes up. */
  private lastLapMusic() {
    if (this.lastLap) return;
    this.lastLap = true;
    if (this.musicFinal) {
      this.musicFinal.volume = 0;
      this.musicTo(this.musicFinal, 0.62, 2);
      this.musicTo(this.music, 0, 2);
    } else if (this.music) {
      try {
        this.music.currentTime = 43;
      } catch {
        /* not seekable: it plays on */
      }
      this.musicTo(this.music, 0.65, 2);
    }
  }

  // ── The finale ──────────────────────────────────────────────────────────

  /** Whether a point beside the track is open grass: clear of every bit of road and of the grandstand. */
  private open(x: number, z: number, min = ROAD.bound + 1.2, max = 21) {
    const T = this.track;
    const i = T.nearest(x, z, -1);
    const d = Math.hypot(T.px[i] - x, T.pz[i] - z);
    if (z > ROAD.bound + 1 && Math.abs(x) < 66) return false;
    return d >= min && d <= max;
  }

  /**
   * Judy's kart flips: it launches off the hit, rolls one and a half times
   * with some yaw, and lands upside down on the run-off. Sam's input goes,
   * the music drops, the queue of lines is cleared for hers; a moment later
   * the picture cuts to a low angle in slow motion.
   */
  private startFinale() {
    if (this.finale || this.phase !== "racing") return;
    const T = this.track;
    const j = this.judy;
    const p = this.player;
    this.setPhase("finale");
    this.keys.clear();
    this.drifting = null;
    this.boostUntil = 0;
    this.sound?.skid(false);
    this.setHud({ prompt: "", countdown: null });
    // Which way she goes: away from him, unless that side has no room.
    let side: 1 | -1 = j.d - p.d > 0.3 ? 1 : j.d - p.d < -0.3 ? -1 : j.d >= 0 ? 1 : -1;
    const a = T.at(j.s);
    const room = (sd: number) => this.open(a.x + a.nx * sd * 17 + a.tx * 20, a.z + a.nz * sd * 17 + a.tz * 20, ROAD.bound + 1);
    if (!room(side) && room(-side)) side = -side as 1 | -1;
    const vy = 8.6;
    const g = FINALE.g;
    const fly = (vy + Math.sqrt(vy * vy - 2 * g * 0.08)) / g;
    const u = Math.max(13, j.v * 0.6);
    const lat = (side * 10.8 - j.d) / fly;
    const kart = {
      com: new THREE.Vector3(j.x, j.y + 0.5, j.z),
      vel: new THREE.Vector3(a.tx * u + a.nx * lat, vy, a.tz * u + a.nz * lat),
      roll: 0,
      rollV: (side * 3 * Math.PI) / fly,
      yaw: j.heading,
      yawV: (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6),
      landed: false,
      still: false,
    };
    // Where the low camera waits: just ahead of the top of her arc, on the road side, at knee height, looking up.
    const top = kart.com
      .clone()
      .addScaledVector(kart.vel, fly * 0.55)
      .setY(0);
    const cam = top
      .clone()
      .add(new THREE.Vector3(a.tx * 7.5, 0, a.tz * 7.5))
      .add(new THREE.Vector3(-a.nx * side * 4.5, 0.45, -a.nz * side * 4.5));
    this.finale = {
      stage: "flip",
      t: 0,
      real: 0,
      stageAt: 0,
      side,
      scale: 1,
      view: "chase",
      kart,
      fly,
      thrown: false,
      fig: { vel: new THREE.Vector3(), spin: new THREE.Vector3(), landed: 0, landAt: 0, from: null, lieQ: new THREE.Quaternion(), fromAt: 0 },
      arm: { off: false, at: 0, hops: [], hop: 0, hopT: 0, axis: new THREE.Vector3(1, 0, 0), restQ: new THREE.Quaternion(), slideFrom: null, rest: false, scale: new THREE.Vector3(1, 1, 1) },
      sam: { x: 0, z: 0, yaw: 0, pitch: -0.08, look: 0, bob: 0, home: new THREE.Vector3() },
      held: false,
      found: false,
      tape: 0,
      lastWait: 0,
      lineEnd: -1,
      blinkAt: -1,
      getin: null,
      crossed: false,
      crossedAt: 0,
      camPos: cam,
      camLook: kart.com.clone(),
      camFov: 50,
      lens: "",
    };
    // Her lines only, starting now.
    this.queue.length = 0;
    this.stopLine();
    this.cue("flip", "high");
    this.musicTo(this.activeMusic(), 0.12, 0.8);
    j.model.shadow.visible = false;
    this.kartShadow.visible = true;
    this.sound?.play("kart-bump", 1, 0.8);
    this.sound?.crunch(0.75);
    this.shake = 0.5;
  }

  /** The finale, `dt` seconds on (slowed in the slow motion). */
  private stepFinale(rawDt: number) {
    const f = this.finale;
    if (!f) return;
    f.real += rawDt;
    // Slow motion: from the cut, 0.35x for two seconds, then easing back to speed.
    const cut = 0.3;
    if (f.real < cut) f.scale = 1;
    else if (f.real < cut + FINALE.slowFor) f.scale = FINALE.slow;
    else f.scale = Math.min(1, f.scale + rawDt * 2.5);
    if (f.real >= cut && f.view === "chase" && f.stage === "flip") {
      f.view = "cine";
      this.setHud({ cinematic: true });
    }
    const dt = rawDt * f.scale;
    f.t += dt;
    this.coastPlayer(dt);
    switch (f.stage) {
      case "flip":
      case "down":
        this.stepKartFlip(dt);
        this.stepThrown(dt);
        this.stepArmHops(dt);
        if (f.stage === "down" && f.arm.rest && f.blinkAt < 0) {
          // On foot once the arm's at rest and her line is said (or it's been long enough).
          const since = f.t - f.arm.at;
          if (since > 2.6 && (!this.speaking || since > 8)) {
            f.blinkAt = f.t;
            this.setHud({ dark: 1 });
            this.after(0.5, () => this.onFoot());
          }
        }
        break;
      case "search":
        this.stepOnFoot(dt);
        break;
      case "getin":
        this.stepGetIn(dt);
        break;
      case "drive":
        this.stepDriveOff(dt);
        break;
      case "line":
      case "over":
        this.stepToLine(dt);
        break;
    }
    if (f.stage !== "drive" && f.stage !== "line" && f.stage !== "over") this.placeFlipped();
  }

  /** Sam's kart, input off: it coasts to a stop on its heading. */
  private coastPlayer(dt: number) {
    const p = this.player;
    p.v = Math.max(0, p.v - 13 * dt);
    p.steer *= Math.exp(-4 * dt);
    const f = forward(p.heading);
    p.x += (f.x * p.v + this.shove.x) * dt;
    p.z += (f.z * p.v + this.shove.z) * dt;
    this.decayShove(dt);
    p.dir += wrapAngle(p.heading - p.dir) * Math.min(1, dt * 6);
    const fr = this.track.frame(p.x, p.z, p.hint);
    p.hint = fr.i;
    p.s = fr.s;
    p.d = fr.d;
    if (!p.grounded) {
      p.vy -= KART.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
      }
    }
    p.wheelSpin += (p.v / 0.28) * dt;
    this.springRoll(p, dt);
    this.place(p);
  }

  /** Her kart in the air, then upside down on the run-off skidding to a stop, sparks off the asphalt. */
  private stepKartFlip(dt: number) {
    const f = this.finale!;
    const k = f.kart;
    if (k.still) return;
    const T = this.track;
    const restY = 0.58;
    if (!k.landed) {
      k.vel.y -= FINALE.g * dt;
      k.com.addScaledVector(k.vel, dt);
      k.roll += k.rollV * dt;
      k.yaw += k.yawV * dt;
      if (f.t > 0.42 && !f.thrown) this.throwJudy();
      if (k.com.y <= restY && k.vel.y < 0) {
        k.landed = true;
        k.com.y = restY;
        k.roll = f.side * 3 * Math.PI;
        k.vel.y = 0;
        k.yawV *= 0.6;
        this.sound?.play("kart-crash", 1);
        this.sparks(k.com.clone().setY(0.1), 26, new THREE.Vector3(k.vel.x, 2, k.vel.z).normalize());
        for (let n = 0; n < 8; n++) this.puffAt(k.com.x + (Math.random() - 0.5) * 2, k.com.z + (Math.random() - 0.5) * 2, 1.2);
        this.shake = 0.6;
      }
    } else {
      // On its back: friction, the spin dying, a scrape of sparks while it slides.
      const sp = Math.hypot(k.vel.x, k.vel.z);
      const ns = Math.max(0, sp - 8.5 * dt);
      if (sp > 0) {
        k.vel.x *= ns / sp;
        k.vel.z *= ns / sp;
      }
      k.com.addScaledVector(k.vel, dt);
      k.yawV *= Math.exp(-2.5 * dt);
      k.yaw += k.yawV * dt;
      k.com.y = restY + Math.max(0, Math.sin(f.t * 30) * 0.02 * Math.min(1, ns / 8));
      if (ns > 3 && Math.random() < 0.7) this.sparks(k.com.clone().setY(0.08), 2, new THREE.Vector3(-k.vel.x, 0.4, -k.vel.z).normalize());
      if (ns > 2 && Math.random() < 0.3) this.puffAt(k.com.x, k.com.z, 0.9);
      // The barrier stops it.
      const fr = T.frame(k.com.x, k.com.z, -1);
      if (Math.abs(fr.d) > ROAD.bound - 1.3) {
        const a = T.at(fr.s);
        const sd = Math.sign(fr.d);
        k.com.x = a.x + a.nx * sd * (ROAD.bound - 1.3);
        k.com.z = a.z + a.nz * sd * (ROAD.bound - 1.3);
        const into = k.vel.x * a.nx * sd + k.vel.z * a.nz * sd;
        if (into > 0) {
          k.vel.x -= a.nx * sd * into;
          k.vel.z -= a.nz * sd * into;
        }
      }
      if (ns < 0.05 && Math.abs(k.yawV) < 0.05) k.still = true;
    }
  }

  /** Puts her kart where the finale has it: a position at its middle and a roll about its own length. */
  private placeFlipped() {
    const f = this.finale!;
    const k = f.kart;
    const g = this.judy.model.group;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k.roll));
    g.quaternion.copy(q);
    g.position.copy(k.com).sub(new THREE.Vector3(0, 0.5, 0).applyQuaternion(q));
    this.judy.model.body.rotation.set(0, 0, 0);
    this.kartShadow.position.set(k.com.x, 0.03, k.com.z);
    const sh = 1 / (1 + Math.max(0, k.com.y - 0.5) * 0.5);
    this.kartShadow.scale.setScalar(sh);
    (this.kartShadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * sh;
  }

  /** Near the top of the flip she's thrown out: over the barrier, tumbling, onto the grass a few metres off. */
  private throwJudy() {
    const f = this.finale!;
    const fig = this.fig;
    const T = this.track;
    f.thrown = true;
    this.scene.attach(fig.root);
    const k = f.kart;
    const land = k.com
      .clone()
      .addScaledVector(k.vel, Math.max(0.2, f.fly - f.t))
      .setY(0);
    const fr = T.frame(land.x, land.z, -1);
    const a = T.at(fr.s);
    let target = new THREE.Vector3(a.x + a.nx * f.side * 18 + a.tx * 6, 0, a.z + a.nz * f.side * 18 + a.tz * 6);
    if (!this.open(target.x, target.z)) target = new THREE.Vector3(a.x + a.nx * f.side * 12.5 + a.tx * 6, 0, a.z + a.nz * f.side * 12.5 + a.tz * 6);
    const p0 = fig.root.position;
    const vy = 4.2;
    const g = FINALE.g;
    const dy = p0.y - fig.lieH;
    const tf = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, dy))) / g;
    f.fig.vel.set((target.x - p0.x) / tf, vy, (target.z - p0.z) / tf);
    f.fig.spin.set(a.tx * f.side * 7, 2.5, a.tz * f.side * 7);
    // How she lies: on her back, along the track, turned a little.
    const yaw = headingOf(a.tx, a.tz) + f.side * 0.5;
    f.fig.lieQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.figShadow.visible = true;
  }

  /** Her flight: a tumble, one bounce that turns her onto her back, and still. Then the arm. */
  private stepThrown(dt: number) {
    const f = this.finale!;
    if (!f.thrown) return;
    const fig = this.fig;
    const r = fig.root;
    const ff = f.fig;
    if (ff.landed < 2) {
      ff.vel.y -= FINALE.g * dt;
      r.position.addScaledVector(ff.vel, dt);
      if (ff.landed === 0) {
        const w = ff.spin.length();
        if (w > 0) r.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ff.spin.clone().divideScalar(w), w * dt));
      } else if (ff.from) r.quaternion.slerpQuaternions(ff.from, ff.lieQ, smooth((f.t - ff.fromAt) / 0.32));
      if (r.position.y <= fig.lieH && ff.vel.y < 0) {
        r.position.y = fig.lieH;
        this.puffAt(r.position.x, r.position.z, 1.4);
        this.puffAt(r.position.x + 0.5, r.position.z - 0.3, 1.1);
        if (ff.landed === 0) {
          ff.landed = 1;
          ff.vel.set(ff.vel.x * 0.35, 2.4, ff.vel.z * 0.35);
          ff.from = r.quaternion.clone();
          ff.fromAt = f.t;
          this.sound?.play("kart-land", 0.7, 0.8);
        } else {
          ff.landed = 2;
          ff.landAt = f.t;
          ff.vel.set(0, 0, 0);
          r.quaternion.copy(ff.lieQ);
          this.sound?.play("kart-land", 0.4, 0.7);
          f.stage = "down";
          f.stageAt = f.t;
        }
      }
    } else if (!f.arm.off && f.t - ff.landAt > 0.45) this.armOff();
    this.figShadow.position.set(r.position.x, 0.025, r.position.z);
    const sh = 1 / (1 + Math.max(0, r.position.y - fig.lieH) * 0.6);
    this.figShadow.scale.setScalar(sh * 1.1);
  }

  /**
   * Her arm comes off with a pop and bounces away (three hops and a slide)
   * to somewhere on the grass 12 to 25 m from her, within 25 m of where Sam
   * will stand and a slight turn from facing her.
   */
  private armOff() {
    const f = this.finale!;
    const fig = this.fig;
    const arm = fig.arm;
    f.arm.off = true;
    f.arm.at = f.t;
    arm.visible = true;
    this.scene.attach(arm);
    f.arm.scale.copy(arm.scale);
    for (const s of fig.stumps) s.visible = true;
    this.sound?.play("kart-pop", 1);
    this.cue("arm-off", "high");
    const judyAt = fig.root.position.clone().setY(0);
    const sam = this.standSpot(true);
    const toJudy = Math.atan2(-(judyAt.x - sam.x), -(judyAt.z - sam.z));
    // The rest spot: tried in order, the first that's open grass at the right distances.
    let rest: THREE.Vector3 | null = null;
    for (const off of [0.6, -0.6, 0.8, -0.8, 0.45, -0.45, 1.0, -1.0])
      for (const dist of [17, 14, 20, 11, 23]) {
        if (rest) break;
        const fw = forward(toJudy + off);
        const c = new THREE.Vector3(sam.x + fw.x * dist, 0, sam.z + fw.z * dist);
        const dj = c.distanceTo(judyAt);
        if (dj < 12 || dj > 25) continue;
        if (!this.open(c.x, c.z, ROAD.half + ROAD.curb + 1.5, 21)) continue;
        const T = this.track;
        const i = T.nearest(c.x, c.z, -1);
        if (Math.abs(Math.hypot(T.px[i] - c.x, T.pz[i] - c.z) - ROAD.bound) < 1) continue;
        rest = c;
      }
    if (!rest) {
      const fw = forward(toJudy + 0.5);
      rest = new THREE.Vector3(sam.x + fw.x * 14, 0, sam.z + fw.z * 14);
    }
    // How it lies: as it was on her, turned about the vertical.
    f.arm.restQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2.4).multiply(arm.quaternion);
    const s = f.arm.scale;
    let minY = Infinity;
    const b = fig.armBox;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) minY = Math.min(minY, new THREE.Vector3(x * s.x, y * s.y, z * s.z).applyQuaternion(f.arm.restQ).y);
    rest.y = -minY + 0.02;
    const from = arm.position.clone();
    const span = rest.clone().sub(from);
    const legs = [
      { k: 0.5, dur: 0.8, h: 1.5, spin: 11 },
      { k: 0.28, dur: 0.52, h: 0.6, spin: 7 },
      { k: 0.14, dur: 0.34, h: 0.22, spin: 3.5 },
      { k: 0.08, dur: 0.45, h: 0, spin: 0 },
    ];
    let at = from.clone();
    let sum = 0;
    f.arm.hops = legs.map((l, i) => {
      sum += l.k;
      const to = i === legs.length - 1 ? rest!.clone() : from.clone().addScaledVector(span, sum).setY(rest!.y);
      const hop = { from: at.clone(), to, dur: l.dur, h: l.h, spin: l.spin };
      at = to;
      return hop;
    });
    f.arm.hop = 0;
    f.arm.hopT = 0;
    f.arm.axis.set(span.z, 0, -span.x).normalize();
    this.glint.position.copy(rest).setY(0);
    this.armShadow.visible = true;
  }

  private stepArmHops(dt: number) {
    const f = this.finale!;
    const A = f.arm;
    if (!A.off || A.rest) return;
    const arm = this.fig.arm;
    const hop = A.hops[A.hop];
    A.hopT += dt;
    const u = Math.min(1, A.hopT / hop.dur);
    arm.position.lerpVectors(hop.from, hop.to, u);
    arm.position.y += 4 * hop.h * u * (1 - u);
    if (hop.spin > 0) arm.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(A.axis, hop.spin * dt));
    else {
      if (!A.slideFrom) A.slideFrom = arm.quaternion.clone();
      arm.quaternion.slerpQuaternions(A.slideFrom, A.restQ, smooth(u));
    }
    this.armShadow.position.set(arm.position.x, 0.02, arm.position.z);
    if (u >= 1) {
      this.puffAt(hop.to.x, hop.to.z, 0.5);
      if (hop.h > 0) this.sound?.play("kart-land", 0.25, 1.4);
      A.hop++;
      A.hopT = 0;
      if (A.hop >= A.hops.length) {
        A.rest = true;
        arm.position.copy(hop.to);
        arm.quaternion.copy(A.restQ);
      }
    }
  }

  /** Where Sam stands to get out: beside his kart on her side (where it will stop, if it's still rolling). */
  private standSpot(predict: boolean) {
    const p = this.player;
    const fw = forward(p.heading);
    const ahead = predict ? (p.v * p.v) / (2 * 13) : 0;
    const x = p.x + fw.x * ahead;
    const z = p.z + fw.z * ahead;
    const a = this.track.at(this.track.frame(x, z, p.hint).s);
    const side = this.finale?.side ?? 1;
    return new THREE.Vector3(x + a.nx * side * 1.7, 0, z + a.nz * side * 1.7);
  }

  /** Through Sam's eyes, standing beside his kart, facing her; the arm a slight turn away, glinting. */
  private onFoot() {
    const f = this.finale!;
    const p = this.player;
    p.v = 0;
    this.shove.x = this.shove.z = 0;
    const spot = this.standSpot(false);
    const judyAt = this.fig.root.position;
    f.sam.x = spot.x;
    f.sam.z = spot.z;
    f.sam.home.copy(spot);
    // The leash reaches her and the arm with room to spare.
    this.leash = Math.max(45, spot.distanceTo(judyAt.clone().setY(0)) + 15, spot.distanceTo(this.fig.arm.position.clone().setY(0)) + 15);
    f.sam.yaw = Math.atan2(-(judyAt.x - spot.x), -(judyAt.z - spot.z));
    f.sam.pitch = -0.08;
    f.sam.look = 0;
    f.stage = "search";
    f.stageAt = f.t;
    f.view = "fp";
    f.lastWait = this.clock - 4;
    p.model.driver.visible = false;
    this.glint.visible = true;
    this.setHud({ dark: 0, cinematic: false, firstPerson: true, objective: "Get Judy's arm", reach: "" });
  }

  /** On foot: walk and turn, pick the arm up, carry it to her, hold E to tape it on. */
  private stepOnFoot(dt: number) {
    const f = this.finale!;
    const sam = f.sam;
    const k = this.keys;
    let turn = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) turn += 1;
    if (k.has("KeyD") || k.has("ArrowRight")) turn -= 1;
    sam.yaw += turn * FINALE.turn * dt;
    let walk = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) walk += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) walk -= 0.6;
    const speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? FINALE.run : FINALE.walk) * walk;
    const fw = forward(sam.yaw);
    sam.x += fw.x * speed * dt;
    sam.z += fw.z * speed * dt;
    // A leash, so nobody wanders off into the trees.
    const off = new THREE.Vector3(sam.x - sam.home.x, 0, sam.z - sam.home.z);
    if (off.length() > this.leash) {
      off.setLength(this.leash);
      sam.x = sam.home.x + off.x;
      sam.z = sam.home.z + off.z;
    }
    sam.bob += Math.abs(speed) * dt * 2.2;
    const arm = this.fig.arm;
    const judyAt = this.fig.root.position;
    const toArm = Math.hypot(arm.position.x - sam.x, arm.position.z - sam.z);
    const toJudy = Math.hypot(judyAt.x - sam.x, judyAt.z - sam.z);
    // Looking down at whatever's close in front of him: the arm on the grass, or her.
    let want = -0.08;
    const near: Array<[THREE.Vector3, number]> = [[judyAt, toJudy]];
    if (!f.held) near.push([arm.position, toArm]);
    for (const [tgt, dist] of near) {
      const ang = Math.abs(wrapAngle(Math.atan2(-(tgt.x - sam.x), -(tgt.z - sam.z)) - sam.yaw));
      if (dist < 5 && ang < 1) want = Math.min(want, clamp(-Math.atan2(FINALE.eye - 0.2, Math.max(0.5, dist)) * 0.85, -0.95, -0.08));
    }
    sam.pitch += (want - sam.pitch) * Math.min(1, dt * 3);
    let reach = "";
    if (!f.held) {
      if (toArm <= FINALE.pick) reach = "Press E to pick up her arm";
    } else if (toJudy <= FINALE.tape) {
      if (!f.found) {
        f.found = true;
        this.cue("arm-found", "high");
      }
      reach = "Hold E to tape it on";
      if (k.has("KeyE")) {
        f.tape = Math.min(1, f.tape + dt / FINALE.tapeFor);
        this.sound?.tape(true);
        if (f.tape >= 1) return this.taped();
      } else this.sound?.tape(false);
    } else this.sound?.tape(false);
    const progress = f.held && toJudy <= FINALE.tape && (f.tape > 0 || k.has("KeyE")) ? Math.round(f.tape * 50) / 50 : null;
    if (reach !== this.hud.reach || progress !== this.hud.progress) this.setHud({ reach, progress });
    // While he looks: a line every ten seconds or so.
    if (!f.held && !this.speaking && !this.queue.length && this.clock - f.lastWait >= FINALE.waitEvery) this.cue("arm-wait", "high");
  }

  /** E on foot: picks the arm up when it's in reach; it goes to his right hand. */
  private interact() {
    const f = this.finale;
    if (!f || f.stage !== "search" || f.held || this.paused) return;
    const arm = this.fig.arm;
    if (Math.hypot(arm.position.x - f.sam.x, arm.position.z - f.sam.z) > FINALE.pick) return;
    f.held = true;
    this.glint.visible = false;
    this.armShadow.visible = false;
    this.camera.add(arm);
    arm.scale.copy(f.arm.scale);
    const dir = new THREE.Vector3(-0.5, 0.3, -1).normalize();
    arm.quaternion.setFromUnitVectors(this.fig.armAxis.clone().normalize(), dir);
    const c = this.fig.armBox.getCenter(new THREE.Vector3()).multiply(f.arm.scale).applyQuaternion(arm.quaternion);
    arm.position.set(0.34, -0.3, -0.78).sub(c);
    this.handRest.copy(arm.position);
    this.hand.visible = true;
    this.sound?.play("kart-land", 0.35, 1.6);
    this.setHud({ objective: "Tape it back on: hold E", reach: "" });
  }

  /** Taped: the arm snaps back on, the stump caps go, and the cut scene takes over again. */
  private taped() {
    const f = this.finale!;
    const fig = this.fig;
    this.sound?.tape(false);
    this.sound?.play("kart-pop", 0.8, 0.8);
    const arm = fig.arm;
    fig.home.parent.add(arm);
    arm.position.copy(fig.home.pos);
    arm.quaternion.copy(fig.home.quat);
    arm.scale.copy(fig.home.scale);
    if (fig.isModel && fig.stumps.length === 0) arm.visible = false;
    for (const s of fig.stumps) s.visible = false;
    this.hand.visible = false;
    this.releasePointer();
    f.stage = "getin";
    f.stageAt = f.t;
    f.view = "cine";
    // The camera steps back from where Sam stood, looking at her and her kart.
    const eye = new THREE.Vector3(f.sam.x, 0, f.sam.z);
    const mid = fig.root.position.clone().setY(0).lerp(f.kart.com.clone().setY(0), 0.5);
    const back = eye.clone().sub(mid).setY(0).normalize();
    f.camPos
      .copy(mid)
      .addScaledVector(back, Math.max(7, eye.distanceTo(mid) + 2.5))
      .add(new THREE.Vector3(back.z * 2, 1.9, -back.x * 2));
    f.camLook.copy(mid).setY(0.7);
    f.camFov = 52;
    const kart = f.kart.com.clone().setY(0);
    const r = fig.root;
    const yaw = Math.atan2(-(kart.x - r.position.x), -(kart.z - r.position.z));
    // She runs to beside her kart (over the barrier if it's in the way), then jumps in.
    const from = r.position.clone().setY(0);
    const runTo = kart.clone().add(from.clone().sub(kart).setLength(1.4));
    const run = from.distanceTo(runTo);
    let hurdle = -1;
    const T = this.track;
    let prev = Math.abs(T.frame(from.x, from.z, -1).d) - ROAD.bound;
    for (let i = 1; i <= 24; i++) {
      const q = from.clone().lerp(runTo, i / 24);
      const now = Math.abs(T.frame(q.x, q.z, -1).d) - ROAD.bound;
      if (Math.sign(now) !== Math.sign(prev)) {
        hurdle = (i - 0.5) / 24;
        break;
      }
      prev = now;
    }
    f.getin = {
      lieP: r.position.clone(),
      lieQ: r.quaternion.clone(),
      standQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      roll0: f.kart.roll,
      jumpFrom: null,
      jumpQ: null,
      seated: false,
      upright: false,
      music: false,
      runTo,
      jumpAt: 0.7 + Math.max(0.4, run / 5.5),
      hurdle,
    };
    this.setHud({ firstPerson: false, cinematic: true, objective: "", reach: "", progress: null });
    // "Tighter!" is done with once it's on: her next line comes now.
    if (this.speaking?.cue === "arm-found" || this.speaking?.cue === "arm-wait") this.stopLine();
    this.queue.length = 0;
    this.cue("taped", "high");
  }

  /** She gets up, runs to her kart (hurdling the barrier) as it rolls back onto its wheels, and jumps in. */
  private stepGetIn(dt: number) {
    const f = this.finale!;
    const G = f.getin!;
    const fig = this.fig;
    const r = fig.root;
    const g = f.t - f.stageAt;
    const k = f.kart;
    if (!G.jumpFrom) {
      if (g < 0.7) {
        // Up off the grass.
        const u = smooth(g / 0.7);
        r.quaternion.slerpQuaternions(G.lieQ, G.standQ, u);
        r.position.set(G.lieP.x, fig.lieH + (fig.standH - fig.lieH) * u + 0.3 * Math.sin(Math.PI * Math.min(1, g / 0.7)), G.lieP.z);
      } else {
        // Running, with a bob in her step and a hop over the barrier.
        const u = clamp((g - 0.7) / (G.jumpAt - 0.7), 0, 1);
        r.quaternion.copy(G.standQ);
        const p = new THREE.Vector3(G.lieP.x, 0, G.lieP.z).lerp(G.runTo, u);
        let y = fig.standH + Math.abs(Math.sin(g * 14)) * 0.07;
        const w = 0.16;
        if (G.hurdle >= 0 && Math.abs(u - G.hurdle) < w) y += 0.95 * Math.cos(((u - G.hurdle) / w) * (Math.PI / 2));
        r.position.set(p.x, y, p.z);
        if (Math.random() < 0.15) this.puffAt(p.x, p.z, 0.35);
      }
      this.figShadow.position.set(r.position.x, 0.025, r.position.z);
    }
    // The kart rolls back over.
    if (g >= 0.55 && !G.upright) {
      const u = Math.min(1, (g - 0.55) / 0.8);
      k.roll = G.roll0 + f.side * Math.PI * smooth(u);
      k.com.y = 0.58 + (0.5 - 0.58) * u + 1.3 * Math.sin(Math.PI * u);
      if (u >= 1) {
        G.upright = true;
        k.roll = 0;
        k.com.y = 0.5;
        this.sound?.play("kart-land", 0.8);
        this.puffAt(k.com.x, k.com.z, 1.3);
      }
    }
    // In.
    if (g >= G.jumpAt && !G.seated) {
      if (!G.jumpFrom) {
        G.jumpFrom = r.position.clone();
        G.jumpQ = r.quaternion.clone();
        if (!G.music) {
          G.music = true;
          this.musicTo(this.activeMusic(), this.raceLevel(), 1.5);
        }
      }
      const u = Math.min(1, (g - G.jumpAt) / 0.55);
      const body = this.judy.model.body;
      body.updateMatrixWorld(true);
      const seat = body.localToWorld(fig.seat.clone());
      const seatQ = body.getWorldQuaternion(new THREE.Quaternion());
      r.position.lerpVectors(G.jumpFrom, seat, smooth(u));
      r.position.y += 1.0 * Math.sin(Math.PI * u);
      r.quaternion.slerpQuaternions(G.jumpQ!, seatQ, smooth(u));
      this.figShadow.position.set(r.position.x, 0.025, r.position.z);
      if (u >= 1) {
        G.seated = true;
        body.add(r);
        r.position.copy(fig.seat);
        r.quaternion.identity();
        this.figShadow.visible = false;
        this.sound?.play("kart-land", 0.5, 1.2);
        // From here she's a kart again.
        const j = this.judy;
        j.x = k.com.x;
        j.z = k.com.z;
        j.y = 0;
        j.vy = 0;
        j.grounded = true;
        j.heading = k.yaw;
        j.dir = k.yaw;
        j.v = 0;
        j.roll = 0;
        j.rollV = 0;
        this.kartShadow.visible = false;
        j.model.shadow.visible = true;
        f.stage = "drive";
        f.stageAt = f.t;
      }
    }
    f.camLook.lerp(fig.root.position.clone().lerp(k.com, 0.4).setY(0.8), Math.min(1, dt * 2));
  }

  /** Wheelspin off the run-off and onto the road, fishtailing with joy. */
  private stepDriveOff(dt: number) {
    const f = this.finale!;
    const j = this.judy;
    const T = this.track;
    const h = f.t - f.stageAt;
    j.v = Math.min(24, j.v + 11 * dt);
    const fr = T.frame(j.x, j.z, -1);
    const aim = T.at(fr.s + 24);
    const want = Math.atan2(-(aim.x - j.x), -(aim.z - j.z));
    j.dir += clamp(wrapAngle(want - j.dir), -2.4 * dt, 2.4 * dt);
    const wobble = 0.38 * Math.sin(h * 9) * Math.exp(-h * 0.7);
    j.heading = j.dir + wobble;
    const fw = forward(j.dir);
    j.x += fw.x * j.v * dt;
    j.z += fw.z * j.v * dt;
    j.steer = clamp(-wobble * 3, -1, 1);
    j.wheelSpin += (j.v / 0.3 + 25) * dt;
    if (Math.random() < 0.6) this.puff(j, 1);
    this.place(j);
    f.camLook.lerp(new THREE.Vector3(j.x, 0.8, j.z), Math.min(1, dt * 3));
    if (h > 1.8) {
      // Cut to the line: she's put on the straight, a few seconds out.
      const L = T.length;
      f.stage = "line";
      f.stageAt = f.t;
      j.s = LAPS * L - 72;
      j.d = 1.5;
      j.v = 24;
      const a = T.at(j.s);
      j.x = a.x + a.nx * j.d;
      j.z = a.z + a.nz * j.d;
      j.heading = j.dir = headingOf(a.tx, a.tz);
      const line = T.at(0);
      f.camPos.set(line.x + line.nx * 11 - line.tx * 5, 1.25, line.z + line.nz * 11 - line.tz * 5);
      f.camLook.set(j.x, 0.9, j.z);
      f.camFov = 24;
      this.place(j);
    }
  }

  /** Down the straight and over the line: the finish, her laugh, her win. */
  private stepToLine(dt: number) {
    const f = this.finale!;
    const j = this.judy;
    const T = this.track;
    const h = f.t - f.stageAt;
    j.v = f.crossed ? Math.max(14, j.v - 6 * dt) : Math.min(36, j.v + 4 * dt);
    j.s += j.v * dt;
    j.d = 1.5 + 2.2 * Math.sin(h * 2.6) * (f.crossed ? 0.4 : 1);
    const a = T.at(j.s);
    j.x = a.x + a.nx * j.d;
    j.z = a.z + a.nz * j.d;
    const base = headingOf(a.tx, a.tz) - Math.cos(h * 2.6) * 0.12;
    j.dir = base;
    j.heading = base + 0.3 * Math.sin(h * 7.5) * (f.crossed ? 0.3 : 1);
    j.steer = clamp(Math.sin(h * 7.5) * -1.2, -1, 1);
    j.hint = a.i;
    j.wheelSpin += (j.v / 0.3) * dt;
    if (Math.random() < 0.25) this.puff(j, 1);
    this.place(j);
    f.camLook.lerp(new THREE.Vector3(j.x, 0.9, j.z), Math.min(1, dt * 9));
    // A long lens on her down the straight, opening out as she comes past.
    const dist = f.camPos.distanceTo(new THREE.Vector3(j.x, 1, j.z));
    f.camFov = clamp((2 * Math.atan(5.5 / Math.max(1, dist)) * 180) / Math.PI, 22, 58);
    if (!f.crossed && j.s >= LAPS * T.length) {
      f.crossed = true;
      f.crossedAt = this.clock;
      f.stage = "over";
      this.sound?.play("kart-finish");
      this.setPhase("finished");
      this.setHud({ result: { time: Math.round(this.time * 10) / 10 }, lap: LAPS, position: 2 });
      this.cue("laugh", "high");
      this.cue("judy-wins", "high");
      // Without her last line (no script), the hand-over still comes.
      const hasLast = !!this.opts.judy?.lines.some((l) => l.cue === "judy-wins");
      this.after(hasLast ? 25 : 4, () => this.goSign());
    }
  }

  /** The finale's camera: fixed or tracking in the cut scenes, Sam's eyes on foot. */
  private finaleCamera(dt: number) {
    const f = this.finale!;
    if (f.view === "fp") {
      const s = f.sam;
      const bob = Math.sin(s.bob * 2) * 0.035;
      this.camera.position.set(s.x, FINALE.eye + bob, s.z);
      this.camera.rotation.set(s.pitch + s.look, s.yaw, 0, "YXZ");
      this.wantFov = 72;
      // His hand sways as he walks; it shakes while he tapes.
      if (f.held) {
        const arm = this.fig.arm;
        const taping = this.keys.has("KeyE") && this.hud.progress !== null;
        const jig = taping ? 0.012 : 0;
        arm.position.set(this.handRest.x + Math.sin(s.bob) * 0.015 + (Math.random() - 0.5) * jig, this.handRest.y + Math.abs(Math.cos(s.bob)) * 0.012 + (Math.random() - 0.5) * jig, this.handRest.z);
      }
      return;
    }
    if (f.stage === "down" && f.arm.off) {
      // Her on the grass in the foreground, side on, the arm bouncing away beyond her.
      const J = this.fig.root.position.clone().setY(0);
      const A = this.fig.arm.position.clone().setY(0);
      const head = new THREE.Vector3(0, 1, 0).applyQuaternion(f.fig.lieQ).setY(0).normalize();
      const across = new THREE.Vector3(head.z, 0, -head.x);
      if (across.dot(A.clone().sub(J)) > 0) across.negate();
      const away = J.clone().sub(A).normalize();
      const want = J.clone()
        .addScaledVector(across, 3.6)
        .addScaledVector(away, 1.6)
        .add(new THREE.Vector3(0, 1.5, 0));
      f.camPos.lerp(want, Math.min(1, dt * 1.4));
      f.camLook.lerp(J.clone().lerp(A, 0.3).setY(0.3), Math.min(1, dt * 2.5));
      f.camFov = 54;
    } else if (f.stage === "flip" || f.stage === "down") {
      f.camLook.lerp(f.kart.com, Math.min(1, dt * 7));
    }
    this.camera.position.copy(f.camPos);
    this.camera.lookAt(f.camLook);
    this.wantFov = f.camFov;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  /** Puts a kart's model where the driver is, leaning into the slide (and rolling off a hit). */
  private place(k: Driver) {
    const g = k.model.group;
    g.position.set(k.x, k.y, k.z);
    g.rotation.set(0, k.heading, 0);
    const slip = wrapAngle(k.heading - k.dir);
    k.model.body.rotation.z = clamp(-slip * 0.6 - k.steer * Math.abs(k.v) * 0.004, -0.22, 0.22) + k.roll;
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
      const f = forward(k.heading);
      const side = n % 2 ? 0.7 : -0.7;
      this.addDust(k.x - f.x * 0.9 + f.z * side, 0.25, k.z - f.z * 0.9 - f.x * side, -f.x * 3 + (Math.random() - 0.5) * 2, -f.z * 3 + (Math.random() - 0.5) * 2, 0.5);
    }
  }

  /** A puff of dust off the ground at a point (a landing, a bounce). */
  private puffAt(x: number, z: number, size: number) {
    for (let n = 0; n < 3; n++) {
      const a = Math.random() * Math.PI * 2;
      this.addDust(x + Math.cos(a) * 0.3, 0.2, z + Math.sin(a) * 0.3, Math.cos(a) * 2.2 * size, Math.sin(a) * 2.2 * size, 0.5 * size);
    }
  }

  private addDust(x: number, y: number, z: number, vx: number, vz: number, size: number) {
    if (this.dust.length >= 80) {
      const old = this.dust.shift()!;
      this.scene.remove(old.sprite);
    }
    const sprite = new THREE.Sprite(this.dustMat);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size);
    this.scene.add(sprite);
    this.dust.push({ sprite, vx, vz, life: 0.7, size });
  }

  /** Sparks: hot specks flung off a point, mostly along `dir`, falling as they fade. */
  private sparks(at: THREE.Vector3, count: number, dir: THREE.Vector3) {
    for (let n = 0; n < count; n++) {
      if (this.sparkList.length >= 90) {
        const old = this.sparkList.shift()!;
        this.scene.remove(old.sprite);
      }
      const sprite = new THREE.Sprite(this.sparkMat);
      sprite.position.copy(at);
      sprite.scale.setScalar(0.25 + Math.random() * 0.2);
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4 + 1, (Math.random() - 0.5) * 6).addScaledVector(dir, 5 + Math.random() * 4);
      const life = 0.3 + Math.random() * 0.35;
      this.scene.add(sprite);
      this.sparkList.push({ sprite, v, life, max: life });
    }
  }

  private animate(dt: number) {
    const p = this.player;
    const f = this.finale;
    // Particles keep the finale's slow motion.
    const pdt = dt * (f?.scale ?? 1);
    // The camera: chasing him, or the finale's.
    if (f && f.view !== "chase") this.finaleCamera(pdt);
    else {
      this.placeCamera(false, dt);
      const boosting = this.clock < this.boostUntil && this.phase === "racing";
      this.wantFov = 68 + (boosting ? 10 : 0) + clamp(p.v / KART.top, 0, 1) * 5;
    }
    if (import.meta.env.DEV && this.devCam) {
      this.camera.position.copy(this.devCam.pos);
      this.camera.lookAt(this.devCam.look);
      this.wantFov = this.devCam.fov;
    }
    // A hit jolts the picture for a moment.
    if (this.shake > 0 && f?.view !== "fp") {
      const k = this.shake * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * k;
      this.camera.rotateZ((Math.random() - 0.5) * k * 0.08);
    }
    this.shake = Math.max(0, this.shake - pdt);
    // Boost: the pipe flames.
    const boosting = this.clock < this.boostUntil && this.phase === "racing";
    p.model.flame.visible = boosting;
    if (boosting) p.model.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    // A cut changes the lens at once; otherwise it eases.
    const cut = !!f && f.view !== "chase" && f.lens !== f.stage + f.view;
    if (f) f.lens = f.stage + f.view;
    this.fov += (this.wantFov - this.fov) * (cut ? 1 : Math.min(1, dt * (f?.stage === "line" || f?.stage === "over" ? 12 : 4)));
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // Dust.
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= pdt;
      d.sprite.position.x += d.vx * pdt;
      d.sprite.position.z += d.vz * pdt;
      d.sprite.position.y += 0.6 * pdt;
      d.sprite.scale.setScalar(d.size + (0.7 - d.life) * 2.2 * (d.size / 0.5));
      if (d.life <= 0) {
        this.scene.remove(d.sprite);
        this.dust.splice(i, 1);
      }
    }
    // Sparks.
    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const sp = this.sparkList[i];
      sp.life -= pdt;
      sp.v.y -= 14 * pdt;
      sp.sprite.position.addScaledVector(sp.v, pdt);
      if (sp.sprite.position.y < 0.03) {
        sp.sprite.position.y = 0.03;
        sp.v.y *= -0.3;
        sp.v.x *= 0.6;
        sp.v.z *= 0.6;
      }
      sp.sprite.material.opacity = 1;
      sp.sprite.scale.setScalar(Math.max(0.04, (sp.life / sp.max) * 0.42));
      if (sp.life <= 0) {
        this.scene.remove(sp.sprite);
        this.sparkList.splice(i, 1);
      }
    }
    // The glint over the arm: a slow pulse and sparkles circling.
    if (this.glint.visible) {
      const t = this.clock;
      const glow = this.glint.getObjectByName("glow") as THREE.Sprite;
      // Bold from afar, soft up close (it's an arm on the grass, not a bonfire).
      const near = clamp((this.camera.position.distanceTo(this.glint.position) - 2) / 8, 0, 1);
      glow.scale.setScalar((0.45 + 0.65 * near) * (1.0 + Math.sin(t * 4) * 0.25));
      glow.material.opacity = 0.55 + 0.45 * near;
      const beam = this.glint.children[1] as THREE.Mesh;
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.16 * near;
      let n = 0;
      for (const c of this.glint.children)
        if (c.name === "twinkle") {
          const a = t * 1.6 + n * 0.9;
          const r = 0.35 + 0.15 * Math.sin(t * 2 + n);
          c.position.set(Math.cos(a) * r, 0.35 + ((t * 0.6 + n * 0.37) % 1.2), Math.sin(a) * r);
          c.scale.setScalar(0.08 + 0.16 * Math.max(0, Math.sin(t * 6 + n * 2.1)));
          n++;
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
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    this.jobs.length = 0;
    this.lineToken++;
    this.releasePointer();
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
    this.dustMat.dispose();
    this.sparkMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (import.meta.env.DEV) delete (window as unknown as { __kartRace?: KartRace }).__kartRace;
  }
}

// ── Judy's arm ────────────────────────────────────────────────────────────

/**
 * Her right arm in the Meshy model (judy-mvznyt6x.glb: one mesh, 1.9 units
 * tall, centred, facing +z, hands clasped in front), as a polyline from the
 * shoulder through the elbow and wrist to the hand, with a radius per
 * segment. Measured from the model's vertices and checked in renders; in
 * units of its height, so a rescaled export still splits.
 */
const ARM_LINE: Array<[number, number, number]> = [
  [-0.2, 0.52, -0.1],
  [-0.23, 0.21, -0.055],
  [-0.13, 0.09, 0.12],
  [-0.06, 0.04, 0.17],
];
const ARM_RADII = [0.085, 0.08, 0.075];

/**
 * Splits a mesh's triangles into her body and her right arm: a triangle is
 * the arm's when its centroid is within the arm's radius of the polyline, on
 * the arm's side of the torso (outside the shoulder width for the upper arm,
 * left of the clasped hands for the forearm), and its normal faces away from
 * the arm's axis (so the torso's own surface under the arm stays). Returns
 * null when the share of triangles is implausible (a different model).
 */
export function splitArm(
  pos: ArrayLike<number>,
  nor: ArrayLike<number>,
  index: ArrayLike<number>,
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): { body: Uint32Array; arm: Uint32Array; pivot: THREE.Vector3; box: THREE.Box3; axis: THREE.Vector3; unit: number } | null {
  const h = bounds.max.y - bounds.min.y;
  if (!(h > 0)) return null;
  const u = h / 1.903;
  const cx0 = (bounds.min.x + bounds.max.x) / 2;
  const cy0 = (bounds.min.y + bounds.max.y) / 2;
  const cz0 = (bounds.min.z + bounds.max.z) / 2;
  const P = ARM_LINE.map(([x, y, z]) => [cx0 + x * u, cy0 + y * u, cz0 + z * u]);
  const R = ARM_RADII.map((r) => r * u);
  const shoulderX = cx0 - 0.14 * u;
  const handX = cx0 - 0.035 * u;
  const tris = index.length / 3;
  const body: number[] = [];
  const arm: number[] = [];
  for (let t = 0; t < tris; t++) {
    const a = index[t * 3];
    const b = index[t * 3 + 1];
    const c = index[t * 3 + 2];
    const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const z = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    let inArm = false;
    if (x < handX) {
      let best = Infinity;
      let seg = -1;
      let rx = 0;
      let ry = 0;
      let rz = 0;
      for (let i = 0; i < 3; i++) {
        const [ax, ay, az] = P[i];
        const [bx, by, bz] = P[i + 1];
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const apx = x - ax;
        const apy = y - ay;
        const apz = z - az;
        const f = clamp((abx * apx + aby * apy + abz * apz) / (abx * abx + aby * aby + abz * abz), 0, 1);
        const vx = apx - abx * f;
        const vy = apy - aby * f;
        const vz = apz - abz * f;
        const d = Math.hypot(vx, vy, vz) / R[i];
        if (d < best) {
          best = d;
          seg = i;
          rx = vx;
          ry = vy;
          rz = vz;
        }
      }
      if (best <= 1 && !(seg === 0 && x > shoulderX)) {
        const nx = nor[a * 3] + nor[b * 3] + nor[c * 3];
        const ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1];
        const nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
        const facing = (nx * rx + ny * ry + nz * rz) / ((Math.hypot(nx, ny, nz) || 1) * (Math.hypot(rx, ry, rz) || 1));
        inArm = !(facing < -0.2 && best > 0.35);
      }
    }
    (inArm ? arm : body).push(a, b, c);
  }
  const share = arm.length / index.length;
  if (share < 0.01 || share > 0.2) return null;
  const pivot = new THREE.Vector3(P[0][0], P[0][1], P[0][2]);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < arm.length; i++) {
    const k = arm[i];
    box.expandByPoint(v.set(pos[k * 3] - pivot.x, pos[k * 3 + 1] - pivot.y, pos[k * 3 + 2] - pivot.z));
  }
  const axis = new THREE.Vector3(P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]).normalize();
  return { body: Uint32Array.from(body), arm: Uint32Array.from(arm), pivot, box, axis, unit: u };
}

// ── Sound ──────────────────────────────────────────────────────────────────

/**
 * The race's sounds. Each has a synthesized version, so the game is whole
 * without files; a file named in the manifest plays instead (decoded into
 * the audio context, so it can change pitch and pauses with it). The engine
 * is a loop whose pitch and volume follow the speed (through four "gears").
 * A hit layers the bump file with a synthesized metal crunch, both pitched a
 * little differently every time; the tape is a loop of ripping noise while E
 * is held.
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
  private readonly buffers: Partial<Record<string, AudioBuffer>> = {};
  private engineLevel = 0;
  private taping = false;
  private tapeAt = 0;
  private tapeLoop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

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
      void this.loadBuffer(key, url);
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

  /** A sound file decoded into the context; until then (or if it can't be) the <audio> element plays it. */
  private async loadBuffer(key: string, url: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      this.buffers[key] = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* the element plays it */
    }
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
    this.tape(false);
  }

  /** Paused: the context stops, and with it anything still ringing. */
  sleep() {
    void this.ctx.suspend().catch(() => {});
  }

  wake() {
    void this.ctx.resume().catch(() => {});
  }

  /** A hit: the bump (the file, or its stand-in) and a metal crunch, each pitched within 15% either way. */
  hit() {
    const r = () => 0.85 + Math.random() * 0.3;
    this.play("kart-bump", 0.85, r());
    this.crunch(r());
  }

  /** A short synthesized crunch of metal: a knock, a rattle of bent panel, a scrape. */
  crunch(rate: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(this.master);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = rate;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 * rate;
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.7, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.3);
    for (const [f, d, v] of [
      [233, 0.18, 0.22],
      [367, 0.14, 0.16],
      [541, 0.1, 0.12],
      [810, 0.07, 0.08],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f * rate, t);
      o.frequency.exponentialRampToValueAtTime(f * rate * 0.82, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.02);
    }
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(110 * rate, t);
    thump.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    thump.connect(tg).connect(out);
    thump.start(t);
    thump.stop(t + 0.2);
  }

  /** The duct tape while E is held: the file on a loop, or bursts of ripping noise. */
  tape(on: boolean) {
    if (on === this.taping) return;
    this.taping = on;
    const buf = this.buffers["kart-tape"];
    if (on && buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.8;
      src.connect(gain).connect(this.master);
      src.start();
      this.tapeLoop = { src, gain };
    } else if (!on && this.tapeLoop) {
      const { src, gain } = this.tapeLoop;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      src.stop(this.ctx.currentTime + 0.15);
      this.tapeLoop = null;
    }
    if (on && !buf) this.tapeAt = 0;
  }

  /** Each step: the next rip of the synthesized tape, while it's on. */
  tick(dt: number) {
    if (!this.taping || this.tapeLoop) return;
    this.tapeAt -= dt;
    if (this.tapeAt > 0) return;
    const dur = 0.09 + Math.random() * 0.16;
    this.tapeAt = dur + 0.02 + Math.random() * 0.08;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.9 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(1800 + Math.random() * 800, t);
    bp.frequency.linearRampToValueAtTime(3600 + Math.random() * 1400, t + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    // The rip's rasp: a fast tremolo on the gain.
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const trem = ctx.createOscillator();
    trem.frequency.value = 55 + Math.random() * 40;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    const tg = ctx.createGain();
    tg.gain.value = 0.6;
    trem.connect(depth).connect(tg.gain);
    n.connect(bp).connect(hp).connect(g).connect(tg).connect(this.master);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.05);
    trem.start(t);
    trem.stop(t + dur + 0.05);
  }

  play(key: KartSoundKey, volume = 0.8, rate = 1) {
    const buf = this.buffers[key];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    const file = this.files[key];
    if (file) {
      try {
        file.volume = clamp(volume, 0, 1);
        file.playbackRate = rate;
        file.preservesPitch = false;
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
        tone("sine", 95 * rate, 40, 0, 0.2, 0.5 * volume);
        burst(0, 0.08, 900 * rate, 0.3 * volume);
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
        burst(0, 0.12, 700 * rate, 0.4 * volume);
        tone("sine", 130 * rate, 50, 0, 0.16, 0.4 * volume);
        break;
      case "kart-crash":
        // A big one: the impact, a long grinding tail, panels clanging, and a second smaller crunch.
        burst(0, 0.9, 1300, 0.6 * volume);
        burst(0.02, 0.35, 4200, 0.25 * volume);
        tone("sine", 80, 28, 0, 0.5, 0.7 * volume);
        [311, 457, 683, 1021].forEach((f, i) => tone("square", f, f * 0.7, 0.01 + i * 0.03, 0.35, 0.07 * volume));
        burst(0.16, 0.3, 900, 0.35 * volume);
        tone("triangle", 190, 120, 0.17, 0.25, 0.2 * volume);
        break;
      case "kart-pop":
        // A cork out of a bottle: a click and a quick upward blip.
        burst(0, 0.025, 6000, 0.5 * volume);
        tone("sine", 520 * rate, 1500 * rate, 0, 0.09, 0.45 * volume);
        tone("sine", 260 * rate, 160 * rate, 0.02, 0.12, 0.25 * volume);
        break;
      case "kart-tape":
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
      this.tapeLoop?.src.stop();
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

/** A spark: a white-hot core in a warm halo (tinted by its material). */
function sparkTexture(): THREE.Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,240,200,0.95)");
  g.addColorStop(0.45, "rgba(255,190,90,0.35)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
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
