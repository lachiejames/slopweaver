/*
 * An owner's mint stamps its instant AFTER the stored pack and the supervisor window are read, and takes its instant
 * from the continuity read rather than from a clock read of its own. Review r1 on the test-instance mint change found
 * the instant captured before those two reads, which moved the owner's continuity window earlier; this pins the order
 * with plain fakes that log when each ran.
 */
import { describe, expect, it } from "vitest";

import { readOwnerMintState } from "../../../talk/ownerMintReads.js";

const STAMPED = "2026-11-28T09:00:01.000Z";

describe("readOwnerMintState", () => {
  it("reads the pack, then the supervisor window, then the clock, then the continuity at that instant", async () => {
    const ran: string[] = [];
    const reads = await readOwnerMintState({
      now: () => {
        ran.push("clock");
        return STAMPED;
      },
      readContinuityAt: async ({ nowIso, supervisor }) => {
        ran.push(`continuity at ${nowIso} with ${supervisor}`);
        return { builtIso: nowIso };
      },
      readPack: () => {
        ran.push("pack");
        return "the pack";
      },
      readSupervisor: () => {
        ran.push("supervisor");
        return "the window";
      },
    });
    expect(ran).toEqual(["pack", "supervisor", "clock", `continuity at ${STAMPED} with the window`]);
    expect(reads).toEqual({
      builtIso: STAMPED,
      continuity: { builtIso: STAMPED },
      pack: "the pack",
      supervisor: "the window",
    });
  });

  it("takes the mint's instant from the continuity read, never from its own clock read", async () => {
    const reads = await readOwnerMintState({
      now: () => STAMPED,
      readContinuityAt: async () => ({ builtIso: "2026-11-28T09:00:02.500Z" }),
      readPack: () => undefined,
      readSupervisor: () => undefined,
    });
    expect(reads.builtIso).toBe("2026-11-28T09:00:02.500Z");
  });
});
