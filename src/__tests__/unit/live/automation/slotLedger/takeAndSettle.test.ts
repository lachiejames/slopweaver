/**
 * Taking a firing and settling it: who gets the firing, what a settled, failed or deferred attempt does to
 * the next take, and what an untouched firing reads as.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readSlotAttempt, slotAttemptKey } from "../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { RECIPE, SLOT, takeSlot } from "./harness.js";

let home: string;

const take = ({ holderToken, nowIso }: { holderToken: string; nowIso: string }) =>
  takeSlot({ holderToken, home, nowIso });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slot-ledger-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("beginSlotAttempt", () => {
  it("hands the firing to the first caller and refuses the second, which is the double-run fix", () => {
    const first = take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" });
    const second = take({ holderToken: "tok-2", nowIso: "2026-09-16T12:01:00.000Z" });
    expect(unwrap(first).kind).toBe("taken");
    const refused = unwrap(second);
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" ? refused.verdict.kind : "").toBe("held");
  });

  it("writes the row under the firing's own key, readable back whole", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const stored = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }));
    expect(stored!.holderToken).toBe("tok-1");
    expect(stored!.attempt).toBe(1);
    expect(stored!.slotIso).toBe(SLOT);
    expect(stored!.outcome).toBe(null);
  });

  it("refuses a firing that already succeeded, so a re-tick never re-runs it", () => {
    const first = unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    expect(first.kind).toBe("taken");
    unwrap(
      settleSlotAttempt({
        holderToken: "tok-1",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:02:00.000Z" },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const again = unwrap(take({ holderToken: "tok-3", nowIso: "2026-09-16T12:03:00.000Z" }));
    expect(again.kind).toBe("refused");
    expect(again.kind === "refused" ? again.verdict.kind : "").toBe("settled");
  });

  it("hands a failed firing back once its floor has passed, as the NEXT attempt", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      settleSlotAttempt({
        holderToken: "tok-1",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        outcome: {
          detail: "exit 1",
          exitCode: 1,
          kind: "failed",
          retryNotBeforeIso: "2026-09-16T12:03:00.000Z",
          settledAtIso: "2026-09-16T12:02:00.000Z",
        },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    const retried = unwrap(take({ holderToken: "tok-2", nowIso: "2026-09-16T12:04:00.000Z" }));
    expect(retried.kind).toBe("taken");
    expect(retried.kind === "taken" ? retried.attempt.attempt : 0).toBe(2);
  });

  it("refuses a firing an ABANDONED attempt holds, leaving the retry judgement to the caller", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const later = unwrap(take({ holderToken: "tok-2", nowIso: "2026-09-18T00:00:00.000Z" }));
    expect(later.kind).toBe("refused");
    expect(later.kind === "refused" ? later.verdict.kind : "").toBe("abandoned");
  });

  it("refuses rather than overwriting a row it cannot read, which would run the firing twice", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const path = join(
      stateHomePaths({ home }).live.recipe.slotAttemptsDir,
      `${slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })}.json`,
    );
    writeFileSync(path, "{ not json", "utf8");
    const again = take({ holderToken: "tok-2", nowIso: "2026-09-18T00:00:00.000Z" });
    expect(again.isErr()).toBe(true);
    expect(again._unsafeUnwrapErr().code).toBe("SLOT_UNREADABLE");
  });
});

describe("settleSlotAttempt", () => {
  it("refuses a token that is not the open attempt's, so a late run cannot close its successor's", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const settled = settleSlotAttempt({
      holderToken: "tok-9",
      home,
      nowIso: "2026-09-16T12:02:00.000Z",
      outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:02:00.000Z" },
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(settled.isErr()).toBe(true);
    expect(settled._unsafeUnwrapErr().code).toBe("SLOT_TOKEN_MISMATCH");
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))!.outcome).toBe(null);
  });
});

describe("readSlotAttempt", () => {
  it("reads a firing nothing has attempted as null, which is every firing's starting state", () => {
    expect(unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }))).toBe(null);
  });
});

describe("a DEFERRED firing", () => {
  it("keeps its row, carrying why it deferred, and is takeable again at the same attempt", () => {
    const taken = unwrap(take({ holderToken: "tok-1", nowIso: SLOT }));
    expect(taken.kind).toBe("taken");

    const settled = settleSlotAttempt({
      holderToken: "tok-1",
      home,
      nowIso: "2026-09-16T12:01:00.000Z",
      outcome: {
        detail: "a top-up generation is still opening this batch",
        kind: "deferred",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
      recipeId: RECIPE,
      slotIso: SLOT,
    });
    expect(settled.isOk()).toBe(true);

    const stored = unwrap(readSlotAttempt({ home, recipeId: RECIPE, slotIso: SLOT }));
    expect(stored!.outcome).toEqual({
      detail: "a top-up generation is still opening this batch",
      kind: "deferred",
      settledAtIso: "2026-09-16T12:01:00.000Z",
    });

    const retaken = unwrap(take({ holderToken: "tok-2", nowIso: "2026-09-16T12:02:00.000Z" }));
    expect(retaken.kind).toBe("taken");
    expect(retaken.kind === "taken" ? retaken.attempt.attempt : -1).toBe(1);
  });

  it("does not spend an attempt however often it defers, so three real failures are still available", () => {
    for (const nth of [1, 2, 3, 4, 5]) {
      const taken = unwrap(take({ holderToken: `tok-${String(nth)}`, nowIso: SLOT }));
      expect(taken.kind === "taken" ? taken.attempt.attempt : -1).toBe(1);
      const settled = settleSlotAttempt({
        holderToken: `tok-${String(nth)}`,
        home,
        nowIso: SLOT,
        outcome: { detail: "still waiting", kind: "deferred", settledAtIso: SLOT },
        recipeId: RECIPE,
        slotIso: SLOT,
      });
      expect(settled.isOk()).toBe(true);
    }
  });
});
