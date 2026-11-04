// The "Anything Is Possible" signing game (three.js). The signer wakes on a
// small island floating in the sky. The movie theater stands on a bigger
// island in the distance, and the only way across is a chain of floating
// blocks (fall and you're back at your last island). Inside: a lobby, a
// full-size auditorium with the seat that has their name on it, the film on
// the screen with the lights down (its sound put through a theater's reverb),
// and when it ends the door beside the screen swings open onto a courtyard
// where a staircase spirals up into the sky. The contract waits on a cloud at
// the top; reaching it hands over to the signing page.
//
// The look leans realistic: generated high-resolution textures (grass, stone,
// wood, brick, velvet), soft sun shadows, filmic tone mapping, a sky dome and
// rounded clouds. Any prop named in /game/manifest.json ("models") is loaded
// as a GLB and takes the placeholder's place, Judy included.
// index.tsx wraps this in React and draws the HUD from `onHud`.
import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Manifest = {
  movie: string | null;
  youtube: string | null;
  music: string | null;
  /**
   * When the song comes in during the film: at `at` seconds into the film it
   * starts from `from` seconds into the track, easing in over `fadeIn`
   * seconds, and then plays on through the exit and the climb. Without a cue
   * it comes in when the signer stands up.
   */
  musicCue?: { at: number; from: number; fadeIn: number } | null;
  sounds: Partial<Record<"door" | "sit" | "sign" | "jump" | "land" | "fall" | "step" | "cheer", string | null>>;
  models: Partial<Record<"seat" | "plant" | "popcorn" | "judy", string>>;
  /** Judy's voiced lines by line id (public/game/judy.json), from scripts/game-judy.mjs. */
  voice: Partial<Record<string, string>>;
};

/** Judy's script (public/game/judy.json): a greeting, rounds of three replies each with her answer, and the ticket. */
export type JudyLine = { id: string; text: string };
export type JudyScript = {
  name: string;
  greeting: JudyLine;
  rounds: Array<{ options: Array<{ sam: string; judy: JudyLine }>; core: JudyLine }>;
  final: JudyLine;
  /** Lines said elsewhere: "pa" comes over the theater's speakers during the film. */
  extras?: Record<string, JudyLine>;
};

/** The film's name, on the marquee, the poster, the ticket. */
export const FILM_TITLE = "Sam Signs the Operating Agreement";

export const EMPTY_MANIFEST: Manifest = { movie: null, youtube: "LnVy5ZEcbH0", music: null, musicCue: null, sounds: {}, models: {}, voice: {} };

/** Where the signer is in the story. */
export type Phase = "intro" | "outside" | "talk" | "lobby" | "theater" | "seated" | "movie" | "ended" | "exit" | "done";

export type Hud = {
  phase: Phase;
  /** What to do next, shown at the bottom of the screen; "" for nothing. */
  prompt: string;
  /** The mouse got free while walking (Escape): a click takes it back. */
  paused: boolean;
  /** The browser wouldn't start the film on its own; a click will. */
  needsClick: boolean;
  /** 0..1 black over everything (the fade into the signing page). */
  dark: number;
  /** Frames a second, over the last half second (the preview shows it). */
  fps: number;
  /** What to head for next, shown small at the top; "" between objectives. */
  objective: string;
  /** Talking to Judy at the booth: who's speaking, the subtitle, and the replies on offer. */
  dialogue: { speaker: string; text: string; options: string[] | null } | null;
  /** The ticket Judy handed over. */
  ticket: boolean;
};

export type GameOptions = {
  signerName: string;
  title: string;
  manifest: Manifest;
  /** Judy's lines; without them the booth just hands over the ticket. */
  judy: JudyScript | null;
  onHud: (hud: Hud) => void;
  /** The desk was reached: show the signing page. */
  onDone: () => void;
};

type Box = { min: THREE.Vector3; max: THREE.Vector3 };

/** The material for walls, floors and props: lit per pixel but far cheaper than a physical material, which only the gold and the models need. */
const surface = (map: THREE.Texture, extra: { color?: number; transparent?: boolean; opacity?: number } = {}) => new THREE.MeshPhongMaterial({ map, shininess: 6, specular: 0x141414, ...extra });
const flat = (color: number, extra: { transparent?: boolean; opacity?: number } = {}) => new THREE.MeshPhongMaterial({ color, shininess: 6, specular: 0x141414, ...extra });

// ── Layout (meters; y up; the start island is at the origin, the theater far down -z) ──
/** The island you wake on: its top is y = 0. */
const START = { half: 7 };
/** The theater's island: far enough that the blocks take about twenty seconds at a walk. */
const ISLAND = { x0: -30, x1: 30, z1: -90, z0: -90 - 74 };
/** The building: interior width, front doors at z1, screen wall at z0. */
const BLDG = { halfW: 13, z1: ISLAND.z1 - 14, z0: ISLAND.z1 - 66, height: 11 };
const LOBBY = { z0: BLDG.z1 - 12, z1: BLDG.z1, height: 5 };
const ROWS = 12;
const ROW_STEP = 0.3;
const ROW_Z = (r: number) => LOBBY.z0 - 6 - 2.2 * r;
const ROW_FLOOR = (r: number) => -ROW_STEP * r;
const FRONT_FLOOR = ROW_FLOOR(ROWS - 1);
const SEATS_PER_SIDE = 7;
const SEAT_X = (side: -1 | 1, k: number) => side * (1.6 + 1.1 * k);
/** The signer's seat: second row from the front, on the aisle. */
const RESERVED = { row: ROWS - 2, side: 1 as const, k: 0 };
const SCREEN = { w: 20, h: 11.25, z: BLDG.z0 + 0.2, y: FRONT_FLOOR + 1.2 + 11.25 / 2 };
const DOOR = { x: BLDG.halfW, z0: BLDG.z0 + 2.8, z1: BLDG.z0 + 4.2, h: 2.4 };
/** The sunken courtyard outside the exit door, where the staircase begins. */
const COURT = { x0: BLDG.halfW, x1: BLDG.halfW + 6, z0: BLDG.z0 + 2, z1: BLDG.z0 + 12 };
/** The spiral staircase: centre, radius, where it starts, how far each step rises and turns. */
const STAIR = { cx: BLDG.halfW + 11, cz: (DOOR.z0 + DOOR.z1) / 2, r: 10, steps: 64, rise: 0.4, turn: 0.11, size: 1.4 };
/** Step i's centre and top: the spiral starts at the door and winds up around a point out in the sky. */
const STEP_ANGLE = (i: number) => Math.PI - i * STAIR.turn;
const STEP_POS = (i: number) => {
  const a = STEP_ANGLE(i);
  return { x: STAIR.cx + STAIR.r * Math.cos(a), y: FRONT_FLOOR + 0.4 + i * STAIR.rise, z: STAIR.cz + STAIR.r * Math.sin(a) };
};
/** The cloud at the top, just beyond the last step, where the contract waits. */
const HEAVEN = (() => {
  const top = STEP_POS(STAIR.steps - 1);
  const a = STEP_ANGLE(STAIR.steps);
  return { x: STAIR.cx + (STAIR.r + 7.5) * Math.cos(a), y: top.y + 0.4, z: STAIR.cz + (STAIR.r + 7.5) * Math.sin(a), size: 12 };
})();
/** The ticket booth on the plaza, beside the red carpet, its window facing the arriving signer. */
const BOOTH = { x: -4.4, z: BLDG.z1 + 8.5, w: 2.6, d: 1.8, h: 2.9 };
const SPAWN = new THREE.Vector3(0, 0, 4.5);
/**
 * The floating blocks from the start island to the theater island, one every
 * 2.6 m: a wandering line that rises and falls gently, with a resting island
 * every so often (reaching one is a checkpoint). Every gap clears at a walk:
 * no running jumps needed. Some blocks move (see MOVERS).
 */
const BLOCKS: Array<[x: number, top: number, z: number, size: number]> = (() => {
  const out: Array<[number, number, number, number]> = [];
  // Up to a stride short of the island: the last hop is like the others, no sprint needed.
  const n = Math.floor((-9.5 - (ISLAND.z1 + 1.2)) / 2.6);
  for (let i = 0; i <= n; i++) {
    const z = -9.5 - i * 2.6;
    const rest = i > 0 && i % 10 === 0 && i < n - 2;
    const top = Math.round((1.4 + 1.2 * Math.sin(i * 0.42) + 0.25 * Math.sin(i * 1.3)) * 10) / 10;
    const x = rest ? 0 : Math.round(1.7 * Math.sin(i * 0.75) * 10) / 10;
    out.push([x, Math.max(0.1, top), z, rest ? 6 : 1.9 + (i % 3) * 0.2]);
  }
  return out;
})();
const RESTS = BLOCKS.filter((b) => b[3] >= 6);
/** Which blocks move, and how: a slide side to side or a slow rise and fall. */
const MOVERS = (i: number, size: number): { axis: "x" | "y"; amp: number; period: number } | null =>
  size >= 6 || i < 2 || i % 4 !== 3 ? null : i % 8 === 3 ? { axis: "x", amp: 1.6, period: 5200 } : { axis: "y", amp: 0.7, period: 4200 };
/** Below this you've fallen off the world. */
const ABYSS = -18;

const PLAYER = { radius: 0.3, height: 1.7, eye: 1.6, speed: 4, jump: 7.6, gravity: 20, step: 0.45 };

export class SigningGame {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private css: CSS3DRenderer | null = null;
  private readonly solids: Box[] = [];
  private readonly disposers: Array<() => void> = [];
  private raf = 0;
  private last = 0;

  // The player
  private readonly pos = SPAWN.clone();
  private checkpoint = SPAWN.clone();
  private vy = 0;
  private grounded = false;
  private yaw = 0; // facing -z
  private pitch = 0;
  /** While sat or talking: the direction the scene put you in, which looking around stays near. */
  private lookBase: { yaw: number; pitch: number } | null = null;
  private readonly keys = new Set<string>();
  private dragging = false;
  private locked = false;
  private falls = 0;

