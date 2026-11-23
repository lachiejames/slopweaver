/**
 * The hold journal's durable edge, against a real `mkdtempSync` home — a round-trip, not a mock. The
 * properties that matter are that a home which has never held anything reports an empty journal, that an
 * append never replaces what is already there, and that the bound is honoured from the END of the file.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type HoldLedgerKind, type HoldLedgerRow, holdLedgerRow } from "../../../../outbound/github/holdLedger.js";
import { HOLD_LEDGER_DEFAULT_LIMIT } from "../../../../outbound/github/holdLedgerLimits.js";
import {
  appendHoldLedgerRow,
  holdLedgerPath,
  readHoldLedgerRows,
} from "../../../../outbound/github/holdLedgerStore.js";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../outbound/github/mergeHold.js";
import { stateHomePaths } from "../../../../stateHome.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-hold-ledger-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One standing hold; a case overrides only the field it is about. */
function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: "2026-08-28T01:00:00.000Z",
    holder: "a-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell",
    ...over,
  };
}

/** One row about the shared fixture hold, at a given instant. */
function row({ kind, nowIso, pr }: { kind: HoldLedgerKind; nowIso: string; pr?: number }): HoldLedgerRow {
  return holdLedgerRow({ hold: hold(pr === undefined ? {} : { pr }), kind, nowIso });
}

describe("holdLedgerPath", () => {
  it("is the one spelling the state home declares, never a second guess at it", () => {
    expect(holdLedgerPath({ home })).toBe(stateHomePaths({ home }).live.github.holdLedgerJsonl);
  });
});

describe("readHoldLedgerRows", () => {
  it("reports an empty journal for a home that has never held anything", () => {
    expect(readHoldLedgerRows({ home })).toEqual([]);
  });

  it("reads back exactly what was appended, in file order", () => {
    const held = row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z" });
    const released = row({ kind: "released", nowIso: "2026-08-28T02:00:00.000Z" });

    unwrap(appendHoldLedgerRow({ home, row: held }));
    unwrap(appendHoldLedgerRow({ home, row: released }));

    expect(readHoldLedgerRows({ home })).toEqual([held, released]);
  });

  it("keeps the LAST rows when the journal is longer than the bound", () => {
    for (const pr of [1, 2, 3]) {
      unwrap(appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z", pr }) }));
    }

    expect(readHoldLedgerRows({ home, limit: 2 }).map((entry) => entry.pr)).toEqual([2, 3]);
  });

  it("reads nothing at all for a non-positive bound", () => {
    unwrap(appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z" }) }));

    expect(readHoldLedgerRows({ home, limit: 0 })).toEqual([]);
  });

  it("drops the one line that will not decode and keeps the rest", () => {
    const path = holdLedgerPath({ home });
    unwrap(appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z" }) }));
    appendFileSync(path, '{"kind":"held","repo":\n');
    const released = row({ kind: "released", nowIso: "2026-08-28T02:00:00.000Z" });
    unwrap(appendHoldLedgerRow({ home, row: released }));

    expect(readHoldLedgerRows({ home }).map((entry) => entry.kind)).toEqual(["held", "released"]);
  });

  it("defaults its bound to the journal's own, so a caller that asks for none still gets a bounded read", () => {
    for (let pr = 1; pr <= HOLD_LEDGER_DEFAULT_LIMIT + 3; pr += 1) {
      unwrap(appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z", pr }) }));
    }

    expect(readHoldLedgerRows({ home })).toHaveLength(HOLD_LEDGER_DEFAULT_LIMIT);
  });
});

describe("appendHoldLedgerRow", () => {
  it("creates the directory owner-only, matching the hold document it sits beside", () => {
    unwrap(appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z" }) }));

    expect(statSync(dirname(holdLedgerPath({ home }))).mode & 0o777).toBe(0o700);
  });

  it("reports the failure rather than throwing when the path cannot be written", () => {
    const path = holdLedgerPath({ home });
    mkdirSync(path, { recursive: true });

    const result = appendHoldLedgerRow({ home, row: row({ kind: "held", nowIso: "2026-08-28T01:00:00.000Z" }) });

    expect(unwrapErr(result)).toEqual([
      `could not append to the hold ledger at ${path}: Error: EISDIR: illegal operation on a directory, ` +
        `open '${path}'`,
    ]);
  });
});
