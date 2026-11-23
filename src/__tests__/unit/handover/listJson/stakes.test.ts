/** The stakes a row publishes for an ask, and the instant they were last stated or reconfirmed. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { doc, type Journal, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("what a row publishes of its stakes", () => {
  const STAKES = { blastRadius: "one doc", risk: "a run starts on the wrong base", stillReal: "the doc names both" };
  const OPTIONS = [
    { letter: "A", option: "main", tradeoff: "every other run is on it" },
    { letter: "B", option: "the release branch", tradeoff: "this doc cites it once" },
  ];

  function rowFor({ journal, over }: { journal?: Journal; over?: Partial<HandoverDoc> }) {
    const journals = journal === undefined ? new Map<string, Journal>() : new Map([["staked", journal]]);
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs: [{ ...doc({ kind: "ask", slug: "staked" }), ...over }], journals }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    return document.rows.find((candidate) => candidate.slug === "staked")!;
  }

  it("publishes the journal's stakes, dated to the question that stated them", () => {
    const asked: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        {
          atIso: "2026-09-22T11:00:00.000Z",
          kind: "question",
          lean: "main",
          options: OPTIONS,
          problem: "the doc names two bases",
          question: "which base?",
          stakes: STAKES,
        },
      ],
      unreadableLines: [],
    };
    const row = rowFor({ journal: asked });

    expect([row.risk, row.blastRadius, row.stillReal]).toEqual([STAKES.risk, STAKES.blastRadius, STAKES.stillReal]);
    expect(row.stillRealIso).toBe("2026-09-22T11:00:00.000Z");
  });

  it("publishes a registered row's stakes with the instant the register verb stamped", () => {
    const row = rowFor({
      over: {
        ...STAKES,
        lean: "main",
        options: OPTIONS,
        problem: "the doc names two bases",
        stillRealIso: "2026-09-22T09:00:00.000Z",
      },
    });

    expect(row.stillReal).toBe(STAKES.stillReal);
    expect(row.stillRealIso).toBe("2026-09-22T09:00:00.000Z");
  });

  it("dates a reconfirmed ask to the reconfirm, even with no stakes, and keeps its asked instant", () => {
    const reconfirmed: Journal = {
      events: [
        { atIso: "2026-09-22T10:00:00.000Z", branch: "a-branch", docHash: "h1", kind: "started" },
        { atIso: "2026-09-22T11:00:00.000Z", kind: "question", question: "which base?" },
        {
          atIso: "2026-09-23T15:00:00.000Z",
          kind: "question-reconfirmed",
          question: "which base?",
          stillReal: "the doc still names two bases",
        },
      ],
      unreadableLines: [],
    };
    const row = rowFor({ journal: reconfirmed });

    expect([row.stillReal, row.stillRealIso, row.questionAskedIso]).toEqual([
      "the doc still names two bases",
      "2026-09-23T15:00:00.000Z",
      "2026-09-22T11:00:00.000Z",
    ]);
  });

  it("publishes no stakes and no instant for a row recorded before they were required", () => {
    const row = rowFor({ over: { lean: "main", options: OPTIONS, problem: "the doc names two bases" } });

    expect([row.risk, row.blastRadius, row.stillReal, row.stillRealIso]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
