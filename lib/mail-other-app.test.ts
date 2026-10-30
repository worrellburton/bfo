import { describe, expect, it } from "vitest";
import { forOtherApp } from "./mail.js";

describe("forOtherApp", () => {
  it("skips mail To an Impact Advisory address", () => {
    expect(forOtherApp({ to: [{ email: "Bobby@ImpactAdvisory.llc" }] }, null)).toBe(true);
  });
  it("skips mail whose envelope names one (Bcc)", () => {
    expect(forOtherApp({ to: [] }, "Delivered-To: bobby@impactadvisory.llc\r\nFrom: x@y.com\r\n\r\nbody")).toBe(true);
    expect(forOtherApp({ to: [] }, "Received: from a by b\r\n for <bobby@impactadvisory.llc>; Thu\r\n\r\n")).toBe(true);
  });
  it("keeps everything else", () => {
    expect(forOtherApp({ to: [{ email: "info@vqshareholders.com" }] }, "From: bobby@impactadvisory.llc\r\n\r\n")).toBe(false);
    expect(forOtherApp({ to: [], cc: null }, null)).toBe(false);
  });
});
