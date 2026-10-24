/**
 * Mail's looks: the colour the whole page is lit in. The appearance button in
 * the corner cycles through them, and the choice is kept on the device.
 *
 *   Aurora  indigo and violet, with the aurora in each mailbox's own hue
 *   Mono    black and white: the same scene with the colour taken out
 *   Ember   amber and gold
 *   Sea     teal and deep green
 *
 * Each look sets CSS variables on the page (--mail-hue, --mail-sat and four
 * accent colours) that the styles read, and a hue and saturation for the
 * aurora shader.
 */

export type MailLook = "aurora" | "mono" | "ember" | "sea";

export type LookSpec = {
  key: MailLook;
  label: string;
  blurb: string;
  /** The aurora's hue (0–1), or null to take it from the mailbox. */
  hue: number | null;
  /** The aurora's saturation (0–1). */
  sat: number;
  /** CSS saturation for everything else. */
  cssSat: string;
  accent: string;
  deep: string;
  pale: string;
  ink: string;
};

export const LOOKS: LookSpec[] = [
  { key: "aurora", label: "Aurora", blurb: "Colours from your mailbox", hue: null, sat: 0.75, cssSat: "80%", accent: "#818cf8", deep: "#6366f1", pale: "#c7d2fe", ink: "#4f46e5" },
  { key: "mono", label: "Mono", blurb: "Black and white", hue: 0.68, sat: 0, cssSat: "0%", accent: "#e5e5e5", deep: "#a3a3a3", pale: "#f5f5f5", ink: "#171717" },
  { key: "ember", label: "Ember", blurb: "Amber and gold", hue: 0.09, sat: 0.8, cssSat: "85%", accent: "#fbbf24", deep: "#f59e0b", pale: "#fde68a", ink: "#b45309" },
  { key: "sea", label: "Sea", blurb: "Teal and deep green", hue: 0.47, sat: 0.7, cssSat: "70%", accent: "#2dd4bf", deep: "#14b8a6", pale: "#99f6e4", ink: "#0f766e" },
];

export const LOOK_KEY = "bfo-mail-look";

export function lookSpec(key: MailLook): LookSpec {
  return LOOKS.find((l) => l.key === key) ?? LOOKS[0];
}

export function readLook(): MailLook {
  try {
    const v = localStorage.getItem(LOOK_KEY);
    return LOOKS.some((l) => l.key === v) ? (v as MailLook) : "aurora";
  } catch {
    return "aurora";
  }
}

export function writeLook(look: MailLook) {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    // Private mode: the look lasts the visit.
  }
}

/** The look after this one, round and round. */
export function nextLook(look: MailLook): MailLook {
  const i = LOOKS.findIndex((l) => l.key === look);
  return LOOKS[(i + 1) % LOOKS.length].key;
}

/** The CSS variables a look sets on the page, given the mailbox's own hue (0–1) for Aurora. */
export function lookVars(look: MailLook, mailboxHue: number): Record<string, string> {
  const l = lookSpec(look);
  return {
    "--mail-hue": String(Math.round((l.hue ?? mailboxHue) * 360)),
    "--mail-sat": l.cssSat,
    "--mail-accent": l.accent,
    "--mail-accent-deep": l.deep,
    "--mail-accent-pale": l.pale,
    "--mail-accent-ink": l.ink,
  };
}
