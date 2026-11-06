import { describe, expect, it } from "vitest";
import {
  accountLabel,
  accountType,
  asOf,
  count,
  date,
  dateRange,
  dateTime,
  duration,
  initials,
  isoDate,
  list,
  looksLikeSsn,
  maskAccount,
  maskEin,
  maskTin,
  money,
  parseDate,
  parseMoney,
  percent,
  phone,
  relative,
  time,
} from "../app/ui/format";

const MINUS = "−";
const NY = { timeZone: "America/New_York" };

describe("money", () => {
  it("formats cents by default, with a true minus", () => {
    expect(money(12480)).toBe("$12,480.00");
    expect(money(-84)).toBe(`${MINUS}$84.00`);
    expect(money(-84)).not.toContain("-");
  });

  it("signs money in for a mixed ledger", () => {
    expect(money(1250, { sign: "always" })).toBe("+$1,250.00");
    expect(money(-84, { sign: "always" })).toBe(`${MINUS}$84.00`);
    expect(money(0, { sign: "always" })).toBe("$0.00");
  });

  it("writes statements in whole dollars with parentheses", () => {
    expect(money(-2140.4, { precision: "dollars", sign: "accounting" })).toBe("($2,140)");
    expect(money(18240, { precision: "dollars", sign: "accounting" })).toBe("$18,240");
    expect(money(-2140.55, { sign: "accounting" })).toBe("($2,140.55)");
  });

  it("decides zero after rounding, and keeps nothing apart from zero", () => {
    expect(money(0.004, { zero: "dash" })).toBe("—");
    expect(money(-0.4, { precision: "dollars", zero: "dash" })).toBe("—");
    expect(money(-0.4, { precision: "dollars" })).toBe("$0");
    expect(money(0)).toBe("$0.00");
    expect(money(null)).toBe("");
    expect(money(undefined, { zero: "dash" })).toBe("");
    expect(money(Number.NaN)).toBe("");
  });

  it("rounds half away from zero without float drift", () => {
    expect(money(1.005)).toBe("$1.01");
    expect(money(-1.005)).toBe(`${MINUS}$1.01`);
    expect(money(2.5, { precision: "dollars" })).toBe("$3");
  });

  it("is compact only when asked", () => {
    expect(money(240000, { precision: "compact" })).toBe("$240K");
    expect(money(1_200_000, { precision: "compact" })).toBe("$1.2M");
    expect(money(-12_000, { precision: "compact" })).toBe(`${MINUS}$12K`);
    expect(money(950, { precision: "compact" })).toBe("$950");
    expect(money(0, { precision: "compact" })).toBe("$0");
    expect(money(999_600, { precision: "compact" })).toBe("$1M");
  });

  it("names other currencies by code", () => {
    expect(money(1250, { currency: "EUR" })).toBe("EUR 1,250.00");
    expect(money(-3, { currency: "gbp" })).toBe(`${MINUS}GBP 3.00`);
  });

  it("drops the sign with sign: none", () => {
    expect(money(-2140, { sign: "none" })).toBe("$2,140.00");
  });
});

describe("percent", () => {
  it("uses one decimal by default and no space before %", () => {
    expect(percent(8.64)).toBe("8.6%");
    expect(percent(-12.5)).toBe(`${MINUS}12.5%`);
  });
  it("keeps ownership as recorded, trailing zeros dropped", () => {
    expect(percent(50, { decimals: 2, trim: true })).toBe("50%");
    expect(percent(33.3333, { decimals: 2, trim: true })).toBe("33.33%");
    expect(percent(12.5, { decimals: 2, trim: true })).toBe("12.5%");
  });
  it("formats rates, scores and statement percentages", () => {
    expect(percent(4.25, { decimals: 2 })).toBe("4.25%");
    expect(percent(76.4, { decimals: 0 })).toBe("76%");
    expect(percent(-12.5, { sign: "accounting" })).toBe("(12.5%)");
    expect(percent(3.4, { sign: "always" })).toBe("+3.4%");
    expect(percent(null)).toBe("");
  });
});

