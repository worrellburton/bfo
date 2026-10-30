// The browser's side of /api/sign (api/sign.ts): types the office pages and
// the contract page share, and the calls they make.
import { authFetch } from "../auth";

export type PartyKey = "a" | "b";
export type FieldType = "signature" | "initials" | "name" | "date";
export type PartyStatus = "pending" | "sent" | "viewed" | "signed" | "declined";
export type RequestStatus = "draft" | "sent" | "partial" | "completed" | "declined" | "voided";

export type SignField = { id: string; party: PartyKey; type: FieldType; page: number; x: number; y: number; w: number; h: number };
export type Party = { key: PartyKey; role: string; name: string; email: string; status: PartyStatus; sentAt?: string; viewedAt?: string; signedAt?: string; declinedAt?: string; declinedReason?: string; signedAs?: string };
export type SignEvent = { at: string; kind: string; party?: PartyKey; by?: string; note?: string };

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
};

export class SignError extends Error {
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

export const signApi = {
  list: () => call<{ requests: SignatureRequest[] }>("/api/sign").then((r) => r.requests),
  /** With `have`, the key of the PDF already on screen: pdfUrl comes back null unless there's a newer one. */
  get: (id: string, have?: string | null) =>
    call<{ request: SignatureRequest; pdfKey: string | null; pdfUrl: string | null }>(`/api/sign?id=${encodeURIComponent(id)}${have ? `&have=${encodeURIComponent(have)}` : ""}`),
  act: (action: string, body: Record<string, unknown>) => call<{ request: SignatureRequest }>("/api/sign", { method: "POST", body: JSON.stringify({ action, ...body }) }).then((r) => r.request),
  download: (id: string) => call<{ url: string }>("/api/sign", { method: "POST", body: JSON.stringify({ action: "download", id }) }).then((r) => r.url),
  remove: (id: string) => call<{ ok: true }>("/api/sign", { method: "POST", body: JSON.stringify({ action: "delete", id }) }),
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

export const FIELD_LABEL: Record<FieldType, string> = { signature: "Signature", initials: "Initials", name: "Name", date: "Date" };

/** A fresh field of a type for a party, sized for the type. */
export function newField(party: PartyKey, type: FieldType, page: number, at?: { x: number; y: number }): SignField {
  const size = type === "signature" ? { w: 0.3, h: 0.055 } : type === "initials" ? { w: 0.08, h: 0.035 } : { w: 0.25, h: 0.03 };
  const x = Math.min(1 - size.w, Math.max(0, (at?.x ?? 0.1) - size.w / 2));
  const y = Math.min(1 - size.h, Math.max(0, (at?.y ?? 0.1) - size.h / 2));
  return { id: Math.random().toString(36).slice(2, 10), party, type, page, x, y, ...size };
}

export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
