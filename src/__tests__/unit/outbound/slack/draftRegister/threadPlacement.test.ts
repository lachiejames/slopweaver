/**
 * A thread reply's placement on a parked row, through the log: the digest binds the thread, a malformed one is
 * passed over by name, and a release, a deletion, a drop or a judgement reads back onto the row it names.
 */
import { describe, expect, it } from "vitest";

import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import {
  type DraftHoldReason,
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";
import { draft, GOLDEN_CONTENT, GOLDEN_DIGEST } from "./fixtures.js";

/** The persisted hold reason for a hold that is not the owner's yes, spelled out so a renamed code fails here. */
const NOT_YES = "not-owner-yes" as const;

describe("a thread reply's placement — the field earlier drafts lacked", () => {
  /** One parked line carrying `fields` over a valid top-level row, bypassing the typed encoder. */
  function lineWith({ fields }: { fields: Record<string, unknown> }): string {
    const parked = draft();
    return JSON.stringify({
      draft: { ...parked, ...fields },
      id: parked.id,
      kind: "parked",
      schemaVersion: 1,
      tsIso: parked.tsIso,
    });
  }

  it("leaves a top-level row's digest exactly as it was approved before threads existed", () => {
    expect(parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, threadTs: undefined } })).toBe(GOLDEN_DIGEST);
  });

  it("moves for the thread, so an approval of the top-level bytes cannot release them into a thread, or vice versa", () => {
    const one = parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, threadTs: "1790566514.594969" } });
    const other = parkedDraftDigest({ draft: { ...GOLDEN_CONTENT, threadTs: "1789407961.767649" } });
    expect([one === GOLDEN_DIGEST, other === GOLDEN_DIGEST, one === other]).toEqual([false, false, false]);
  });

  it("round-trips a thread row with the parent the recording read", () => {
    const parked = draft({
      over: {
        shape: "thread",
        threadParent: { text: "staging pool exhausted", userId: "U0JONAH" },
        threadTs: "1789407961.767649",
      },
    });
    const line = slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } });
    const row = foldSlackDrafts({ events: parseSlackDraftLog({ lines: [line] }).events })[0]!;
    expect([row.draft.shape, row.draft.threadTs, row.draft.threadParent]).toEqual([
      "thread",
      "1789407961.767649",
      { text: "staging pool exhausted", userId: "U0JONAH" },
    ]);
  });

  it("passes over a row whose shape and thread disagree, or whose parent is malformed", () => {
    const malformed: readonly Record<string, unknown>[] = [
      { shape: "thread" },
      { shape: "thread", threadTs: "p1789407961767649" },
      { threadTs: "1789407961.767649" },
      { threadParent: { text: "a parent with no thread" } },
      { shape: "thread", threadParent: { userId: "U0JONAH" }, threadTs: "1789407961.767649" },
      { shape: "thread", threadParent: { text: 7 }, threadTs: "1789407961.767649" },
    ];
    expect(malformed.length).toBeGreaterThan(0);
    const skipped = malformed.map((fields) => parseSlackDraftLog({ lines: [lineWith({ fields })] }).skipped);
    expect(skipped).toEqual(malformed.map(() => [{ id: "sd-11111111", kind: "parked", line: 1 }]));
  });

  it("says a release into a thread landed in that thread", () => {
    const parked = draft({ over: { shape: "thread", threadTs: "1789407961.767649" } });
    const { events } = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        slackDraftEventLine({
          event: {
            channel: "C0ISO",
            id: parked.id,
            kind: "released",
            threadTs: "1789407961.767649",
            ts: "1790600000.000100",
            tsIso: "2026-09-28T13:00:00.000Z",
          },
        }),
      ],
    });
    expect(foldSlackDrafts({ events })[0]!.outcome).toBe("C0ISO 1790600000.000100 in thread 1789407961.767649");
  });

  it("reads back a release's journalled permalink, so a spent row names the message it became", () => {
    const parked = draft({ over: {} });
    const permalink = "https://acme.slack.com/archives/C0ISO/p1790600000000100";
    const { events, skipped } = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        slackDraftEventLine({
          event: {
            channel: "C0ISO",
            id: parked.id,
            kind: "released",
            permalink,
            ts: "1790600000.000100",
            tsIso: "2026-09-28T13:00:00.000Z",
          },
        }),
        JSON.stringify({ channel: "C0ISO", id: parked.id, kind: "released", permalink: 7, ts: "1", tsIso: "x" }),
      ],
    });
    expect(skipped.map((line) => line.line)).toEqual([3]);
    expect(foldSlackDrafts({ events })[0]!.outcome).toBe(`C0ISO 1790600000.000100 · ${permalink}`);
  });

  it("reads back the digest a release sent, and passes over one that is not a string", () => {
    const parked = draft({ over: {} });
    const released = { channel: "C0ISO", id: parked.id, kind: "released", ts: "1", tsIso: "2026-09-28T13:00:00.000Z" };
    const { events, skipped } = parseSlackDraftLog({
      lines: [JSON.stringify({ ...released, digest: parked.digest }), JSON.stringify({ ...released, digest: 7 })],
    });
    expect(skipped.map((line) => line.line)).toEqual([2]);
    expect(events).toEqual([{ ...released, digest: parked.digest }]);
  });

  it("keeps a released row released when a drop is journalled after it, since the message already landed", () => {
    const parked = draft({ over: {} });
    const [item] = foldSlackDrafts({
      events: [
        { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso },
        {
          channel: "C0ISO",
          id: parked.id,
          kind: "released",
          ts: "1790600000.000100",
          tsIso: "2026-09-28T13:00:00.000Z",
        },
        { id: parked.id, kind: "dropped", note: "superseded by sd-00000001", tsIso: "2026-09-28T13:00:01.000Z" },
      ],
    });
    expect([item!.state, item!.outcome]).toEqual(["released", "C0ISO 1790600000.000100"]);
  });

  it("reads a deletion line back exactly, passes over one missing its coordinate, and leaves the row released", () => {
    const parked = draft({ over: {} });
    const deleted = {
      channel: "C0ISO",
      id: parked.id,
      kind: "deleted",
      ts: "1790600000.000100",
      tsIso: "2026-09-28T14:00:00.000Z",
    } as const;
    const { events, skipped } = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        slackDraftEventLine({
          event: { channel: "C0ISO", id: parked.id, kind: "released", ts: "1790600000.000100", tsIso: parked.tsIso },
        }),
        slackDraftEventLine({ event: deleted }),
        JSON.stringify({ ...deleted, ts: 7 }),
        JSON.stringify({ ...deleted, tsIso: "not-a-date" }),
      ],
    });
    expect(skipped.map((line) => [line.line, line.kind])).toEqual([
      [4, "deleted"],
      [5, "deleted"],
    ]);
    expect(events[2]).toEqual(deleted);
    const [item] = foldSlackDrafts({ events });
    expect([item!.state, item!.outcome]).toEqual(["released", "C0ISO 1790600000.000100"]);
  });

  it("keeps the yes a hold that is not the owner's yes set down, through every later hold, until an approve", () => {
    const approval = { anchor: "talk-call:f9e9277d#12", atIso: "2026-10-08T00:16:54.000Z", heard: "Send it" };
    const parked = draft({ over: { approval } });
    const hold = ({ reason, tsIso }: { reason: DraftHoldReason; tsIso: string }): SlackDraftEvent => ({
      id: parked.id,
      kind: "held",
      reason,
      tsIso,
      why: `${reason} at ${tsIso}`,
    });
    const base: SlackDraftEvent[] = [
      { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso },
      hold({ reason: NOT_YES, tsIso: "2026-10-08T00:30:00.000Z" }),
      hold({ reason: NOT_YES, tsIso: "2026-10-08T00:40:00.000Z" }),
      hold({ reason: "no-fleet-slot", tsIso: "2026-10-08T00:45:00.000Z" }),
    ];
    const [after] = foldSlackDrafts({ events: base });
    const [approved] = foldSlackDrafts({
      events: [...base, { approval, id: parked.id, kind: "approved", tsIso: "2026-10-08T00:50:00.000Z" }],
    });

    expect([after!.draft.approval, after!.hold?.reason, after!.hold?.setDown]).toEqual([
      undefined,
      "no-fleet-slot",
      { approval, atIso: "2026-10-08T00:30:00.000Z", why: `${NOT_YES} at 2026-10-08T00:30:00.000Z` },
    ]);
    expect([approved!.draft.approval, approved!.hold]).toEqual([approval, undefined]);
  });

  it("reads back how many landing rows a drop judged, and none from a line that carries no count", () => {
    const parked = draft({ over: {} });
    const park = slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } });
    const drop = ({ landingsRead }: { landingsRead: unknown }) =>
      JSON.stringify({ id: parked.id, kind: "dropped", landingsRead, note: "moot", schemaVersion: 1, tsIso: "x" });
    const fold = ({ landingsRead }: { landingsRead: unknown }) =>
      foldSlackDraftLog({ log: parseSlackDraftLog({ lines: [park, drop({ landingsRead })] }) })[0]!.landingsRead;

    expect(fold({ landingsRead: 7 })).toBe(7);
    expect(fold({ landingsRead: -1 })).toBeUndefined();
    expect(fold({ landingsRead: "7" })).toBeUndefined();
  });

  it("reads back how many landing rows an approve or a hold judged onto the row", () => {
    const parked = draft({ over: {} });
    const park = slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } });
    const at = "2026-10-08T00:40:00.000Z";
    const held = ({ landingsRead }: { landingsRead: unknown }) =>
      JSON.stringify({
        id: parked.id,
        kind: "held",
        landingsRead,
        reason: NOT_YES,
        schemaVersion: 1,
        tsIso: at,
        why: "the other one",
      });
    const fold = ({ lines }: { lines: readonly string[] }) =>
      foldSlackDraftLog({ log: parseSlackDraftLog({ lines: [park, ...lines] }) })[0]!.judgedLandings;
    const approval = { anchor: "talk-call:f9e9277d#12", atIso: "2026-10-08T00:16:54.000Z", heard: "Send it" };
    const approved = slackDraftEventLine({
      event: { approval, id: parked.id, kind: "approved", landingsRead: 5, tsIso: at },
    });

    expect(fold({ lines: [held({ landingsRead: 2 })] })).toBe(2);
    expect(fold({ lines: [held({ landingsRead: 2.5 })] })).toBeUndefined();
    expect(fold({ lines: [held({ landingsRead: 2 }), approved] })).toBe(5);
  });
});
