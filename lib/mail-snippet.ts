/**
 * A message's preview line, tidied for a list: the few words a person reads
 * under the subject. Pure, and shared by the server (lib/mail.ts writes the
 * stored snippet with it, and tidies older ones on the way out) and the
 * browser (app/mail), so every surface shows the same clean text.
 *
 * HTTP surface: none. Who may call it: anyone; it touches no data.
 * Env: none.
 *
 * What it removes: HTML entities left in a text part ("&quot;", "&amp;"),
 * Markdown image and link syntax that newsletters put in their text part
 * ("[Plaid logo](https://…)" keeps "Plaid logo" only when it isn't an image's
 * description), bare web addresses, the invisible padding senders use to
 * hide preheader text (zero-width spaces, soft hyphens, combining joiners),
 * and the lines a help desk wraps around a reply.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  zwnj: "",
  zwj: "",
  shy: "",
};

/** "&quot;" → '"', "&#8217;" → "’"; anything unknown is left as it was. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED[entity.toLowerCase()];
    // A bare "&amp" without its ";" only counts when it is a known name.
    return named ?? match;
  });
}

/** Characters that take no space: zero-width spaces and joiners, soft hyphens, the combining grapheme joiner, BOMs. */
const INVISIBLE = /\u034f|\u17b4|\u17b5|[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]/g;

/** Words in an image's description that mark a link as a picture, not words worth reading. */
const IMAGE_WORDS = /\b(logo|icon|image|photo|picture|banner|graphic|illustration|avatar|headshot|screenshot)\b/i;

/** Lines a support desk wraps around a reply, which say nothing about it. */
const DESK_LEAD = /^\s*(#+-?\s*please type your reply above this line\s*-?#+|[-_=*]{4,}|\[[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+\])\s*/i;
const DESK_TAIL = /\s*(this (?:email|message) is a service from\b.*|delivered by zendesk.*|sent from my (?:iphone|ipad|android|galaxy|phone).*|get outlook for (?:ios|android).*)$/i;

/**
 * The preview, clean. Safe to run twice. A preview that is nothing but an
 * ellipsis (the sender's padding, cut) becomes "".
 */
export function tidySnippet(input: string | null | undefined): string {
  let s = decodeEntities(String(input ?? "")).replace(INVISIBLE, "");
  // ![alt](url) is always a picture.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)?/g, " ");
  // [text](url): the text, unless it describes a picture. A link cut short by the snippet's end has no ")".
  s = s.replace(/\[([^\]]*)\]\((?:[^)\s]*)\)?/g, (_m, text: string) => (IMAGE_WORDS.test(text) ? " " : ` ${text} `));
  // A link whose closing "]" was cut off: "[Plaid logo with a geo…".
  s = s.replace(/\[([^\]]*)$/, (_m, text: string) => (IMAGE_WORDS.test(text) ? " " : ` ${text}`));
  // <https://…> and bare addresses: noise in a one-line preview.
  s = s.replace(/<\s*(?:https?:\/\/|mailto:)[^>\s]*>?/gi, " ").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(DESK_LEAD, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(DESK_TAIL, "").trim();
  // Punctuation left hanging where something was removed: "( ." or " ."
  s = s
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return /^[\s….·-]*$/.test(s) ? "" : s;
}
