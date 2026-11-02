#!/usr/bin/env node
/**
 * Makes the signing game's sound effects with ElevenLabs and writes them to
 * public/game/sounds/<name>.mp3, then names each one in public/game/manifest.json.
 *
 *   npm run game:sounds            # every effect that isn't there yet
 *   npm run game:sounds -- --all   # remake them all
 *   npm run game:sounds -- door    # just that one
 *
 * Needs ELEVENLABS_API_KEY. Each effect is one call to the sound-generation
 * endpoint; a failure stops the run so the manifest never names a file that
 * didn't land. The key never goes into the repo or the browser.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../public/game/", import.meta.url).pathname;
const SOUNDS = join(ROOT, "sounds");
const MANIFEST = join(ROOT, "manifest.json");

/** Each effect: what to ask for and how long it should be. */
const EFFECTS = {
  door: { text: "A heavy old wooden theater door creaking slowly open, echoing in a quiet hall, then a soft wooden knock as it settles", seconds: 3.5 },
  sit: { text: "Someone sitting down into a plush velvet cinema seat, a soft cushioned thump and a faint creak of the seat frame", seconds: 1.5 },
  sign: { text: "A fountain pen signing a signature on paper on a wooden desk, quick confident scribble, then the pen set down", seconds: 2.5 },
  jump: { text: "A short, light, cartoon video game jump hop sound, soft and bouncy, like a blocky character leaping", seconds: 0.8 },
  land: { text: "A soft thud of a character landing on a wooden block in a video game, light and quick", seconds: 0.7 },
  fall: { text: "A quick descending whoosh of falling into a dark pit in a video game, ending in a low soft puff", seconds: 1.8 },
  step: { text: "A single soft footstep on short grass, close up, quick and quiet", seconds: 0.5 },
};

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set.");
  process.exit(2);
}
const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));
const names = only.length ? only : Object.keys(EFFECTS);

await mkdir(SOUNDS, { recursive: true });
const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
manifest.sounds ??= {};

for (const name of names) {
  const effect = EFFECTS[name];
  if (!effect) {
    console.error(`No such effect: ${name}. Known: ${Object.keys(EFFECTS).join(", ")}`);
    process.exit(2);
  }
  const file = join(SOUNDS, `${name}.mp3`);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists && !all && !only.length) {
    console.log(`${name}: already there`);
    manifest.sounds[name] = `/game/sounds/${name}.mp3`;
    continue;
  }
  process.stdout.write(`${name}: asking ElevenLabs… `);
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: effect.text, duration_seconds: effect.seconds, prompt_influence: 0.4 }),
  });
  if (!r.ok) {
    console.error(`\nElevenLabs refused ${name} (${r.status}): ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  await writeFile(file, bytes);
  manifest.sounds[name] = `/game/sounds/${name}.mp3`;
  console.log(`${(bytes.length / 1024).toFixed(0)} KB`);
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Manifest updated: ${Object.entries(manifest.sounds).filter(([, v]) => v).length} sounds named.`);
