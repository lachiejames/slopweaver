/**
 * Retiring a firing: the death written only onto the attempt that was judged, the stored outcome kinds read
 * back exactly, and a death reason this build does not know refused by the codec.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { attemptOf } from "../../../../../live/automation/slotAttemptCodec.js";
import { readSlotAttempt, retakeAbandonedSlot, slotAttemptKey } from "../../../../../live/automation/slotLedger.js";
import { retireSlot, settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { LEASE, RECIPE, SLOT, takeSlot } from "./harness.js";

let home: string;

const take = ({ holderToken, nowIso }: { holderToken: string; nowIso: string }) =>
  takeSlot({ holderToken, home, nowIso });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("retireSlot", () => {
  const retire = ({ judged }: { judged: { attempt: number; holderToken: string } }) =>
    unwrap(
      retireSlot({
        detail: "lease expired, effect unprovable",
        home,
        judged,
        nowIso: "2026-09-18T00:00:00.000Z",
        reason: "OUTCOME_UNKNOWN",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );

  it("writes the death onto the attempt that was judged, which is the only act that can end one", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const retired = retire({ judged: { attempt: 1, holderToken: "tok-1" } });
    expect(retired.kind).toBe("retired");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome!.kind).toBe("dead");
  });

  it("leaves a newer, live attempt exactly as found when the verdict was made over an older one", () => {
    // The counterexample: attempt 1 judged abandoned, then another dispatcher retook the firing as a
    // live attempt 2 before this retirement reached the lock.
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      retakeAbandonedSlot({
        holder: "recipe run-due",
        holderPid: 5151,
        holderToken: "tok-2",
        home,
        leaseExpiresIso: "2026-09-19T12:00:00.000Z",
        nowIso: "2026-09-17T13:00:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const before = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    const retired = retire({ judged: { attempt: 1, holderToken: "tok-1" } });
    expect(retired).toEqual({ current: before, kind: "moved" });
    const after = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    expect(after).toEqual(before);
    expect(after.attempt).toBe(2);
    expect(after.outcome).toBe(null);
  });

  it("never overwrites a success that landed after the verdict was made", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      settleSlotAttempt({
        holderToken: "tok-1",
        home,
        nowIso: "2026-09-16T12:30:00.000Z",
        outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:30:00.000Z" },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(retire({ judged: { attempt: 1, holderToken: "tok-1" } }).kind).toBe("moved");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome!.kind).toBe("succeeded");
  });

  it("retires nothing when the firing's row is gone, because no row is the attempt that was judged", () => {
    expect(retire({ judged: { attempt: 1, holderToken: "tok-1" } })).toEqual({ current: null, kind: "moved" });
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });
});

describe("retireSlot over an existing attempt", () => {
  it("keeps the attempt's own history and writes the death onto it", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const retired = unwrap(
      retireSlot({
        detail: "lease expired, effect unprovable",
        home,
        judged: { attempt: 1, holderToken: "tok-1" },
        nowIso: "2026-09-18T00:00:00.000Z",
        reason: "OUTCOME_UNKNOWN",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(retired.kind).toBe("retired");
    const written = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    expect(written.holder).toBe("holder-tok-1");
    expect(written.outcome).toEqual({
      detail: "lease expired, effect unprovable",
      kind: "dead",
      reason: "OUTCOME_UNKNOWN",
      settledAtIso: "2026-09-18T00:00:00.000Z",
    });
  });

  it("round-trips every outcome kind through the reader", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      settleSlotAttempt({
        holderToken: "tok-1",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        outcome: {
          detail: "exit 1",
          exitCode: null,
          kind: "failed",
          retryNotBeforeIso: "2026-09-16T18:00:00.000Z",
          settledAtIso: "2026-09-16T12:02:00.000Z",
        },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toEqual({
      detail: "exit 1",
      exitCode: null,
      kind: "failed",
      retryNotBeforeIso: "2026-09-16T18:00:00.000Z",
      settledAtIso: "2026-09-16T12:02:00.000Z",
    });
  });

  it("refuses a stored dead outcome with a reason this build does not know", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const path = join(
      stateHomePaths({ home }).live.recipe.slotAttemptsDir,
      `${slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })}.json`,
    );
    const stored = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    writeFileSync(
      path,
      JSON.stringify({ ...stored, outcome: { detail: "x", kind: "dead", reason: "MADE_UP", settledAtIso: SLOT } }),
      "utf8",
    );
    const read = readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("SLOT_UNREADABLE");
  });

  it("writes and reads back a KILLED_BY_SIGNAL death exactly", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      retireSlot({
        detail: "received SIGTERM while its effect ran",
        home,
        judged: { attempt: 1, holderToken: "tok-1" },
        nowIso: "2026-09-16T12:03:00.000Z",
        reason: "KILLED_BY_SIGNAL",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toEqual({
      detail: "received SIGTERM while its effect ran",
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: "2026-09-16T12:03:00.000Z",
    });
  });
});

describe("attemptOf — a stored death reason", () => {
  /** One stored row whose outcome is a death for the given reason, as the codec is fed it. */
  const deadRow = ({ reason }: { reason: string }): Record<string, unknown> => ({
    attempt: 1,
    holder: "recipe run-due",
    holderPid: null,
    holderToken: "tok-1",
    leaseExpiresIso: LEASE,
    outcome: { detail: "x", kind: "dead", reason, settledAtIso: SLOT },
    recipeId: RECIPE,
    runStartedAtIso: null,
    schemaVersion: 1,
    slotIso: SLOT,
    startedAtIso: SLOT,
  });

  it("decodes KILLED_BY_SIGNAL exactly", () => {
    expect(attemptOf({ value: deadRow({ reason: "KILLED_BY_SIGNAL" }) })!.outcome).toEqual({
      detail: "x",
      kind: "dead",
      reason: "KILLED_BY_SIGNAL",
      settledAtIso: SLOT,
    });
  });

  it("still refuses a reason this build does not write", () => {
    expect(attemptOf({ value: deadRow({ reason: "SOMETHING_ELSE" }) })).toBe(undefined);
  });
});
