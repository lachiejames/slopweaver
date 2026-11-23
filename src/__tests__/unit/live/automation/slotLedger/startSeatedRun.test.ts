/**
 * Starting a seated run: admission once per take, the run-start and pid stamps it writes, and the stale,
 * missing or expired holds it refuses.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { beginSlotAttempt, readSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { startSeatedRun } from "../../../../../live/automation/slotSeatedRun.js";
import { LEASE, RECIPE, SEATED_PID, SLOT, takeSlot } from "./harness.js";

let home: string;

const take = ({ holderToken, nowIso }: { holderToken: string; nowIso: string }) =>
  takeSlot({ holderToken, home, nowIso });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("startSeatedRun", () => {
  it("admits the seated session once and REFUSES a second invocation of the same command", () => {
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    const first = unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const second = unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-16T12:02:01.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(first.kind).toBe("taken");
    expect(second.kind).toBe("refused");
  });

  it("stamps when the run began, which is what makes admission a compare-and-set", () => {
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.runStartedAtIso).toBe(
      "2026-09-16T12:02:00.000Z",
    );
  });

  it("stamps the running process's pid over the seat's PID-less take", () => {
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderPid).toBe(null);
    unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderPid).toBe(SEATED_PID);
  });

  it("lets the next take read a seated run whose process is gone as abandoned, not HELD to its lease", () => {
    // MEASURED: a seated resync-corpus-slack run died of a heap-OOM abort mid-morning with a
    // PID-less attempt, and every take read it HELD until its lease ran out.
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const nextTake = ({ alive }: { alive: boolean }) =>
      unwrap(
        beginSlotAttempt({
          holder: "next-seat",
          holderPid: null,
          holderToken: "next-tok",
          home,
          leaseExpiresIso: LEASE,
          nowIso: "2026-09-16T12:30:00.000Z",
          processAlive: ({ pid }) => pid !== SEATED_PID || alive,
          recipeId: RECIPE,
          slotIso: SLOT,
        }),
      );
    expect(nextTake({ alive: true })).toMatchObject({ kind: "refused", verdict: { kind: "held" } });
    expect(nextTake({ alive: false })).toMatchObject({
      kind: "refused",
      verdict: { abandonment: { holderPid: SEATED_PID, kind: "holder-gone" }, kind: "abandoned" },
    });
  });

  it("refuses a token that is not the seat's, so a stale board row cannot start a run", () => {
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    const started = startSeatedRun({
      holderPid: SEATED_PID,
      holderToken: "some-other-token",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(started.isErr()).toBe(true);
    expect(started._unsafeUnwrapErr().code).toBe("SLOT_TOKEN_MISMATCH");
  });

  it("refuses a firing nothing holds at all", () => {
    const started = startSeatedRun({
      holderPid: SEATED_PID,
      holderToken: "seat-tok",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(started.isErr()).toBe(true);
    expect(started._unsafeUnwrapErr().code).toBe("SLOT_NOT_HELD");
  });

  it("refuses a firing whose lease has expired, rather than running for a schedule that moved on", () => {
    unwrap(take({ holderToken: "seat-tok", nowIso: "2026-09-16T12:01:00.000Z" }));
    const started = unwrap(
      startSeatedRun({
        holderPid: SEATED_PID,
        holderToken: "seat-tok",
        home,
        nowIso: "2026-09-18T00:00:00.000Z",
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(started.kind).toBe("refused");
  });
});
