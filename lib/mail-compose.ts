/**
 * Formatted mail: what the composer may hold and what goes out. One allowlist,
 * used in the browser (paste, the editor) and again on the server (send), so
 * a message is paragraphs, line breaks, bold, italic, underline, lists, quotes,
 * headings and links, and nothing else: no scripts, styles, images or
 * attributes but a link's address. The HTML that's sent carries its own
 * inline styles, since mail clients ignore stylesheets; the plain-text part is
 * written from the same tree.
 *
 * Pure string work, no DOM: runs the same in Node and the browser.
 */

type Tag = "p" | "br" | "strong" | "em" | "u" | "ul" | "ol" | "li" | "blockquote" | "h3" | "a";
type Node = string | { tag: Tag; href?: string; kids: Node[] };

/** Tags kept (some under another name); the rest are unwrapped, their text kept. */
const MAP: Record<string, Tag> = {
  p: "p",
  div: "p",
  br: "br",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  h1: "h3",
  h2: "h3",
  h3: "h3",
  h4: "h3",
  a: "a",
};
/** Dropped with everything inside them. */
const DROP = new Set(["script", "style", "head", "title", "meta", "link", "iframe", "object", "embed", "svg", "math", "template", "noscript", "xml", "o:p"]);
const BLOCK = new Set<Tag>(["p", "ul", "ol", "li", "blockquote", "h3"]);
const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "wbr", "col", "area", "base", "source"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => esc(s).replace(/"/g, "&quot;");

function safeHref(raw: string | undefined): string | undefined {
  const href = decodeEntities(raw ?? "").trim();
  return /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(href) && href.length <= 2000 ? href : undefined;
}

/** Bold or italic carried in a style attribute (Google Docs and Word paste spans like that). */
function styleTag(attrs: string): Tag | null {
  const style = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  const css = (style?.[2] ?? style?.[3] ?? "").toLowerCase();
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(css)) return "strong";
  if (/font-style\s*:\s*italic/.test(css)) return "em";
  return null;
}

/** Any HTML into the allowed tree. */
function parseCompose(html: string): Node[] {
  const root: { tag: "root"; kids: Node[] } = { tag: "root", kids: [] };
  // Each open element; `tag` null for one that's unwrapped (its text still lands in the parent).
  const stack: { tag: Tag | null; name: string; node: { kids: Node[] } }[] = [{ tag: null, name: "#root", node: root }];
  const top = () => stack[stack.length - 1];
  let skip: string | null = null;
  let skipDepth = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tok = m[0];
    const name = (m[1] ?? "").toLowerCase();
    if (tok.startsWith("<!")) continue;
    const closing = tok.startsWith("</");
    if (skip) {
      if (name === skip) skipDepth += closing ? -1 : tok.endsWith("/>") ? 0 : 1;
      if (skipDepth <= 0) skip = null;
      continue;
    }
    if (!name) {
      // Text (a stray "<" is text too).
      const text = tok === "<" ? "<" : decodeEntities(tok);
      if (text) top().node.kids.push(text);
      continue;
    }
    if (DROP.has(name)) {
      // Dropped with its contents, unless it never has any (<meta>, <link>).
      if (!closing && !tok.endsWith("/>") && !VOID.has(name)) {
        skip = name;
        skipDepth = 1;
      }
      continue;
    }
    const mapped = MAP[name] ?? (!closing ? styleTag(m[2] ?? "") : null);
    if (closing) {
      // Close back to the matching element, if it's open.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (mapped === "br") {
      top().node.kids.push({ tag: "br", kids: [] });
      continue;
    }
    if (VOID.has(name) || tok.endsWith("/>")) continue;
    if (!mapped) {
      stack.push({ tag: null, name, node: top().node });
      continue;
    }
    // A paragraph doesn't hold another block: close it first.
    if (BLOCK.has(mapped) && mapped !== "li") {
      const i = stack.length - 1;
      if (stack[i].tag === "p" || stack[i].tag === "h3") stack.length = i;
    }
    const node: { tag: Tag; href?: string; kids: Node[] } = { tag: mapped, kids: [] };
    if (mapped === "a") {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2] ?? "");
      const safe = safeHref(href?.[2] ?? href?.[3] ?? href?.[4]);
      if (!safe) {
        stack.push({ tag: null, name, node: top().node });
        continue;
      }
      node.href = safe;
    }
    top().node.kids.push(node);
    stack.push({ tag: mapped, name, node });
  }
  return tidy(root.kids);
}

