/** The derived status a board row publishes beside its authored line, and how a settled ask ended. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import { ruledBeforeSettleOf } from "../../../../cli/commands/handover/listJsonSettlement.js";
import { type BoardModel } from "../../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument's status", () => {
  it("emits the DERIVED status and keeps the authored line beside it", () => {
    // The owner's own example row's shape: `settlement: answered` in front matter beside `status: ready`, with a
    // question still open on the journal. The document used to publish `ready`, so the console read it as
    // an open ask five days after it was settled.
    const settled: HandoverDoc = { ...doc({ kind: "ask", slug: "settled" }), settlement: "answered" };
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({
        docs: [settled],
        journals: new Map([
          [
            "settled",
            {
              events: [
                { atIso: "2026-09-16T03:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
                { atIso: "2026-09-16T03:04:38.747Z", kind: "question", question: "which option?" },
              ],
              unreadableLines: [],
            },
          ],
        ]),
      }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    const row = document.rows[0]!;
    expect(row.status).toBe("done");
    expect(row.authoredStatus).toBe("ready");
    expect(row.statusFrom).toBe("settlement");
    expect(row.ownerWait).toBe("settled");
  });

  it("publishes how a settled ask ended, its witness and when it was settled — what the voice says it left at", () => {
    const settled: HandoverDoc = {
      ...doc({ kind: "ask", slug: "settled", summary: "Bump Jasper for review on acme-admin#18247?" }),
      askedIso: "2026-10-07T03:00:00.000Z",
      lean: "send it",
      options: [
        { letter: "A", option: "send", tradeoff: "the owner reads it today" },
        { letter: "B", option: "hold", tradeoff: "nothing moves" },
      ],
      problem: "the review ask has sat a week",
      settledIso: "2026-10-07T03:18:26.968Z",
      settlement: "answered",
      settlementWitness: "intake-mark card 2026-10-07T03:18:26.968Z: the owner said send it",
    };
    const row = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [settled] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    }).rows[0]!;

    expect([row.settlement, row.settlementWitness, row.settledIso]).toEqual([
      "answered",
      "intake-mark card 2026-10-07T03:18:26.968Z: the owner said send it",
      "2026-10-07T03:18:26.968Z",
    ]);
    expect([row.summary, row.question, row.ownerWait, row.problem]).toEqual([
      "Bump Jasper for review on acme-admin#18247?",
      undefined,
      "not-waiting",
      "the review ask has sat a week",
    ]);
    expect([row.ruledBeforeSettleIso, row.ruledBeforeSettleWords]).toEqual([undefined, undefined]);
  });

  // A ruled ask reads `already-ruled` and is off the owner's Queue from the ruling, before a session settles it.
  it("publishes the ruling that took a settled ask off first, and no ruling decided after the settle", () => {
    const settled: HandoverDoc = {
      ...doc({ kind: "ask", slug: "settled" }),
      askedIso: "2026-10-07T03:00:00.000Z",
      settledIso: "2026-10-07T05:00:00.000Z",
      settlement: "answered",
      settlementWitness: "#1946",
    };
    const ruling = ({ atIso }: { atIso: string }): RunEvent => ({
      anchor: "transcript:abc#def",
      atIso,
      kind: "ruling",
      ruling: "send it",
    });
    const modelsRuledAt = ({ atIso }: { atIso: string }) =>
      modelsFor({
        docs: [settled],
        journals: new Map([["settled", { events: [ruling({ atIso })], unreadableLines: [] }]]),
      });
    const rowOfModels = ({ models }: { models: readonly BoardModel[] }) =>
      boardJsonDocument({
        detached: NO_DETACHED_FINDINGS,
        filter: EMPTY_TAG_FILTER,
        handoverDir: "/h",
        models,
        observedAtIso: OBSERVED,
        references: NO_BOARD_REFERENCES,
        scanStartedIso: SCAN_STARTED,
        unreadable: [],
        unresolved: 0,
      }).rows[0]!;
    const ruledFirst = modelsRuledAt({ atIso: "2026-10-07T03:10:00.000Z" });
    const before = rowOfModels({ models: ruledFirst });
    expect([before.ruledBeforeSettleIso, before.ruledBeforeSettleWords]).toEqual([
      "2026-10-07T03:10:00.000Z",
      "send it",
    ]);
    const answer = ruledBeforeSettleOf({ model: ruledFirst[0]! })!;
    expect([answer.decidedIso, answer.words]).toEqual(["2026-10-07T03:10:00.000Z", "send it"]);
    const ruledLater = modelsRuledAt({ atIso: "2026-10-07T05:30:00.000Z" });
    const after = rowOfModels({ models: ruledLater });
    expect([after.ruledBeforeSettleIso, after.ruledBeforeSettleWords]).toEqual([undefined, undefined]);
    expect(ruledBeforeSettleOf({ model: ruledLater[0]! })).toBeUndefined();
    // A ruling correcting the first does not take it off the owner's Queue; the first does.
    const corrected = modelsFor({
      docs: [settled],
      journals: new Map([
        [
          "settled",
          {
            events: [
              { ...ruling({ atIso: "2026-10-07T03:20:00.000Z" }), ruling: "actually hold" },
              ruling({ atIso: "2026-10-07T03:10:00.000Z" }),
            ],
            unreadableLines: [],
          },
        ],
      ]),
    });
    const correctedRow = rowOfModels({ models: corrected });
    expect([correctedRow.ruledBeforeSettleIso, correctedRow.ruledBeforeSettleWords]).toEqual([
      "2026-10-07T03:10:00.000Z",
      "send it",
    ]);
    const beforeAsked = modelsRuledAt({ atIso: "2026-10-07T02:50:00.000Z" });
    expect(ruledBeforeSettleOf({ model: beforeAsked[0]! })).toBeUndefined();
    // A settle instant that does not parse bounds nothing, so the ruling still dates the removal.
    const badSettle = modelsFor({
      docs: [{ ...settled, settledIso: "not-a-date" }],
      journals: new Map([
        ["settled", { events: [ruling({ atIso: "2026-10-07T03:10:00.000Z" })], unreadableLines: [] }],
      ]),
    });
    expect(ruledBeforeSettleOf({ model: badSettle[0]! })!.decidedIso).toBe("2026-10-07T03:10:00.000Z");
  });

  // A ruling a correction folded never takes the restated card off the owner's Queue.
  it("dates a settled ask's departure from the first ruling after its last correction, not one the correction folded", () => {
    const settled: HandoverDoc = {
      ...doc({ kind: "ask", slug: "settled" }),
      askedIso: "2026-10-20T10:01:00.000Z",
      settledIso: "2026-10-20T10:06:00.000Z",
      settlement: "answered",
      settlementWitness: "the owner said cut it",
    };
    const ruled = ({ atIso, words }: { atIso: string; words: string }): RunEvent => ({
      anchor: "transcript:abc#def",
      atIso,
      kind: "ruling",
      ruling: words,
    });
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-20T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-10-20T10:01:00.000Z", kind: "question", question: "what would you change?" },
      ruled({ atIso: "2026-10-20T10:02:00.000Z", words: "react to it first" }),
      {
        atIso: "2026-10-20T10:03:00.000Z",
        kind: "question-corrected",
        question: "what would you change, now we have talked it through?",
        why: "folded the owner's 10:02Z ruling",
      },
      ruled({ atIso: "2026-10-20T10:04:00.000Z", words: "cut the Session section" }),
      { answer: "cut the Session section", atIso: "2026-10-20T10:05:00.000Z", kind: "answered" },
    ];
    const models = modelsFor({ docs: [settled], journals: new Map([["settled", { events, unreadableLines: [] }]]) });

    const answer = ruledBeforeSettleOf({ model: models[0]! })!;

    expect([answer.decidedIso, answer.words]).toEqual(["2026-10-20T10:04:00.000Z", "cut the Session section"]);
  });

  // A ruling that answered an EARLIER question on the row never took the later card off.
  it("dates a settled ask's departure from a ruling after its latest question, not one that answered an earlier one", () => {
    const settled: HandoverDoc = {
      ...doc({ kind: "ask", slug: "settled" }),
      askedIso: "2026-10-20T10:01:00.000Z",
      settledIso: "2026-10-20T10:08:00.000Z",
      settlement: "answered",
      settlementWitness: "the owner said ship it",
    };
    const ruled = ({ atIso, words }: { atIso: string; words: string }): RunEvent => ({
      anchor: "transcript:abc#def",
      atIso,
      kind: "ruling",
      ruling: words,
    });
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-20T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-10-20T10:01:00.000Z", kind: "question", question: "what would you change?" },
      {
        atIso: "2026-10-20T10:02:00.000Z",
        kind: "question-corrected",
        question: "what would you change in the draft?",
        why: "named the draft",
      },
      ruled({ atIso: "2026-10-20T10:03:00.000Z", words: "cut the Session section" }),
      { answer: "cut the Session section", atIso: "2026-10-20T10:04:00.000Z", kind: "answered" },
      { atIso: "2026-10-20T10:05:00.000Z", kind: "question", question: "ship the cut draft?" },
      ruled({ atIso: "2026-10-20T10:06:00.000Z", words: "ship it" }),
      { answer: "ship it", atIso: "2026-10-20T10:07:00.000Z", kind: "answered" },
    ];
    const models = modelsFor({ docs: [settled], journals: new Map([["settled", { events, unreadableLines: [] }]]) });

    const answer = ruledBeforeSettleOf({ model: models[0]! })!;

    expect([answer.decidedIso, answer.words]).toEqual(["2026-10-20T10:06:00.000Z", "ship it"]);
  });

  // A ruling appended after the latest question but decided before it answered nothing.
  it("never dates a settled ask's departure from a ruling decided before its latest question, however late it was appended", () => {
    const settled: HandoverDoc = {
      ...doc({ kind: "ask", slug: "settled" }),
      askedIso: "2026-10-20T10:01:00.000Z",
      settledIso: "2026-10-20T10:08:00.000Z",
      settlement: "answered",
      settlementWitness: "the owner said ship it",
    };
    const ruled = ({ atIso, words }: { atIso: string; words: string }): RunEvent => ({
      anchor: "transcript:abc#def",
      atIso,
      kind: "ruling",
      ruling: words,
    });
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-20T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: "2026-10-20T10:01:00.000Z", kind: "question", question: "what would you change?" },
      { answer: "cut the Session section", atIso: "2026-10-20T10:04:00.000Z", kind: "answered" },
      { atIso: "2026-10-20T10:05:00.000Z", kind: "question", question: "ship the cut draft?" },
      ruled({ atIso: "2026-10-20T10:03:00.000Z", words: "cut the Session section" }),
      ruled({ atIso: "2026-10-20T10:06:00.000Z", words: "ship it" }),
      { answer: "ship it", atIso: "2026-10-20T10:07:00.000Z", kind: "answered" },
    ];
    const models = modelsFor({ docs: [settled], journals: new Map([["settled", { events, unreadableLines: [] }]]) });

    const answer = ruledBeforeSettleOf({ model: models[0]! })!;

    expect([answer.decidedIso, answer.words]).toEqual(["2026-10-20T10:06:00.000Z", "ship it"]);
  });

  it("publishes no settlement on an open row", () => {
    const row = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ kind: "ask", slug: "open" })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    }).rows[0]!;

    expect([row.settlement, row.settlementWitness, row.settledIso]).toEqual([undefined, undefined, undefined]);
  });

  it("emits the authored line unchanged on a row the register says nothing about", () => {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [doc({ slug: "plain", status: "in-progress" })] }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });

    const row = document.rows[0]!;
    expect(row.status).toBe("in-progress");
    expect(row.authoredStatus).toBe("in-progress");
    expect(row.statusFrom).toBe("authored");
  });
});
