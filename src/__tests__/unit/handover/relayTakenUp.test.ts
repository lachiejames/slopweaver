/**
 * What the chair's own registers say became of a voice relay row.
 *
 * The property under test is that this is a READER, never a judge: a relay settles only on a cut row, its landing on
 * an ask whose row shows action, or an intake mark; a relay with none is left alone, and the settlements a later
 * settle depends on — `filed` into a row cut from the relay, or into the ask the owner's words landed on — win over a mark.
 */
import { describe, expect, it } from "vitest";

import {
  type RelayBoardRow,
  type RelayLandingEvidence,
  type RelayWorkEvidence,
  relayAnchorOfRow,
  relayTakenUpOf,
  wordsReachedWork,
} from "../../../handover/relayTakenUp.js";
import type { IntakeMark } from "../../../supervisor/intake.js";

const TURN = "a0000063-0000-4000-8000-000000000070";
const ANCHOR = `talk:${TURN}`;
const RELAY: RelayBoardRow = { anchor: ANCHOR, settled: false, slug: "talk-a00000630000" };
const ASK = "acme-home-storage-ask";

/** A relay whose turn names no card: every mark answers it, exactly as before the card check. */
const NO_CARD = (): RelayWorkEvidence => ({
  cardKey: undefined,
  kind: "read",
  rulingOnCard: false,
  seatDispatched: false,
});

/** A relay with no standing landing on an ask: the mark rules decide, exactly as before the landing source. */
const INACTIVE = (): RelayLandingEvidence => ({ kind: "inactive" });

/** A relay spoken over the 17564 card, the owner's words reaching work only where a field says so. */
function overCard({
  rulingOnCard = false,
  seatDispatched = false,
}: {
  rulingOnCard?: boolean;
  seatDispatched?: boolean;
}): () => RelayWorkEvidence {
  return () => ({
    cardKey: "ask:owner-steer-console-call-5a50c50e-01-56z-01",
    kind: "read",
    rulingOnCard,
    seatDispatched,
  });
}

/** One intake mark on the relay's pointer unless another is named. */
function mark(over: Partial<IntakeMark> & Pick<IntakeMark, "kind" | "witness">): IntakeMark {
  return { byClaudeSessionId: "chair", markedAtIso: "2026-10-04T10:30:00.000Z", pointer: ANCHOR, ...over };
}

/** A reader that fails the test if the decision reaches it. */
function never<T>({ what }: { what: string }): () => T {
  return () => {
    throw new Error(`the decision read ${what}`);
  };
}

describe("relayAnchorOfRow", () => {
  it("names the anchor of a relay's own row", () => {
    expect(relayAnchorOfRow({ row: RELAY })).toBe(ANCHOR);
  });

  it("refuses a row carrying the anchor under another slug — a row cut from the relay is not the relay", () => {
    expect(relayAnchorOfRow({ row: { ...RELAY, slug: "the-cut-row" } })).toBeUndefined();
  });

  it("refuses a row with no anchor, and one whose anchor is not a talk turn", () => {
    expect(relayAnchorOfRow({ row: { ...RELAY, anchor: undefined } })).toBeUndefined();
    expect(relayAnchorOfRow({ row: { ...RELAY, anchor: "call:abc" } })).toBeUndefined();
  });
});

