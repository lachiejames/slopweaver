/**
 * The optional fields a parked row carries through the log — its media, its asked-before declaration and its
 * identity — each round-tripped when well formed and passed over by name when this version cannot say what it means.
 */
import { describe, expect, it } from "vitest";

import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import { type ParkedPriorAsk, slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import { draft, STILL, VIDEO } from "./fixtures.js";

describe("the register's log — a row's media field", () => {
  /** One parked line carrying `media` exactly as given, bypassing the typed encoder. */
  function lineWith({ media }: { media: unknown }): string {
    const parked = draft();
    return JSON.stringify({
      draft: { ...parked, media },
      id: parked.id,
      kind: "parked",
      schemaVersion: 1,
      tsIso: parked.tsIso,
    });
  }

  it("round-trips a row carrying well-formed media, entries in order", () => {
    const parked = draft({ over: { media: [VIDEO, STILL] } });
    const line = slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } });
    const { events } = parseSlackDraftLog({ lines: [line] });
    expect(foldSlackDrafts({ events })[0]!.draft.media).toEqual([VIDEO, STILL]);
  });

  it("passes over a row whose media entry could not be fetched by hash or named safely, and never shows it", () => {
    const malformed: readonly unknown[] = [
      "walkthrough.mp4",
      [{ ...VIDEO, name: "" }],
      [{ ...VIDEO, name: "../escape.mp4" }],
      [{ ...VIDEO, name: String.raw`dir\clip.mp4` }],
      [{ ...VIDEO, name: ".." }],
      [{ ...VIDEO, sha256: "A".repeat(64) }],
      [{ ...VIDEO, sha256: "a".repeat(63) }],
      [{ ...VIDEO, bytes: 0 }],
      [{ ...VIDEO, bytes: 1.5 }],
      [{ ...VIDEO, bytes: "2747" }],
      [{ bytes: 2747, name: "walkthrough.mp4" }],
      [VIDEO, null],
    ];
    expect(malformed.length).toBeGreaterThan(0);
    const read = malformed.map((media) => {
      const log = parseSlackDraftLog({ lines: [lineWith({ media })] });
      return { events: log.events.length, shown: foldSlackDraftLog({ log }).length, skipped: log.skipped };
    });
    expect(read).toEqual(
      malformed.map(() => ({ events: 0, shown: 0, skipped: [{ id: "sd-11111111", kind: "parked", line: 1 }] })),
    );
  });
});

describe("the register's log — a row's asked-before declaration", () => {
  const PRIOR: ParkedPriorAsk = {
    answerCount: 4,
    answers: [{ text: "expected", ts: "1789000100.000100", userId: "U0JONAH" }],
    changed: "spend tripled",
    kind: "prior",
    ours: { text: "is the spend expected?", ts: "1789000000.000100", userId: "U0SYNADAOWN" },
    permalink: "https://acme.slack.com/archives/C0ISO/p1789000000000100",
    proof: [STILL],
    readThroughTs: "1789000300.000100",
  };

  /** One parked line carrying `priorAsk` exactly as given, bypassing the typed encoder. */
  function lineWith({ priorAsk }: { priorAsk: unknown }): string {
    const parked = draft();
    return JSON.stringify({
      draft: { ...parked, priorAsk },
      id: parked.id,
      kind: "parked",
      schemaVersion: 1,
      tsIso: parked.tsIso,
    });
  }

  it("round-trips a declared none and a declared earlier ask with its proof", () => {
    const read = [{ kind: "none" as const }, PRIOR].map((priorAsk) => {
      const parked = draft({ over: { priorAsk } });
      const line = slackDraftEventLine({
        event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso },
      });
      return foldSlackDrafts({ events: parseSlackDraftLog({ lines: [line] }).events })[0]!.draft.priorAsk;
    });
    expect(read).toEqual([{ kind: "none" }, PRIOR]);
  });

  it("passes over a row whose declaration could mislead the card, and never shows it", () => {
    const { ours: _ours, ...noOurs } = PRIOR;
    const malformed: readonly unknown[] = [
      "none",
      { kind: "maybe" },
      { kind: "none", permalink: PRIOR.permalink },
      noOurs,
      { ...PRIOR, permalink: "http://acme.slack.com/archives/C0ISO/p1789000000000100" },
      { ...PRIOR, answerCount: 0 },
      { ...PRIOR, answerCount: 1.5 },
      { ...PRIOR, readThroughTs: "yesterday" },
      { ...PRIOR, changed: 3 },
      { ...PRIOR, proof: [{ ...STILL, sha256: "x" }] },
      { ...PRIOR, ours: { text: "no ts" } },
    ];
    expect(malformed.length).toBeGreaterThan(0);
    const read = malformed.map((priorAsk) => {
      const log = parseSlackDraftLog({ lines: [lineWith({ priorAsk })] });
      return { events: log.events.length, skipped: log.skipped };
    });
    expect(read).toEqual(
      malformed.map(() => ({ events: 0, skipped: [{ id: "sd-11111111", kind: "parked", line: 1 }] })),
    );
  });
});

