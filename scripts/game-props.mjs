#!/usr/bin/env node
/**
 * Makes the signing game's props: OpenAI draws each one as a clean picture,
 * Meshy turns the picture into a textured GLB, and the model is written to
 * public/game/models/<name>.glb and named in public/game/manifest.json. The
 * game then uses the model in place of its blocky placeholder (app/sign/game).
 *
 *   npm run game:props              # every prop that isn't there yet
 *   npm run game:props -- --all     # remake them all
 *   npm run game:props -- seat      # just that one
 *
 * Needs OPENAI_API_KEY and MESHY_API_KEY (the same two the logo studio uses,
 * lib/brand.ts). A Meshy task takes a few minutes; this waits on each one.
 * The pictures are kept beside the models (<name>.png) for a look.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../public/game/", import.meta.url).pathname;
const MODELS = join(ROOT, "models");
const MANIFEST = join(ROOT, "manifest.json");

const STYLE =
  "Photorealistic, like a product photograph for a 3D scan: a single subject, centered, seen from a three-quarter front view, filling most of the frame, " +
  "evenly lit from the front with soft studio light, no harsh shadows, on a plain pure white background, no text, no watermark, nothing else in the picture.";

const PROPS = {
  seat: "A single plush red velvet movie theater seat with a folding cushion, dark wooden armrests and a small brass seat-number plate.",
  plant: "A tall potted areca palm in a terracotta pot.",
  popcorn: "A classic red and gold movie theater popcorn cart with a glass case full of popcorn and a striped canopy.",
  judy: "A friendly woman in her late sixties, gray hair in a neat bun, reading glasses on a beaded chain, a lavender cardigan over a white blouse, standing upright with her hands folded in front of her, full body from head to feet, smiling slightly.",
};

const openaiKey = process.env.OPENAI_API_KEY?.trim();
const meshyKey = process.env.MESHY_API_KEY?.trim();
if (!openaiKey || !meshyKey) {
  console.error(`${!openaiKey ? "OPENAI_API_KEY" : "MESHY_API_KEY"} is not set.`);
  process.exit(2);
}
const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));
const names = only.length ? only : Object.keys(PROPS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function draw(prompt) {
  let last = "";
  for (const model of ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]) {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", quality: "high", output_format: "png" }),
    });
    const text = await r.text();
    if (r.ok) {
      const b64 = JSON.parse(text).data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI returned no image.");
      return Buffer.from(b64, "base64");
    }
    last = `OpenAI ${r.status}: ${text.slice(0, 200)}`;
    // A model this key can't use: try the next. Anything else is final.
    if (![400, 403, 404].includes(r.status) || !/model|not found|does not exist|access|unsupported/i.test(text)) break;
  }
  throw new Error(last || "No image model answered.");
}

async function meshy(path, init = {}) {
  const r = await fetch(`https://api.meshy.ai/openapi/v1${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${meshyKey}`, "Content-Type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Meshy ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function model(png) {
  const { result: taskId } = await meshy("/image-to-3d", {
    method: "POST",
    body: {
      image_url: `data:image/png;base64,${png.toString("base64")}`,
      ai_model: "latest",
      should_texture: true,
      enable_pbr: false,
      texture_resolution: "1k",
      target_formats: ["glb"],
      origin_at: "bottom",
      topology: "triangle",
      target_polycount: 12000,
    },
  });
  if (!taskId) throw new Error("Meshy didn't start the task.");
  for (let i = 0; i < 120; i++) {
    await sleep(10_000);
    const task = await meshy(`/image-to-3d/${encodeURIComponent(taskId)}`);
    if (task.status === "SUCCEEDED") {
      const url = task.model_urls?.glb;
      if (!url) throw new Error("Meshy finished without a GLB.");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Couldn't download the model (${r.status}).`);
      return Buffer.from(await r.arrayBuffer());
    }
    if (task.status === "FAILED" || task.status === "CANCELED") throw new Error(task.task_error?.message || `Meshy ${task.status.toLowerCase()} the task.`);
    process.stdout.write(`${task.progress ?? 0}% `);
  }
  throw new Error("Meshy took longer than 20 minutes.");
}

await mkdir(MODELS, { recursive: true });
const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
manifest.models ??= {};

for (const name of names) {
  const what = PROPS[name];
  if (!what) {
    console.error(`No such prop: ${name}. Known: ${Object.keys(PROPS).join(", ")}`);
    process.exit(2);
  }
  const file = join(MODELS, `${name}.glb`);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists && !all && !only.length) {
    console.log(`${name}: already there`);
    manifest.models[name] = `/game/models/${name}.glb`;
    continue;
  }
  process.stdout.write(`${name}: drawing… `);
  const png = await draw(`${what} ${STYLE}`);
  await writeFile(join(MODELS, `${name}.png`), png);
  process.stdout.write(`modelling… `);
  const glb = await model(png);
  await writeFile(file, glb);
  manifest.models[name] = `/game/models/${name}.glb`;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${(glb.length / 1024).toFixed(0)} KB`);
}
console.log(`Manifest updated: ${Object.keys(manifest.models).length} props named.`);
