/*
 * The sentence the Queue card heads with and the sentence `handover ask` judges are one sentence.
 *
 * `src/handover/cardAlignment.ts` refuses a heading that leads with a pull request, and it finds
 * that heading with `src/handover/cardHeading.ts`; the card draws it with `site/lib/queueCardAsk.ts`'s `leadQuestion`,
 * over its own `sentencesOf`, because a file under `site/` may not import one under `src/`. A change to either
 * splitter that the other misses would let every gate test pass while the card heads with a sentence the gate never
 * read, so this file, in the lane that reaches both roots, drives one table through both. `cardHeading.ts` is a leaf
 * for this test's sake: the site build typechecks it, and the rest of `src/` would not compile there.
 */

import { describe, expect, it } from "vitest";

import { cardHeading, cardLead } from "../../../src/handover/cardHeading";
import { leadQuestion } from "../../lib/queueCardAsk";

/** The gate's heading, exactly as `cardAlignmentProblems` picks it. */
function gateHeading({ question }: { question: string }): string | undefined {
  return cardHeading({ lead: cardLead({ question }) });
}

const QUESTIONS = [
  "Push the staging branch, A or B? The branch is written.",
  "The branch is written. Push it to staging, A or B?",
  "The evidence is attached. https://github.com/acme/acme-admin/pull/18721 — should we merge it?",
  "Should we raise the gateway errors with platform? The test dashboard shows every request failing since 04:00Z.",
  "The test dashboard shows 1,200 5xx from 3:00 to 4:00pm. Should we share it with the team (ABC-1)?",
  "See http://localhost:3000/queue?open=ask%3Aa first. Is that the card you meant?",
  "Close #42? https://github.com/acme/acme-admin/issues/42 is stale.",
  "Will you paste one sudo line, once, to install the guard?\n\nsudo /bin/true\n\nIt keeps mds off.",
  "Some fixture customers could not finish checkout: should we share it with the team?",
];

describe("the Queue heading the gate judges is the one the card draws", () => {
  it("covers a non-empty table", () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
  });

  it.each(QUESTIONS)("%j", (question) => {
    expect(leadQuestion({ text: question })).toBe(gateHeading({ question }));
  });
});
