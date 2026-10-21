/**
 * Palm's questions on a filing ("cases"): what it asks for, and BFO's best
 * answer to start from. An address field is answered with Palm's address
 * object, filled from the entity's principal office or mailing address.
 */

import { parseAddress, type FormationAddress } from "./formation";

export type CaseField = { name: string; type: string; description: string; required?: boolean; example?: unknown; document_types?: string[] };

export type PalmCase = {
  id: string;
  kind: string;
  status: "needs_response" | "under_review" | "resolved" | "superseded";
  summary: string;
  details?: string | null;
  request?: { fields: CaseField[]; documents?: string[] } | null;
  due_at?: string | null;
  opened_at: string;
  resolved_at?: string | null;
};

/** What the form holds for one field: an address in parts, or text. */
export type CaseValue = { kind: "address"; address: FormationAddress } | { kind: "text"; text: string } | { kind: "document" };

export const isAddressField = (f: CaseField) => f.type === "object" && /address/i.test(f.name);

type EntityFacts = { name?: string; address?: string; mailingAddress?: string; registeredAgentAddress?: string; email?: string };

const EMPTY: FormationAddress = { street1: "", street2: "", city: "", region: "", postal: "", county: "" };

/** Which of the entity's addresses a field asks for. */
export function addressFor(field: CaseField, a: EntityFacts): string | undefined {
  const n = field.name.toLowerCase();
  if (/mail/.test(n)) return a.mailingAddress || a.address;
  if (/agent/.test(n)) return a.registeredAgentAddress;
  return a.address;
}

export function caseDefaults(c: PalmCase, a: EntityFacts): Record<string, CaseValue> {
  const out: Record<string, CaseValue> = {};
  for (const f of c.request?.fields ?? []) {
    if (isAddressField(f)) out[f.name] = { kind: "address", address: splitSuite(parseAddress(addressFor(f, a)) ?? { ...EMPTY }) };
    else if (f.type === "document") out[f.name] = { kind: "document" };
    else if (f.name === "legal_name") out[f.name] = { kind: "text", text: a.name ?? "" };
    else if (/email/i.test(f.name)) out[f.name] = { kind: "text", text: a.email ?? "" };
    else out[f.name] = { kind: "text", text: "" };
  }
  return out;
}

/** "5227 N 7th St STE 48575" → street "5227 N 7th St", suite "STE 48575". */
function splitSuite(x: FormationAddress): FormationAddress {
  if (x.street2.trim()) return x;
  const m = /^(.*\S)\s+((?:ste\.?|suite|unit|apt\.?|#)\s*[\w-]+)$/i.exec(x.street1.trim());
  return m ? { ...x, street1: m[1], street2: m[2] } : x;
}

/** Palm's address object, as the formation request takes it. */
export function palmAddress(x: FormationAddress): Record<string, string> {
  const o: Record<string, string> = {
    street_line_1: x.street1.trim(),
    street_line_2: x.street2.trim(),
    city: x.city.trim(),
    region: x.region.trim().toUpperCase(),
    postal_code: x.postal.trim(),
    country: "US",
  };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
}

/** The response's fields, or what's still missing. */
export function caseAnswer(c: PalmCase, values: Record<string, CaseValue>): { fields: Record<string, unknown> } | { missing: string[] } {
  const fields: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const f of c.request?.fields ?? []) {
    const v = values[f.name];
    const required = f.required !== false;
    if (!v || v.kind === "document") {
      if (required) missing.push(f.description || f.name);
      continue;
    }
    if (v.kind === "address") {
      const x = v.address;
      if (!x.street1.trim() || !x.city.trim() || !/^[A-Za-z]{2}$/.test(x.region.trim()) || !/^\d{5}(-\d{4})?$/.test(x.postal.trim())) {
        if (required) missing.push(f.description || f.name);
        continue;
      }
      fields[f.name] = palmAddress(x);
      continue;
    }
    const text = v.text.trim();
    if (!text) {
      if (required) missing.push(f.description || f.name);
      continue;
    }
    if (f.type === "number") fields[f.name] = Number(text);
    else if (f.type === "boolean") fields[f.name] = /^(yes|true|1)$/i.test(text);
    else if (f.type === "object" || f.type === "list") {
      try {
        fields[f.name] = JSON.parse(text);
      } catch {
        missing.push(`${f.description || f.name} (as JSON)`);
      }
    } else fields[f.name] = text;
  }
  return missing.length ? { missing } : { fields };
}
