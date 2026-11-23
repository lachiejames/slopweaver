import { describe, expect, it } from "vitest";

import { PACK_KEEPER_REFRESH_MINUTES, PACK_KEEPER_TICK_MS, packKeeperArgv } from "../../lib/packKeeper";

describe("packKeeperArgv", () => {
  it("asks the verb to rebuild only a pack older than the keeper's bound, so the age is decided in one place", () => {
    expect(packKeeperArgv()).toEqual(["talk", "pack", "--write", "--if-older-than", "30"]);
  });
});

describe("the keeper's bounds", () => {
  // The mint leaves out a pack past 60 minutes (src/talk/storedPack.ts PACK_MAX_AGE_MINUTES). A pack rebuilt once it
  // is 30 minutes old, checked every 10, is at most 40 minutes old at any mint — inside that bound with room to spare.
  it("refreshes at half the mint's bound and checks often enough that a mint never finds one past it", () => {
    expect(PACK_KEEPER_REFRESH_MINUTES).toBe(30);
    expect(PACK_KEEPER_TICK_MS).toBe(600_000);
    expect(PACK_KEEPER_REFRESH_MINUTES + PACK_KEEPER_TICK_MS / 60_000).toBe(40);
  });
});
