/**
 * The card-deferral ledger on disk: a press round-trips, a home that never deferred reads empty, and a line that
 * does not parse is counted rather than dropped.
 */
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { CardDeferralErrors } from "../../../queueDefer/cardDeferralErrors.js";
import { appendCardDeferral, cardDeferralsPath, readCardDeferrals } from "../../../queueDefer/cardDeferralStore.js";

const DEFER = {
  action: "defer",
  bySession: "work-console",
  cardKey: "ask:policy-approvals",
  pressedIso: "2026-10-05T11:58:00.000Z",
} as const;

describe("the card-deferral ledger", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "card-defer-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a home that never deferred a card as an empty ledger", () => {
    expect(unwrap(readCardDeferrals({ home }))).toEqual({
      path: join(home, "queue", "card-deferrals.jsonl"),
      rows: [],
      unreadable: [],
    });
  });

  it("round-trips a press into a 0600 file and reads it back", () => {
    const restore = { ...DEFER, action: "restore", pressedIso: "2026-10-05T12:00:00.000Z" } as const;
    const path = unwrap(appendCardDeferral({ home, row: DEFER }));
    unwrap(appendCardDeferral({ home, row: restore }));
    expect([path, statSync(path).mode & 0o777, unwrap(readCardDeferrals({ home })).rows]).toEqual([
      cardDeferralsPath({ home }),
      0o600,
      [DEFER, restore],
    ]);
  });

  it("counts a line that does not parse by its line number, and keeps the rows around it", () => {
    unwrap(appendCardDeferral({ home, row: DEFER }));
    appendFileSync(cardDeferralsPath({ home }), '{"cardKey":"act:x","action":"defer"}\nnot json\n');
    unwrap(appendCardDeferral({ home, row: { ...DEFER, cardKey: "pr:1881" } }));
    const read = unwrap(readCardDeferrals({ home }));
    expect([read.rows.map((row) => row.cardKey), read.unreadable]).toEqual([
      ["ask:policy-approvals", "pr:1881"],
      [2, 3],
    ]);
  });

  it("refuses to append a row its own reader would refuse", () => {
    const refused = unwrapErr(appendCardDeferral({ home, row: { ...DEFER, cardKey: "act:x" } }));
    expect([refused.code, refused.message]).toEqual([
      "LEDGER_IO",
      `the card-deferral ledger at ${cardDeferralsPath({ home })} could not be used — the row does not read back: {"action":"defer","bySession":"work-console","cardKey":"act:x","pressedIso":"2026-10-05T11:58:00.000Z"}`,
    ]);
  });
});

describe("CardDeferralErrors.notDeferrable", () => {
  it("names the card and the kinds the Queue draws", () => {
    expect(CardDeferralErrors.notDeferrable({ id: "x", kind: "act" }).message).toBe(
      "act:x is not a card the owner's Queue draws — expected --kind <hand|ask|draft|post|review|import|pr> and an id of letters, digits, '.', '_' or '-'",
    );
  });
});
