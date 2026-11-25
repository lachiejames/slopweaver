/**
 * `recordConfirmsLiveReplacement`: the comparisons that let a changed whole-form write skip the replacement key, and
 * every drift that keeps it demanded — a stale record at a locus the pull request has come back to included.
 */
import { describe, expect, it } from "vitest";

import { recordConfirmsLiveReplacement } from "../../../../../cli/commands/github/replacementDrift.js";
import { unwrap } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { bodyHash, type PrRecord } from "../../../../../outbound/github/prLedger.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";

/** The form this door last wrote to the example pull request. */
const FORM = unwrap(
  stampForWrite({
    draft: { ...EXAMPLE_PR_FORM, target: { base: "main", head: "feature", owner: "o", repo: "r" } },
    // The example form's own problem-seen day: the write door refuses a problem seen after today.
    today: "2026-09-28",
  }),
);

/** The description GitHub stored from that write. */
const BODY = "the description this door wrote\nsecond line";

/** The live pull request's own locus. */
const LOCUS = "o/r#main...feature";

/** The same pull request's locus while it was based on `develop`. */
const DEVELOP = "o/r#develop...feature";

/** The confirmed record that write left under the pull request's locus. */
const RECORD: PrRecord = {
  bodyHash: bodyHash({ body: BODY }),
  confirmedIso: "2026-08-15T00:00:00.000Z",
  form: FORM,
  locus: LOCUS,
  nodeId: "PR_42",
  number: 42,
  reservedIso: "2026-08-15T00:00:00.000Z",
};

/** {@link RECORD} as a reservation that carries every other field but was never confirmed. */
const UNCONFIRMED: PrRecord = {
  bodyHash: RECORD.bodyHash,
  form: FORM,
  locus: LOCUS,
  nodeId: "PR_42",
  number: 42,
  reservedIso: RECORD.reservedIso,
};

/** The pull request as read before the door, untouched since that write. */
const LIVE: { body: string | undefined; nodeId: string; number: number; title: string } = {
  body: BODY,
  nodeId: "PR_42",
  number: 42,
  title: FORM.title,
};

/** Judge the live pull request against `records`, under its own locus. */
function confirms({ live = LIVE, records }: { live?: typeof LIVE; records: readonly PrRecord[] }): boolean {
  return recordConfirmsLiveReplacement({ live, locus: LOCUS, records, unreadable: 0 });
}

describe("recordConfirmsLiveReplacement", () => {
  it("confirms a pull request whose node id, number, title and body are exactly this door's last write", () => {
    expect(confirms({ records: [RECORD] })).toBe(true);
  });

  it("refuses body drift: the description was edited on GitHub since the write", () => {
    expect(confirms({ live: { ...LIVE, body: `${BODY} edited` }, records: [RECORD] })).toBe(false);
  });

  it("refuses title drift: the title was edited on GitHub since the write", () => {
    expect(confirms({ live: { ...LIVE, title: "A title someone retyped" }, records: [RECORD] })).toBe(false);
  });

  it("refuses with no ledger record", () => {
    expect(confirms({ records: [] })).toBe(false);
  });

  it("refuses a matching record kept only under another locus", () => {
    expect(confirms({ records: [{ ...RECORD, locus: DEVELOP }] })).toBe(false);
  });

  it("refuses a record for another pull request number", () => {
    expect(confirms({ records: [{ ...RECORD, number: 41 }] })).toBe(false);
  });

  it("refuses a record for another pull request's node id", () => {
    expect(confirms({ records: [{ ...RECORD, nodeId: "PR_OTHER" }] })).toBe(false);
  });

  it("refuses a trailing bot block: the recorded body with a block appended after it", () => {
    const appended = `${BODY}\n\n<!-- a bot's summary -->\nSummary by a review bot`;
    expect(confirms({ live: { ...LIVE, body: appended }, records: [RECORD] })).toBe(false);
  });

  it("refuses a record matching node id, number, digest and title that was never confirmed", () => {
    expect(confirms({ records: [UNCONFIRMED] })).toBe(false);
  });

  it("refuses a record whose stored form no longer decodes, even with its number and digest intact", () => {
    const formless: PrRecord = {
      bodyHash: RECORD.bodyHash,
      confirmedIso: RECORD.confirmedIso,
      locus: LOCUS,
      nodeId: "PR_42",
      number: 42,
      reservedIso: RECORD.reservedIso,
    };
    expect(confirms({ records: [formless] })).toBe(false);
  });

  it("never matches an absent body against an empty one, in either direction", () => {
    const emptyRecord: PrRecord = { ...RECORD, bodyHash: bodyHash({ body: "" }) };
    const absentRecord: PrRecord = { ...RECORD, bodyHash: bodyHash({ body: undefined }) };
    expect([
      confirms({ live: { ...LIVE, body: undefined }, records: [emptyRecord] }),
      confirms({ live: { ...LIVE, body: "" }, records: [absentRecord] }),
    ]).toStrictEqual([false, false]);
  });

  it("reads a body GitHub re-saved with CRLF line endings as the same body", () => {
    expect(confirms({ live: { ...LIVE, body: BODY.replaceAll("\n", "\r\n") }, records: [RECORD] })).toBe(true);
  });
});

