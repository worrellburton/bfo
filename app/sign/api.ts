// The browser's side of /api/sign (api/sign.ts): types the office pages and
// the contract page share, the calls they make, and the words for statuses
// and modes (one list, so every screen names them the same).
import { authFetch } from "../auth";
import { date as formatDate, dateTime } from "../ui/format";

export type PartyKey = "a" | "b";
export type FieldType = "signature" | "initials" | "name" | "date" | "address";
export type PartyStatus = "pending" | "sent" | "viewed" | "signed" | "declined";
export type RequestStatus = "draft" | "sent" | "partial" | "completed" | "declined" | "voided";
/** How the parties sign: the plain page, the Anything Is Possible theater game (app/sign/game), or the racetrack game (app/sign/kart) in front of it. */
export type SignMode = "normal" | "game" | "race";
/** True for a mode that puts a game in front of the signing page. */
export const isGameMode = (mode: SignMode | undefined): boolean => mode === "game" || mode === "race";

export type SignField = { id: string; party: PartyKey; type: FieldType; page: number; x: number; y: number; w: number; h: number };
export type Party = {
  key: PartyKey;
  role: string;
  /** The person who signs. */
  name: string;
  email: string;
  /** The company they sign for, and their title there ("Manager"). */
  entity?: string;
  title?: string;
  status: PartyStatus;
  sentAt?: string;
  expiresAt?: string;
  viewedAt?: string;
  viewIp?: string;
  viewDevice?: string;
  signedAt?: string;
  ip?: string;
  device?: string;
  method?: "drawn" | "typed";
  via?: "page" | "game";
  timeZone?: string;
  declinedAt?: string;
  declinedReason?: string;
  declineIp?: string;
  declineDevice?: string;
  signedAs?: string;
  /** The address they typed when signing, when the document had an address box for them. */
  address?: string;
  /** Their agreement to use electronic records and signatures. */
  consent?: { version: string; at: string; ip?: string; device?: string };
};
export type SignEvent = { at: string; kind: string; party?: PartyKey; by?: string; byName?: string; note?: string; ip?: string; device?: string };

export type SignatureRequest = {
  id: string;
  title: string;
  status: RequestStatus;
  source: "contract" | "upload";
  asset_id: string | null;
  contract_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  original_path: string | null;
  current_path: string | null;
  signed_path: string | null;
  pages: Array<{ w: number; h: number }>;
  fields: SignField[];
  parties: Party[];
  events: SignEvent[];
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
  copy_sent_at: string | null;
  /** Sent under this name instead of BFO's (an MSA with "Entity name only"). */
  brand: string | null;
  /** The plain page or the game; rows from before the column come back without it. */
  mode?: SignMode;
  /** Fingerprints: the original as sent, the signed pages (on the certificate), the signed copy as filed and sent. */
  original_sha256?: string | null;
  executed_sha256?: string | null;
  signed_sha256?: string | null;
  archived_at?: string | null;
  archived_by_name?: string | null;
  archived_reason?: string | null;
  /** The request this was sent again from, and the one that replaced it. */
  replaces?: string | null;
  replaced_by?: string | null;
  /** Where the signed copy was filed with the entity's documents. */
  filed_path?: string | null;
};

/** Another request for the same document and entity: a version. */
export type RelatedRequest = { id: string; status: RequestStatus; created_at: string; sent_at: string | null; completed_at: string | null; archived: boolean };

/** What the request's page gets with the request. */
export type RequestPage = {
  request: SignatureRequest;
  pdfKey: string | null;
  pdfUrl: string | null;
  gameAllowed?: boolean;
  gameEntity?: boolean;
  entityName?: string | null;
  /** The role of each party that already has a BFO account. */
  accounts?: Partial<Record<PartyKey, string>>;
  /** Names for the history's actors, by id. */
  people?: Record<string, string>;
  related?: RelatedRequest[];
};

class SignError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new SignError(body.error ?? `http_${res.status}`, body.message ?? body.error ?? "Something went wrong.");
  return body;
}