/** Drop empty blocks and runs of whitespace a paste leaves behind. */
function tidy(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (typeof n === "string") {
      const s = n.replace(/[\t\r\n ]+/g, " ");
      if (s) out.push(s);
      continue;
    }
    const kids = n.tag === "br" ? [] : tidy(n.kids);
    const empty = !kids.some((k) => (typeof k === "string" ? k.trim() : k.tag !== "br"));
    if (n.tag !== "br" && empty) continue;
    out.push({ ...n, kids });
  }
  return out;
}

// ── Out ──────────────────────────────────────────────────────────────────

const STYLE: Partial<Record<Tag, string>> = {
  p: "margin:0 0 14px",
  ul: "margin:0 0 14px;padding-left:24px",
  ol: "margin:0 0 14px;padding-left:24px",
  li: "margin:0 0 6px",
  blockquote: "margin:0 0 14px;padding:2px 0 2px 14px;border-left:3px solid #d5d9e0;color:#555",
  h3: "margin:18px 0 8px;font-size:16px;font-weight:600",
  a: "color:#2563eb",
};

function toHtml(nodes: Node[], styled: boolean): string {
  return nodes
    .map((n) => {
      if (typeof n === "string") return esc(n);
      if (n.tag === "br") return "<br>";
      const style = styled && STYLE[n.tag] ? ` style="${STYLE[n.tag]}"` : "";
      const href = n.tag === "a" ? ` href="${attr(n.href!)}"` : "";
      return `<${n.tag}${href}${style}>${toHtml(n.kids, styled)}</${n.tag}>`;
    })
    .join("");
}

/** Clean HTML for the editor (no inline styles: the editor styles it). */
export function cleanCompose(html: string): string {
  return toHtml(parseCompose(html), false);
}

/** The HTML part that's sent: a whole document, styled inline for mail clients. */
export function composeDocument(html: string): string {
  const body = toHtml(parseCompose(html), true);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0"><div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">${body}</div></body></html>`;
}

/** The plain-text part, from the same tree: blank lines between paragraphs, "1." and "-" for lists, "> " for quotes. */
export function composeText(html: string): string {
  const blocks = (nodes: Node[]): string[] => {
    const out: string[] = [];
    let inline = "";
    const flush = () => {
      if (inline.trim()) out.push(inline.replace(/[ \t]+\n/g, "\n").trim());
      inline = "";
    };
    for (const node of nodes) {
      if (typeof node === "string") inline += node;
      else if (node.tag === "br") inline += "\n";
      else if (node.tag === "strong" || node.tag === "em" || node.tag === "u") inline += blocks(node.kids).join(" ");
      else if (node.tag === "a") {
        const label = blocks(node.kids).join(" ");
        const href = node.href!.replace(/^mailto:/i, "");
        inline += label && label !== href ? `${label} (${href})` : href;
      } else {
        flush();
        if (node.tag === "ul" || node.tag === "ol") {
          let i = 0;
          const items = node.kids.filter((k) => typeof k !== "string" || k.trim());
          out.push(
            items
              .map((k) => {
                const body = blocks(typeof k === "string" ? [k] : k.tag === "li" ? k.kids : [k]).join("\n").replace(/\n/g, "\n   ");
                return node.tag === "ol" ? `${++i}. ${body}` : `- ${body}`;
              })
              .join("\n")
          );
        } else if (node.tag === "blockquote") {
          out.push(blocks(node.kids).join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
        } else out.push(blocks(node.kids).join("\n\n"));
      }
    }
    flush();
    return out.filter(Boolean);
  };
  return blocks(parseCompose(html)).join("\n\n");
}

/**
 * Plain text as HTML: paragraphs at blank lines, "1." and "-" runs as lists,
 * "> " runs as a quote. How a plain paste, or a reply's quoted text, enters
 * the editor.
 */
export function htmlFromPlain(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const kind = (l: string) => (/^\s*>/.test(l) ? "quote" : /^\s*\d{1,3}[.)]\s+\S/.test(l) ? "ol" : /^\s*[-*•]\s+\S/.test(l) ? "ul" : l.trim() ? "text" : "blank");
  while (i < lines.length) {
    const k = kind(lines[i]);
    if (k === "blank") {
      i++;
      continue;
    }
    const run: string[] = [];
    while (i < lines.length && kind(lines[i]) === k) run.push(lines[i++]);
    if (k === "quote") out.push(`<blockquote>${htmlFromPlain(run.map((l) => l.replace(/^\s*>\s?/, "")).join("\n"))}</blockquote>`);
    else if (k === "ol") out.push(`<ol>${run.map((l) => `<li>${esc(l.replace(/^\s*\d{1,3}[.)]\s+/, ""))}</li>`).join("")}</ol>`);
    else if (k === "ul") out.push(`<ul>${run.map((l) => `<li>${esc(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`);
    else out.push(`<p>${run.map(esc).join("<br>")}</p>`);
  }
  return out.join("");
}