describe("recordConfirmsLiveReplacement — only this pull request's latest confirmed write counts", () => {
  it("refuses a stale record at a base the pull request came back to, once a later write sits under another locus", () => {
    const later: PrRecord = { ...RECORD, confirmedIso: "2026-08-16T00:00:00.000Z", locus: DEVELOP };
    expect(confirms({ records: [RECORD, later] })).toBe(false);
  });

  it("refuses when another locus holds a write of this pull request confirmed at the same instant", () => {
    expect(confirms({ records: [RECORD, { ...RECORD, locus: DEVELOP }] })).toBe(false);
  });

  it("confirms the latest write when an older one of the same pull request sits under another locus", () => {
    const earlier: PrRecord = { ...RECORD, confirmedIso: "2026-08-14T00:00:00.000Z", locus: DEVELOP };
    expect(confirms({ records: [earlier, RECORD] })).toBe(true);
  });

  it("is not outranked by a later write of the same number whose node id differs", () => {
    const other: PrRecord = { ...RECORD, confirmedIso: "2026-08-16T00:00:00.000Z", locus: DEVELOP, nodeId: "PR_7" };
    expect(confirms({ records: [RECORD, other] })).toBe(true);
  });

  it("is not outranked by an unconfirmed record of the same node id under another locus", () => {
    const later: PrRecord = { ...UNCONFIRMED, locus: DEVELOP, reservedIso: "2026-08-16T00:00:00.000Z" };
    expect(confirms({ records: [RECORD, later] })).toBe(true);
  });
});

describe("recordConfirmsLiveReplacement — confirmation instants are compared as instants, never as strings", () => {
  it("refuses when another locus holds the same instant spelled with a fraction the judged record lacks", () => {
    const judged: PrRecord = { ...RECORD, confirmedIso: "2026-08-15T00:00:00Z" };
    const sameInstant: PrRecord = { ...RECORD, confirmedIso: "2026-08-15T00:00:00.000Z", locus: DEVELOP };
    expect(confirms({ records: [judged, sameInstant] })).toBe(false);
  });

  it("confirms over an earlier write elsewhere whose offset spelling sorts after the judged instant as text", () => {
    const earlier: PrRecord = { ...RECORD, confirmedIso: "2026-08-15T09:00:00+10:00", locus: DEVELOP };
    const judged: PrRecord = { ...RECORD, confirmedIso: "2026-08-15T00:00:00Z" };
    expect(confirms({ records: [judged, earlier] })).toBe(true);
  });

  it("refuses when another locus holds a write of this pull request whose instant does not parse", () => {
    expect(confirms({ records: [RECORD, { ...RECORD, confirmedIso: "not an instant", locus: DEVELOP }] })).toBe(false);
  });

  it("refuses a judged record whose own instant does not parse, with nothing else in the ledger", () => {
    expect(confirms({ records: [{ ...RECORD, confirmedIso: "not an instant" }] })).toBe(false);
  });
});
