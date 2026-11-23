/**
 * Scanning the ledger by row rather than by clock: the row's open attempt, and the open attempt one holder
 * token carries when two firings of a row are held at once.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { beginSlotAttempt } from "../../../../../live/automation/slotLedger.js";
import { findAttemptHeldBy, findOpenSlotAttempt } from "../../../../../live/automation/slotLedgerScan.js";
import { settleSlotAttempt } from "../../../../../live/automation/slotSettlement.js";
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

describe("findOpenSlotAttempt", () => {
  it("finds a row's open attempt by ROW, even when the clock has moved to the next firing", () => {
    // The measured bug this exists for: a run claimed for the 12:00 firing, released at 13:00:05, used to
    // derive the 13:00 firing from the clock and release nothing while reporting success.
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    const found = findOpenSlotAttempt({ home, recipeId: RECIPE });
    expect(found!.slotIso).toBe(SLOT);
    expect(found!.holderToken).toBe("tok-1");
  });

  it("answers null for a row whose only attempt is settled", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
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
    expect(findOpenSlotAttempt({ home, recipeId: RECIPE })).toBe(null);
  });

  it("ignores another row's open attempt", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    expect(findOpenSlotAttempt({ home, recipeId: "knock-alerts" })).toBe(null);
  });

  it("answers null when the ledger has never been written", () => {
    expect(findOpenSlotAttempt({ home, recipeId: RECIPE })).toBe(null);
  });

  it("skips a record it cannot parse rather than failing the whole scan", () => {
    unwrap(take({ holderToken: "tok-1", nowIso: "2026-09-16T12:01:00.000Z" }));
    writeFileSync(join(stateHomePaths({ home }).live.recipe.slotAttemptsDir, "zz-corrupt.json"), "{ nope", "utf8");
    expect(findOpenSlotAttempt({ home, recipeId: RECIPE })!.holderToken).toBe("tok-1");
  });
});

describe("findAttemptHeldBy", () => {
  const NEXT_SLOT = "2026-09-16T16:00:00.000Z";

  it("finds the open attempt one token holds when two seats hold two firings of one row", () => {
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      beginSlotAttempt({
        holder: "holder-seat-b",
        holderPid: null,
        holderToken: "seat-b",
        home,
        leaseExpiresIso: LEASE,
        nowIso: "2026-09-16T16:01:00.000Z",
        processAlive: () => true,
        recipeId: RECIPE,
        slotIso: NEXT_SLOT,
      }),
    );
    expect(findAttemptHeldBy({ holderToken: "seat-a", home, recipeId: RECIPE })!.slotIso).toBe(SLOT);
    expect(findAttemptHeldBy({ holderToken: "seat-b", home, recipeId: RECIPE })!.slotIso).toBe(NEXT_SLOT);
  });

  it("answers null for a token no open attempt on the row carries", () => {
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    expect(findAttemptHeldBy({ holderToken: "a-stale-token", home, recipeId: RECIPE })).toBe(null);
  });

  it("answers null once the token's attempt is settled, even though the token still matches", () => {
    unwrap(take({ holderToken: "seat-a", nowIso: "2026-09-16T12:01:00.000Z" }));
    unwrap(
      settleSlotAttempt({
        holderToken: "seat-a",
        home,
        nowIso: "2026-09-16T12:02:00.000Z",
        outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:02:00.000Z" },
        recipeId: RECIPE,
        slotIso: SLOT,
      }),
    );
    expect(findAttemptHeldBy({ holderToken: "seat-a", home, recipeId: RECIPE })).toBe(null);
  });
});
