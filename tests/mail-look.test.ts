import { describe, expect, it } from "vitest";
import { LOOKS, lookSpec, lookVars, nextLook } from "../app/mail-look";

describe("mail looks", () => {
  it("cycles through every look and back to the first", () => {
    let k = LOOKS[0].key;
    const seen = [k];
    for (let i = 1; i < LOOKS.length; i++) {
      k = nextLook(k);
      seen.push(k);
    }
    expect(seen).toEqual(LOOKS.map((l) => l.key));
    expect(nextLook(k)).toBe(LOOKS[0].key);
  });

  it("Aurora takes the mailbox's hue; the others have their own", () => {
    expect(lookVars("aurora", 0.5)["--mail-hue"]).toBe("180");
    expect(lookVars("ember", 0.5)["--mail-hue"]).toBe(String(Math.round(lookSpec("ember").hue! * 360)));
  });

  it("Mono has no colour", () => {
    const v = lookVars("mono", 0.5);
    expect(v["--mail-sat"]).toBe("0%");
    expect(lookSpec("mono").sat).toBe(0);
  });

  it("every look sets all six variables", () => {
    for (const l of LOOKS) {
      const v = lookVars(l.key, 0.3);
      expect(Object.keys(v).sort()).toEqual(["--mail-accent", "--mail-accent-deep", "--mail-accent-ink", "--mail-accent-pale", "--mail-hue", "--mail-sat"]);
      for (const x of Object.values(v)) expect(x).toBeTruthy();
    }
  });

  it("falls back to Aurora for an unknown key", () => {
    expect(lookSpec("nope" as never).key).toBe("aurora");
  });
});