describe("relayTakenUpOf", () => {
  it("files the relay into a row cut from it", () => {
    const rows = [RELAY, { anchor: ANCHOR, settled: false, slug: "the-cut-row" }];

    expect(relayTakenUpOf({ landing: INACTIVE, marks: [], relay: RELAY, rows, work: NO_CARD })).toEqual({
      because: `row the-cut-row was cut from this relay (same ${ANCHOR})`,
      settlement: "filed",
      witness: "the-cut-row",
    });
  });

  it("prefers the cut row over a mark that would answer the relay", () => {
    const rows = [RELAY, { anchor: ANCHOR, settled: true, slug: "the-cut-row" }];
    const marks = [mark({ kind: "answered", witness: "answered in chat" })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows, work: NO_CARD })!.settlement).toBe("filed");
  });

  it("files into the row a card mark names", () => {
    const rows = [RELAY, { anchor: undefined, settled: false, slug: "the-card-row" }];
    const marks = [mark({ kind: "card", witness: "the-card-row" })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows, work: NO_CARD })).toEqual({
      because: `the chair marked ${ANCHOR} card at 2026-10-04T10:30:00.000Z`,
      settlement: "filed",
      witness: "the-card-row",
    });
  });

  it("files into the row an earlier card mark names, never answering on later free text", () => {
    const rows = [RELAY, { anchor: undefined, settled: false, slug: "the-card-row" }];
    const marks = [
      mark({ kind: "card", witness: "the-card-row" }),
      mark({ kind: "answered", markedAtIso: "2026-10-04T10:31:00.000Z", witness: "handled at the tick" }),
    ];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows, work: NO_CARD })).toEqual({
      because: `the chair marked ${ANCHOR} card at 2026-10-04T10:30:00.000Z`,
      settlement: "filed",
      witness: "the-card-row",
    });
  });

  it("answers on a card mark whose witness is a question rather than a row on the board", () => {
    const marks = [mark({ kind: "card", witness: "Merge #403 tonight?" })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })!.witness).toBe(
      "intake-mark card 2026-10-04T10:30:00.000Z: Merge #403 tonight?",
    );
  });

  it("answers on a no-ask mark, folding its witness onto one line a settle accepts", () => {
    const marks = [mark({ kind: "no-ask", witness: "small talk\nwith the voice" })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })).toEqual({
      because: `the chair marked ${ANCHOR} no-ask at 2026-10-04T10:30:00.000Z`,
      settlement: "answered",
      witness: "intake-mark no-ask 2026-10-04T10:30:00.000Z: small talk with the voice",
    });
  });

  it("reads the LATEST mark on the pointer", () => {
    const marks = [
      mark({ kind: "answered", markedAtIso: "2026-10-04T11:00:00.000Z", witness: "the later one" }),
      mark({ kind: "no-ask", markedAtIso: "2026-10-04T10:00:00.000Z", witness: "the earlier one" }),
    ];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })!.witness).toBe(
      "intake-mark answered 2026-10-04T11:00:00.000Z: the later one",
    );
  });

  it("never files a relay into itself", () => {
    const marks = [mark({ kind: "card", witness: RELAY.slug })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })!.settlement).toBe(
      "answered",
    );
  });

  it("decides nothing for a relay with neither a cut row nor a mark — the owner's words are not closed on no evidence", () => {
    const marks = [mark({ kind: "answered", pointer: "talk:00000000-0000-4000-8000-000000000000", witness: "other" })];

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })).toBeUndefined();
  });

  it("decides nothing for a relay already settled, or a row that is not a relay's own", () => {
    const marks = [mark({ kind: "answered", witness: "done" })];
    const landing = never<RelayLandingEvidence>({ what: "the landing of a row it had already ruled out" });

    expect(
      relayTakenUpOf({ landing, marks, relay: { ...RELAY, settled: true }, rows: [RELAY], work: NO_CARD }),
    ).toBeUndefined();
    expect(
      relayTakenUpOf({ landing, marks, relay: { ...RELAY, slug: "the-cut-row" }, rows: [RELAY], work: NO_CARD }),
    ).toBeUndefined();
  });
});

