/**
 * An opened Automations card leads with ONE plain sentence saying what the automation is, and folds everything
 * operational below the things the owner acts on (AGENTS.md rule 7).
 *
 * A card that tells the owner much but never what it is fails them, so the sentence comes first. The unit lane has no `react-dom`, so
 * the markup is not rendered here — a pull request carries the before and after photographs. What this holds is the
 * order the open card draws its sections in, and that every operational section sits inside a fold that never opens
 * itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SITE = join(import.meta.dirname, "../..");

/** The card component, whitespace collapsed so a reflow by the formatter does not move the assertion. */
const CARD = readFileSync(join(SITE, "components/live/AutomationCard.tsx"), "utf8").replaceAll(/\s+/gu, " ");

/** The open card's body: from the bordered block the collapsed summary opens onto, to the end of the component. */
const BODY = CARD.slice(CARD.indexOf('<div className="mt-2 flex flex-col gap-1 border-t'));

/** The Technical detail fold the card's body ends on, which lives in its own module. */
const TECHNICAL_FOLD = "<TechnicalDetail automation={automation} />";

/** That fold's own markup: from the component's declaration to the end of its file, whitespace collapsed. */
const TECHNICAL = ((): string => {
  const file = readFileSync(join(SITE, "components/live/AutomationTechnical.tsx"), "utf8").replaceAll(/\s+/gu, " ");
  return file.slice(file.indexOf("export function TechnicalDetail("));
})();

/** Where each element first appears in the open card's body; a missing one is -1, which no ordering accepts. */
function at({ needle }: { needle: string }): number {
  return BODY.indexOf(needle);
}

describe("an opened Automations card", () => {
  it("leads with the purpose sentence, before the broken answers and everything else", () => {
    const purpose = at({ needle: "<PurposeSentence automation={automation} />" });
    expect(purpose).toBeGreaterThan(0);
    expect(purpose).toBeLessThan(at({ needle: "<BrokenAnswers" }));
    expect(BODY.match(/<PurposeSentence /gu)).toEqual(["<PurposeSentence "]);
  });

  it("draws the purpose once, never again as a labelled field further down", () => {
    expect(BODY).not.toContain('label="for"');
  });

  it("puts what it produced and how to steer it above every fold", () => {
    const firstFold = at({ needle: "<details" });
    expect(at({ needle: "<Outputs " })).toBeLessThan(firstFold);
    expect(at({ needle: "<SteerNote " })).toBeLessThan(firstFold);
  });

  it("folds run history, requests and technical detail, in that order, none opening itself", () => {
    const running = at({ needle: "How it has been running</summary>" });
    const requests = at({ needle: "Requests and changes</summary>" });
    const technical = at({ needle: TECHNICAL_FOLD });
    expect([running > 0, running < requests, requests < technical]).toEqual([true, true, true]);
    expect(BODY).not.toMatch(/<details[^>]*\bopen\b/u);
  });

  it("draws the technical fold as a closed fold whose summary says Technical detail", () => {
    expect(TECHNICAL.indexOf('<details className="text-[0.72rem]"> <summary')).toBeGreaterThan(0);
    expect(TECHNICAL.indexOf("Technical detail</summary>")).toBeGreaterThan(TECHNICAL.indexOf("<details"));
    expect(TECHNICAL).not.toMatch(/<details[^>]*\bopen\b/u);
  });

  it("reaches the run answers, recent runs, steers, timeline and cadence only from inside their folds", () => {
    const running = at({ needle: "How it has been running</summary>" });
    const requests = at({ needle: "Requests and changes</summary>" });
    const technical = at({ needle: TECHNICAL_FOLD });
    expect(
      [at({ needle: "<RunAnswers " }), at({ needle: "<RecentRuns " })].every((i) => i > running && i < requests),
    ).toBe(true);
    expect([at({ needle: "<Steers " }), at({ needle: "<Timeline " })].every((i) => i > requests && i < technical)).toBe(
      true,
    );
    expect(at({ needle: "automation.cadence" })).toBe(-1);
    expect(TECHNICAL.indexOf("automation.cadence")).toBeGreaterThan(TECHNICAL.indexOf("Technical detail</summary>"));
  });
});
