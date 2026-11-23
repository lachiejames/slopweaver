/**
 * The `UNCARDED` verdict over composed rows: a closed ask of the owner's whose page never reached the owner's Queue, judged
 * board-wide so a page another row's card carried reads as delivered.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { type BoardReachFacts, pagesCardedOnBoard, uncardedCandidate } from "../../../sweep/uncarded.js";

import { ask, PAGE } from "./askDocFixture.js";

const HOME = "/h/home";

/** Compose rows as the board does, with each row's journal. */
function models({
  docs,
  journals = new Map(),
}: {
  docs: readonly HandoverDoc[];
  journals?: ReadonlyMap<string, { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] }>;
}): readonly BoardModel[] {
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

/** No ruling, no hand step, no other row's card. */
const NOTHING: BoardReachFacts = { cardedOnBoard: new Map(), handPageSteps: new Map(), ruledIdentities: new Set() };

describe("uncardedCandidate", () => {
  it("finds the measured row: settled answered with a page witness and no question ever asked", () => {
    const model = models({ docs: [ask()] })[0]!;
    expect(uncardedCandidate({ events: [], facts: NOTHING, home: HOME, model })).toEqual({
      act: "none",
      path: "/h/home/handovers/plan-usage-strategy.md",
      slug: "plan-usage-strategy",
      verdict: "UNCARDED",
      witness: `settled answered with witness page:${PAGE}; page:${PAGE} never reached the owner's Queue — no question naming it, no ruling, no hand step, no other row's card`,
    });
  });

  it("finds nothing once another row's card carried the page", () => {
    const model = models({ docs: [ask()] })[0]!;
    const facts = { ...NOTHING, cardedOnBoard: new Map([[PAGE, "repair-card"]]) };
    expect(uncardedCandidate({ events: [], facts, home: HOME, model })).toBe(undefined);
  });

  it("finds nothing once the owner has ruled on the page", () => {
    const model = models({ docs: [ask()] })[0]!;
    const facts = { ...NOTHING, ruledIdentities: new Set([`page:${PAGE}`]) };
    expect(uncardedCandidate({ events: [], facts, home: HOME, model })).toBe(undefined);
  });

  it("judges only a closed ask of the owner's: never a live one, a finding row, or a non-ask", () => {
    const live = models({ docs: [ask({ settlement: undefined, settlementWitness: undefined })] })[0]!;
    const finding = models({ docs: [ask({ origin: "finding" })] })[0]!;
    const doc = models({ docs: [ask({ kind: "doc" })] })[0]!;
    expect(
      [live, finding, doc].map((model) => uncardedCandidate({ events: [], facts: NOTHING, home: HOME, model })),
    ).toEqual([undefined, undefined, undefined]);
  });

  it("finds nothing for a closed ask whose witness is not a page", () => {
    const model = models({ docs: [ask({ settlementWitness: "https://acme.slack.com/archives/C0/p1" })] })[0]!;
    expect(uncardedCandidate({ events: [], facts: NOTHING, home: HOME, model })).toBe(undefined);
  });
});

describe("pagesCardedOnBoard", () => {
  it("maps a page a whole registered shape names to its row, and ignores a dispatch ask's bare summary", () => {
    const shaped = ask({
      lean: "A",
      options: [
        { letter: "A", option: `read page:${PAGE}`, tradeoff: "five minutes" },
        { letter: "B", option: "leave it", tradeoff: "none" },
      ],
      problem: "the owner's plan usage expires on several dates",
      settlement: undefined,
      settlementWitness: undefined,
      slug: "repair-card",
    });
    const bare = ask({ settlement: undefined, slug: "bare", summary: `see page:other-page` });
    expect([
      ...pagesCardedOnBoard({ home: HOME, journals: new Map(), models: models({ docs: [shaped, bare] }) }),
    ]).toEqual([[PAGE, "repair-card"]]);
  });

  it("maps a page a journalled question names to its row", () => {
    const question: RunEvent = { atIso: "2026-11-03T09:00:00.000Z", kind: "question", question: `read page:${PAGE}?` };
    const journals = new Map([["asker", { events: [question], unreadableLines: [] }]]);
    const rows = models({ docs: [ask({ settlement: undefined, slug: "asker" })], journals });
    expect([...pagesCardedOnBoard({ home: HOME, journals, models: rows })]).toEqual([[PAGE, "asker"]]);
  });
});
