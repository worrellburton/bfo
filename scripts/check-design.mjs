#!/usr/bin/env node
/**
 * The design system's check (docs/DESIGN.md §14.7): finds legacy styling in
 * app/**\/*.tsx, per file and line, so pages can be moved onto the tokens and
 * components and stay there.
 *
 *   npm run check:design                    # every file; fails if a strict file has findings
 *   npm run check:design -- app/routes/notes.tsx app/ui/card.tsx
 *   npm run check:design -- --quiet         # CI: findings for strict files, counts for the rest
 *
 * A file that imports Page from app/ui is strict: any finding there fails
 * (exit 1). Other files are reported and don't fail. After the flip (§4.4)
 * every file is strict (pass --all-strict).
 *
 * The rules are line-based and skip comments; a false alarm in a strict file
 * is fixed by rewriting the line, not by an exemption.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const COLOURS = "gray|zinc|slate|neutral|stone|white|black|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink";
const SPACING =
  "p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|top|right|bottom|left|inset|inset-x|inset-y|start|end|w|h|size|min-w|min-h|max-w|max-h|translate-x|translate-y|scroll-mt|scroll-mb|scroll-pt|scroll-pb";

/** Each rule: an id, what it means, and a test that returns the offending text (or null) for a line of code. */
export const RULES = [
  {
    id: "raw-colour",
    why: "a raw palette colour; use a token (text-ink-2, bg-raised, border-line)",
    re: new RegExp(`(?<![\\w/-])(?:text|bg|border(?:-[xytblrse])?|divide|ring|outline|fill|stroke|from|to|via|decoration|placeholder|caret|shadow)-(?:${COLOURS})(?![\\w])`, "g"),
  },
  { id: "hex-colour", why: "a hex colour in a class or style; use a token", re: /\[#[0-9a-fA-F]{3,8}\]|(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*["'`]#[0-9a-fA-F]{3,8}\b/g },
  {
    id: "legacy-type",
    why: "a legacy type size; use text-caption, text-small, text-body, text-section, text-title, text-heading",
    re: /(?<![\w/-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])|(?<![\w/-])text-\[\d[^\]]*\]/g,
  },
  {
    id: "tracked-caps",
    why: "uppercase with tracking; sentence case, text-small font-medium text-ink-2",
    test: (l) => (/\buppercase\b/.test(l) && /\btracking-/.test(l) ? "uppercase … tracking-" : null),
  },
  { id: "rem", why: "rem in an arbitrary value or a style; use px or a token", re: /\[[^\]\s]*\d(?:\.\d+)?rem[^\]]*\]|:\s*["'`][^"'`]*\b\d+(?:\.\d+)?rem\b/g },
  { id: "glass-or-pulse", why: "glass, blur or a pulse; surfaces are solid and nothing loops", re: /\b(?:glass-card|glass-panel|backdrop-blur(?:-[\w[\]]+)?|animate-ping|animate-pulse)\b/g },
  { id: "theme-branch", why: "a theme branch in script; tokens follow the theme by themselves", re: /\bisDark\s*\?|\buseTone\(|\btiers\(|\bisDarkNow\(/g },
  { id: "z-index", why: "an arbitrary z-index; use the ladder (z-sticky, z-shell, z-fab, z-popover, z-modal, z-toast, z-tooltip)", re: /(?<![\w/-])z-\[/g },
  {
    id: "legacy-radius",
    why: "a legacy radius; use rounded-mark, rounded-control, rounded-card, rounded-dialog, rounded-full",
    re: /(?<![\w/-])rounded(?:-[tblrsexy]{1,2})?-(?:sm|md|lg|xl|2xl|3xl)(?![\w-])/g,
  },
  { id: "legacy-width", why: "a legacy max width; use max-w-reading, max-w-workspace or px", re: /(?<![\w/-])max-w-(?:xs|sm|md|lg|xl|[2-7]xl)(?![\w-])/g },
  { id: "half-step", why: "a half step off the 4px grid; 2px and 6px are written as px inside a component", re: new RegExp(`(?<![\\w/-])-?(?:${SPACING})-(?:0\\.5|1\\.5|2\\.5|3\\.5)(?![\\w.])`, "g") },
  {
    id: "own-overlay",
    why: "a hand-made overlay; use Dialog, Sheet, Menu, Popover or confirm() from app/ui",
    re: /role=["'](?:dialog|alertdialog)["']|\baria-modal\b/g,
    skip: (file) => file.startsWith(`app${sep}ui${sep}`) || file.startsWith("app/ui/"),
  },
  { id: "native-control", why: "a native select or browser dialog; use Select or confirm() from app/ui", re: /<select\b|\bwindow\.(?:confirm|prompt|alert)\(/g },
];

/** Code without its comments, line for line (so line numbers hold). Strings are left alone. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      out += body.replace(/[^\n]/g, " ");
      i += body.length;
      continue;
    }
    if (c === "/" && n === "/" && src[i - 1] !== ":") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Whether a file has moved onto the system: it imports Page from app/ui. */
export function isStrict(src) {
  return /import\s*\{[^}]*\bPage\b[^}]*\}\s*from\s*["'][^"']*\/ui(?:\/page|\/index)?["']/.test(src);
}

/** Every finding in one file's source. */
export function findings(file, src) {
  const out = [];
  const lines = stripComments(src).split("\n");
  lines.forEach((line, k) => {
    for (const rule of RULES) {
      if (rule.skip?.(file)) continue;
      if (rule.test) {
        const hit = rule.test(line);
        if (hit) out.push({ line: k + 1, col: 1, rule: rule.id, text: hit, why: rule.why });
        continue;
      }
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        out.push({ line: k + 1, col: m.index + 1, rule: rule.id, text: m[0].length > 60 ? `${m[0].slice(0, 57)}…` : m[0], why: rule.why });
        if (!rule.re.global) break;
      }
    }
  });
  return out;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function main(argv) {
  const quiet = argv.includes("--quiet");
  const allStrict = argv.includes("--all-strict");
  const named = argv.filter((a) => !a.startsWith("--"));
  const files = (named.length ? named.map((f) => join(ROOT, f)) : walk(join(ROOT, "app"))).filter((f) => f.endsWith(".tsx")).sort();
  let total = 0;
  let strictTotal = 0;
  const counts = [];
  for (const abs of files) {
    const file = relative(ROOT, abs);
    const src = readFileSync(abs, "utf8");
    const strict = allStrict || isStrict(src);
    const found = findings(file, src);
    if (!found.length) continue;
    total += found.length;
    if (strict) strictTotal += found.length;
    if (quiet && !strict) {
      counts.push(`  ${String(found.length).padStart(4)}  ${file}`);
      continue;
    }
    console.log(`${file}${strict ? " (strict)" : ""}`);
    for (const f of found) console.log(`  ${f.line}:${f.col}  ${f.rule}  ${f.text}  — ${f.why}`);
  }
  if (quiet && counts.length) {
    console.log("Not yet moved (findings per file):");
    console.log(counts.join("\n"));
  }
  const filesWith = files.length;
  console.log(`\n${total} finding${total === 1 ? "" : "s"} in ${filesWith} file${filesWith === 1 ? "" : "s"} checked; ${strictTotal} in strict files.`);
  if (strictTotal > 0) {
    console.log("Strict files (they import Page from app/ui) must have none: docs/DESIGN.md §14.6–14.7.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
