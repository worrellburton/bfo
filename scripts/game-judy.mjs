#!/usr/bin/env node
/**
 * Voices Judy, the ticket lady in the signing game, with ElevenLabs: one MP3
 * per line of public/game/judy.json, written to public/game/voice/judy-<id>.mp3
 * and named in public/game/manifest.json under "voice". The game plays each
 * clip as Judy speaks and draws subtitles under her; without the clips she is
 * subtitles only.
 *
 *   npm run game:judy              # the lines that aren't voiced yet
 *   npm run game:judy -- --all     # redo them all (after editing the script)
 *   npm run game:judy -- r2        # just that line
 *
 * Needs ELEVENLABS_API_KEY. The voice is an older woman from the ElevenLabs
 * library, picked by its labels; set JUDY_VOICE_ID to use a particular one.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../public/game/", import.meta.url).pathname;
const VOICE = join(ROOT, "voice");
const MANIFEST = join(ROOT, "manifest.json");
const SCRIPT = join(ROOT, "judy.json");

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) {
  console.error("ELEVENLABS_API_KEY is not set.");
  process.exit(2);
}
const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));

const judy = JSON.parse(await readFile(SCRIPT, "utf8"));
const lines = [judy.greeting, ...judy.rounds.flatMap((r) => [...r.options.map((o) => o.judy), r.core]), judy.final, ...Object.values(judy.extras ?? {})];

async function pickVoice() {
  if (process.env.JUDY_VOICE_ID) return process.env.JUDY_VOICE_ID;
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!r.ok) throw new Error(`Couldn't list voices (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const { voices = [] } = await r.json();
  const female = voices.filter((v) => /female/i.test(v.labels?.gender ?? ""));
  const score = (v) => {
    const age = (v.labels?.age ?? "").toLowerCase();
    const desc = `${v.labels?.description ?? ""} ${v.labels?.accent ?? ""} ${v.name}`.toLowerCase();
    return (age.includes("old") ? 4 : age.includes("middle") ? 2 : 0) + (/mature|warm|grand|older|elder/.test(desc) ? 1 : 0);
  };
  const best = [...female].sort((a, b) => score(b) - score(a))[0] ?? voices[0];
  if (!best) throw new Error("The account has no voices.");
  console.log(`Judy is "${best.name}" (${best.labels?.age ?? "age unknown"}, ${best.labels?.accent ?? "accent unknown"}). Set JUDY_VOICE_ID to choose another.`);
  return best.voice_id;
}

await mkdir(VOICE, { recursive: true });
const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
manifest.voice ??= {};
const voiceId = await pickVoice();

for (const line of lines) {
  if (only.length && !only.includes(line.id)) continue;
  const file = join(VOICE, `judy-${line.id}.mp3`);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists && !all && !only.length) {
    manifest.voice[line.id] = `/game/voice/judy-${line.id}.mp3`;
    console.log(`${line.id}: already there`);
    continue;
  }
  process.stdout.write(`${line.id}: ${line.text.split(/\s+/).length} words… `);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: line.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
  });
  if (!r.ok) {
    console.error(`\nElevenLabs refused ${line.id} (${r.status}): ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  await writeFile(file, bytes);
  manifest.voice[line.id] = `/game/voice/judy-${line.id}.mp3`;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${(bytes.length / 1024).toFixed(0)} KB`);
}
console.log(`Manifest updated: ${Object.keys(manifest.voice).length} of ${lines.length} lines voiced.`);
