/**
 * Giving a firing back: the holder's release so it reads open again, and the unstarted-only give-back that
 * refuses once a run has begun.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  giveBackUnstartedAttempt,
  readSlotAttempt,
  releaseSlotAttempt,
} from "../../../../../live/automation/slotLedger.js";
import { startSeatedRun } from "../../../../../live/automation/slotSeatedRun.js";
import { RECIPE, SEATED_PID, SLOT, takeSlot } from "./harness.js";

let home: string;

const take = ({ holderToken, nowIso }: { holderToken: string; nowIso: string }) =>
  takeSlot({ holderToken, home, nowIso });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("releaseSlotAttempt", () => {
  it("gives a firing back so it reads open again, which is right for a spawn that never started", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      releaseSlotAttempt({
        holderToken: "tok-1",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
    expect(unwrap(take({ holderToken: "tok-2", nowIso: "2026-09-16T12:03:00.000Z" })).kind).toBe("taken");
  });

  it("refuses to give back a firing this caller does not hold", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const released = releaseSlotAttempt({
      holderToken: "tok-9",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(released.isErr()).toBe(true);
    expect(released._unsafeUnwrapErr().code).toBe("SLOT_TOKEN_MISMATCH");
  });

  it("is a no-op on a firing nobody holds, so tidy-up never has to branch", () => {
    const released = releaseSlotAttempt({
      holderToken: "tok-1",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(released.isOk()).toBe(true);
  });
});

describe("giveBackUnstartedAttempt", () => {
  it("removes an attempt nothing has started, so the firing reads open again", () => {
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    const given = unwrap(
      giveBackUnstartedAttempt({
        holderToken: "seat-a",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(given).toEqual({ kind: "given-back" });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });

  it("refuses to remove an attempt whose run STARTED after it was read — the r1 counterexample", () => {
    // The caller read the row unstarted; between that read and this call another invocation started it.
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-a",
        home,
        nowIso: "2026-09-16T12:01:30.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const given = unwrap(
      giveBackUnstartedAttempt({
        holderToken: "seat-a",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(given).toEqual({ at: "2026-09-16T12:01:30.000Z", kind: "started" });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.runStartedAtIso).toBe(
      "2026-09-16T12:01:30.000Z",
    );
  });

  it("refuses another token's attempt, and treats an already-gone row as given back", () => {
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    const other = giveBackUnstartedAttempt({
      holderToken: "seat-b",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(other.isErr()).toBe(true);
    expect(other._unsafeUnwrapErr().code).toBe("SLOT_TOKEN_MISMATCH");
    const gone = unwrap(
      giveBackUnstartedAttempt({
        holderToken: "seat-a",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: "2026-09-16T13:00:00.000Z",
      }),
    );
    expect(gone).toEqual({ kind: "given-back" });
  });
});