describe("count and list", () => {
  it("pairs numerals with the right noun", () => {
    expect(count(1, "entity", "entities")).toBe("1 entity");
    expect(count(3, "entity", "entities")).toBe("3 entities");
    expect(count(1204, "transaction")).toBe("1,204 transactions");
    expect(count(0, "entity", "entities")).toBe("No entities");
    expect(count(0, "rule", undefined, { zero: "numeral" })).toBe("0 rules");
  });
  it("joins names for prose", () => {
    expect(list(["Alex"])).toBe("Alex");
    expect(list(["Alex", "Sam"])).toBe("Alex and Sam");
    expect(list(["Alex", "Sam", "Jo"])).toBe("Alex, Sam, and Jo");
    expect(list(["Mail", "Phone"], "disjunction")).toBe("Mail or Phone");
  });
});

describe("dates", () => {
  const now = new Date("2026-11-06T17:00:00Z");

  it("drops the year in the short style only for this year", () => {
    expect(date("2026-11-06", "short", { now })).toBe("Nov 6");
    expect(date("2025-11-06", "short", { now })).toBe("Nov 6, 2025");
    expect(date("2026-11-06", "medium")).toBe("Nov 6, 2026");
    expect(date("2026-11-06", "long")).toBe("November 6, 2026");
  });

  it("never shifts a calendar date with the time zone", () => {
    expect(date("2026-01-01", "medium", { timeZone: "America/Los_Angeles" })).toBe("Jan 1, 2026");
    expect(date("2026-01-01", "medium", { timeZone: "Asia/Tokyo" })).toBe("Jan 1, 2026");
  });

  it("shows instants in the viewer's zone, with the zone for audit stamps", () => {
    const t = "2026-11-06T20:14:00Z";
    expect(dateTime(t, NY)).toBe("Nov 6, 2026, 3:14 PM");
    expect(dateTime(t, { ...NY, zone: true })).toBe("Nov 6, 2026, 3:14 PM EST");
    expect(time(t, NY)).toBe("3:14 PM");
    expect(dateTime("not a date")).toBe("");
  });

  it("writes ranges with an en dash, spaced only when the ends have spaces", () => {
    expect(dateRange("2026-11-01", "2026-11-05")).toBe("Nov 1–5, 2026");
    expect(dateRange("2026-01-01", "2026-11-05")).toBe("Jan 1 – Nov 5, 2026");
    expect(dateRange("2025-12-15", "2026-01-10")).toBe("Dec 15, 2025 – Jan 10, 2026");
    expect(dateRange("2026-11-06", "2026-11-06")).toBe("Nov 6, 2026");
  });

  it("says as of when", () => {
    expect(asOf("2026-11-06")).toBe("As of Nov 6, 2026");
    expect(asOf("2026-11-06T12:00:00Z", { time: true, ...NY })).toBe("As of Nov 6, 2026, 7:00 AM");
  });

  it("is relative only under a day", () => {
    expect(relative(new Date(now.getTime() - 20_000), now)).toBe("Just now");
    expect(relative(new Date(now.getTime() - 12 * 60_000), now)).toBe("12 min ago");
    expect(relative(new Date(now.getTime() - 60 * 60_000), now)).toBe("1 hour ago");
    expect(relative(new Date(now.getTime() - 3 * 3600_000), now)).toBe("3 hours ago");
    expect(relative("2026-11-02", now)).toBe("Nov 2");
    expect(relative("2025-11-02", now)).toBe("Nov 2, 2025");
  });

  it("says durations in plain words", () => {
    expect(duration(180_000)).toBe("about 3 minutes");
    expect(duration(60_000)).toBe("about a minute");
    expect(duration(2 * 3600_000)).toBe("about 2 hours");
    expect(duration(5_000)).toBe("5 seconds");
  });

  it("reads typed dates in common forms", () => {
    expect(parseDate("Nov 6, 2026")).toBe("2026-11-06");
    expect(parseDate("november 6 2026")).toBe("2026-11-06");
    expect(parseDate("6 Nov 2026")).toBe("2026-11-06");
    expect(parseDate("Sept. 3rd, 2026")).toBe("2026-09-03");
    expect(parseDate("11/6/2026")).toBe("2026-11-06");
    expect(parseDate("11/6/26")).toBe("2026-11-06");
    expect(parseDate("2026-11-06")).toBe("2026-11-06");
    expect(parseDate("Feb 30, 2026")).toBeNull();
    expect(parseDate("Mayo 3 2026")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(isoDate(new Date(2026, 10, 6))).toBe("2026-11-06");
  });
});

describe("parseMoney", () => {
  it("reads what people type", () => {
    expect(parseMoney("$1,250.00")).toBe(1250);
    expect(parseMoney("1250")).toBe(1250);
    expect(parseMoney("(84.00)")).toBe(-84);
    expect(parseMoney(`${MINUS}84`)).toBe(-84);
    expect(parseMoney("-$84")).toBe(-84);
    expect(parseMoney(".5")).toBe(0.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("12a")).toBeNull();
  });
});

describe("masks", () => {
  it("masks accounts, EINs and TINs with bullets", () => {
    expect(maskAccount("4821")).toBe("•• 4821");
    expect(maskAccount("000123454821")).toBe("•• 4821");
    expect(maskEin("12-3456789")).toBe("••-•••6789");
    expect(maskTin("123-45-6789", "ssn")).toBe("•••-••-6789");
    expect(maskTin("12-3456789", "ein")).toBe("••-•••6789");
    expect(maskAccount("")).toBe("");
  });

  it("spots an SSN typed into an EIN field", () => {
    expect(looksLikeSsn("123-45-6789")).toBe(true);
    expect(looksLikeSsn(" 123-45-6789 ")).toBe(true);
    expect(looksLikeSsn("12-3456789")).toBe(false);
    expect(looksLikeSsn("123456789")).toBe(false);
  });

  it("formats North American numbers and leaves others international", () => {
    expect(phone("+15550100142")).toBe("(555) 010-0142");
    expect(phone("5550100142")).toBe("(555) 010-0142");
    expect(phone("+442079460958")).toBe("+442079460958");
  });
});

describe("accounts", () => {
  it("names an account by nickname, else its tidied name, then the mask", () => {
    expect(accountLabel({ nickname: "Operating checking", name: "BUSINESS CHECKING", mask: "4821" })).toBe("Operating checking •• 4821");
    expect(accountLabel({ name: "BUSINESS_PREMIER_CHECKING", mask: "4821" })).toBe("Business Premier Checking •• 4821");
    expect(accountLabel({ name: "ROTH IRA BROKERAGE" })).toBe("Roth IRA Brokerage");
    expect(accountLabel({ name: "Northwind Holdings LLC" })).toBe("Northwind Holdings LLC");
    expect(accountLabel({})).toBe("Account");
  });

  it("labels account types from a map", () => {
    expect(accountType("checking")).toBe("Checking");
    expect(accountType("roth")).toBe("Roth IRA");
    expect(accountType("401k")).toBe("401(k)");
    expect(accountType("credit_card")).toBe("Credit card");
    expect(accountType("cash management")).toBe("Cash management");
    expect(accountType("crypto_exchange")).toBe("Crypto exchange");
  });
});

describe("initials", () => {
  it("takes the first and last words, skipping designators", () => {
    expect(initials("Alex Rivera")).toBe("AR");
    expect(initials("Northwind Holdings, LLC")).toBe("NH");
    expect(initials("The Alder Family Trust")).toBe("AF");
    expect(initials("sam")).toBe("S");
    expect(initials("LLC")).toBe("");
  });
});
