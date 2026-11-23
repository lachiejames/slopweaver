/**
 * `draftSentNote.ts` — only a whole `sent <ref>…` record, every ref in the row's own channel after it was parked,
 * reads as a send. Prose containing a permalink, `not sent …` included, does not. And a
 * well-formed record proves the send only when Slack holds the row's own words there, by its author.
 */
import { describe, expect, it } from "vitest";

import { noteRecordsSend, sentNoteProven, sentRefsOfRow } from "../../../../outbound/slack/draftSentNote.js";
import { draftItem } from "../../supervisor/draftItemFixture.js";

/** Parked at Slack ts 1791418200, in the fixture channel. */
const ROW = draftItem({ id: "sd-11112222", tsIso: "2026-10-08T00:10:00.000Z" });
const LATER = "https://acme.slack.com/archives/C0123456789/p1791418800000100";
const LATER_TOO = "https://acme.slack.com/archives/C0123456789/p1791418900000200?thread_ts=1791418800.000100";

describe("noteRecordsSend", () => {
  it("reads a sent record of one permalink, several, or the release's channel-and-ts pair", () => {
    expect(noteRecordsSend({ note: `sent ${LATER}`, row: ROW })).toBe(true);
    expect(noteRecordsSend({ note: `sent ${LATER}, ${LATER_TOO}`, row: ROW })).toBe(true);
    expect(noteRecordsSend({ note: "sent C0123456789 1791418800.000100", row: ROW })).toBe(true);
  });

  it("refuses prose that merely contains a send's shape", () => {
    expect(noteRecordsSend({ note: "not sent C0123456789 1791418800.000100 — invalid_auth", row: ROW })).toBe(false);
    expect(noteRecordsSend({ note: `slack refused it, see ${LATER}`, row: ROW })).toBe(false);
    expect(noteRecordsSend({ note: `sent ${LATER} but then deleted`, row: ROW })).toBe(false);
    expect(noteRecordsSend({ note: "sent", row: ROW })).toBe(false);
  });

  it("refuses a ref in another channel, or one posted before the row was parked", () => {
    expect(noteRecordsSend({ note: "sent https://acme.slack.com/archives/C0999/p1791418800000100", row: ROW })).toBe(
      false,
    );
    expect(noteRecordsSend({ note: "sent C0123456789 1700000000.000100", row: ROW })).toBe(false);
    expect(noteRecordsSend({ note: `sent ${LATER}, C0123456789 1700000000.000100`, row: ROW })).toBe(false);
  });
});

describe("sentRefsOfRow", () => {
  it("names each ref's channel and ts in note order, permalinks decoded", () => {
    expect(sentRefsOfRow({ note: `sent ${LATER}, C0123456789 1791418900.000200`, row: ROW })).toEqual([
      { channel: "C0123456789", ts: "1791418800.000100" },
      { channel: "C0123456789", ts: "1791418900.000200" },
    ]);
  });

  it("is undefined for a note that is not a whole send record of this row", () => {
    expect(sentRefsOfRow({ note: "moot: Seth answered", row: ROW })).toBeUndefined();
    expect(sentRefsOfRow({ note: "sent C0999 1791418800.000100", row: ROW })).toBeUndefined();
  });

  it("is undefined for a note naming one message twice, which no split ever is", () => {
    expect(sentRefsOfRow({ note: "sent C0123456789 1791418800.000100, C0123456789 1791418800.000100", row: ROW })).toBe(
      undefined,
    );
    expect(sentRefsOfRow({ note: `sent ${LATER}, C0123456789 1791418800.000100`, row: ROW })).toBeUndefined();
  });
});

describe("sentNoteProven", () => {
  const AUTHOR = "U0SYN000001";
  const authored = { ...ROW, draft: { ...ROW.draft, authorId: AUTHOR } };
  const first = { channel: "C0123456789", ts: "1791418800.000100" };
  const second = { channel: "C0123456789", ts: "1791418900.000200" };
  const message = ({ text, ts, user = AUTHOR }: { text: string; ts: string; user?: string }) => ({
    text,
    ts,
    type: "message",
    user,
  });

  it("holds when the row's author posted the row's words at the ref, case and spacing aside", () => {
    const reads = [[message({ text: "Sounds  GOOD", ts: first.ts })]];

    expect(sentNoteProven({ reads, refs: [first], row: authored })).toBe(true);
  });

  it("holds for a drip split whose parts, in note order, are the row's words", () => {
    const payload = { form: "plain", text: "sounds\n\ngood", unfurl_links: false, unfurl_media: false } as const;
    const split = { ...authored, draft: { ...authored.draft, payload } };
    const reads = [[message({ text: "sounds", ts: first.ts })], [message({ text: "good", ts: second.ts })]];

    expect(sentNoteProven({ reads, refs: [first, second], row: split })).toBe(true);
    expect(sentNoteProven({ reads: reads.toReversed(), refs: [second, first], row: split })).toBe(false);
  });

  it("refuses other words, another author, another ts, or an empty read", () => {
    expect(
      sentNoteProven({ reads: [[message({ text: "another reply", ts: first.ts })]], refs: [first], row: authored }),
    ).toBe(false);
    expect(
      sentNoteProven({
        reads: [[message({ text: "sounds good", ts: first.ts, user: "U0SYNSOMEONE" })]],
        refs: [first],
        row: authored,
      }),
    ).toBe(false);
    expect(
      sentNoteProven({ reads: [[message({ text: "sounds good", ts: second.ts })]], refs: [first], row: authored }),
    ).toBe(false);
    expect(sentNoteProven({ reads: [[]], refs: [first], row: authored })).toBe(false);
  });

  it("holds a reply only in the row's own thread, and a top-level row only top-level", () => {
    const THREAD = "1791418700.000050";
    const reply = { ...authored, draft: { ...authored.draft, threadTs: THREAD } };
    const inThread = { ...message({ text: "sounds good", ts: first.ts }), thread_ts: THREAD };
    const elsewhere = { ...message({ text: "sounds good", ts: first.ts }), thread_ts: "1791418600.000010" };
    const topLevel = message({ text: "sounds good", ts: first.ts });

    expect(sentNoteProven({ reads: [[inThread]], refs: [first], row: reply })).toBe(true);
    expect(sentNoteProven({ reads: [[topLevel]], refs: [first], row: reply })).toBe(false);
    expect(sentNoteProven({ reads: [[elsewhere]], refs: [first], row: reply })).toBe(false);
    expect(sentNoteProven({ reads: [[inThread]], refs: [first], row: authored })).toBe(false);
  });

  it("refuses the row's words posted without its media", () => {
    const medium = { bytes: 2048, name: "graph.png", sha256: "a".repeat(64) };
    const withMedia = { ...authored, draft: { ...authored.draft, media: [medium] } };
    const bare = message({ text: "sounds good", ts: first.ts });
    const attached = { ...bare, files: [{ name: "graph.png", size: 2048 }] };

    expect(sentNoteProven({ reads: [[bare]], refs: [first], row: withMedia })).toBe(false);
    expect(sentNoteProven({ reads: [[attached]], refs: [first], row: withMedia })).toBe(true);
  });

  it("refuses a row recorded with no author, since nothing names whose message proves it", () => {
    const reads = [[message({ text: "sounds good", ts: first.ts })]];

    expect(sentNoteProven({ reads, refs: [first], row: ROW })).toBe(false);
  });
});
