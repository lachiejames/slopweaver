/**
 * The hold journal's pure decisions: building a row from a hold, serialising it, decoding a line back, and
 * rendering what `github hold --history` prints.
 */
import { describe, expect, it } from "vitest";
import {
  HOLD_LEDGER_SCHEMA_VERSION,
  type HoldLedgerRow,
  holdLedgerLine,
  holdLedgerRenderedLines,
  holdLedgerRow,
  parseHoldLedgerRow,
} from "../../../../outbound/github/holdLedger.js";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../outbound/github/mergeHold.js";

const PLACED = "2026-08-28T01:00:00.000Z";
const RELEASED = "2026-08-28T02:00:00.000Z";

/** One standing hold; a case overrides only the field it is about. */
function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: PLACED,
    holder: "a-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell",
    ...over,
  };
}

describe("holdLedgerRow", () => {
  it("carries the pull request, the session and the instant a `held` row is about", () => {
    const row = holdLedgerRow({ hold: hold(), kind: "held", nowIso: PLACED });

    expect(row).toEqual({
      atIso: PLACED,
      heldAtIso: PLACED,
      heldMinutes: 0,
      holder: "a-session",
      kind: "held",
      pr: 32,
      repo: "owner/name",
      schemaVersion: HOLD_LEDGER_SCHEMA_VERSION,
      sha: undefined,
      staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
      why: "rebase hell",
    });
  });

  it("computes the duration on a `released` row, so a reader never has to subtract two instants", () => {
    const row = holdLedgerRow({ hold: hold(), kind: "released", nowIso: RELEASED, sha: "abc1234" });

    expect(row.heldMinutes).toBe(60);
    expect(row.heldAtIso).toBe(PLACED);
    expect(row.sha).toBe("abc1234");
  });

  it("keeps the holder's own threshold on a `stale` row, so it is judged against the bound it was placed with", () => {
    const row = holdLedgerRow({ hold: hold({ staleMinutes: 5 }), kind: "stale", nowIso: RELEASED });

    expect(row.staleMinutes).toBe(5);
    expect(row.heldMinutes).toBe(60);
  });
});

describe("holdLedgerLine + parseHoldLedgerRow", () => {
  it("round-trips a released row through the exact bytes that reach disk", () => {
    const row = holdLedgerRow({ hold: hold(), kind: "released", nowIso: RELEASED, sha: "abc1234" });

    expect(parseHoldLedgerRow({ line: holdLedgerLine({ row }) })).toEqual(row);
  });

  it("round-trips a held row whose `sha` is absent from the serialised line entirely", () => {
    const row = holdLedgerRow({ hold: hold(), kind: "held", nowIso: PLACED });

    expect(holdLedgerLine({ row })).not.toContain("sha");
    expect(parseHoldLedgerRow({ line: holdLedgerLine({ row }) })).toEqual(row);
  });

  it("drops a blank line", () => {
    expect(parseHoldLedgerRow({ line: "   " })).toBe(undefined);
  });

  it("drops a half-written line rather than throwing at the reader", () => {
    expect(parseHoldLedgerRow({ line: '{"kind":"held","repo":"owner/na' })).toBe(undefined);
  });

  it("drops a row whose kind is not one of the three transitions", () => {
    const line = '{"kind":"expired","repo":"owner/name","pr":32,"holder":"a","atIso":"2026-08-28T01:00:00.000Z"}';

    expect(parseHoldLedgerRow({ line })).toBe(undefined);
  });

  it("drops a row with no usable pull request number", () => {
    const line = '{"kind":"held","repo":"owner/name","pr":0,"holder":"a","atIso":"2026-08-28T01:00:00.000Z"}';

    expect(parseHoldLedgerRow({ line })).toBe(undefined);
  });

  it("drops a row whose instant will not parse", () => {
    const line = '{"kind":"held","repo":"owner/name","pr":32,"holder":"a","atIso":"whenever"}';

    expect(parseHoldLedgerRow({ line })).toBe(undefined);
  });

  it("defaults the fields a first-version row may lack rather than dropping the whole row", () => {
    const line = '{"kind":"held","repo":"owner/name","pr":32,"holder":"a","atIso":"2026-08-28T01:00:00.000Z"}';

    expect(parseHoldLedgerRow({ line })).toEqual({
      atIso: "2026-08-28T01:00:00.000Z",
      heldAtIso: "2026-08-28T01:00:00.000Z",
      heldMinutes: 0,
      holder: "a",
      kind: "held",
      pr: 32,
      repo: "owner/name",
      schemaVersion: HOLD_LEDGER_SCHEMA_VERSION,
      sha: undefined,
      staleMinutes: 0,
      why: "",
    });
  });
});

describe("holdLedgerRenderedLines", () => {
  it("says plainly that nothing has ever held the queue in this home", () => {
    expect(holdLedgerRenderedLines({ rows: [] })).toEqual([
      "no hold has been journalled in this home: nothing has held the merge queue through the door.",
    ]);
  });

  it("renders one line per row, with the duration a released hold would otherwise have taken with it", () => {
    const rows: readonly HoldLedgerRow[] = [
      holdLedgerRow({ hold: hold(), kind: "held", nowIso: PLACED }),
      holdLedgerRow({ hold: hold(), kind: "released", nowIso: RELEASED, sha: "abc1234" }),
    ];

    expect(holdLedgerRenderedLines({ rows })).toEqual([
      `${PLACED}\theld\towner/name#32\t0m\tby a-session\trebase hell`,
      `${RELEASED}\treleased\towner/name#32\t60m\tby a-session\trebase hell\tlanded abc1234`,
    ]);
  });

  it("omits the landed column on a release that recorded no commit", () => {
    const rows = [holdLedgerRow({ hold: hold(), kind: "released", nowIso: RELEASED })];

    expect(holdLedgerRenderedLines({ rows })).toEqual([
      `${RELEASED}\treleased\towner/name#32\t60m\tby a-session\trebase hell`,
    ]);
  });
});