describe("the register's log — a row's identity (a finding in a channel posts as the bot)", () => {
  /** One parked line carrying `fields` exactly as given, bypassing the typed encoder. */
  function lineWith({ fields }: { fields: Record<string, unknown> }): string {
    const parked = draft();
    return JSON.stringify({ draft: { ...parked, ...fields }, id: parked.id, kind: "parked", tsIso: parked.tsIso });
  }

  it("round-trips a bot finding and an as-me row the bot could not post", () => {
    const rows = [
      draft({ over: { actor: "bot", kind: "finding" } }),
      draft({ over: { botCannotPost: "not-in-channel", kind: "finding" } }),
    ];
    const lines = rows.map((parked) =>
      slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
    );
    const read = lines.map((line) => foldSlackDrafts({ events: parseSlackDraftLog({ lines: [line] }).events })[0]!);
    expect(read.map((row) => [row.draft.actor, row.draft.kind, row.draft.botCannotPost])).toEqual([
      ["bot", "finding", undefined],
      [undefined, "finding", "not-in-channel"],
    ]);
  });

  it("round-trips each act, and reads a row parked before the field with none", () => {
    const rows = [
      draft({ over: { act: "bump" } }),
      draft({ over: { act: "review-ask" } }),
      draft({ over: { act: "reply" } }),
      draft(),
    ];
    const read = rows.map(
      (parked) =>
        foldSlackDrafts({
          events: parseSlackDraftLog({
            lines: [
              slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
            ],
          }).events,
        })[0]!.draft.act,
    );
    expect(read).toEqual(["bump", "review-ask", "reply", undefined]);
  });

  it("round-trips the board row a draft names, and reads a row parked before the field with none", () => {
    const read = [draft({ over: { row: "thread-chase-daily" } }), draft()].map(
      (parked) =>
        foldSlackDrafts({
          events: parseSlackDraftLog({
            lines: [
              slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
            ],
          }).events,
        })[0]!.draft.row,
    );
    expect(read).toEqual(["thread-chase-daily", undefined]);
  });

  it("passes over a row whose identity this version cannot say, rather than reading it as the owner's", () => {
    const malformed = [
      { actor: "me" },
      { actor: "robot" },
      { kind: "memo" },
      { botCannotPost: "asleep" },
      { act: "question" },
      { row: "" },
      { row: 7 },
    ];
    expect(malformed.length).toBeGreaterThan(0);
    const skipped = malformed.map((fields) => parseSlackDraftLog({ lines: [lineWith({ fields })] }).skipped);
    expect(skipped).toEqual(malformed.map(() => [{ id: "sd-11111111", kind: "parked", line: 1 }]));
  });
});
