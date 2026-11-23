/**
 * The section rules themselves: the disclosure scope a gloss may come from, the two ask-framing refusals,
 * the ranked pointer's age, and the lede's one cap.
 *
 * Every fixture is a projected input rather than a form or a page, so a failing test names the RULE that
 * moved rather than a projection that changed shape. The projections have their own tests either side.
 */
import { describe, expect, it } from "vitest";

import {
  checkSectionQuality,
  LEDE_SECTION,
  RANKED_SECTION,
  type SectionQualityInput,
  type SectionQualityScope,
} from "../../../briefing/sectionQuality.js";

/** An input carrying nothing but what one test fills in. */
function input({ over }: { over: Partial<SectionQualityInput> }): SectionQualityInput {
  return { asks: [], lede: undefined, parseProblems: [], pointers: [], scopes: [], ...over };
}

/** One disclosure level, with no level enclosing it unless a test says so. */
function scope({ over }: { over: Partial<SectionQualityScope> }): SectionQualityScope {
  return { ancestors: [], path: [], section: '"earlier today, in order"', text: "", ...over };
}

/** Every defect one input produced, as `rule: reason`, in order. */
function defects({ over, framing = true }: { over: Partial<SectionQualityInput>; framing?: boolean }): string[] {
  return checkSectionQuality({ applyFraming: framing, input: input({ over }) }).defects.map(
    (defect) => `${defect.rule}: ${defect.reason}`,
  );
}

describe("a fleet word is refused where the section never says what it means", () => {
  it("refuses one a collapsed section uses and never explains", () => {
    const text = "The fill spawned the audit at 21:10.";

    expect(defects({ over: { scopes: [scope({ over: { text } })] } })).toEqual([
      'fleet-jargon: "earlier today, in order" uses the fleet word "The fill spawned" and never says what it ' +
        'means — "fill" here is the scan that starts work nobody is holding. Say what it means in the same ' +
        "breath, above the fold, or write the card without the word.",
    ]);
  });

  it("passes the same section once one of its cells says what the word means", () => {
    const text = "The fill spawned — the scan that starts unheld work — the audit at 21:10.";

    expect(defects({ over: { scopes: [scope({ over: { text } })] } })).toEqual([]);
  });

  it("takes a gloss from a level ENCLOSING this one, which a reader has open", () => {
    const ancestors = ["Every tick is one pass of the supervisor's loop."];
    const text = "This tick spawned the audit.";

    expect(defects({ over: { scopes: [scope({ over: { ancestors, text } })] } })).toEqual([]);
  });

  it("never takes one from a fold the owner has not opened, which is the card rule pointed downwards", () => {
    const parent = scope({ over: { path: ["a"], text: "This tick spawned the audit." } });
    const child = scope({
      over: { ancestors: ["This tick spawned the audit."], path: ["b"], text: "Every tick is one pass of the loop." },
    });

    expect(defects({ over: { scopes: [parent, child] } })).toEqual([
      'fleet-jargon: "earlier today, in order" uses the fleet word "This tick" and never says what it means ' +
        '— "tick" here is one pass of the supervisor\'s loop. Say what it means in the same breath, above ' +
        "the fold, or write the card without the word.",
    ]);
  });

  it("reports each section that breaks it, so a composer fixes them in one pass", () => {
    const first = scope({ over: { section: "the lede", text: "The fill spawned it." } });
    const second = scope({ over: { text: "This tick closed the chair." } });

    expect(defects({ over: { scopes: [first, second] } })).toHaveLength(2);
  });
});

describe("a ranked open page's ask is framed the way a card's question is", () => {
  it("refuses one asking permission for something doctrine already settles", () => {
    const asks = [{ path: [], section: RANKED_SECTION, text: "Should I merge the pull request now it is green?" }];

    expect(defects({ over: { asks } })[0]).toContain("the ranked open-pages index asks permission for");
  });

  it("refuses one asking the owner to choose between implementations", () => {
    const asks = [{ path: [], section: RANKED_SECTION, text: "Which implementation should the page use?" }];

    expect(defects({ over: { asks } })[0]).toContain("asks the owner to choose between implementations");
  });

  it("passes an ask that simply says what the page wants from the owner", () => {
    const asks = [{ path: [], section: RANKED_SECTION, text: "Your read of the rewritten routing." }];

    expect(defects({ over: { asks } })).toEqual([]);
  });

  it("passes a STATEMENT that names a mechanism, which is the live counterexample that sharpened this", () => {
    const text = "Your 238-10 word: the page is out, discussion first, implementation held.";

    expect(defects({ over: { asks: [{ path: [], section: RANKED_SECTION, text }] } })).toEqual([]);
  });
});

