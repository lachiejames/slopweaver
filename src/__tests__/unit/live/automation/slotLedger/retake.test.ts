/**
 * Retaking a firing: an abandoned attempt handed on as the next one, and a holder whose process is gone read
 * through the retake's own liveness probe rather than any earlier reading.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { beginSlotAttempt, readSlotAttempt, retakeAbandonedSlot } from "../../../../../live/automation/slotLedger.js";
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

describe("retakeAbandonedSlot", () => {
  it("takes an abandoned firing as the next attempt, so it cannot be retaken without limit", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const retaken = unwrap(
      retakeAbandonedSlot({
        holder: "recipe run-due",
        holderPid: null,
        holderToken: "tok-2",
        home,
        leaseExpiresIso: "2026-09-19T12:00:00.000Z",
        nowIso: "2026-09-18T00:00:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(retaken.kind).toBe("taken");
    expect(retaken.kind === "taken" ? retaken.attempt.attempt : 0).toBe(2);
  });

  it("refuses a firing that is not abandoned at all", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const retaken = unwrap(
      retakeAbandonedSlot({
        holder: "recipe run-due",
        holderPid: null,
        holderToken: "tok-2",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-16T12:02:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(retaken.kind).toBe("refused");
  });
});

describe("a holder process that is gone", () => {
  /** Take the firing as an in-process run-due whose pid is 4242. */
  const takeAsPid = (): void => {
    unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 4242,
        holderToken: "tok-1",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-16T12:01:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
  };

  /** A second dispatcher's retake inside the lease, probing through `processAlive`. */
  const retakeInsideLease = ({ alive, probed }: { alive: boolean; probed: number[] }) =>
    unwrap(
      retakeAbandonedSlot({
        holder: "recipe run-due",
        holderPid: 5151,
        holderToken: "tok-2",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-16T12:05:00.000Z",
        processAlive: ({ pid }) => {
          probed.push(pid);
          return alive;
        },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );

  it("persists the pid it was taken under", () => {
    takeAsPid();
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.holderPid).toBe(4242);
  });

  it("refuses a second take as ABANDONED inside the lease, naming the gone pid, when the probe says dead", () => {
    takeAsPid();
    const probed: number[] = [];
    const second = unwrap(
      beginSlotAttempt({
        holder: "recipe run-due",
        holderPid: 5151,
        holderToken: "tok-2",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-16T12:05:00.000Z",
        processAlive: ({ pid }) => {
          probed.push(pid);
          return false;
        },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(probed).toEqual([4242]);
    expect(second).toEqual({
      kind: "refused",
      verdict: {
        abandonment: { holderPid: 4242, kind: "holder-gone" },
        attempt: 1,
        holder: "recipe run-due",
        holderToken: "tok-1",
        kind: "abandoned",
        ran: true,
      },
    });
  });

  it("retakes it as the next attempt under the new pid when the retake's OWN probe says dead", () => {
    takeAsPid();
    const probed: number[] = [];
    const retaken = retakeInsideLease({ alive: false, probed });
    expect(probed).toEqual([4242]);
    expect(retaken.kind).toBe("taken");
    const stored = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!;
    expect(stored.attempt).toBe(2);
    expect(stored.holderPid).toBe(5151);
  });

  it("refuses the retake as HELD when its own probe now reads the holder alive — no reading is carried over", () => {
    takeAsPid();
    const probed: number[] = [];
    const retaken = retakeInsideLease({ alive: true, probed });
    expect(probed).toEqual([4242]);
    expect(retaken).toEqual({
      kind: "refused",
      verdict: { attempt: 1, holder: "recipe run-due", kind: "held", leaseExpiresIso: LEASE },
    });
  });

  it("never probes a PID-less holder, which stays held for its lease", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const probed: number[] = [];
    const retaken = retakeInsideLease({ alive: false, probed });
    expect(probed).toEqual([]);
    expect(retaken.kind).toBe("refused");
  });
});