// Seven relay rows over ask cards stayed ready after their asks' runs had taken the work up.
describe("relayTakenUpOf on a relay whose words landed on an ask", () => {
  const started = (): RelayLandingEvidence => ({
    action: { atIso: "2026-11-02T09:00:00.000Z", eventKind: "started", kind: "run-event" },
    kind: "active",
    workSlug: ASK,
  });

  it("files the relay into the ask once the ask's run journalled work since the relay registered", () => {
    expect(relayTakenUpOf({ landing: started, marks: [], relay: RELAY, rows: [RELAY], work: NO_CARD })).toEqual({
      because: `the owner's words landed on ask:${ASK}, whose row journalled started at 2026-11-02T09:00:00.000Z`,
      settlement: "filed",
      witness: ASK,
    });
  });

  it("files the relay into the ask once the ask was settled since the relay registered", () => {
    const landing = (): RelayLandingEvidence => ({ action: { kind: "settlement" }, kind: "active", workSlug: ASK });

    expect(relayTakenUpOf({ landing, marks: [], relay: RELAY, rows: [RELAY], work: NO_CARD })).toEqual({
      because: `the owner's words landed on ask:${ASK}, whose row was settled since the relay registered`,
      settlement: "filed",
      witness: ASK,
    });
  });

  it("decides nothing while the ask's row shows no action yet", () => {
    const landing = (): RelayLandingEvidence => ({ action: undefined, kind: "active", workSlug: ASK });

    expect(relayTakenUpOf({ landing, marks: [], relay: RELAY, rows: [RELAY], work: NO_CARD })).toBeUndefined();
  });

  it("never files the relay into its own row, though a landing names it", () => {
    const landing = (): RelayLandingEvidence => ({
      action: { kind: "settlement" },
      kind: "active",
      workSlug: RELAY.slug,
    });

    expect(relayTakenUpOf({ landing, marks: [], relay: RELAY, rows: [RELAY], work: NO_CARD })).toBeUndefined();
  });

  it("files into a cut row first, reading neither the landing nor the work evidence", () => {
    const rows = [RELAY, { anchor: ANCHOR, settled: false, slug: "the-cut-row" }];
    const decided = relayTakenUpOf({
      landing: never<RelayLandingEvidence>({ what: "the landing" }),
      marks: [],
      relay: RELAY,
      rows,
      work: never<RelayWorkEvidence>({ what: "the work evidence" }),
    });

    expect(decided!.witness).toBe("the-cut-row");
  });

  it("files into the ask over a mark that would answer the relay", () => {
    const marks = [mark({ kind: "answered", witness: "answered in chat" })];

    expect(relayTakenUpOf({ landing: started, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })!.witness).toBe(ASK);
  });

  it("lets no mark answer the relay when its landing would not read", () => {
    const marks = [mark({ kind: "answered", witness: "answered in chat" })];
    const landing = (): RelayLandingEvidence => ({ kind: "unreadable", why: "the ledger would not read" });

    expect(relayTakenUpOf({ landing, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })).toBeUndefined();
  });

  it("falls through to the mark when the ask's row shows no action yet", () => {
    const marks = [mark({ kind: "no-ask", witness: "a nod" })];
    const landing = (): RelayLandingEvidence => ({ action: undefined, kind: "active", workSlug: ASK });

    expect(relayTakenUpOf({ landing, marks, relay: RELAY, rows: [RELAY], work: NO_CARD })!.settlement).toBe("answered");
  });
});

// A free-text card mark answered a relay spoken over a card, though the owner's words had reached nothing.
describe("relayTakenUpOf on a relay spoken over a card", () => {
  const marks = [mark({ kind: "card", witness: "the owning seat reworks the pull request on that relay" })];

  it("decides nothing when the owner's words reached neither the card's journal nor a dispatched seat", () => {
    expect(
      relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work: overCard({}) }),
    ).toBeUndefined();
  });

  it("answers once the owner's words are a ruling on the card's own journal", () => {
    const work = overCard({ rulingOnCard: true });

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work })).toEqual({
      because: `the chair marked ${ANCHOR} card at 2026-10-04T10:30:00.000Z`,
      settlement: "answered",
      witness: "intake-mark card 2026-10-04T10:30:00.000Z: the owning seat reworks the pull request on that relay",
    });
  });

  it("answers once a seat was dispatched on the relay row", () => {
    const work = overCard({ seatDispatched: true });

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work })!.settlement).toBe(
      "answered",
    );
  });

  it("decides nothing when the register would not read, rather than reading it as a relay over no card", () => {
    const work = (): RelayWorkEvidence => ({ kind: "unreadable", why: "the relay's turn would not read" });

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows: [RELAY], work })).toBeUndefined();
  });

  it("still files into a row cut from the relay, and never reads the evidence to do it", () => {
    const rows = [RELAY, { anchor: ANCHOR, settled: false, slug: "the-cut-row" }];
    const work = never<RelayWorkEvidence>({ what: "the relay's work evidence on the filed path" });

    expect(relayTakenUpOf({ landing: INACTIVE, marks, relay: RELAY, rows, work })!.witness).toBe("the-cut-row");
  });

  it("still files into the live row a card mark names", () => {
    const rows = [RELAY, { anchor: undefined, settled: false, slug: "the-card-row" }];
    const named = [mark({ kind: "card", witness: "the-card-row" })];

    expect(
      relayTakenUpOf({ landing: INACTIVE, marks: named, relay: RELAY, rows, work: overCard({}) })!.settlement,
    ).toBe("filed");
  });
});

describe("wordsReachedWork", () => {
  it("holds for a relay over no card, and for a card the owner's words reached either way", () => {
    expect([
      wordsReachedWork({ work: NO_CARD() }),
      wordsReachedWork({ work: overCard({ rulingOnCard: true })() }),
      wordsReachedWork({ work: overCard({ seatDispatched: true })() }),
    ]).toEqual([true, true, true]);
  });

  it("fails for a card the owner's words never reached, and for a register that would not read", () => {
    expect([
      wordsReachedWork({ work: overCard({})() }),
      wordsReachedWork({ work: { kind: "unreadable", why: "x" } }),
    ]).toEqual([false, false]);
  });
});
