/** The owner-wait verdict a board row carries, and the instant its open question was asked. */
// The legacy-spelling cases went out with the fold that read it.
// deleted-with-code: OWNER_WAIT_SPELLING
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { OWNER_WAIT_KIND, waitsOnOwner } from "../../../../handover/ownerWait.js";
import { EMPTY_TAG_FILTER } from "../../../../handover/tagFilter.js";
import { packAsksOf } from "../../../../talk/packAsks.js";
import { packRecentlyLeftOf } from "../../../../talk/packRecentlyLeft.js";
import { doc, type Journal, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

/**
 * The cap exists because a `summary:` is AUTHORED, so nothing bounds it: on the board this was written
 * against, five docs carried 535–570 KB each and the whole document was 28.34 MB of which `summary` was
 * 27.18 MB. Every case here feeds a summary LONGER than the cap and asserts both halves — what survived and
 * what the tally says was dropped — so a cap that silently stopped applying reddens rather than passing.
 */
describe("boardJsonDocument's owner-wait verdict", () => {
  const ASKED = "2026-09-16T03:04:38.747Z";
  const started: RunEvent = {
    atIso: "2026-09-16T03:00:00.000Z",
    branch: "b",
    docHash: "h",
    kind: "started",
  };
  const question: RunEvent = {
    atIso: ASKED,
    kind: "question",
    question: "Option C is IN. #763 landed. Anything else?",
  };

  function rowOf({ docs, journals }: { docs: readonly HandoverDoc[]; journals: ReadonlyMap<string, Journal> }) {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs, journals }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    return document.rows[0]!;
  }

  it("carries the instant the question was asked, which no row carried before", () => {
    const row = rowOf({
      docs: [doc({ slug: "asked" })],
      journals: new Map([["asked", { events: [started, question], unreadableLines: [] }]]),
    });

    expect(row.questionAskedIso).toBe(ASKED);
    expect(row.ownerWait).toBe("owner");
    expect(row.ruledSinceQuestionIso).toBe(undefined);
  });

  it("leaves questionAskedIso absent on a row with no open question", () => {
    const row = rowOf({ docs: [doc({ slug: "quiet" })], journals: new Map() });

    expect(row.questionAskedIso).toBe(undefined);
    expect(row.ownerWait).toBe("not-waiting");
  });

  it("reads a row the owner already ruled on as already-ruled, with the decision instant beside it", () => {
    const ruled: RunEvent = {
      anchor: "transcript:abc#def",
      atIso: "2026-09-16T05:06:18.877Z",
      kind: "ruling",
      ruling: "option C",
    };
    const row = rowOf({
      docs: [doc({ slug: "ruled" })],
      journals: new Map([["ruled", { events: [started, question, ruled], unreadableLines: [] }]]),
    });

    expect(row.ownerWait).toBe("already-ruled");
    expect(row.ruledSinceQuestionIso).toBe("2026-09-16T05:06:18.877Z");
    expect(row.question).toBe("Option C is IN. #763 landed. Anything else?");
  });

  it("reads a paused row as not-runnable rather than as the owner's", () => {
    const row = rowOf({
      docs: [doc({ slug: "held", status: "paused" })],
      journals: new Map([["held", { events: [started, question], unreadableLines: [] }]]),
    });

    expect(row.ownerWait).toBe("not-runnable");
  });
});

/* The owner-wait kind as each reader of a published row takes it: only the owner's arm reads as needing the owner. */
describe("the owner-wait kind", () => {
  const published = {
    lean: "option A",
    ownerWait: "owner",
    path: "/h/asked.md",
    prNamed: [],
    prSteers: undefined,
    priority: "p1",
    question: "A or B?",
    questionAskedIso: "2026-09-24T10:00:00.000Z",
    slug: "asked",
  };

  it("reads only the owner's arm as the owner's", () => {
    expect(OWNER_WAIT_KIND).toBe("owner");
    expect(["owner", "already-ruled", "not-waiting"].map((ownerWait) => waitsOnOwner({ ownerWait }))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("packs the ask for the voice from a row waiting on the owner, and none from one that is not", () => {
    const asksOf = (row: typeof published) =>
      packAsksOf({ ownerWordsOf: () => [], proofs: { kind: "unread", why: "no reading" }, rows: [row] });
    expect(asksOf(published).map((ask) => ask.slug)).toEqual(["asked"]);
    expect(asksOf({ ...published, ownerWait: "already-ruled" })).toEqual([]);
  });

  it("finds a landed card left the owner's Queue from a row waiting on the owner", () => {
    const left = ({ ownerWait }: { ownerWait: string }) =>
      packRecentlyLeftOf({
        landings: [
          { atIso: "2026-09-24T12:00:00.000Z", cardKey: "ask:asked", source: "relay", words: "do A", workSlug: "w" },
        ],
        moves: [],
        nowIso: "2026-09-24T13:00:00.000Z",
        rows: [
          {
            kind: "doc",
            ownerWait,
            problem: undefined,
            question: "A or B?",
            ruledBeforeSettleIso: undefined,
            ruledBeforeSettleWords: undefined,
            ruledSinceQuestionIso: undefined,
            settledIso: undefined,
            settlement: undefined,
            settlementWitness: undefined,
            slug: "asked",
            summary: "Pick A or B",
          },
        ],
      }).map((one) => one.key);
    expect(left({ ownerWait: "owner" })).toEqual(["ask:asked"]);
    expect(left({ ownerWait: "not-waiting" })).toEqual([]);
  });
});
