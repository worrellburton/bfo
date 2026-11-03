import { describe, expect, it } from "vitest";
import { GAME_ENTITY, GAME_ONLY_MESSAGE, isGameEntity } from "../lib/game-entity";

describe("the one entity that may send the game", () => {
  it("is TallulahMD LLC, written any way", () => {
    expect(isGameEntity(GAME_ENTITY)).toBe(true);
    expect(isGameEntity("Tallulah MD, LLC")).toBe(true);
    expect(isGameEntity("  tallulahmd llc ")).toBe(true);
    expect(isGameEntity("TALLULAH M.D. LLC")).toBe(true);
  });

  it("is no other entity, and not a missing name", () => {
    expect(isGameEntity("Ledger Louise, LLC")).toBe(false);
    expect(isGameEntity("Tallulah Holdings, LLC")).toBe(false);
    expect(isGameEntity("")).toBe(false);
    expect(isGameEntity(null)).toBe(false);
    expect(isGameEntity(undefined)).toBe(false);
  });

  it("names the entity in the refusal", () => {
    expect(GAME_ONLY_MESSAGE).toContain(GAME_ENTITY);
  });
});
