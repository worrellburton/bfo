#!/usr/bin/env node
/**
 * Applies the SQL files in supabase/migrations that the project hasn't had
 * yet, in name order, and records each in public.schema_migrations.
 *
 *   npm run migrate -- --check   what's pending (needs SUPABASE_URL and SUPABASE_SERVICE_KEY)
 *   npm run migrate              apply what's pending (also needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF)
 *
 * Reads go through PostgREST with the service key, as the app's do. Applying
 * runs each file through Supabase's management API (the same call the SQL
 * editor makes), which takes a personal access token from
 * supabase.com/dashboard/account/tokens and the project ref from its URL.
 * A file is recorded only after it ran without error; a failure stops the
 * run so the files after it wait for the fix.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = new URL("../supabase/migrations/", import.meta.url).pathname;
const check = process.argv.includes("--check");

const env = (name, required = true) => {
  const v = process.env[name]?.trim();
  if (!v && required) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
  return v ?? "";
};

const url = env("SUPABASE_URL").replace(/\/$/, "");
const key = env("SUPABASE_SERVICE_KEY");

async function applied() {
  const r = await fetch(`${url}/rest/v1/schema_migrations?select=name&order=name`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  // Before the first migration that creates the table, nothing is applied as far as the runner knows.
  if (r.status === 404 || r.status === 400) return new Set();
  if (!r.ok) throw new Error(`Couldn't read schema_migrations (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return new Set((await r.json()).map((row) => row.name));
}

async function runSql(ref, token, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase refused the query (${r.status}): ${(await r.text()).slice(0, 400)}`);
}

const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
const done = await applied();
const pending = files.filter((f) => !done.has(f));
const unknown = [...done].filter((n) => !files.includes(n));

if (unknown.length) console.warn(`Applied on the project but not in the repo: ${unknown.join(", ")}`);
if (!pending.length) {
  console.log(`Up to date: ${files.length} migrations applied.`);
  process.exit(0);
}
console.log(`Pending (${pending.length}):\n  ${pending.join("\n  ")}`);
if (check) process.exit(1);

const ref = env("SUPABASE_PROJECT_REF");
const token = env("SUPABASE_ACCESS_TOKEN");
for (const name of pending) {
  const sql = await readFile(join(DIR, name), "utf8");
  process.stdout.write(`Applying ${name} … `);
  await runSql(ref, token, sql);
  await runSql(ref, token, `insert into public.schema_migrations (name) values ('${name.replace(/'/g, "''")}') on conflict (name) do nothing;`);
  console.log("done");
}
console.log('Applied. Say so in the commit: "Applied to the project."');