/** Entity names by id, read from the tree: for a server that doesn't name them with the requests. */
export async function entityNamesFor(ids: string[]): Promise<Record<string, string>> {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return {};
  try {
    const res = await authFetch(`/api/tree?path=assets&ids=${want.map(encodeURIComponent).join(",")}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { rows?: Array<{ id: string; data?: { name?: unknown } | null }> };
    return Object.fromEntries((body.rows ?? []).filter((r) => typeof r.data?.name === "string" && r.data.name.trim()).map((r) => [r.id, String(r.data!.name).trim()]));
  } catch {
    return {};
  }
}

export const signApi = {
  /** Every request that isn't archived (or only the archived ones), and the names of their entities. */
  list: async (archived = false) => {
    const r = await call<{ requests: SignatureRequest[]; entityNames?: Record<string, string> }>(`/api/sign${archived ? "?archived=1" : ""}`);
    const entityNames = r.entityNames ?? (await entityNamesFor(r.requests.map((x) => x.asset_id ?? "")));
    return { requests: r.requests, entityNames };
  },
  /** One request. With `have`, the key of the PDF already on screen: pdfUrl comes back null unless there's a newer one. gameAllowed: this draft may go out as the game (only TallulahMD LLC's). */
  get: (id: string, have?: string | null) => call<RequestPage>(`/api/sign?id=${encodeURIComponent(id)}${have ? `&have=${encodeURIComponent(have)}` : ""}`),
  act: (action: string, body: Record<string, unknown>) => call<{ request: SignatureRequest }>("/api/sign", { method: "POST", body: JSON.stringify({ action, ...body }) }).then((r) => r.request),
  download: (id: string) => call<{ url: string }>("/api/sign", { method: "POST", body: JSON.stringify({ action: "download", id }) }).then((r) => r.url),
  /** Deletes a draft that never went out (the server refuses anything else). */
  remove: (id: string) => call<{ ok: true }>("/api/sign", { method: "POST", body: JSON.stringify({ action: "delete", id }) }),
  /** Makes a PDF already in an entity's documents the request's document (the server copies it). */
  attachStored: (id: string, path: string) => signApi.act("attach-stored", { id, path }),
  /** Puts the PDF where the request expects it and reads its pages. */
  async attach(id: string, file: Blob): Promise<SignatureRequest> {
    // A fresh path each time; the server only accepts paths it handed out for this request.
    const { signedUrl, path } = await call<{ signedUrl: string; token: string; path: string }>("/api/sign", { method: "POST", body: JSON.stringify({ action: "upload-url", id }) });
    const put = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
    if (!put.ok) throw new SignError("upload_failed", `The upload failed (${put.status}).`);
    return signApi.act("attach", { id, path });
  },
};

/**
 * A new tab opened now, inside the click, for a link fetched afterwards
 * (signApi.download): opened only after the await, Safari blocks it as a popup.
 * `go` points it at the link; `close` drops it when the fetch fails. The same
 * as openStoredFile in app/stored-file.tsx.
 */
export function blankTab(): { go: (url: string) => void; close: () => void } {
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  return {
    go: (url) => {
      if (win) win.location.href = url;
      else window.open(url, "_blank", "noopener");
    },
    close: () => win?.close(),
  };
}

/** Still waiting on someone: worth checking for progress. */
export const isOpen = (status?: RequestStatus | null) => status === "sent" || status === "partial";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft",
  sent: "Waiting",
  partial: "Partly signed",
  completed: "Signed",
  declined: "Declined",
  voided: "Voided",
};

export const PARTY_LABEL: Record<PartyStatus, string> = {
  pending: "Not sent",
  sent: "Sent",
  viewed: "Opened",
  signed: "Signed",
  declined: "Declined",
};

export const FIELD_LABEL: Record<FieldType, string> = { signature: "Signature", initials: "Initials", name: "Name", date: "Date", address: "Address" };

/** The ways a request can be signed, in the order they're offered: the plain page first, the default. */
export const MODES: Array<{ mode: SignMode; label: string; blurb: string }> = [
  { mode: "normal", label: "Normal e-signature", blurb: "They open the link, read the document and sign." },
  { mode: "game", label: "Anything Is Possible film", blurb: "On a computer a short film plays first, then the signing page. A phone signs straight away." },
  { mode: "race", label: "Racetrack game", blurb: "On a computer a two-lap race comes first, then the signing page. A phone signs straight away." },
];

export const MODE_LABEL: Record<SignMode, string> = { normal: MODES[0].label, game: MODES[1].label, race: MODES[2].label };

/** A fresh field of a type for a party, sized for the type. */
export function newField(party: PartyKey, type: FieldType, page: number, at?: { x: number; y: number }): SignField {
  const size = type === "signature" ? { w: 0.3, h: 0.055 } : type === "address" ? { w: 0.3, h: 0.05 } : type === "initials" ? { w: 0.08, h: 0.035 } : { w: 0.25, h: 0.03 };
  const x = Math.min(1 - size.w, Math.max(0, (at?.x ?? 0.1) - size.w / 2));
  const y = Math.min(1 - size.h, Math.max(0, (at?.y ?? 0.1) - size.h / 2));
  return { id: Math.random().toString(36).slice(2, 10), party, type, page, x, y, ...size };
}

/** The office keeps Arizona time, as the certificate does. */
export const OFFICE_ZONE = "America/Phoenix";

/** "Nov 5, 2026" in Arizona time (lists, headers); "" for nothing. */
export const when = (iso?: string | null) => (iso ? formatDate(iso, "medium", { timeZone: OFFICE_ZONE }) : "");

/** "Nov 5" this year, "Nov 5, 2025" otherwise, in Arizona time (rows). */
export const whenShort = (iso?: string | null) => (iso ? formatDate(iso, "short", { timeZone: OFFICE_ZONE }) : "");

/** An audit stamp: "Nov 5, 2026, 6:58 AM MST". */
export const stamp = (iso?: string | null) => (iso ? dateTime(iso, { zone: true, timeZone: OFFICE_ZONE }) : "");

/** "Northwind Holdings, LLC, by Alex Rivera, Manager", or the person's name. */
export function capacity(p: Pick<Party, "name" | "entity" | "title" | "role">): string {
  if (!p.entity) return p.name || p.role;
  return `${p.entity}, by ${p.name || "its signer"}${p.title ? `, ${p.title}` : ""}`;
}

/** The first characters of a fingerprint, grouped to read aloud: "3f9a 41c2 7be0". */
export const shortSha = (sha?: string | null) => (sha ? (sha.slice(0, 12).match(/.{1,4}/g) ?? []).join(" ") : "");

/** A user agent as a few words: "Safari on iPhone". */
export function deviceWords(ua?: string): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser && os ? `${browser} on ${os}` : browser || os || "a browser";
}

/** A name that reads as a company, trust or other organisation (the same test the server's Send uses). */
export function looksLikeEntity(name: string): boolean {
  return (
    /\b(l\.?l\.?c|l\.?l\.?p|l\.?p|inc|incorporated|corp|corporation|company|co|ltd|limited|trust|foundation|partners(hip)?|holdings|pllc|pc|p\.c)\b\.?,?\s*$/i.test(name.trim()) ||
    /,\s*(llc|inc|lp|ltd)\b/i.test(name)
  );
}

/** Every open request whose document and entity have a later, completed version: still live, though superseded. */
export function supersededBy(r: SignatureRequest, all: SignatureRequest[]): SignatureRequest | null {
  if (!isOpen(r.status)) return null;
  const later = all
    .filter((o) => o.id !== r.id && o.status === "completed" && o.title === r.title && (o.asset_id ?? null) === (r.asset_id ?? null) && o.created_at > r.created_at)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return later[0] ?? null;
}
