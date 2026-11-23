/**
 * The two committed fixtures are the same react-now card twice: once with its detail sitting above the
 * fold, once with the same words inside a `<details>`. Nothing was cut between them, which is the whole
 * claim the gate makes — a card is refused for where its words are, never for having them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { briefingRefused, checkBriefing, renderBriefingCheck } from "../../../briefing/check.js";

const FIXTURES = join(process.cwd(), "src/__tests__/fixtures/briefing");

/** A fixed instant, so a fixture's card ages are the same on every run of this suite. */
const NOW_ISO = "2026-09-12T00:00:00Z";

function checkFixture({ name }: { name: string }): ReturnType<typeof checkBriefing> {
  return checkBriefing({
    applyBareRefs: true,
    applyFraming: true,
    applyVoice: true,
    html: readFileSync(join(FIXTURES, name), "utf8"),
    nowIso: NOW_ISO,
    rules: [],
  });
}

describe("the committed briefing fixtures", () => {
  it("refuses the wall-of-text card, naming the field, the count and the cap", () => {
    const result = checkFixture({ name: "wall-of-text-card.html" });

    expect(briefingRefused({ result })).toBe(true);
    expect(renderBriefingCheck({ result })[0]).toBe(
      'card 1 ("the progress card in Slack: should a background ticker rewrite it every 90 se..."): what — ' +
        "15 sentences above the fold, over the cap of 4. Keep the ones the owner has to read to decide, and fold the rest.",
    );
    expect(result.cards.defects.filter((defect) => defect.field === "what").length).toBe(6);
  });

  it("collapses one rule firing many times into one line carrying the count", () => {
    const lines = renderBriefingCheck({ result: checkFixture({ name: "wall-of-text-card.html" }) });

    expect(lines).toContain(
      'card 1 ("the progress card in Slack: should a background ticker rewrite it every 90 se..."): what — ' +
        "what: 5 times — a semicolon joins two clauses that are two facts. Make them two sentences; nothing " +
        "above the fold needs a reader to hold both halves at once.",
    );
  });

  it("passes the same card once its detail sits inside a fold", () => {
    const result = checkFixture({ name: "reshaped-card.html" });

    expect(briefingRefused({ result })).toBe(false);
    expect(renderBriefingCheck({ result })).toEqual([
      "1 card(s) checked under react-now, no defects",
      "shape: react-now first, the groupings in order, both instants stated",
      "page: 61 words and 2 unfolded block(s) above the fold outside the cards, inside budget",
      "alignment: stated in 15 words above the fold",
      "sections: 2 level(s) outside the cards read, every fleet word glossed where you can see it",
      "autonomy ledger: nothing has been done autonomously, or the page was rendered without --autonomy-ledger",
      "one index: 0 row(s) of yours in 0 words, 0 artifact(s) linked, every anchor lands",
      "corrections: not stamped — a first publish, or a republish that skipped `briefing corrections`",
      "correction block: nothing is waiting on your mark, or the page was rendered without --owner-beliefs",
      "quiz: this sweep asked nothing, or the page was rendered without --knowledge-quiz",
      "bare references: none found",
      "fold residue: none found",
      "blocked on the owner: nothing waiting on them, or the ask-lifecycle log was not read",
      "gone quiet: every standing row is posting on its cadence, or the recipe store was not read",
      "live premises: no card names a pull request, or the freshness leg did not run",
    ]);
  });
});