describe("a ranked pointer carries an instant and an age", () => {
  const pointer = { landedIso: "2026-09-12T04:00:00Z", path: [], renderedAge: "landed 6 hours ago" };

  it("refuses a landing instant no clock can parse", () => {
    const pointers = [{ ...pointer, landedIso: "yesterdayish", section: RANKED_SECTION }];

    expect(defects({ over: { pointers } })).toEqual([
      'pointer-instant: the ranked open-pages index carries the landing instant "yesterdayish", which no ' +
        "clock can parse, so the page cannot say how long it has been open on the owner.",
    ]);
  });

  it("refuses a line that prints a stamp with no age beside it", () => {
    const pointers = [{ ...pointer, renderedAge: undefined, section: RANKED_SECTION }];

    expect(defects({ over: { pointers } })).toEqual([
      "pointer-age: the ranked open-pages index prints a landing stamp with no age beside it, so how long " +
        "the page has been waiting is a subtraction the owner has to do themselves. Re-render with `slopweaver " +
        "briefing render`.",
    ]);
  });

  it("passes a line that landed AFTER the instant the corpus was read, which is an ordinary page", () => {
    const pointers = [{ ...pointer, landedIso: "2026-09-30T04:00:00Z", section: RANKED_SECTION }];

    expect(defects({ over: { pointers } })).toEqual([]);
  });
});

describe("the lede is held to what a card's `what` is held to", () => {
  it("refuses one over the cap, naming the count and the cap", () => {
    const lede = Array.from({ length: 61 }, () => "alpha").join(" ");

    expect(defects({ over: { lede } })).toEqual([
      "lede-words: the lede runs to 61 words, over the cap of 60. It is the first thing the owner reads and it is " +
        "held to what a card's `what` is held to — say the one thing the page is about, and let the " +
        "sections below carry the rest.",
    ]);
  });

  it("passes one exactly at the cap", () => {
    const lede = Array.from({ length: 60 }, () => "alpha").join(" ");

    expect(defects({ over: { lede } })).toEqual([]);
  });

  it("still refuses it with the framing rules lifted, because a cap is not a framing finding", () => {
    const lede = Array.from({ length: 61 }, () => "alpha").join(" ");

    expect(defects({ framing: false, over: { lede } })[0]).toContain("lede-words: the lede runs to 61 words");
  });
});

describe("the reader's break-glass and its parse problems", () => {
  it("lifts every vocabulary and framing finding when framing is off", () => {
    const scopes = [scope({ over: { text: "The fill spawned it." } })];
    const asks = [{ path: [], section: RANKED_SECTION, text: "Should I merge the pull request now it is green?" }];

    expect(defects({ framing: false, over: { asks, scopes } })).toEqual([]);
  });

  it("reports a section it could not read rather than passing the page silently", () => {
    const parseProblems = ["line 1 of the ranked open-pages index carries no marked ask"];

    expect(defects({ over: { parseProblems } })).toEqual([
      "section-parse: line 1 of the ranked open-pages index carries no marked ask",
    ]);
  });

  it("lifts that too with the break-glass, because only an ARCHIVE can carry one", () => {
    const parseProblems = ["line 1 of the ranked open-pages index carries no marked ask"];

    expect(defects({ framing: false, over: { parseProblems } })).toEqual([]);
  });

  it("counts the levels it read, so a clean result can be told from a projection that found nothing", () => {
    const scopes = [
      scope({ over: { text: "A quiet hour." } }),
      scope({ over: { section: LEDE_SECTION, text: "Hi." } }),
    ];

    expect(checkSectionQuality({ applyFraming: true, input: input({ over: { scopes } }) }).scopesChecked).toBe(2);
  });
});
