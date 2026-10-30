import { describe, expect, it } from "vitest";
import { needsReading, readingFailed, readingKey, toReading } from "../lib/paper-read";

describe("paper mail reading", () => {
  it("is read once per envelope, and again when a scan arrives", () => {
    const envelopeOnly = { envelope_path: "stable/a/envelope.jpg", scan_path: null };
    expect(needsReading({ ...envelopeOnly, reading_from: null })).toBe(true);
    expect(needsReading({ ...envelopeOnly, reading_from: readingKey(envelopeOnly) })).toBe(false);
    const scanned = { ...envelopeOnly, scan_path: "stable/a/scan.pdf" };
    expect(needsReading({ ...scanned, reading_from: readingKey(envelopeOnly) })).toBe(true);
    expect(needsReading({ envelope_path: null, scan_path: null, reading_from: null })).toBe(false);
  });

  it("doesn't read again copies whose reading failed, until a scan arrives", () => {
    const envelopeOnly = { envelope_path: "stable/a/envelope.jpg", scan_path: null };
    const failed = { ...envelopeOnly, reading_from: `failed:${readingKey(envelopeOnly)}` };
    expect(needsReading(failed)).toBe(false);
    expect(readingFailed(failed)).toBe(true);
    expect(readingFailed({ ...envelopeOnly, reading_from: readingKey(envelopeOnly) })).toBe(false);
    const scanned = { ...failed, scan_path: "stable/a/scan.pdf" };
    expect(needsReading(scanned)).toBe(true);
    expect(readingFailed(scanned)).toBe(false);
  });

  it("keeps what's well formed and drops the rest", () => {
    const r = toReading(
      {
        headline: "  Likely a statement from Stable, judging by the envelope ",
        kind: "spaceship",
        urgency: "urgent",
        sender: { name: "STABLE", address: "2261 Market St #4706, San Francisco, CA 94114-1612" },
        recipient: null,
        postage: "",
        mailClass: "Presorted First-Class",
        action: null,
        dueDate: "Nov 14",
        amounts: [{ label: "Amount due", amount: "$1,240.00" }, { label: "", amount: "$5" }, "junk"],
        dates: [],
        references: [{ label: "Account", value: "••1234" }],
        contents: "Should be dropped without a scan.",
        envelopeText: ["STABLE", "", 7, "LEDGER LOUISE, LLC"],
      },
      false
    );
    expect(r.headline).toBe("Likely a statement from Stable, judging by the envelope");
    expect(r.kind).toBe("other");
    expect(r.urgency).toBe("fyi");
    expect(r.sender.address).toContain("San Francisco");
    expect(r.recipient).toEqual({ name: null, address: null });
    expect(r.postage).toBeNull();
    expect(r.dueDate).toBeNull();
    expect(r.amounts).toEqual([{ label: "Amount due", amount: "$1,240.00" }]);
    expect(r.contents).toBeNull();
    expect(r.envelopeText).toEqual(["STABLE", "LEDGER LOUISE, LLC"]);
    expect(r.fromScan).toBe(false);
  });

  it("keeps the contents and a real due date when the scan was read", () => {
    const r = toReading({ headline: "A bill", kind: "bill", urgency: "action", dueDate: "2026-11-14", contents: "Pay it." }, true);
    expect(r).toMatchObject({ kind: "bill", urgency: "action", dueDate: "2026-11-14", contents: "Pay it.", fromScan: true });
  });
});