  // The story
  private phase: Phase = "intro";
  private hud: Hud = { phase: "intro", prompt: "", paused: false, needsClick: false, dark: 0, fps: 0, objective: "", dialogue: null, ticket: false };
  // Movement feel: a forgiving jump (coyote time, a buffered press, a shorter hop on an early release), a smoothed eye, a bob, a dip on landing.
  private lastGrounded = 0;
  private jumpPressedAt = -1;
  private eyeY = SPAWN.y + PLAYER.eye;
  private bob = 0;
  private landDip = 0;
  private stepClock = 0;
  private stepSide = 0;
  private moving = false;
  private readonly dust: Array<{ sprite: THREE.Sprite; v: THREE.Vector3; life: number }> = [];
  private dustMat!: THREE.SpriteMaterial;
  // The objective beacon: a shaft of light over the next goal, hidden once you're close.
  private beacon!: THREE.Mesh;
  private judyFigure: THREE.Object3D | null = null;
  private projector!: THREE.Mesh;
  private motes!: THREE.Points;
  // Frame pacing: frames and time since the last fps reading, and the render scale the scaler settled on.
  private frames = 0;
  private frameTime = 0;
  private fpsAt = 0;
  private scale = 1;
  // Judy at the booth: which round we're in and the timers that pace her subtitles.
  private talking: { round: number } | null = null;
  private talkTimers: Array<ReturnType<typeof setTimeout>> = [];
  private talkAudio: HTMLAudioElement | null = null;
  private frontDoors: Array<{ group: THREE.Group; side: -1 | 1 }> = [];
  private frontDoorSolid: Box | null = null;
  private frontOpen = 0;
  /** The ticket in the signer's hand, from Judy's window to the front doors. */
  private ticketHand: THREE.Group | null = null;
  /** When the ticket was held up at the doors; 0 until then. */
  private presentedAt = 0;
  private frontOpenAt = 0;
  private doorOpenAt = 0;
  private judyHead: THREE.Object3D | null = null;
  private hintUntil = 0;
  /** The cheer at the top of the stairs plays once. */
  private cheered = false;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; qFrom: THREE.Quaternion; qTo: THREE.Quaternion; start: number; dur: number; then?: () => void } | null = null;
  private doorOpen = 0; // 0 closed .. 1 open
  private doorSolid: Box | null = null;
  private doorGroup!: THREE.Group;
  private exitSign!: THREE.MeshStandardMaterial;
  private houseLights: THREE.PointLight[] = [];
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private screenLight!: THREE.PointLight;
  private seatLight!: THREE.PointLight;
  private label!: THREE.Sprite;
  private marqueeBulbs: THREE.MeshStandardMaterial[] = [];
  /** The marquee over the doors and its twin on the roof, which the top of the stairs can read. */
  private marqueeSign: THREE.Mesh | null = null;
  private roofSign: THREE.Mesh | null = null;
  /** Clouds around the staircase, at eye level on the way up, swaying in place. */
  private stairClouds: Array<{ group: THREE.Group; base: THREE.Vector3; phase: number }> = [];
  /** Wind on the stairs: filtered noise that rises with the climb. */
  private wind: { ctx: AudioContext; gain: GainNode; filter: BiquadFilterNode } | null = null;
  /** The pen beside the contract, and the same pen once it's in hand. */
  private pen: THREE.Mesh | null = null;
  private penHand: THREE.Group | null = null;
  private penTakenAt = 0;
  private clouds: THREE.Object3D[] = [];
  /** Blocks that move, with the box the player stands on; the player rides along. */
  private movers: Array<{ mesh: THREE.Mesh; box: Box; base: THREE.Vector3; axis: "x" | "y"; amp: number; period: number; phase: number }> = [];
  private birds: Array<{ group: THREE.Group; wings: THREE.Mesh[]; cx: number; cz: number; r: number; y: number; speed: number; phase: number }> = [];
  private dim = 0; // 0 house lights up .. 1 movie dark

  // Media
  private music: HTMLAudioElement | null = null;
  private musicFade: number | null = null;
  /** The song has come in on its cue during the film, so nothing restarts it. */
  private cued = false;
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private audio: AudioContext | null = null;
  /** The theater's PA: Judy's announcement goes through a horn and the room. */
  private pa: AudioContext | null = null;
  private yt: { player: YTPlayer | null; iframe: HTMLIFrameElement } | null = null;
  private screenMaterial!: THREE.MeshBasicMaterial;
  private readonly sounds: Partial<Record<string, HTMLAudioElement>> = {};

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: GameOptions,
  ) {
    const useCss = !opts.manifest.movie && !!opts.manifest.youtube;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 900);
    this.camera.rotation.order = "YXZ";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: useCss, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
    this.renderer.setClearColor(0x000000, useCss ? 0 : 1);
    // Shadows are drawn once (the world stands still; what moves casts none) rather than every frame.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    Object.assign(this.renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "1", display: "block" });
    if (useCss) {
      this.css = new CSS3DRenderer();
      Object.assign(this.css.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "0", background: "#000" });
      container.appendChild(this.css.domElement);
    }
    container.appendChild(this.renderer.domElement);
    this.build();
    this.media();
    this.listen();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.emit();
    // In development only: the browser checks (e2e) drive the game from the console.
    if (import.meta.env.DEV) (window as unknown as { __signingGame?: SigningGame }).__signingGame = this;
  }

  /** Development only: jumps the player somewhere (the browser checks skip the walk). */
  teleport(x: number, y: number, z: number, yaw = 0) {
    if (!import.meta.env.DEV) return;
    this.pos.set(x, y, z);
    this.eyeY = y + PLAYER.eye;
    this.vy = 0;
    this.yaw = yaw;
    this.pitch = 0;
  }

  /** Development only: where the player is and what phase the story is in. */
  get debug() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return {
      phase: this.phase,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      yaw: this.yaw,
      facing: { x: +dir.x.toFixed(2), z: +dir.z.toFixed(2) },
      grounded: this.grounded,
      solids: this.solids.length,
      doorOpen: this.doorOpen,
      falls: this.falls,
    };
  }

  // ── Building the world ──────────────────────────────────────────────────

  private build() {
    const s = this.scene;
    if (!this.css) {
      s.fog = new THREE.Fog(0xc9dff2, 120, 380);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
      dome.position.set(0, 0, -60);
      s.add(dome);
    }

    const grass = pixelTexture(0x4f8a34, 22, "grass");
    const dirt = pixelTexture(0x5e452a, 16, "stone");
    const rock = pixelTexture(0x6a6a6e, 14, "stone");
    const carpet = pixelTexture(0x5a1420, 14, "fabric");
    const lobbyCarpet = pixelTexture(0x2b1b3d, 12, "fabric");
    const wall = pixelTexture(0x3d3a44, 6, "plaster");
    const facade = pixelTexture(0x8c2a2f, 12, "brick");
    const ceilingTex = pixelTexture(0x3a3a42, 6, "plaster");
    const wood = pixelTexture(0x6b4a2b, 14, "wood");
    const velvet = pixelTexture(0x7a1020, 10, "fabric");
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.35, emissive: 0x3a2a05 });

    // Sky light and the sun; the sun casts the building's shadow so the inside stays dark.
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a5a2a, 0.75);
    s.add(this.hemi);
    // A little light from everywhere, so ceilings and the undersides of things aren't black.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    s.add(this.ambient);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(60, 110, -30);
    sun.target.position.set(0, 0, (ISLAND.z0 + 10) / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 320;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 115;
    sun.shadow.camera.bottom = -115;
    sun.shadow.bias = -0.0006;
    s.add(sun, sun.target);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
    sunDisc.position.set(220, 260, -140);
    s.add(sunDisc);
    // A sea of cloud far below, and clouds drifting by.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), surface(pixelTexture(0xf0f4f9, 10, "cloud")));
    (sea.material as THREE.MeshPhongMaterial).map!.repeat.set(24, 24);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -34;
    s.add(sea);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 22; i++) {
      const c = new THREE.Group();
      const n = 2 + Math.floor(rnd() * 3);
      const cloudMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 2, emissive: 0xe6eef7, emissiveIntensity: 0.55, transparent: true, opacity: 0.94 });
      for (let j = 0; j < n + 2; j++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(2.2 + rnd() * 2.8, 18, 12), cloudMat);
        m.position.set((rnd() - 0.5) * 9, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 5);
        m.scale.y = 0.55 + rnd() * 0.2;
        c.add(m);
      }
      const side = rnd() < 0.5 ? -1 : 1;
      c.position.set(side * (14 + rnd() * 70), 10 + rnd() * 32, 20 - rnd() * 250);
      s.add(c);
      this.clouds.push(c);
    }

    // ── The start island ──
    this.island(0, 0, START.half * 2, START.half * 2, 0, grass, dirt, rock);
    this.signpost(2.6, 0, -2.5, ["THE THEATER", "is on the island ahead.", "Jump the blocks."]);
    this.plant(-3.5, 0, 2.5, wood);

    // ── The blocks ──
    const blockTop = pixelTexture(0x3f8a3a, 22);
    const moverTop = pixelTexture(0x8ab4e8, 22);
    BLOCKS.forEach(([x, top, z, size], i) => {
      const h = size > 4 ? 2.2 : 0.8;
      const mover = MOVERS(i, size);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(size, h, size),
        [dirt, dirt, mover ? moverTop : blockTop, dirt, dirt, dirt].map((t) => surface(t)),
      );
      m.position.set(x, top - h / 2, z);
      m.castShadow = !mover;
      m.receiveShadow = true;
      s.add(m);
      const box = { min: new THREE.Vector3(x - size / 2, top - h, z - size / 2), max: new THREE.Vector3(x + size / 2, top, z + size / 2) };
      this.solids.push(box);
      if (mover) this.movers.push({ mesh: m, box, base: m.position.clone(), ...mover, phase: i * 1.7 });
    });
    // Birds wheeling over the sky between the islands.
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.22), flat(0x23232a));
      const wings = [-1, 1].map((side) => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.7), flat(0x33333c));
        w.position.set(0, 0.05, side * 0.4);
        g.add(w);
        return w;
      });
      g.add(body);
      s.add(g);
      this.birds.push({ group: g, wings, cx: (i % 2 ? 1 : -1) * (8 + i * 2), cz: -12 - i * 11, r: 6 + (i % 3) * 3, y: 7 + (i % 4) * 2.5, speed: 0.35 + (i % 3) * 0.12, phase: i * 0.9 });
    }
    RESTS.forEach(([x, top, z], i) => this.signpost(x + 2.2, top, z + 1.2, [i === RESTS.length - 1 ? "NEARLY THERE" : `REST ${i + 1} OF ${RESTS.length}`, "Fall and you start from here."]));

    // ── The theater's island: a ring of ground around the building, and rock underneath ──
    const g = (x0: number, x1: number, z0: number, z1: number) => this.slab((x0 + x1) / 2, -2.5, (z0 + z1) / 2, x1 - x0, 5, z1 - z0, grass, true);
    g(ISLAND.x0, ISLAND.x1, BLDG.z1, ISLAND.z1); // the plaza in front
    g(ISLAND.x0, -BLDG.halfW - 0.3, ISLAND.z0, BLDG.z1); // left of the building
    g(BLDG.halfW + 0.3, ISLAND.x1, COURT.z1 + 0.3, BLDG.z1); // right, in front of the courtyard
    g(BLDG.halfW + 0.3, ISLAND.x1, ISLAND.z0, COURT.z0 - 0.3); // right, behind the courtyard
    g(COURT.x1 + 0.3, ISLAND.x1, COURT.z0 - 0.3, COURT.z1 + 0.3); // right, beside the courtyard
    g(ISLAND.x0, ISLAND.x1, ISLAND.z0, BLDG.z0 - 0.3); // behind the building
    const underTex = rock.clone();
    underTex.repeat.set(60, 10);
    const under = new THREE.Mesh(new THREE.BoxGeometry(ISLAND.x1 - ISLAND.x0, 10, ISLAND.z1 - ISLAND.z0), surface(underTex));
    under.position.set(0, -10, (ISLAND.z0 + ISLAND.z1) / 2);
    s.add(under);
    const under2 = new THREE.Mesh(new THREE.CylinderGeometry(24, 9, 14, 22), surface(rock));
    under2.scale.z = 1.5;
    under2.position.set(2, -21, (ISLAND.z0 + ISLAND.z1) / 2 + 3);
    s.add(under2);
    // The red carpet up to the doors.
    const red = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, ISLAND.z1 - BLDG.z1 - 2), surface(carpet));
    red.position.set(0, 0.02, (ISLAND.z1 + BLDG.z1) / 2 - 1);
    red.receiveShadow = true;
    s.add(red);
    this.velvetRope(0, 0, BLDG.z1 + 5);
    this.plant(-5, 0, BLDG.z1 + 2.5, wood);
    this.plant(5, 0, BLDG.z1 + 2.5, wood);
    for (const x of [-9, 9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), flat(0x1a1a1f));
      post.position.set(x, 2, BLDG.z1 + 6);
      post.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 1.2 }));
      lamp.position.set(x, 4.3, BLDG.z1 + 6);
      s.add(post, lamp);
    }

    // ── The building's outside ──
    const doorHalf = 1.5;
    const doorTop = 3;
    const bw = BLDG.halfW;
    const by0 = FRONT_FLOOR - 1;
    const bh = BLDG.height - by0;
    const byc = (BLDG.height + by0) / 2;
    this.wall(-(bw + doorHalf) / 2, byc, BLDG.z1, bw - doorHalf, bh, 0.3, facade, true);
    this.wall((bw + doorHalf) / 2, byc, BLDG.z1, bw - doorHalf, bh, 0.3, facade, true);
    this.wall(0, (doorTop + BLDG.height) / 2, BLDG.z1, doorHalf * 2, BLDG.height - doorTop, 0.3, facade, true);
    this.wall(-bw - 0.15, byc, (BLDG.z0 + BLDG.z1) / 2, 0.3, bh, BLDG.z1 - BLDG.z0, facade, true);
    // The right wall has the exit door in it; the annex (the signing room) closes around that.
    const seg = (z0: number, z1: number, y0: number, y1: number) => this.wall(bw + 0.15, (y0 + y1) / 2, (z0 + z1) / 2, 0.3, y1 - y0, z1 - z0, facade, true);
    seg(BLDG.z0 - 0.3, DOOR.z0, by0, BLDG.height);
    seg(DOOR.z1, BLDG.z1 + 0.3, by0, BLDG.height);
    seg(DOOR.z0, DOOR.z1, FRONT_FLOOR + DOOR.h, BLDG.height);
    this.wall(0, byc, BLDG.z0 - 0.15, bw * 2 + 0.6, bh, 0.3, facade, true);
    this.slab(0, BLDG.height + 0.15, (BLDG.z0 + BLDG.z1) / 2, bw * 2 + 0.6, 0.3, BLDG.z1 - BLDG.z0 + 0.6, rock, true);
    // The marquee over the doors, with its bulbs.
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(18, 3.2, 1.2), flat(0x14141a));
    marquee.position.set(0, doorTop + 3.4, BLDG.z1 + 0.75);
    marquee.castShadow = true;
    s.add(marquee);
    this.marqueeSign = this.sign(["NOW SHOWING", FILM_TITLE.toUpperCase()], 0, doorTop + 3.5, BLDG.z1 + 1.36, 16, 2.4, 0, "#14141a", "#ffd166");
    // The same words on a board up a mast at the back of the roof, turned toward the top of the stairs, clear of the cloud.
    {
      const top = STEP_POS(STAIR.steps - 1);
      const sx = 10;
      const sy = BLDG.height + 0.3 + 8;
      const sz = STAIR.cz - 1;
      const board = new THREE.Mesh(new THREE.BoxGeometry(10.4, 3.6, 0.3), flat(0x14141a));
      board.position.set(sx, sy, sz);
      board.lookAt(top.x, top.y + 1.5, top.z);
      s.add(board);
      this.roofSign = this.sign(["NOW SHOWING", FILM_TITLE.toUpperCase()], sx, sy, sz, 10, 3.2, 0, "#14141a", "#ffd166");
      this.roofSign.lookAt(top.x, top.y + 1.5, top.z);
      this.roofSign.translateZ(0.17);
      for (const dx of [-3.5, 3.5]) {
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.25, sy - 1.8 - (BLDG.height + 0.3), 0.25), flat(0x2a2a30));
        mast.position.set(sx + dx, (sy - 1.8 + BLDG.height + 0.3) / 2, sz);
        s.add(mast);
      }
    }
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffe08a, emissiveIntensity: 1.5 });
      this.marqueeBulbs.push(mat);
      const x = -8.6 + (i % 12) * 1.56;
      const y = i < 12 ? doorTop + 5.2 : doorTop + 1.7;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
      b.position.set(x, y, BLDG.z1 + 1.4);
      s.add(b);
    }
    this.sign([`RESERVED SEATING FOR ${this.opts.signerName.toUpperCase()}`], 0, doorTop + 0.9, BLDG.z1 + 0.17, 7, 0.7, 0, "#2e0f14", "#f4ede0");
    // The front doors: shut until Judy hands over a ticket, then they swing inward.
    for (const side of [-1, 1] as const) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, doorTop - 0.05, doorHalf), surface(wood));
      const grp = new THREE.Group();
      grp.position.set(side * doorHalf, (doorTop - 0.05) / 2, BLDG.z1 - 0.15);
      panel.position.set(0, 0, -doorHalf / 2);
      grp.add(panel);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), gold);
      knob.position.set(-side * 0.08, 0, -doorHalf + 0.2);
      grp.add(knob);
      grp.rotation.y = (side * Math.PI) / 2;
      s.add(grp);
      this.frontDoors.push({ group: grp, side });
    }
    this.frontDoorSolid = { min: new THREE.Vector3(-doorHalf, 0, BLDG.z1 - 0.3), max: new THREE.Vector3(doorHalf, doorTop, BLDG.z1 + 0.1) };
    this.solids.push(this.frontDoorSolid);
    this.booth(gold);

    // ── The lobby ──
    // Plaster inside the brick: the lobby's and the auditorium's side walls, and the inside of the front wall.
    const wallY = (BLDG.height + FRONT_FLOOR) / 2;
    const lining = pixelTexture(0x6b5b48, 7, "plaster");
    const dark = pixelTexture(0x3b3540, 6, "plaster");
    this.panel(-bw + 0.04, LOBBY.height / 2, (LOBBY.z0 + LOBBY.z1) / 2, 0.08, LOBBY.height, LOBBY.z1 - LOBBY.z0, lining);
    this.panel(bw - 0.04, LOBBY.height / 2, (LOBBY.z0 + LOBBY.z1) / 2, 0.08, LOBBY.height, LOBBY.z1 - LOBBY.z0, lining);
    this.panel(-(bw + doorHalf) / 2, LOBBY.height / 2, BLDG.z1 - 0.19, bw - doorHalf, LOBBY.height, 0.08, lining);
    this.panel((bw + doorHalf) / 2, LOBBY.height / 2, BLDG.z1 - 0.19, bw - doorHalf, LOBBY.height, 0.08, lining);
    this.panel(-bw + 0.04, wallY, (BLDG.z0 + LOBBY.z0) / 2, 0.08, BLDG.height - FRONT_FLOOR, LOBBY.z0 - BLDG.z0, dark);
    this.panel(bw - 0.04, wallY, (BLDG.z0 + DOOR.z1) / 2, 0.08, BLDG.height - FRONT_FLOOR, DOOR.z1 - BLDG.z0 - 1.8, dark);
    this.panel(bw - 0.04, wallY, (DOOR.z1 + LOBBY.z0) / 2, 0.08, BLDG.height - FRONT_FLOOR, LOBBY.z0 - DOOR.z1, dark);
    this.panel(0, wallY, BLDG.z0 + 0.04, bw * 2, BLDG.height - FRONT_FLOOR, 0.08, dark);
    this.slab(0, -0.5, (LOBBY.z0 + LOBBY.z1) / 2, bw * 2, 1, LOBBY.z1 - LOBBY.z0, lobbyCarpet);
    this.slab(0, LOBBY.height + 0.15, (LOBBY.z0 + LOBBY.z1) / 2, bw * 2, 0.3, LOBBY.z1 - LOBBY.z0, ceilingTex);
    for (const z of [LOBBY.z1 - 3, LOBBY.z1 - 9]) {
      const l = new THREE.PointLight(0xffd9a8, 160, 0, 2);
      l.position.set(0, LOBBY.height - 1.2, z);
      s.add(l);
    }
    // The wall into the auditorium, with its doorway.
    this.wall(-(bw + doorHalf) / 2, byc, LOBBY.z0, bw - doorHalf, bh, 0.3, wall);
    this.wall((bw + doorHalf) / 2, byc, LOBBY.z0, bw - doorHalf, bh, 0.3, wall);
    this.wall(0, (doorTop + BLDG.height) / 2, LOBBY.z0, doorHalf * 2, BLDG.height - doorTop, 0.3, wall);
    this.sign(["AUDITORIUM", "▼"], 0, doorTop + 0.55, LOBBY.z0 + 0.16, 2.6, 0.8, 0, "#111118", "#f4ede0");
    this.sign(["NOW SHOWING", "SAM SIGNS", "THE OPERATING", "AGREEMENT"], -bw + 0.02, 2.4, LOBBY.z1 - 6, 2.4, 3, Math.PI / 2, "#1a0f2e", "#ffd166");
    this.sign(["RESERVED", "SEATING", `FOR ${this.opts.signerName.toUpperCase()}`], bw - 0.02, 2.4, LOBBY.z1 - 6, 2.4, 3, -Math.PI / 2, "#2e0f14", "#f4ede0");
    this.sign([this.opts.title.toUpperCase().slice(0, 30)], 0, 4.2, LOBBY.z1 - 0.17, 9, 1, Math.PI, "#111118", "#f4ede0");
    this.popcorn(-6, 0, LOBBY.z1 - 4);
    this.counter(6.5, 0, LOBBY.z1 - 5, wood);
    this.plant(-10, 0, LOBBY.z0 + 1.5, wood);
    this.plant(10, 0, LOBBY.z0 + 1.5, wood);
    this.velvetRope(0, 0, LOBBY.z1 - 2.5);

    // ── The auditorium ──
    this.slab(0, BLDG.height - 0.15, (BLDG.z0 + LOBBY.z0) / 2, bw * 2, 0.3, LOBBY.z0 - BLDG.z0, ceilingTex);
    // Floors: the entrance, a step down per row, then the flat in front of the screen.
    const entranceZ0 = ROW_Z(0) + 1.1;
    this.slab(0, -0.5, (LOBBY.z0 + entranceZ0) / 2, bw * 2, 1, LOBBY.z0 - entranceZ0, carpet);
    for (let r = 0; r < ROWS; r++) this.slab(0, ROW_FLOOR(r) - 0.5, ROW_Z(r), bw * 2, 1, 2.2, carpet);
    const frontZ1 = ROW_Z(ROWS - 1) - 1.1;
    this.slab(0, FRONT_FLOOR - 0.5, (BLDG.z0 + frontZ1) / 2, bw * 2, 1, frontZ1 - BLDG.z0, carpet);
    // Aisle lights.
    const aisleMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff8a2a, emissiveIntensity: 1.2 });
    for (let r = 0; r < ROWS; r++)
      for (const x of [-1.05, 1.05, -(SEAT_X(1, SEATS_PER_SIDE - 1) + 0.6), SEAT_X(1, SEATS_PER_SIDE - 1) + 0.6]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.4), aisleMat);
        m.position.set(x, ROW_FLOOR(r) + 0.02, ROW_Z(r));
        s.add(m);
      }
    this.seats(velvet, gold);
    // Screen, frame and curtains.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 1, SCREEN.h + 1, 0.2), flat(0x0c0c10));
    frame.position.set(0, SCREEN.y, SCREEN.z - 0.15);
    s.add(frame);
    for (const side of [-1, 1]) {
      const curtain = new THREE.Mesh(new THREE.BoxGeometry(1.6, BLDG.height - FRONT_FLOOR - 0.4, 0.7), surface(velvet));
      curtain.position.set(side * (SCREEN.w / 2 + 1.5), wallY, SCREEN.z + 0.3);
      s.add(curtain);
    }
    this.screenMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), this.screenMaterial);
    screen.position.set(0, SCREEN.y, SCREEN.z);
    s.add(screen);
    this.screenLight = new THREE.PointLight(0xcfe3ff, 0, 0, 2);
    this.screenLight.position.set(0, SCREEN.y, SCREEN.z + 5);
    s.add(this.screenLight);
    for (const z of [LOBBY.z0 - 7, LOBBY.z0 - 22])
      for (const x of [-6, 6]) {
        const l = new THREE.PointLight(0xffe2b8, 160, 60, 2);
        l.position.set(x, BLDG.height - 2, z);
        s.add(l);
        this.houseLights.push(l);
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b8, emissiveIntensity: 0.8 }));
        fixture.position.set(x, BLDG.height - 0.05, z);
        s.add(fixture);
      }
    // The exit door beside the screen, hinged at its far-from-screen jamb and swinging into the signing room.
    this.doorGroup = new THREE.Group();
    this.doorGroup.position.set(DOOR.x, FRONT_FLOOR, DOOR.z0);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, DOOR.h, DOOR.z1 - DOOR.z0 - 0.04), surface(wood));
    door.position.set(0, DOOR.h / 2, (DOOR.z1 - DOOR.z0) / 2);
    this.doorGroup.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), gold);
    knob.position.set(-0.08, DOOR.h / 2, DOOR.z1 - DOOR.z0 - 0.2);
    this.doorGroup.add(knob);
    s.add(this.doorGroup);
    this.doorSolid = { min: new THREE.Vector3(DOOR.x - 0.1, FRONT_FLOOR, DOOR.z0), max: new THREE.Vector3(DOOR.x + 0.1, FRONT_FLOOR + DOOR.h, DOOR.z1) };
    this.solids.push(this.doorSolid);
    this.exitSign = new THREE.MeshStandardMaterial({ color: 0x0b2a12, emissive: 0x22c55e, emissiveIntensity: 0.15 });
    const exitSign = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.9), this.exitSign);
    exitSign.position.set(DOOR.x - 0.1, FRONT_FLOOR + DOOR.h + 0.35, (DOOR.z0 + DOOR.z1) / 2);
    s.add(exitSign);
    this.sign(["EXIT"], DOOR.x - 0.14, FRONT_FLOOR + DOOR.h + 0.35, (DOOR.z0 + DOOR.z1) / 2, 0.8, 0.26, -Math.PI / 2, "transparent", "#ffffff");

    // ── The courtyard outside the exit door, and the staircase into the sky ──
    this.slab((COURT.x0 + COURT.x1) / 2, FRONT_FLOOR - 0.5, (COURT.z0 + COURT.z1) / 2, COURT.x1 - COURT.x0, 1, COURT.z1 - COURT.z0, rock);
    this.signpost(COURT.x1 - 1.2, FRONT_FLOOR, COURT.z1 - 1.2, ["THE CONTRACT", "is up there.", "Take the stairs."]);
    const stepTex = pixelTexture(0xe8e2d2, 10);
    const stepSide = pixelTexture(0xcfc7b4, 10);
    for (let i = 0; i < STAIR.steps; i++) {
      const p = STEP_POS(i);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(STAIR.size, 0.4, STAIR.size),
        [stepSide, stepSide, stepTex, stepSide, stepSide, stepSide].map((t) => surface(t)),
      );
      m.position.set(p.x, p.y - 0.2, p.z);
      m.rotation.y = -STEP_ANGLE(i);
      m.castShadow = true;
      m.receiveShadow = true;
      s.add(m);
      // Collision boxes are axis-aligned; a turned step gets a box that covers it.
      const half = (STAIR.size / 2) * 1.2;
      this.solids.push({ min: new THREE.Vector3(p.x - half, p.y - 0.4, p.z - half), max: new THREE.Vector3(p.x + half, p.y, p.z + half) });
      if (i % 16 === 8) {
        const lamp = new THREE.PointLight(0xffe8b0, 6, 9, 2);
        lamp.position.set(p.x, p.y + 1.6, p.z);
        s.add(lamp);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), gold);
        post.position.set(p.x, p.y + 0.7, p.z);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffe08a, emissiveIntensity: 1.4 }));
        bulb.position.set(p.x, p.y + 1.5, p.z);
        s.add(post, bulb);
      }
    }
    // The heavens: a cloud with the contract on a pedestal, under its own light.
    const cloud = new THREE.Group();
    for (const [dx, dy, dz, w, h, d] of [
      [0, -1, 0, HEAVEN.size, 2, HEAVEN.size],
      [-4, -1.6, 3, 7, 2, 6],
      [5, -1.8, -4, 6, 2, 7],
      [3, -1.4, 5, 5, 1.6, 4],
      [-5, -2.2, -4, 6, 1.6, 5],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.position.set(dx, dy, dz);
      cloud.add(m);
    }
    cloud.position.set(HEAVEN.x, HEAVEN.y, HEAVEN.z);
    s.add(cloud);
    const hs = HEAVEN.size / 2;
    this.solids.push({ min: new THREE.Vector3(HEAVEN.x - hs, HEAVEN.y - 2, HEAVEN.z - hs), max: new THREE.Vector3(HEAVEN.x + hs, HEAVEN.y, HEAVEN.z + hs) });
    // A lectern of light: a glowing column with a slanted gold top, where the pedestal was.
    const glow = (r0: number, r1: number, h: number, opacity: number) =>
      new THREE.Mesh(
        new THREE.CylinderGeometry(r0, r1, h, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
    const column = glow(0.3, 0.55, 1.1, 0.42);
    column.position.set(HEAVEN.x, HEAVEN.y + 0.55, HEAVEN.z);
    const core = glow(0.1, 0.16, 1.1, 0.8);
    core.position.copy(column.position);
    s.add(column, core);
    const top = STEP_POS(STAIR.steps - 1);
    const toStairs = new THREE.Vector3(top.x - HEAVEN.x, 0, top.z - HEAVEN.z).normalize();
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.9), gold);
    desk.position.set(HEAVEN.x, HEAVEN.y + 1.12, HEAVEN.z);
    desk.lookAt(HEAVEN.x + toStairs.x, HEAVEN.y + 1.12 + 0.45, HEAVEN.z + toStairs.z);
    s.add(desk);
    this.solids.push({ min: new THREE.Vector3(HEAVEN.x - 0.45, HEAVEN.y, HEAVEN.z - 0.45), max: new THREE.Vector3(HEAVEN.x + 0.45, HEAVEN.y + 1.1, HEAVEN.z + 0.45) });
    // The document, open to the signature page, facing whoever comes up the stairs.
    this.contract = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 1.25),
      new THREE.MeshBasicMaterial({
        map: textTexture(
          [this.opts.title.slice(0, 30), "", "SIGNATURE PAGE", "", "", "Signed:", "X ________________", this.opts.signerName, "", "Date: ____________"],
          300,
          400,
          "#faf8f2",
          "#1a1a1f",
          20,
        ),
        side: THREE.DoubleSide,
      }),
    );
    this.contract.position.set(HEAVEN.x, HEAVEN.y + 1.85, HEAVEN.z);
    this.contract.lookAt(HEAVEN.x + toStairs.x * 10, HEAVEN.y + 1.85 - 1.5, HEAVEN.z + toStairs.z * 10);
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(1.01, 1.31), new THREE.MeshBasicMaterial({ color: 0x2e2410, side: THREE.DoubleSide }));
    edge.position.z = -0.006;
    this.contract.add(edge);
    s.add(this.contract);
    // The pen, waiting beside it.
    const penGeo = new THREE.CylinderGeometry(0.022, 0.01, 0.42, 10);
    this.pen = new THREE.Mesh(penGeo, gold);
    this.pen.position.set(HEAVEN.x + 0.7, HEAVEN.y + 1.45, HEAVEN.z);
    this.pen.rotation.z = 0.5;
    s.add(this.pen);
    const penHand = new THREE.Group();
    const held = new THREE.Mesh(penGeo, new THREE.MeshBasicMaterial({ color: 0xd4af37 }));
    const nib = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 8), new THREE.MeshBasicMaterial({ color: 0x3a2a05 }));
    nib.position.y = -0.235;
    nib.rotation.x = Math.PI;
    penHand.add(held, nib);
    penHand.scale.setScalar(0.42);
    penHand.visible = false;
    this.camera.add(penHand);
    this.penHand = penHand;
    // A shaft of light from the cloud down to the theater's roof: the destination, seen from the courtyard and the stairs.
    const shaftTop = HEAVEN.y - 2;
    const shaftBottom = BLDG.height + 0.3;
    const shaft = glow(2.2, 3.4, shaftTop - shaftBottom, 0.16);
    shaft.position.set(HEAVEN.x, (shaftTop + shaftBottom) / 2, HEAVEN.z);
    s.add(shaft);
    // Clouds around the staircase, at eye level on the way up.
    {
      let seed = 23;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 12; k++) {
        const i = 6 + k * 5;
        const p = STEP_POS(i);
        const a = STEP_ANGLE(i) + (rnd() - 0.5) * 0.6;
        const r = k % 4 === 3 ? 2.5 : STAIR.r + 6 + rnd() * 6;
        const g = new THREE.Group();
        const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 2, emissive: 0xe6eef7, emissiveIntensity: 0.55, transparent: true, opacity: 0.9 });
        const n = 3 + Math.floor(rnd() * 3);
        for (let j = 0; j < n; j++) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.8 + rnd() * 1.0, 14, 10), mat);
          m.position.set((rnd() - 0.5) * 4, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 2.5);
          m.scale.y = 0.55 + rnd() * 0.2;
          g.add(m);
        }
        const base = new THREE.Vector3(STAIR.cx + r * Math.cos(a), p.y + 1.2 + (rnd() - 0.5) * 1.2, STAIR.cz + r * Math.sin(a));
        g.position.copy(base);
        s.add(g);
        this.stairClouds.push({ group: g, base, phase: rnd() * Math.PI * 2 });
      }
    }
    const halo = new THREE.PointLight(0xffe9b0, 40, 18, 2);
    halo.position.set(HEAVEN.x, HEAVEN.y + 3.2, HEAVEN.z);
    s.add(halo);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ray = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 9, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ray.position.set(HEAVEN.x + 1.6 * Math.cos(a), HEAVEN.y + 5, HEAVEN.z + 1.6 * Math.sin(a));
      ray.rotation.z = 0.25 * Math.cos(a);
      ray.rotation.x = 0.25 * Math.sin(a);
      s.add(ray);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 0.3), gold);
    arch.position.set(HEAVEN.x, HEAVEN.y + 4.2, HEAVEN.z - 3);
    s.add(arch);
    for (const dx of [-2.35, 2.35]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), gold);
      col.position.set(HEAVEN.x + dx, HEAVEN.y + 2.1, HEAVEN.z - 3);
      s.add(col);
    }
    this.sign(["ANYTHING IS POSSIBLE", this.opts.title.toUpperCase().slice(0, 30), "SIGN HERE"], HEAVEN.x, HEAVEN.y + 2.6, HEAVEN.z - 2.9, 4.4, 1.3, 0, "#17120c", "#ffd166");

    // Landing dust, the objective beacon, and the projector's beam with its dust motes.
    this.dustMat = new THREE.SpriteMaterial({ color: 0xf2e9d8, transparent: true, opacity: 0.55, depthWrite: false });
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.5, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beacon.visible = false;
    s.add(this.beacon);
    const beamLen = SCREEN.z - (LOBBY.z0 - 1.5);
    this.projector = new THREE.Mesh(
      new THREE.CylinderGeometry(SCREEN.w * 0.55, 0.3, Math.abs(beamLen), 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.projector.rotation.x = Math.PI / 2;
    this.projector.position.set(0, BLDG.height - 2.2 - (BLDG.height - 2.2 - SCREEN.y) / 2, (LOBBY.z0 - 1.5 + SCREEN.z) / 2);
    this.projector.rotation.z = 0;
    this.projector.visible = false;
    s.add(this.projector);
    const moteCount = 160;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const t = Math.random();
      const spread = 0.3 + t * SCREEN.w * 0.5;
      motePos[i * 3] = (Math.random() - 0.5) * spread;
      motePos[i * 3 + 1] = BLDG.height - 2.2 - t * (BLDG.height - 2.2 - SCREEN.y) + (Math.random() - 0.5) * spread * 0.5;
      motePos[i * 3 + 2] = LOBBY.z0 - 1.5 + t * beamLen;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.motes.visible = false;
    s.add(this.motes);

    this.ticketInHand();
    this.models();
  }

  /** A floating island: grass on top, dirt, then rock tapering away underneath. */
  private island(x: number, z: number, w: number, d: number, top: number, grass: THREE.Texture, dirt: THREE.Texture, rock: THREE.Texture) {
    const dirtTex = dirt.clone();
    dirtTex.repeat.set(w, 3);
    const grassTex = grass.clone();
    grassTex.repeat.set(w, d);
    const dirtMat = surface(dirtTex);
    const grassMat = surface(grassTex);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), [dirtMat, dirtMat, grassMat, dirtMat, dirtMat, dirtMat]);
    m.position.set(x, top - 1.5, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.solids.push({ min: new THREE.Vector3(x - w / 2, top - 3, z - d / 2), max: new THREE.Vector3(x + w / 2, top, z + d / 2) });
    const rockMat = surface(rock);
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.48, w * 0.3, 4, 18), rockMat);
    r1.position.set(x + 0.4, top - 4.5, z - 0.3);
    const r2 = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.28, w * 0.1, 3.5, 14), rockMat);
    r2.position.set(x - 0.6, top - 7.8, z + 0.4);
    this.scene.add(r1, r2);
  }

  private slab(x: number, y: number, z: number, w: number, h: number, d: number, tex: THREE.Texture, shadow = false) {
    const t = tex.clone();
    t.repeat.set(w, d);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surface(t));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = shadow;
    this.scene.add(m);
    this.solids.push({ min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2) });
  }

  /** A surface with no collision of its own: the lining inside an outer wall. */
  private panel(x: number, y: number, z: number, w: number, h: number, d: number, tex: THREE.Texture) {
    const t = tex.clone();
    t.repeat.set(Math.max(w, d), h);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surface(t));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  private wall(x: number, y: number, z: number, w: number, h: number, d: number, tex: THREE.Texture, shadow = false) {
    const t = tex.clone();
    t.repeat.set(Math.max(w, d), h);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surface(t));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = shadow;
    this.scene.add(m);
    this.solids.push({ min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2) });
  }

  /** A lettered board: lines of text on a plane, turned `rotY` about y. */
  private sign(lines: string[], x: number, y: number, z: number, w: number, h: number, rotY: number, bg: string, fg: string) {
    const tex = textTexture(lines, Math.round(w * 160), Math.round(h * 160), bg, fg);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: bg === "transparent" }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.scene.add(m);
    return m;
  }

  /** What the marquee says: over the doors, and on the roof for the top of the stairs. */
  private setMarquee(lines: string[]) {
    for (const [m, w, h] of [
      [this.marqueeSign, 16, 2.4],
      [this.roofSign, 10, 3.2],
    ] as const) {
      if (!m) continue;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = textTexture(lines, Math.round(w * 160), Math.round(h * 160), "#14141a", "#ffd166");
      mat.needsUpdate = true;
    }
  }

  private signpost(x: number, y: number, z: number, lines: string[]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), flat(0x4a3018));
    post.position.set(x, y + 0.8, z);
    post.castShadow = true;
    this.scene.add(post);
    this.sign(lines, x, y + 1.75, z + 0.07, 1.8, 0.7, 0, "#17120c", "#f4ede0");
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 0.1), flat(0x4a3018));
    back.position.set(x, y + 1.75, z);
    this.scene.add(back);
  }

  private seats(velvet: THREE.Texture, gold: THREE.Material) {
    const count = ROWS * SEATS_PER_SIDE * 2 - 1;
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.45, 0.9), surface(velvet), count);
    const back = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.1, 0.15), surface(velvet), count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < ROWS; r++)
      for (const side of [-1, 1] as const)
        for (let k = 0; k < SEATS_PER_SIDE; k++) {
          const x = SEAT_X(side, k);
          const z = ROW_Z(r);
          const fy = ROW_FLOOR(r);
          this.solids.push({ min: new THREE.Vector3(x - 0.5, fy, z - 0.45), max: new THREE.Vector3(x + 0.5, fy + 1.0, z + 0.475) });
          this.seatSpots.push({ x, y: fy, z });
          if (r === RESERVED.row && side === RESERVED.side && k === RESERVED.k) continue;
          base.setMatrixAt(i, m.makeTranslation(x, fy + 0.225, z));
          back.setMatrixAt(i, m.makeTranslation(x, fy + 0.55, z + 0.4));
          i++;
        }
    base.instanceMatrix.needsUpdate = true;
    back.instanceMatrix.needsUpdate = true;
    this.scene.add(base, back);
    this.seatPlaceholders.push(base, back);

    // The reserved seat: gold, lit, with the signer's name floating over it.
    const { x, y, z } = this.reservedSeat();
    const rb = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.9), gold);
    rb.position.set(x, y + 0.225, z);
    const rk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 0.15), gold);
    rk.position.set(x, y + 0.55, z + 0.4);
    this.scene.add(rb, rk);
    this.seatPlaceholders.push(rb, rk);
    this.seatLight = new THREE.PointLight(0xffd166, 10, 5, 2);
    this.seatLight.position.set(x, y + 2.4, z);
    this.scene.add(this.seatLight);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(this.opts.signerName), transparent: true, depthTest: false }));
    label.scale.set(2.2, 0.85, 1);
    label.position.set(x, y + 2.0, z);
    this.scene.add(label);
    this.label = label;
  }
  private readonly seatSpots: Array<{ x: number; y: number; z: number }> = [];
  private readonly seatPlaceholders: THREE.Object3D[] = [];
  /** The instanced Meshy seats, set aside if the machine can't keep up. */
  private readonly seatModels: THREE.Object3D[] = [];
  private slowReadings = 0;
  private beganAt = 0;
  private lowQuality = false;
  private readonly plantPlaceholders: THREE.Object3D[] = [];
  private readonly popcornPlaceholders: THREE.Object3D[] = [];
  private readonly plantSpots: Array<{ x: number; y: number; z: number }> = [];
  private readonly judyPlaceholders: THREE.Object3D[] = [];

  private reservedSeat() {
    return { x: SEAT_X(RESERVED.side, RESERVED.k), y: ROW_FLOOR(RESERVED.row), z: ROW_Z(RESERVED.row) };
  }

  private contract!: THREE.Mesh;

  /** The ticket booth, with Judy in it: a blocky older lady in a lavender cardigan, glasses, and a gray bun. */
  private booth(gold: THREE.Material) {
    const s = this.scene;
    const { x, z, w, d, h } = BOOTH;
    const paint = surface(pixelTexture(0x8c2a2f, 12));
    const counter = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), paint);
    counter.position.set(x, 0.55, z);
    counter.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.25, d + 0.5), flat(0x14141a));
    roof.position.set(x, h, z);
    roof.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h - 1.1, 0.1), paint);
    back.position.set(x, 1.1 + (h - 1.1) / 2, z - d / 2 + 0.05);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 1.3), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    glass.position.set(x, 1.1 + (h - 1.3) / 2, z + d / 2);
    s.add(counter, roof, back, glass);
    for (const px of [-w / 2 + 0.1, w / 2 - 0.1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h - 1.1, 0.16), flat(0x14141a));
      post.position.set(x + px, 1.1 + (h - 1.1) / 2, z + d / 2 - 0.08);
      s.add(post);
    }
    this.sign(["TICKETS"], x, h + 0.55, z + d / 2 + 0.1, 2.2, 0.6, 0, "#14141a", "#ffd166");
    this.sign(["JUDY"], x + 0.7, 1.0, z + d / 2 + 0.01, 0.7, 0.18, 0, "#f4ede0", "#14141a");
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.2), gold);
    slot.position.set(x - 0.4, 1.11, z + d / 2 - 0.15);
    s.add(slot);
    this.solids.push({ min: new THREE.Vector3(x - w / 2 - 0.2, 0, z - d / 2 - 0.25), max: new THREE.Vector3(x + w / 2 + 0.2, h + 0.3, z + d / 2 + 0.1) });

    // Judy.
    const judy = new THREE.Group();
    const cardigan = surface(pixelTexture(0x9b7bb8, 10));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.42), cardigan);
    body.position.set(0, 1.45, 0);
    const skin = flat(0xe8c4a8);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), skin);
    head.position.set(0, 2.07, 0);
    const hair = surface(pixelTexture(0xc9c4bd, 14));
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), hair);
    hairTop.position.set(0, 2.36, -0.02);
    const bun = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), hair);
    bun.position.set(0, 2.42, -0.3);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), hair);
    hairBack.position.set(0, 2.14, -0.24);
    const dark = flat(0x1a1a1f);
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), dark);
      eye.position.set(ex, 2.1, 0.24);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
      lens.position.set(ex, 2.1, 0.26);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.02), gold);
      rim.position.set(ex, 2.17, 0.26);
      judy.add(eye, lens, rim);
    }
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), gold);
    chain.position.set(0.2, 2.0, 0.2);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), flat(0xa04050));
    mouth.position.set(0, 1.95, 0.24);
    const brooch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), gold);
    brooch.position.set(-0.22, 1.7, 0.22);
    for (const ax of [-0.45, 0.45]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), cardigan);
      arm.position.set(ax, 1.4, 0.08);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), skin);
      hand.position.set(ax, 1.08, 0.12);
      judy.add(arm, hand);
    }
    judy.add(body, head, hairTop, bun, hairBack, chain, mouth, brooch);
    judy.position.set(x - 0.2, 0, z - 0.25);
    s.add(judy);
    this.judyHead = head;
    this.judyPlaceholders.push(judy);
    this.judyFigure = judy;
    const lamp = new THREE.PointLight(0xffe2b8, 6, 5, 2);
    lamp.position.set(x, h - 0.3, z + 0.3);
    s.add(lamp);
  }

  private popcorn(x: number, y: number, z: number) {
    const cart = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), flat(0xb01030));
    cart.position.set(x, y + 0.45, z);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.7), flat(0xfff2b0, { transparent: true, opacity: 0.6 }));
    glass.position.set(x, y + 1.3, z);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.9), surface(pixelTexture(0xd42040, 24)));
    roof.position.set(x, y + 1.76, z);
    const kernels = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), surface(pixelTexture(0xfff0c0, 30)));
    kernels.position.set(x, y + 1.15, z);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.3), new THREE.MeshBasicMaterial({ map: textTexture(["POPCORN"], 220, 60, "#fff2b0", "#b01030") }));
    sign.position.set(x, y + 0.75, z + 0.41);
    this.scene.add(cart, glass, roof, kernels, sign);
    this.popcornPlaceholders.push(cart, glass, roof, kernels, sign);
    this.solids.push({ min: new THREE.Vector3(x - 0.65, y, z - 0.45), max: new THREE.Vector3(x + 0.65, y + 1.9, z + 0.45) });
  }

  private counter(x: number, y: number, z: number, wood: THREE.Texture) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 1.2), surface(wood));
    top.position.set(x, y + 0.55, z);
    this.scene.add(top);
    this.solids.push({ min: new THREE.Vector3(x - 2.5, y, z - 0.6), max: new THREE.Vector3(x + 2.5, y + 1.1, z + 0.6) });
    this.sign(["CONCESSIONS"], x, y + 0.6, z + 0.61, 3, 0.4, 0, "#fff2b0", "#b01030");
    for (let i = 0; i < 4; i++) {
      const cup = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), flat(i % 2 ? 0xb01030 : 0xf4ede0));
      cup.position.set(x - 1.6 + i * 1.0, y + 1.3, z);
      this.scene.add(cup);
    }
  }

  private plant(x: number, y: number, z: number, wood: THREE.Texture) {
    const pot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), surface(wood));
    pot.position.set(x, y + 0.25, z);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), flat(0x4a3018));
    trunk.position.set(x, y + 1.0, z);
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), surface(pixelTexture(0x2f7a2a, 28)));
    leaves.position.set(x, y + 1.75, z);
    leaves.castShadow = true;
    this.scene.add(pot, trunk, leaves);
    this.plantPlaceholders.push(pot, trunk, leaves);
    this.plantSpots.push({ x, y, z });
    this.solids.push({ min: new THREE.Vector3(x - 0.3, y, z - 0.3), max: new THREE.Vector3(x + 0.3, y + 1.0, z + 0.3) });
  }

  private velvetRope(x: number, y: number, z: number) {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.4 });
    for (const px of [-3.2, 3.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), gold);
      post.position.set(x + px, y + 0.5, z);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), gold);
      foot.position.set(x + px, y + 0.025, z);
      this.scene.add(post, foot);
    }
    for (const px of [-5.3, 5.3]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.06), flat(0x8a1020));
      rope.position.set(x + px * 0.8, y + 0.85, z);
      this.scene.add(rope);
    }
  }

  /** Props from the manifest take their placeholders' place. Many copies (the seats) become instanced meshes: one draw call each. */
  private models() {
    const models = this.opts.manifest.models;
    const loader = new GLTFLoader();
    const put = (url: string, spots: Array<{ x: number; y: number; z: number }>, size: { w: number; h: number; d: number }, placeholders: THREE.Object3D[], rotY = 0) => {
      loader.load(
        url,
        (gltf) => {
          const src = gltf.scene;
          src.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(src);
          const dims = new THREE.Vector3();
          box.getSize(dims);
          const scale = Math.min(size.w / (dims.x || 1), size.h / (dims.y || 1), size.d / (dims.z || 1));
          const center = new THREE.Vector3();
          box.getCenter(center);
          for (const p of placeholders) p.visible = false;
          // Where each copy's origin goes, after the model is scaled to fit and set on its spot.
          const place = (spot: { x: number; y: number; z: number }) =>
            new THREE.Matrix4().compose(
              new THREE.Vector3(spot.x - center.x * scale, spot.y - box.min.y * scale, spot.z - center.z * scale),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
              new THREE.Vector3(scale, scale, scale),
            );
          if (spots.length === 1) {
            src.applyMatrix4(place(spots[0]));
            src.traverse((o) => {
              if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
            });
            // A single model sits in a group at its spot, so it can turn (Judy faces whoever comes to the window).
            const group = new THREE.Group();
            group.position.set(spots[0].x, spots[0].y, spots[0].z);
            src.position.sub(group.position);
            group.add(src);
            this.scene.add(group);
            if (placeholders === this.judyPlaceholders) this.judyFigure = group;
          } else {
            const placements = spots.map(place);
            src.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
              const local = mesh.matrixWorld.clone();
              const m = new THREE.Matrix4();
              placements.forEach((pm, i) => inst.setMatrixAt(i, m.multiplyMatrices(pm, local)));
              inst.instanceMatrix.needsUpdate = true;
              inst.receiveShadow = true;
              this.scene.add(inst);
              if (placeholders === this.seatPlaceholders) this.seatModels.push(inst);
            });
          }
          this.renderer.shadowMap.needsUpdate = true;
        },
        undefined,
        () => {
          /* the placeholder stays */
        },
      );
    };
    // Meshy models face the camera of their picture (+z); the seats must face the screen (-z).
    if (models.seat) put(models.seat, this.seatSpots, { w: 1.0, h: 1.1, d: 0.95 }, this.seatPlaceholders, Math.PI);
    if (models.plant) put(models.plant, this.plantSpots, { w: 1.0, h: 2.1, d: 1.0 }, this.plantPlaceholders);
    if (models.popcorn) put(models.popcorn, [{ x: -6, y: 0, z: LOBBY.z1 - 4 }], { w: 1.3, h: 1.9, d: 0.9 }, this.popcornPlaceholders);
    // Judy stands behind her counter, facing the window; the counter hides her from the waist down.
    if (models.judy) put(models.judy, [{ x: BOOTH.x - 0.2, y: 0.25, z: BOOTH.z - 0.25 }], { w: 1.0, h: 1.75, d: 0.8 }, this.judyPlaceholders);
  }

  // ── Media: the music, the film, the sounds ──────────────────────────────

  private media() {
    const { manifest } = this.opts;
    if (manifest.music) {
      const a = new Audio(manifest.music);
      a.loop = true;
      a.volume = 0.55;
      a.preload = "auto";
      this.music = a;
    }
    for (const [key, url] of Object.entries(manifest.sounds)) {
      if (!url) continue;
      const a = new Audio(url);
      a.preload = "auto";
      a.volume = 0.8;
      this.sounds[key] = a;
    }
    if (manifest.movie) {
      const v = document.createElement("video");
      v.src = manifest.movie;
      v.preload = "auto";
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.setAttribute("playsinline", "");
      Object.assign(v.style, { position: "absolute", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
      this.container.appendChild(v);
      v.addEventListener("ended", () => this.movieEnded());
      // The screen stays dark until the lights go down; the texture goes on when the film starts.
      const tex = new THREE.VideoTexture(v);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.videoTexture = tex;
      this.video = v;
    } else if (this.css && manifest.youtube) {
      // The screen is a hole in the WebGL layer; the YouTube player sits behind it in the CSS3D layer.
      this.screenMaterial.opacity = 0;
      this.screenMaterial.transparent = false;
      this.screenMaterial.blending = THREE.NoBlending;
      this.screenMaterial.side = THREE.DoubleSide;
      this.screenMaterial.needsUpdate = true;
      const iframe = document.createElement("iframe");
      const origin = encodeURIComponent(window.location.origin);
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(manifest.youtube)}?enablejsapi=1&controls=0&disablekb=1&rel=0&modestbranding=1&playsinline=1&origin=${origin}`;
      iframe.width = "1280";
      iframe.height = "720";
      iframe.allow = "autoplay; encrypted-media";
      iframe.title = "The film";
      Object.assign(iframe.style, { border: "0", background: "#000" });
      const obj = new CSS3DObject(iframe);
      obj.position.set(0, SCREEN.y, SCREEN.z - 0.01);
      obj.scale.setScalar(SCREEN.w / 1280);
      this.scene.add(obj);
      this.yt = { player: null, iframe };
      loadYouTubeApi()
        .then((YT) => {
          if (!this.yt) return;
          this.yt.player = new YT.Player(iframe, { events: { onStateChange: (e) => e.data === 0 && this.movieEnded() } });
        })
        .catch(() => {
          /* the escape hatch in the HUD covers a blocked player */
        });
    }
  }

  private play(key: string, volume = 0.8) {
    const a = this.sounds[key];
    if (!a) return;
    try {
      a.volume = volume;
      a.currentTime = 0;
      void a.play().catch(() => {});
    } catch {
      /* no sound */
    }
  }

  /** How loud the song sits once it has come in; the climb takes it up from here. */
  private static readonly MUSIC_IN = 0.45;

  /** The song comes in: from `from` seconds into the track, easing up to its level over `ms`. */
  private fadeInMusic(from = this.opts.manifest.musicCue?.from ?? 0, ms = 3000) {
    const a = this.music;
    if (!a) return;
    if (this.musicFade !== null) cancelAnimationFrame(this.musicFade);
    this.musicFade = null;
    try {
      a.currentTime = from;
    } catch {
      /* not seekable yet: it plays from wherever it is */
    }
    a.volume = 0;
    void a.play().catch(() => {});
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      // Eased: slow at first, then up, then settling.
      a.volume = SigningGame.MUSIC_IN * (0.5 - 0.5 * Math.cos(Math.PI * k));
      if (k < 1) this.musicFade = requestAnimationFrame(step);
      else this.musicFade = null;
    };
    this.musicFade = requestAnimationFrame(step);
  }

  /** The cue during the film ("Anything is possible"): the song comes in on the line and takes over from there. */
  private cueMusic() {
    const cue = this.opts.manifest.musicCue;
    if (this.cued || !cue || !this.music || this.phase !== "movie") return;
    const t = this.video ? this.video.currentTime : (this.yt?.player?.getCurrentTime?.() ?? 0);
    if (t < cue.at) return;
    this.cued = true;
    this.fadeInMusic(cue.from, Math.max(0, cue.fadeIn) * 1000);
  }

  private fadeOutMusic() {
    const a = this.music;
    if (!a || this.musicFade !== null) return;
    const start = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 2500);
      a.volume = start * (1 - k);
      if (k < 1) this.musicFade = requestAnimationFrame(step);
      else {
        a.pause();
        this.musicFade = null;
      }
    };
    this.musicFade = requestAnimationFrame(step);
  }

  /**
   * Puts the film's sound through a big room: early slaps off the walls and a
   * couple of seconds of decay, the highs rolled off as they would be from a
   * seat. Only the film file can be treated; a YouTube embed keeps its own sound.
   */
  private theaterAcoustics() {
    if (!this.video || this.audio) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(this.video);
      const dry = ctx.createGain();
      dry.gain.value = 0.62;
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      const reverb = ctx.createConvolver();
      reverb.buffer = impulseResponse(ctx, 2.4);
      src.connect(dry).connect(ctx.destination);
      src.connect(lp).connect(reverb).connect(wet).connect(ctx.destination);
      this.audio = ctx;
      this.disposers.push(() => void ctx.close().catch(() => {}));
    } catch {
      /* no Web Audio: the film plays as it is */
    }
  }

  private startMovie() {
    this.setPhase("movie");
    this.heckle();
    if (this.video) {
      this.theaterAcoustics();
      void this.audio?.resume().catch(() => {});
      if (this.videoTexture && !this.screenMaterial.map) {
        this.screenMaterial.map = this.videoTexture;
        this.screenMaterial.color.set(0xffffff);
        this.screenMaterial.needsUpdate = true;
      }
      this.video.currentTime = 0;
      this.video.play().then(
        () => this.setHud({ needsClick: false }),
        () => this.setHud({ needsClick: true }),
      );
    } else if (this.yt) {
      const tryPlay = () => this.yt?.player?.playVideo();
      tryPlay();
      // If the API isn't there yet, try again as it lands.
      const t = setTimeout(tryPlay, 1500);
      this.disposers.push(() => clearTimeout(t));
    }
  }

  /** Twelve seconds into the film, Judy over the speakers. */
  private paTimer: ReturnType<typeof setTimeout> | null = null;
  private heckle() {
    const line = this.opts.judy?.extras?.pa;
    if (!line) return;
    if (this.paTimer) clearTimeout(this.paTimer);
    this.paTimer = setTimeout(() => {
      if (this.phase !== "movie") return;
      const speaker = `${this.opts.judy?.name ?? "Judy"}, over the speakers`;
      const url = this.opts.manifest.voice[line.id];
      const chunks = subtitleChunks(line.text);
      // The film waits while she talks, and carries on once her voice and the subtitles are both done.
      let waiting = url ? 2 : 1;
      const resume = () => {
        if (--waiting > 0 || this.phase !== "movie") return;
        void this.video?.play().catch(() => {});
        this.yt?.player?.playVideo();
      };
      const show = (i: number) => {
        if (this.phase !== "movie") return;
        if (i >= chunks.length) {
          this.setHud({ dialogue: null });
          return resume();
        }
        this.setHud({ dialogue: { speaker, text: chunks[i], options: null } });
        this.talkTimers.push(setTimeout(() => show(i + 1), 2600));
      };
      this.video?.pause();
      this.yt?.player?.pauseVideo?.();
      if (url) {
        const a = new Audio();
        a.crossOrigin = "anonymous";
        a.src = url;
        a.volume = 0.9;
        this.throughSpeaker(a);
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          resume();
        };
        a.onended = end;
        a.onerror = end;
        void a.play().catch(end);
      }
      show(0);
    }, 12000);
    this.disposers.push(() => {
      if (this.paTimer) clearTimeout(this.paTimer);
    });
  }

  /**
   * Plays a voice line as the theater's PA would: thin and a little hard
   * through the horn (the lows and highs gone, a push in the middle, a
   * touch of drive), then the room's echo on top. Without Web Audio, or if
   * the file can't be routed, the line plays plain.
   */
  private throughSpeaker(a: HTMLAudioElement) {
    try {
      if (!this.pa) {
        const ctx = new AudioContext();
        this.pa = ctx;
        this.disposers.push(() => void ctx.close().catch(() => {}));
      }
      const ctx = this.pa;
      const src = ctx.createMediaElementSource(a);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 350;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3600;
      lp.Q.value = 1.1;
      const horn = ctx.createBiquadFilter();
      horn.type = "peaking";
      horn.frequency.value = 1900;
      horn.Q.value = 1.4;
      horn.gain.value = 6;
      const drive = ctx.createWaveShaper();
      drive.curve = softClip(1.8);
      drive.oversample = "2x";
      const dry = ctx.createGain();
      dry.gain.value = 0.55;
      const echo = ctx.createConvolver();
      echo.buffer = impulseResponse(ctx, 2.8);
      const wet = ctx.createGain();
      wet.gain.value = 0.75;
      src.connect(hp).connect(lp).connect(horn).connect(drive);
      drive.connect(dry).connect(ctx.destination);
      drive.connect(echo).connect(wet).connect(ctx.destination);
      void ctx.resume().catch(() => {});
    } catch {
      /* the line plays as it is */
    }
  }

  private movieEnded() {
    if (this.phase !== "movie") return;
    this.setPhase("ended");
    this.setMarquee(["SOLD OUT", `${(this.opts.signerName.trim().split(/\s+/)[0] || "Sam").toUpperCase()} WAS HERE`]);
    this.doorOpenAt = performance.now();
    this.play("door");
    this.exitSign.emissiveIntensity = 2.2;
    this.setHud({ prompt: "The film is over. The door by the screen is open: click to stand up.", needsClick: false });
    this.checkpoint.set(COURT.x0 + 1.5, FRONT_FLOOR, (DOOR.z0 + DOOR.z1) / 2);
  }

  // ── Input ───────────────────────────────────────────────────────────────

  private listen() {
    const el = this.renderer.domElement;
    const on = (target: Document | HTMLElement | Window, type: string, fn: (e: any) => void) => {
      target.addEventListener(type, fn);
      this.disposers.push(() => target.removeEventListener(type, fn));
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyE" || e.code === "Enter") this.interact();
      if (this.phase === "talk" && /^(Digit|Numpad)[1-3]$/.test(e.code)) this.choose(Number(e.code.slice(-1)) - 1);
      if (["Space", "ArrowUp", "ArrowDown"].includes(e.code) && this.walking()) e.preventDefault();
      if (e.code === "Space" && this.walking()) this.jumpPressedAt = performance.now();
    });
    on(window, "keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      // Let go early and the jump is a hop.
      if (e.code === "Space" && this.vy > 3.2) this.vy = 3.2;
    });
    on(window, "blur", () => this.keys.clear());
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked && this.walking()) this.setHud({ paused: true });
      if (this.locked) this.setHud({ paused: false });
    });
    on(el, "mousemove", (e: MouseEvent) => {
      // Walking needs the pointer locked (or a drag); from a seat or Judy's window the view just follows the mouse.
      if (!(this.locked || this.dragging || this.looking())) return;
      if (this.walking()) {
        this.yaw -= e.movementX * 0.0022;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * 0.0022));
      } else if (this.looking() && this.lookBase && !this.tween) {
        // Looking around from a seat or a window: so far each way, no further.
        const b = this.lookBase;
        this.yaw = Math.max(b.yaw - 1.1, Math.min(b.yaw + 1.1, this.yaw - e.movementX * 0.0022));
        this.pitch = Math.max(Math.max(-1.4, b.pitch - 0.6), Math.min(Math.min(1.4, b.pitch + 0.6), this.pitch - e.movementY * 0.0022));
      }
    });
    on(el, "mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.phase === "ended") return this.standUp();
      if (this.phase === "exit" && this.nearContract()) return this.finish();
      if (this.phase === "movie" && this.hud.needsClick) return this.startMovie();
      if (this.walking()) {
        this.dragging = true;
        if (!this.locked) this.lockPointer();
      } else if (this.looking()) this.dragging = true;
    });
    on(window, "mouseup", () => (this.dragging = false));
    on(el, "contextmenu", (e: Event) => e.preventDefault());
  }

  private walking() {
    return this.phase === "outside" || this.phase === "lobby" || this.phase === "theater" || this.phase === "exit";
  }

  /** Sat down or at Judy's window: no walking, but the view can turn a little either way. */
  private looking() {
    return this.phase === "talk" || this.phase === "seated" || this.phase === "movie" || this.phase === "ended";
  }

  /** Takes the camera's current direction as the one to look around from. */
  private settleLook() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = e.y;
    this.pitch = e.x;
    this.lookBase = { yaw: e.y, pitch: e.x };
  }

  private lockPointer() {
    try {
      const r = this.renderer.domElement.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* drag to look still works */
    }
  }

  /** The HUD's "click to begin": starts the walk and the music. */
  begin() {
    if (this.phase !== "intro") return;
    this.beganAt = performance.now();
    this.setPhase("outside");
    this.lockPointer();
    void this.music?.play().catch(() => {});
    this.hint("The theater is on the island ahead. Jump the blocks to get there: W A S D to move, mouse to look, space to jump. The blue ones move.", 8000);
  }

  /** The HUD's "click to continue" after Escape. */
  resume() {
    if (this.walking()) this.lockPointer();
  }

  private interact() {
    if (this.phase === "outside" && !this.hud.ticket && this.nearBooth()) this.startTalk();
    else if (this.phase === "theater" && this.nearReservedSeat()) this.sit();
    else if (this.phase === "exit" && this.nearContract()) this.finish();
    else if (this.phase === "ended") this.standUp();
  }

  private nearBooth() {
    return Math.hypot(this.pos.x - BOOTH.x, this.pos.z - (BOOTH.z + BOOTH.d / 2)) < 3.0 && Math.abs(this.pos.y) < 1.5;
  }

  // ── Judy ────────────────────────────────────────────────────────────────

  /** Walks up to the booth: the mouse is freed for the replies, the music drops, and Judy says hello. */
  private startTalk() {
    this.setPhase("talk");
    if (this.locked) document.exitPointerLock();
    this.keys.clear();
    if (this.music) this.music.volume = 0.18;
    this.setHud({ prompt: "" });
    // Turn to face her.
    const eye = this.camera.position.clone();
    const look = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(BOOTH.x - 0.2, 2.05, BOOTH.z - 0.25), new THREE.Vector3(0, 1, 0));
    this.tween = {
      from: eye,
      to: eye.clone(),
      qFrom: this.camera.quaternion.clone(),
      qTo: new THREE.Quaternion().setFromRotationMatrix(look),
      start: performance.now(),
      dur: 600,
      then: () => this.settleLook(),
    };
    const judy = this.opts.judy;
    if (!judy) {
      this.say([{ id: "final", text: "Here's a ticket. Second row, on the aisle." }], () => this.giveTicket());
      return;
    }
    this.talking = { round: 0 };
    this.say([judy.greeting], () => this.offer());
  }

  /** The three things Sam can say in this round. */
  private offer() {
    const judy = this.opts.judy;
    const t = this.talking;
    if (!judy || !t) return;
    const round = judy.rounds[t.round];
    this.setHud({ dialogue: { speaker: judy.name, text: this.hud.dialogue?.text ?? "", options: round.options.map((o) => o.sam) } });
  }

  /** Sam's reply (clicked or keys 1–3): shown for a moment, then Judy's answer and her ramble. */
  choose(i: number) {
    const judy = this.opts.judy;
    const t = this.talking;
    if (this.phase !== "talk" || !judy || !t || !this.hud.dialogue?.options) return;
    const round = judy.rounds[t.round];
    const opt = round.options[i];
    if (!opt) return;
    this.setHud({ dialogue: { speaker: "You", text: opt.sam, options: null } });
    const after = () => {
      const lines = [opt.judy, round.core];
      const last = t.round >= judy.rounds.length - 1;
      this.say(lines, () => {
        if (last) this.say([judy.final], () => this.giveTicket());
        else {
          t.round++;
          this.offer();
        }
      });
    };
    this.talkTimers.push(setTimeout(after, 1700));
  }

  /**
   * Judy speaks: each line's clip plays if it was voiced, and its words are
   * shown a sentence or two at a time, paced to the clip (or to a reading
   * speed without one). `then` runs when the last line is done.
   */
  private say(lines: JudyLine[], then: () => void) {
    const judy = this.opts.judy;
    const speaker = judy?.name ?? "Judy";
    const next = (k: number) => {
      if (k >= lines.length) return then();
      const line = lines[k];
      const chunks = subtitleChunks(line.text);
      const words = chunks.map((c) => c.split(/\s+/).length);
      const total = words.reduce((a, b) => a + b, 0);
      // The timers pacing this line, so Space can drop them and move on.
      const mine: Array<ReturnType<typeof setTimeout>> = [];
      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms);
        mine.push(t);
        this.talkTimers.push(t);
      };
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const t of mine) clearTimeout(t);
        if (this.talkAudio) {
          this.talkAudio.pause();
          this.talkAudio = null;
        }
        next(k + 1);
      };
      const schedule = (seconds: number) => {
        let at = 0;
        chunks.forEach((text, i) => {
          later(() => this.setHud({ dialogue: { speaker, text, options: null } }), at * 1000);
          at += (seconds * words[i]) / total;
        });
        later(finish, seconds * 1000 + 350);
      };
      // Judy's line plays through: there is no skipping her.
      const url = this.opts.manifest.voice[line.id];
      if (!url) return schedule(total * 0.42 + 0.4);
      const a = new Audio(url);
      a.preload = "auto";
      this.talkAudio = a;
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        const seconds = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total * 0.42 + 0.4;
        schedule(seconds);
      };
      a.addEventListener("loadedmetadata", () => {
        a.play().then(start, () => start());
      });
      a.addEventListener("error", () => start());
      // A clip that never loads shouldn't hold the line.
      later(start, 4000);
      a.load();
    };
    next(0);
  }

  private giveTicket() {
    this.play("sign");
    this.talking = null;
    this.lookBase = null;
    // Carry the facing from the conversation into the walk.
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = e.y;
    this.pitch = e.x;
    this.setHud({ ticket: true, dialogue: null });
    if (this.ticketHand) this.ticketHand.visible = true;
    this.setPhase("outside");
    if (this.music) this.music.volume = 0.55;
    this.hint("You've got your ticket. Show it at the front doors.", 5000);
    this.lockPointer();
  }

  /** A ticket held low and to the right, like a weapon in a shooter; it rises to the doors when they're reached. */
  private ticketInHand() {
    this.scene.add(this.camera);
    const g = new THREE.Group();
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.072), new THREE.MeshBasicMaterial({ map: ticketTexture(FILM_TITLE, this.opts.signerName), side: THREE.DoubleSide, toneMapped: false }));
    g.add(card);
    g.visible = false;
    this.camera.add(g);
    this.ticketHand = g;
  }

  private static readonly TICKET_HELD = { pos: new THREE.Vector3(0.19, -0.135, -0.42), rot: new THREE.Euler(-0.35, -0.55, 0.3) };
  private static readonly TICKET_SHOWN = { pos: new THREE.Vector3(0.02, -0.05, -0.3), rot: new THREE.Euler(-0.12, 0.05, 0.04) };

  private handTicket(now: number) {
    const g = this.ticketHand;
    if (!g || !g.visible) return;
    // At the doors with the ticket: hold it up, and the doors open for it.
    if (!this.presentedAt && this.phase === "outside" && Math.abs(this.pos.x) < 2.1 && this.pos.z > BLDG.z1 && this.pos.z < BLDG.z1 + 2.4 && this.pos.y > -1) {
      this.presentedAt = now;
      this.hint("Ticket, please.", 2500);
    }
    const t = this.presentedAt ? Math.min(1, (now - this.presentedAt) / 800) : 0;
    const e = t * t * (3 - 2 * t);
    const H = SigningGame.TICKET_HELD;
    const S = SigningGame.TICKET_SHOWN;
    const walkBob = this.moving && !this.presentedAt ? Math.sin(this.bob) : 0;
    g.position.copy(H.pos).lerp(S.pos, e);
    g.position.x += 0.006 * walkBob;
    g.position.y += 0.004 * Math.sin(this.bob * 2) * (walkBob ? 1 : 0);
    g.rotation.set(H.rot.x + (S.rot.x - H.rot.x) * e, H.rot.y + (S.rot.y - H.rot.y) * e, H.rot.z + (S.rot.z - H.rot.z) * e);
    if (this.presentedAt && t >= 1 && !this.frontOpenAt) {
      this.frontOpenAt = now;
      this.play("door");
      this.hint("In you go.", 3000);
    }
    // Taken at the door: once the doors are moving, the hand is empty.
    if (this.presentedAt && now - this.presentedAt > 1700) g.visible = false;
  }

  private nearReservedSeat() {
    const s = this.reservedSeat();
    return Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < 1.9 && Math.abs(this.pos.y - s.y) < 1.2;
  }

  private nearContract() {
    return Math.hypot(this.pos.x - HEAVEN.x, this.pos.z - HEAVEN.z) < 2.2 && Math.abs(this.pos.y - HEAVEN.y) < 2;
  }

  private sit() {
    this.setPhase("seated");
    this.play("sit");
    if (this.locked) document.exitPointerLock();
    const s = this.reservedSeat();
    const to = new THREE.Vector3(s.x, s.y + 1.2, s.z + 0.1);
    const look = new THREE.Matrix4().lookAt(to, new THREE.Vector3(0, SCREEN.y, SCREEN.z), new THREE.Vector3(0, 1, 0));
    const qTo = new THREE.Quaternion().setFromRotationMatrix(look);
    this.tween = {
      from: this.camera.position.clone(),
      to,
      qFrom: this.camera.quaternion.clone(),
      qTo,
      start: performance.now(),
      dur: 1100,
      then: () => {
        this.settleLook();
        this.startMovie();
      },
    };
    this.setHud({ prompt: "" });
  }

  private standUp() {
    if (this.phase !== "ended") return;
    this.lookBase = null;
    const s = this.reservedSeat();
    this.pos.set(0.5, s.y, s.z);
    this.eyeY = s.y + PLAYER.eye;
    this.vy = 0;
    this.yaw = -0.9; // facing the screen, turned a little toward the door
    this.pitch = 0;
    this.setPhase("exit");
    this.setHud({ prompt: "" });
    this.hint("Through the open door by the screen: a staircase climbs into the sky. The contract is at the top.", 8000);
    // The song is already playing if it came in on its cue; otherwise it comes in now.
    if (!this.cued) this.fadeInMusic();
    this.startWind();
    this.lockPointer();
  }

  /** On the stairs: the wind rises with the height, and so does the music. Both ease off once signed. */
  private climb(now: number) {
    if (this.phase !== "exit" && this.phase !== "done") return;
    const f = this.phase === "done" ? 0 : Math.max(0, Math.min(1, (this.pos.y - FRONT_FLOOR) / (HEAVEN.y - FRONT_FLOOR)));
    if (this.wind) {
      const w = this.wind;
      w.filter.frequency.value = 260 + 140 * Math.sin(now / 1700) + 70 * Math.sin(now / 530);
      w.gain.gain.setTargetAtTime(0.5 * f * f, w.ctx.currentTime, 0.25);
    }
    if (this.music && this.musicFade === null && this.phase === "exit") this.music.volume = Math.min(1, SigningGame.MUSIC_IN + (1 - SigningGame.MUSIC_IN) * f);
  }

  private startWind() {
    if (this.wind) return;
    try {
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = 0.98 * last + 0.02 * (Math.random() * 2 - 1);
        d[i] = last * 6;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 300;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.wind = { ctx, gain, filter };
      this.disposers.push(() => void ctx.close().catch(() => {}));
    } catch {
      /* no Web Audio: a quiet climb */
    }
  }

  private static readonly PEN_FROM = { pos: new THREE.Vector3(0.24, -0.42, -0.34), rot: new THREE.Euler(0.4, 0.2, -1.2) };
  private static readonly PEN_HELD = { pos: new THREE.Vector3(0.16, -0.11, -0.3), rot: new THREE.Euler(0.95, 0.25, -0.55) };

  /** The pen floats up into the hand at the contract; after the signature it scribbles for a moment. */
  private handPen(now: number) {
    const g = this.penHand;
    if (!g) return;
    if (!this.penTakenAt && this.phase === "exit" && this.nearContract()) {
      this.penTakenAt = now;
      if (this.pen) this.pen.visible = false;
      g.visible = true;
    }
    if (!g.visible) return;
    const t = Math.min(1, (now - this.penTakenAt) / 700);
    const e = t * t * (3 - 2 * t);
    const F = SigningGame.PEN_FROM;
    const H = SigningGame.PEN_HELD;
    g.position.copy(F.pos).lerp(H.pos, e);
    g.rotation.set(F.rot.x + (H.rot.x - F.rot.x) * e, F.rot.y + (H.rot.y - F.rot.y) * e, F.rot.z + (H.rot.z - F.rot.z) * e);
  }

  /** At the contract: straight to the signing page. Nothing is signed yet, so no sound, no sign, no ceremony. */
  private finish() {
    this.setPhase("done");
    if (this.locked) document.exitPointerLock();
    this.setHud({ prompt: "" });
    this.opts.onDone();
  }

  // ── Each frame ──────────────────────────────────────────────────────────

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.pace(now, raw);
    if (this.walking() && !this.hud.paused) this.move(dt);
    else if (this.looking() && !this.tween && this.lookBase) this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.story(now);
    this.lights(dt);
    this.animate(now, dt);
    this.renderer.render(this.scene, this.camera);
    this.css?.render(this.scene, this.camera);
  };

  /**
   * Keeps the frame time low: every half second the fps is read, and when
   * frames are taking longer than about 8 ms the picture is drawn at a lower
   * resolution (down to 60%), stepping back up when there's headroom.
   */
  private pace(now: number, raw: number) {
    this.frames++;
    this.frameTime += raw;
    if (now - this.fpsAt < 500) return;
    const fps = this.frames / ((now - this.fpsAt) / 1000);
    const avg = this.frameTime / this.frames;
    this.frames = 0;
    this.frameTime = 0;
    this.fpsAt = now;
    let scale = this.scale;
    if (avg > 0.0095 && scale > 0.6) scale = Math.max(0.6, scale - 0.1);
    else if (avg < 0.006 && scale < 1) scale = Math.min(1, scale + 0.05);
    // Still slow at the lowest resolution: the heavy seats go, and so do the shadows.
    // Only once the signer has been playing a while: the first seconds after the build are slow for everyone (shaders compiling).
    const playing = this.phase !== "intro" && this.beganAt > 0 && performance.now() - this.beganAt > 6000;
    if (playing && !this.lowQuality && scale <= 0.6 && avg > 0.012) {
      if (++this.slowReadings >= 3) this.dropQuality();
    } else this.slowReadings = 0;
    if (scale !== this.scale) {
      this.scale = scale;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1) * scale);
      this.resize();
    }
    if (Math.round(fps) !== this.hud.fps) this.setHud({ fps: Math.round(fps) });
  }

  /** Simple seats, no shadows, fewer lights: what a slow machine gets so the game still runs well. */
  private dropQuality() {
    this.lowQuality = true;
    for (const m of this.seatModels) m.visible = false;
    for (const p of this.seatPlaceholders) p.visible = true;
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (mat) mat.needsUpdate = true;
      }
    });
    this.houseLights.slice(2).forEach((l) => (l.intensity = 0));
    this.clouds.forEach((c, i) => (c.visible = i % 2 === 0));
  }

  private move(dt: number) {
    const k = this.keys;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const speed = PLAYER.speed * (k.has("ShiftLeft") || k.has("ShiftRight") ? 1.6 : 1);
    const len = Math.hypot(f, r) || 1;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // The camera looks down -z at yaw 0; forward and strafe follow the yaw.
    const dx = ((-sin * f + cos * r) / len) * speed * dt;
    const dz = ((-cos * f - sin * r) / len) * speed * dt;
    const now = performance.now();
    // A press up to 150 ms before landing still jumps; up to 120 ms after walking off an edge still jumps.
    const wantsJump = this.jumpPressedAt >= 0 && now - this.jumpPressedAt < 150;
    const canJump = this.grounded || (now - this.lastGrounded < 120 && this.vy <= 0.5);
    if (wantsJump && canJump) {
      this.vy = PLAYER.jump;
      this.grounded = false;
      this.jumpPressedAt = -1;
      this.lastGrounded = 0;
      this.play("jump");
    }
    this.vy -= PLAYER.gravity * dt;
    this.slide(0, dx);
    this.slide(2, dz);
    this.pos.y += this.vy * dt;
    const hitY = this.resolve(1, this.vy);
    if (hitY < 0) {
      if (!this.grounded && this.vy < -6) {
        this.play("land");
        this.landDip = Math.min(0.22, -this.vy * 0.014);
        this.puff();
      }
      this.grounded = true;
      this.lastGrounded = now;
      this.vy = 0;
    } else if (hitY > 0) this.vy = 0;
    else this.grounded = false;
    // Footsteps and a gentle bob while walking on the ground.
    this.moving = (f !== 0 || r !== 0) && this.grounded;
    if (this.moving) {
      this.bob += dt * 9.5;
      this.stepClock += dt;
      if (this.stepClock > 0.42) {
        this.stepClock = 0;
        this.stepSide ^= 1;
        this.play("step", this.stepSide ? 0.5 : 0.36);
      }
    } else this.stepClock = 0.3;
    this.landDip = Math.max(0, this.landDip - dt * 0.9);
    // The eye follows the feet with a little give, so a step up a riser doesn't jolt.
    const eyeTarget = this.pos.y + PLAYER.eye;
    this.eyeY += (eyeTarget - this.eyeY) * Math.min(1, dt * (this.grounded ? 14 : 40));
    if (Math.abs(eyeTarget - this.eyeY) > 0.6) this.eyeY = eyeTarget;
    const bob = this.moving ? Math.sin(this.bob) * 0.028 : 0;
    this.camera.position.set(this.pos.x, this.eyeY + bob - this.landDip, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** A little dust where the feet landed. */
  private puff() {
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(this.dustMat.clone());
      const a = (i / 10) * Math.PI * 2;
      sprite.position.set(this.pos.x, this.pos.y + 0.05, this.pos.z);
      sprite.scale.setScalar(0.18);
      this.scene.add(sprite);
      this.dust.push({ sprite, v: new THREE.Vector3(Math.cos(a) * 1.6, 0.9 + Math.random() * 0.6, Math.sin(a) * 1.6), life: 0.55 });
    }
  }

  /** Moves along a horizontal axis, stepping up low ledges (the rows' risers). */
  private slide(axis: 0 | 2, d: number) {
    if (!d) return;
    const key = axis === 0 ? "x" : "z";
    this.pos[key] += d;
    if (!this.overlapping()) return;
    const raised = this.pos.y;
    this.pos.y += PLAYER.step;
    if (!this.overlapping()) {
      this.grounded = true;
      return;
    }
    this.pos.y = raised;
    this.resolve(axis, d);
  }

  /** Pushes the player out of whatever they moved into along one axis. Returns the push direction, or 0. */
  private resolve(axis: 0 | 1 | 2, d: number): number {
    const key = axis === 0 ? "x" : axis === 1 ? "y" : "z";
    let pushed = 0;
    for (const b of this.solids) {
      if (!this.overlaps(b)) continue;
      if (axis === 1) {
        if (d <= 0) {
          this.pos.y = b.max.y;
          pushed = -1;
        } else {
          this.pos.y = b.min.y - PLAYER.height;
          pushed = 1;
        }
      } else if (d > 0) {
        this.pos[key] = b.min[key] - PLAYER.radius - 0.001;
        pushed = 1;
      } else {
        this.pos[key] = b.max[key] + PLAYER.radius + 0.001;
        pushed = -1;
      }
    }
    return pushed;
  }

  private overlapping(): boolean {
    for (const b of this.solids) if (this.overlaps(b)) return true;
    return false;
  }

  private overlaps(b: Box): boolean {
    const p = this.pos;
    const r = PLAYER.radius;
    return p.x + r > b.min.x && p.x - r < b.max.x && p.y + PLAYER.height > b.min.y && p.y < b.max.y && p.z + r > b.min.z && p.z - r < b.max.z;
  }

  private story(now: number) {
    const p = this.pos;
    if (this.phase === "outside") {
      // Checkpoints: each resting island, then the theater's island.
      for (const [rx, rtop, rz] of RESTS) {
        if (Math.abs(p.z - rz) < 3 && Math.abs(p.x - rx) < 3 && Math.abs(p.y - rtop) < 0.6 && this.checkpoint.z > rz) {
          this.checkpoint.set(rx, rtop, rz);
          this.hint("A rest. Fall from here and you start again from this island.", 5000);
        }
      }
      if (p.z < ISLAND.z1 - 0.5 && p.y > -1 && this.checkpoint.z > ISLAND.z1) {
        this.checkpoint.set(0, 0, ISLAND.z1 - 3);
        this.hint("You made it. Get your ticket at the booth.", 6000);
      }
      if (p.z < BLDG.z1 - 0.4 && Math.abs(p.x) < 2 && p.y > -1) {
        this.setPhase("lobby");
        this.hint("Through the lobby to the auditorium.", 5000);
      }
      if (p.y < ABYSS) {
        this.play("fall");
        p.copy(this.checkpoint);
        this.vy = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.eyeY = p.y + PLAYER.eye;
        this.setHud({ dark: 1 });
        this.falls++;
        this.hint(this.falls < 3 ? "Back to the island. Walk to the edge and jump a touch earlier." : "Back to the island. Wait for a moving block to come to you.", 4000);
      }
    } else if (this.phase === "lobby" && p.z < LOBBY.z0 - 0.4) {
      this.setPhase("theater");
      this.fadeOutMusic();
      this.hint("Find the seat with your name on it.", 6000);
    } else if (this.phase === "exit" && p.y < ABYSS) {
      // Off the staircase: back to the courtyard.
      this.play("fall");
      p.copy(this.checkpoint);
      this.vy = 0;
      this.yaw = -Math.PI / 2;
      this.pitch = 0;
      this.eyeY = p.y + PLAYER.eye;
      this.setHud({ dark: 1 });
      this.falls++;
      this.hint("Back to the foot of the stairs. Keep to the middle of the steps.", 4000);
    }
    let prompt = this.hud.prompt;
    if (this.phase === "outside" && !this.hud.ticket && this.nearBooth()) prompt = "Press E to talk to Judy";
    else if (this.phase === "theater") prompt = this.nearReservedSeat() ? "Press E to take your seat" : now < this.hintUntil ? this.hud.prompt : "";
    else if (this.phase === "exit") {
      const there = this.nearContract();
      if (there && !this.cheered) {
        this.cheered = true;
        this.play("cheer", 0.9);
      }
      prompt = there ? "Press E or click to open the contract" : now < this.hintUntil ? this.hud.prompt : "";
    } else if ((this.phase === "outside" || this.phase === "lobby") && now >= this.hintUntil) prompt = "";
    if (prompt !== this.hud.prompt) this.setHud({ prompt });
  }

  private hint(text: string, ms: number) {
    this.hintUntil = performance.now() + ms;
    this.setHud({ prompt: text });
  }

  private lights(dt: number) {
    const movie = this.phase === "seated" || this.phase === "movie";
    const target = movie ? 1 : this.phase === "ended" ? 0.6 : 0;
    this.dim += (target - this.dim) * Math.min(1, dt * 1.8);
    this.houseLights.forEach((l, i) => (l.intensity = this.lowQuality && i >= 2 ? 0 : 160 * (1 - this.dim) + 8 * this.dim));
    this.hemi.intensity = 0.75 * (1 - this.dim) + 0.08 * this.dim;
    this.ambient.intensity = 0.3 * (1 - this.dim) + 0.03 * this.dim;
    this.screenLight.intensity = this.phase === "movie" ? 95 + 18 * Math.sin(performance.now() / 310) + 9 * Math.sin(performance.now() / 97) : this.phase === "ended" ? 40 : 0;
    this.seatLight.intensity = this.phase === "theater" ? 10 + 4 * Math.sin(performance.now() / 300) : 0;
    this.label.visible = this.phase === "lobby" || this.phase === "theater";
  }

  private animate(now: number, dt: number) {
    this.label.position.y = this.reservedSeat().y + 2.0 + 0.12 * Math.sin(now / 500);
    this.contract.position.y = HEAVEN.y + 1.85 + 0.08 * Math.sin(now / 900);
    if (this.pen) this.pen.position.y = HEAVEN.y + 1.45 + 0.06 * Math.sin(now / 600 + 1);
    for (const c of this.stairClouds) {
      c.group.position.x = c.base.x + 1.4 * Math.sin(now / 4200 + c.phase);
      c.group.position.z = c.base.z + 1.0 * Math.cos(now / 5100 + c.phase);
      c.group.position.y = c.base.y + 0.3 * Math.sin(now / 2600 + c.phase);
    }
    this.cueMusic();
    this.climb(now);
    this.handPen(now);
    const blink = Math.floor(now / 350) % 2;
    this.marqueeBulbs.forEach((m, i) => (m.emissiveIntensity = (i + blink) % 2 ? 1.6 : 0.25));
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (0.4 + (i % 3) * 0.25);
      if (c.position.x > 110) c.position.x = -110;
    }
    // Moving blocks carry whoever is standing on them.
    for (const mv of this.movers) {
      const off = mv.amp * Math.sin((now / mv.period) * Math.PI * 2 + mv.phase);
      const next = mv.base.clone();
      next[mv.axis] += off;
      const d = next.clone().sub(mv.mesh.position);
      if (!d.lengthSq()) continue;
      const p = this.pos;
      const riding =
        this.grounded &&
        Math.abs(p.y - mv.box.max.y) < 0.08 &&
        p.x + PLAYER.radius > mv.box.min.x &&
        p.x - PLAYER.radius < mv.box.max.x &&
        p.z + PLAYER.radius > mv.box.min.z &&
        p.z - PLAYER.radius < mv.box.max.z;
      mv.mesh.position.copy(next);
      mv.box.min.add(d);
      mv.box.max.add(d);
      if (riding && this.walking()) {
        p.add(d);
        this.camera.position.set(p.x, p.y + PLAYER.eye, p.z);
      }
    }
    for (const b of this.birds) {
      const a = (now / 1000) * b.speed + b.phase;
      b.group.position.set(b.cx + b.r * Math.cos(a), b.y + 0.4 * Math.sin(a * 3), b.cz + b.r * Math.sin(a));
      b.group.rotation.y = -a;
      const flap = Math.sin(now / 90 + b.phase) * 0.6;
      b.wings[0].rotation.x = flap;
      b.wings[1].rotation.x = -flap;
    }
    if (this.judyHead) this.judyHead.rotation.y = this.phase === "talk" ? 0.12 * Math.sin(now / 420) : 0.3 * Math.sin(now / 2600);
    this.handTicket(now);
    if (this.hud.ticket && this.frontOpenAt > 0 && this.frontOpen < 1) {
      // On the clock: the doors take about a second whatever the frame rate.
      this.frontOpen = Math.min(1, (now - this.frontOpenAt) / 1200);
      for (const { group, side } of this.frontDoors) group.rotation.y = side * ((Math.PI / 2) * (1 - this.frontOpen) + 0.4 * this.frontOpen);
      if (this.frontOpen >= 1 && this.frontDoorSolid) {
        const i = this.solids.indexOf(this.frontDoorSolid);
        if (i >= 0) this.solids.splice(i, 1);
        this.frontDoorSolid = null;
        for (const { group } of this.frontDoors) {
          const b = new THREE.Box3().setFromObject(group);
          this.solids.push({ min: b.min, max: b.max });
        }
      }
    }
    if (this.phase === "ended" || this.phase === "exit" || this.phase === "done") {
      if (this.doorOpen < 1) {
        this.doorOpen = Math.min(1, (now - this.doorOpenAt) / 1200);
        this.doorGroup.rotation.y = this.doorOpen * 1.8;
        if (this.doorOpen >= 1 && this.doorSolid) {
          const i = this.solids.indexOf(this.doorSolid);
          if (i >= 0) this.solids.splice(i, 1);
          this.doorSolid = null;
        }
      }
    }
    if (this.tween) {
      // On the clock, not per frame: a slow machine still sits down in about a second.
      const t = this.tween;
      const u = Math.min(1, (now - t.start) / t.dur);
      const k = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(t.from, t.to, k);
      this.camera.quaternion.slerpQuaternions(t.qFrom, t.qTo, k);
      if (u >= 1) {
        this.tween = null;
        t.then?.();
      }
    }
    if (this.phase === "done") this.setHud({ dark: 1 });
    else if (this.hud.dark > 0 && this.walking()) this.setHud({ dark: Math.max(0, this.hud.dark - dt / 0.7) });
    // Landing dust drifts out and fades.
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      d.v.y -= dt * 2.5;
      d.sprite.position.addScaledVector(d.v, dt);
      d.sprite.scale.setScalar(0.18 + (0.55 - d.life) * 0.5);
      (d.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, d.life) * 1.0;
      if (d.life <= 0) {
        this.scene.remove(d.sprite);
        (d.sprite.material as THREE.SpriteMaterial).dispose();
        this.dust.splice(i, 1);
      }
    }
    // The beacon over the next goal, and the line that names it.
    const goal = this.objective();
    if (goal) {
      const far = Math.hypot(this.pos.x - goal.x, this.pos.z - goal.z);
      this.beacon.visible = far > 7;
      this.beacon.position.set(goal.x, goal.y + 20, goal.z);
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.05 * Math.sin(now / 400);
      if (this.hud.objective !== goal.label) this.setHud({ objective: goal.label });
    } else {
      this.beacon.visible = false;
      if (this.hud.objective) this.setHud({ objective: "" });
    }
    // Judy turns to whoever is near her window.
    if (this.judyFigure) {
      const dx = this.pos.x - this.judyFigure.position.x;
      const dz = this.pos.z - this.judyFigure.position.z;
      const near = Math.hypot(dx, dz) < 7 && dz > 0;
      const target = near ? Math.atan2(dx, dz) : 0;
      this.judyFigure.rotation.y += (target - this.judyFigure.rotation.y) * Math.min(1, dt * 4);
    }
    // The projector's beam while the film runs, its light breathing with the picture.
    const showing = this.phase === "movie" || this.phase === "ended";
    this.projector.visible = showing;
    this.motes.visible = showing;
    if (showing) {
      this.motes.rotation.z = Math.sin(now / 9000) * 0.02;
      this.motes.position.y = Math.sin(now / 2600) * 0.15;
      (this.projector.material as THREE.MeshBasicMaterial).opacity = 0.04 + 0.012 * Math.sin(now / 230) + 0.008 * Math.sin(now / 71);
    }
  }

  /** Where to go next, for the beacon and the line at the top. */
  private objective(): { x: number; y: number; z: number; label: string } | null {
    switch (this.phase) {
      case "outside":
        if (this.pos.z > ISLAND.z1 + 2) return { x: 0, y: 0, z: ISLAND.z1 - 4, label: "Cross the blocks to the theater" };
        if (!this.hud.ticket) return { x: BOOTH.x, y: 0, z: BOOTH.z + 1, label: "Get your ticket from Judy" };
        return this.presentedAt ? { x: 0, y: 0, z: BLDG.z1 + 1, label: "Through the front doors" } : { x: 0, y: 0, z: BLDG.z1 + 1.2, label: "Show your ticket at the doors" };
      case "lobby":
        return { x: 0, y: 0, z: LOBBY.z0 + 1, label: "Into the auditorium" };
      case "theater": {
        const s = this.reservedSeat();
        return { x: s.x, y: s.y, z: s.z, label: "Find the seat with your name on it" };
      }
      case "exit":
        return this.pos.x < BLDG.halfW + 0.5
          ? { x: DOOR.x + 1, y: FRONT_FLOOR, z: (DOOR.z0 + DOOR.z1) / 2, label: "Through the door by the screen" }
          : { x: HEAVEN.x, y: HEAVEN.y, z: HEAVEN.z, label: "Climb the stairs to the contract" };
      default:
        return null;
    }
  }

  // ── HUD and lifecycle ───────────────────────────────────────────────────

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.setHud({ phase, paused: false });
  }

  private setHud(patch: Partial<Hud>) {
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
    this.css?.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const t of this.talkTimers) clearTimeout(t);
    this.talkAudio?.pause();
    if (this.musicFade !== null) cancelAnimationFrame(this.musicFade);
    for (const d of this.disposers) d();
    this.music?.pause();
    this.video?.pause();
    this.video?.remove();
    this.yt?.player?.destroy?.();
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        const tex = (mat as THREE.MeshBasicMaterial).map;
        tex?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css?.domElement.remove();
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
    // A long sentence is split at commas so a subtitle never runs past two lines.
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

// ── Acoustics ─────────────────────────────────────────────────────────────

/** A big room's echo: a few early reflections, then a noisy tail fading over `seconds`. */
/** A gentle saturation curve for the WaveShaper: louder parts flatten a little, like a small speaker pushed. */
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

function impulseResponse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5;
    for (const [ms, gain] of [
      [23, 0.6],
      [41, 0.45],
      [67, 0.35],
      [89, 0.28],
      [131, 0.2],
    ]) {
      const at = Math.floor((rate * (ms + ch * 3)) / 1000);
      if (at < len) d[at] += gain;
    }
  }
  return buf;
}

// ── Textures ──────────────────────────────────────────────────────────────

type TextureKind = "plain" | "grass" | "stone" | "wood" | "brick" | "fabric" | "plaster" | "cloud";

/**
 * A 256×256 tile of a material, drawn from layered noise and repeated with
 * smooth filtering: grass with blades, stone with cracks, wood with grain and
 * plank lines, brick with mortar, fabric with a weave, plaster, cloud.
 */
function pixelTexture(base: number, variance: number, kind: TextureKind = "plain"): THREE.Texture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const r0 = (base >> 16) & 255;
  const g0 = (base >> 8) & 255;
  const b0 = base & 255;
  let seed = (base * 7919 + variance * 131 + kind.length) & 0x7fffffff;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // Layered value noise: smooth, tileable.
  const octave = (cells: number) => {
    const g: number[] = [];
    for (let i = 0; i < cells * cells; i++) g.push(rnd());
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx) % cells;
      const y0 = Math.floor(fy) % cells;
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const tx = smooth(fx - Math.floor(fx));
      const ty = smooth(fy - Math.floor(fy));
      const a = g[y0 * cells + x0] * (1 - tx) + g[y0 * cells + x1] * tx;
      const b = g[y1 * cells + x0] * (1 - tx) + g[y1 * cells + x1] * tx;
      return a * (1 - ty) + b * ty;
    };
  };
  const o1 = octave(4);
  const o2 = octave(8);
  const o3 = octave(16);
  const o4 = octave(32);
  const noise = (x: number, y: number) => (o1(x, y) * 0.45 + o2(x, y) * 0.3 + o3(x, y) * 0.15 + o4(x, y) * 0.1) * 2 - 1;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let n = noise(x, y) * variance;
      let r = r0;
      let g = g0;
      let b = b0;
      if (kind === "wood") {
        // Grain along y, wavering with the noise, and a dark seam every 64 px.
        const grain = Math.sin((x / size) * Math.PI * 14 + noise(x, y) * 3) * 0.5 + 0.5;
        n = n * 0.5 + (grain - 0.5) * variance * 1.4;
        if (x % 64 < 2) n -= 40;
      } else if (kind === "brick") {
        const row = Math.floor(y / 32);
        const bx = (x + (row % 2 ? 24 : 0)) % 48;
        if (y % 32 < 3 || bx < 3) {
          r = g = b = 150;
          n = noise(x, y) * 8;
        } else n = n * 0.8 + (row % 3) * 4;
      } else if (kind === "fabric") {
        n = n * 0.6 + ((x + y) % 4 < 2 ? 4 : -4) + (x % 8 < 1 ? -3 : 0);
      } else if (kind === "plaster") {
        n = n * 0.7;
      } else if (kind === "cloud") {
        n = Math.max(n, 0) * 0.8;
      } else if (kind === "stone") {
        n = n * 0.9 + (o4(x, y) > 0.86 ? -30 : 0);
      }
      const i = (y * size + x) * 4;
      d[i] = clamp(r + n);
      d[i + 1] = clamp(g + n);
      d[i + 2] = clamp(b + n);
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  if (kind === "grass") {
    // Blades: short strokes a shade darker and lighter.
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const dark = rnd() < 0.55;
      ctx.strokeStyle = dark ? `rgba(${r0 - 40},${g0 - 30},${b0 - 20},0.55)` : `rgba(${r0 + 40},${g0 + 45},${b0 + 20},0.45)`;
      ctx.lineWidth = 1 + rnd();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 6);
      ctx.stroke();
    }
  }
  if (kind === "stone") {
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = rnd() * size;
      let y = rnd() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The sky: deep blue overhead down to a pale, warm horizon. */
function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#2f6fc4");
  g.addColorStop(0.42, "#6fa9e6");
  g.addColorStop(0.55, "#b9d7f0");
  g.addColorStop(0.62, "#e8eef5");
  g.addColorStop(1, "#dfe6ee");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function textTexture(lines: string[], w: number, h: number, bg: string, fg: string, size?: number): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const px = size ?? Math.min(h / (lines.length + 1), w / 9);
  ctx.font = `700 ${px}px "Playfair Display", Georgia, serif`;
  const gap = px * 1.25;
  const top = h / 2 - ((lines.length - 1) * gap) / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * gap, w - 16));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/** The ticket: cream card, red dashed border, the film and the name. */
function ticketTexture(title: string, name: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 230;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4ede0";
  roundRect(ctx, 0, 0, 512, 230, 18);
  ctx.fill();
  ctx.strokeStyle = "#8c2a2f";
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 10]);
  roundRect(ctx, 14, 14, 484, 202, 12);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.fillStyle = "#8c2a2f";
  ctx.font = "700 26px Inter, system-ui, sans-serif";
  ctx.fillText("ADMIT ONE", 256, 62);
  ctx.fillStyle = "#2e0f14";
  ctx.font = '700 36px "Playfair Display", Georgia, serif';
  ctx.fillText(title, 256, 118, 450);
  ctx.font = "500 24px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(46,15,20,0.75)";
  ctx.fillText(`Row 2, aisle  ·  ${name}`, 256, 170, 450);
  ctx.fillStyle = "#8c2a2f";
  ctx.font = "600 16px Inter, system-ui, sans-serif";
  ctx.fillText("ANYTHING IS POSSIBLE", 256, 202);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(name: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 248;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(10,10,14,0.85)";
  roundRect(ctx, 8, 8, 624, 200, 28);
  ctx.fill();
  ctx.strokeStyle = "#d4af37";
  ctx.lineWidth = 6;
  roundRect(ctx, 8, 8, 624, 200, 28);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#d4af37";
  ctx.font = "600 30px Inter, system-ui, sans-serif";
  ctx.fillText("RESERVED FOR", 320, 66);
  ctx.fillStyle = "#f4ede0";
  ctx.font = '700 64px "Playfair Display", Georgia, serif';
  ctx.fillText(name, 320, 150, 580);
  // The pointer under the card.
  ctx.fillStyle = "#d4af37";
  ctx.beginPath();
  ctx.moveTo(300, 212);
  ctx.lineTo(340, 212);
  ctx.lineTo(320, 240);
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── YouTube (only when no movie file is in the manifest) ──────────────────

type YTPlayer = { playVideo(): void; pauseVideo?(): void; destroy?(): void; getCurrentTime?(): number };
type YTApi = { Player: new (el: HTMLIFrameElement, opts: { events: { onStateChange: (e: { data: number }) => void } }) => YTPlayer };

let ytLoading: Promise<YTApi> | null = null;

function loadYouTubeApi(): Promise<YTApi> {
  const w = window as unknown as { YT?: YTApi & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytLoading) return ytLoading;
  ytLoading = new Promise<YTApi>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT) resolve(w.YT);
      else reject(new Error("no YT"));
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("YouTube API blocked"));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error("YouTube API timed out")), 15000);
  });
  return ytLoading;
}
