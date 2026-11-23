import { describe, expect, it } from "vitest";

import {
  holderAliveFor,
  killFailureReadsAlive,
  recipeHolderAlive,
} from "../../../../live/automation/holderLiveness.js";
import { openSlotAttempt, type RecipeSlotAttempt } from "../../../../live/automation/slotAttempt.js";
import { attemptOf } from "../../../../live/automation/slotAttemptCodec.js";

const SLOT = "2026-09-26T17:00:00.000Z";

const row = ({ holderPid }: { holderPid: number | null }): RecipeSlotAttempt =>
  openSlotAttempt({
    attempt: 2,
    holder: "recipe run-due",
    holderPid,
    holderToken: "13d09ab5",
    leaseExpiresIso: "2026-09-27T17:00:00.000Z",
    nowIso: "2026-09-26T23:40:22.764Z",
    recipeId: "store-backup-daily",
    slotIso: SLOT,
  });

describe("killFailureReadsAlive", () => {
  it("reads ESRCH — no such process — as the one answer that proves the holder is gone", () => {
    expect(killFailureReadsAlive({ code: "ESRCH" })).toBe(false);
  });

  it("reads EPERM as alive: the process exists under another user", () => {
    expect(killFailureReadsAlive({ code: "EPERM" })).toBe(true);
  });

  it("reads any other failure as alive, so a probe that cannot tell never abandons a live attempt", () => {
    expect(killFailureReadsAlive({ code: "EINVAL" })).toBe(true);
    expect(killFailureReadsAlive({ code: undefined })).toBe(true);
  });
});

describe("recipeHolderAlive", () => {
  it("reads this very process as alive", () => {
    expect(recipeHolderAlive({ pid: process.pid })).toBe(true);
  });
});

describe("holderAliveFor", () => {
  it("never probes a PID-less row, answering null so the lease alone judges it", () => {
    const probed: number[] = [];
    const reading = holderAliveFor({
      processAlive: ({ pid }) => {
        probed.push(pid);
        return false;
      },
      stored: row({ holderPid: null }),
    });
    expect(reading).toBe(null);
    expect(probed).toEqual([]);
  });

  it("answers null for a firing nothing has attempted", () => {
    expect(holderAliveFor({ processAlive: () => false, stored: null })).toBe(null);
  });

  it("probes exactly the stored pid and answers what the probe said", () => {
    const probed: number[] = [];
    const reading = holderAliveFor({
      processAlive: ({ pid }) => {
        probed.push(pid);
        return false;
      },
      stored: row({ holderPid: 4242 }),
    });
    expect(reading).toBe(false);
    expect(probed).toEqual([4242]);
  });
});

describe("attemptOf — the holder pid", () => {
  it("round-trips a stored pid", () => {
    const stored = row({ holderPid: 4242 });
    expect(attemptOf({ value: JSON.parse(JSON.stringify(stored)) })).toEqual(stored);
  });

  it("reads a row written before the field existed as PID-less", () => {
    const { holderPid: _dropped, ...legacy } = row({ holderPid: 4242 });
    expect(attemptOf({ value: legacy })!.holderPid).toBe(null);
  });

  it("refuses a pid that is not a positive safe integer, rather than guessing one", () => {
    const stored = row({ holderPid: 4242 });
    expect(attemptOf({ value: { ...stored, holderPid: 0 } })).toBe(undefined);
    expect(attemptOf({ value: { ...stored, holderPid: -1 } })).toBe(undefined);
    expect(attemptOf({ value: { ...stored, holderPid: 1.5 } })).toBe(undefined);
    expect(attemptOf({ value: { ...stored, holderPid: "4242" } })).toBe(undefined);
  });
});
