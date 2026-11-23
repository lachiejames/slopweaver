/*
 * The four card-framing rules over the rendered page: an unglossed fleet word, a question rule 1 already
 * settles or one asking the owner to choose an implementation, a `why you` naming no reason, an option the owner cannot pick
 * where it sits; plus the premise instant, the word budget, and the break-glass that lifts the four at once.
 */
import { describe, expect, it } from "vitest";

import { checkReactNowCards } from "../../../../briefing/reactNowCard.js";
import { AGE_LINE, artifact, card, check, NOW_ISO } from "./harness.js";

describe("the four card-framing rules, over the rendered page", () => {
  it("refuses an unglossed fleet word in the composer's own prose", () => {
    const html = artifact({ cards: [card({ what: "A settled ask still reads ready. The fill spawned it tonight." })] });

    const jargon = check({ html }).defects.filter((defect) => defect.reason.includes("fleet word"));
    expect(jargon).toHaveLength(1);
    expect(jargon[0]!.field).toBe("what");
    expect(jargon[0]!.reason).toContain('the card uses the fleet word "settled ask" and never says what it means');
  });

  it("leaves the same word alone once the card glosses it above the fold", () => {
    const what =
      "A settled ask is a request of yours already answered, and one is still being offered. It spawned tonight.";
    const html = artifact({ cards: [card({ what })] });

    expect(check({ html }).defects.filter((defect) => defect.reason.includes("fleet word"))).toEqual([]);
  });

  it("does NOT read the subject line, which carries the subject's own title rather than the fleet's words", () => {
    const withSubject = card().replace(
      '<dl class="f">',
      '<div class="bg"><a href="https://github.com/lachiejames/slopweaver/pull/1">the settled ask row</a></div><dl class="f">',
    );

    expect(check({ html: artifact({ cards: [withSubject] }) }).defects).toEqual([]);
  });

  it("refuses a question asking permission for something rule 1 already settles", () => {
    const question = "1. Does the fix that closes a dead session's run get a pull request?";
    const html = artifact({ cards: [card({ question })] });

    const settled = check({ html }).defects.filter((defect) => defect.reason.includes("already settled by"));
    expect(settled).toHaveLength(1);
    expect(settled[0]!.field).toBe("question");
    expect(settled[0]!.reason).toContain("AGENTS.md rule 1");
  });

  it("refuses a question asking the owner to choose between implementations", () => {
    const question = "1. Does the keep-alive fix land tonight as a stopgap?";
    const html = artifact({ cards: [card({ question })] });

    const framed = check({ html }).defects.filter((defect) => defect.reason.includes("between implementations"));
    expect(framed).toHaveLength(1);
    expect(framed[0]!.reason).toContain("The owner cares about the outcome, not how it works internally");
  });

  it("refuses a `why you` naming no reason the decision is the owner's", () => {
    const whyYou = "Every route either changes what a pull request ships or takes a branch another session holds.";
    const html = artifact({ cards: [card({ whyYou })] });

    const floor = check({ html }).defects.filter((defect) => defect.reason.includes("names no reason"));
    expect(floor).toHaveLength(1);
    expect(floor[0]!.field).toBe("whyYou");
  });

  it("refuses an option the owner cannot pick where it sits", () => {
    const options = "A: send it as written. B: hold, you will read the touch-seam page first.";
    const html = artifact({ cards: [card({ options })] });

    const away = check({ html }).defects.filter((defect) => defect.reason.includes("cannot be picked where it sits"));
    expect(away).toHaveLength(1);
    expect(away[0]!.reason).toContain('option B cannot be picked where it sits — "read the touch-seam page"');
  });

  it("refuses an option that would change what a pull request ships, and only on a pull-request card", () => {
    const options = "A: wait for the sessions to finish. B: rebase each onto staging, three change what they ship.";
    const onPullRequest = card({ options }).replace('data-premise-kind="composed"', 'data-premise-kind="pull-request"');

    const ships = check({ html: artifact({ cards: [onPullRequest] }) }).defects.filter((defect) =>
      defect.reason.includes("would change what the pull request ships"),
    );
    expect(ships).toHaveLength(1);
    expect(ships[0]!.reason).toContain(
      'option B would change what the pull request ships, with "change what they ship"',
    );

    const composed = check({ html: artifact({ cards: [card({ options })] }) }).defects.filter((defect) =>
      defect.reason.includes("would change what the pull request ships"),
    );
    expect(composed).toEqual([]);
  });

  it("refuses a card carrying no age line at all", () => {
    const ageless = card().replace(AGE_LINE, "");

    const premise = check({ html: artifact({ cards: [ageless] }) }).defects.filter(
      (defect) => defect.field === "premise",
    );
    expect(premise).toHaveLength(1);
    expect(premise[0]!.reason).toContain("card 1 carries no usable premise instant — the card carries no age line.");
  });

  it("refuses a premise instant in the future, which claims to have read a world that has not happened", () => {
    const ahead = card().replace('data-premise-iso="2026-09-11T21:18:59Z"', 'data-premise-iso="2026-09-13T00:00:00Z"');

    const premise = check({ html: artifact({ cards: [ahead] }) }).defects.filter(
      (defect) => defect.field === "premise",
    );
    expect(premise).toHaveLength(1);
    expect(premise[0]!.reason).toContain("is in the future");
  });

  it("does NOT charge the renderer's own age line against the card's word budget", () => {
    const long = [20, 20, 18].map((count) => `${Array.from({ length: count }, () => "alpha").join(" ")}.`).join(" ");
    const html = artifact({
      cards: [
        card({
          lean: `${Array.from({ length: 30 }, () => "alpha").join(" ")}.`,
          options: ["A", "B", "C", "D"]
            .map((letter) => `${letter}: ${Array.from({ length: 25 }, () => "alpha").join(" ")}.`)
            .join(" "),
          what: long,
          whyYou: `only you ${Array.from({ length: 28 }, () => "alpha").join(" ")}.`,
        }),
      ],
    });

    const budget = check({ html }).defects.filter((defect) => defect.reason.includes("the whole card is"));
    expect(budget).toHaveLength(1);
    expect(budget[0]!.reason).toContain("the whole card is 243 words above the fold");
  });

  it("lifts every one of the four for one invocation, and nothing else, under the break-glass", () => {
    const html = artifact({
      cards: [
        card({
          options: "A: send it as written. B: hold, you will read the page first.",
          question: "1. Does this get a pull request?",
          what: "A settled ask still reads ready. The fill spawned it tonight.",
          whyYou: "It moved without you and this is the report.",
        }),
      ],
    });

    const on = checkReactNowCards({ applyFraming: true, applyVoice: true, html, nowIso: NOW_ISO, rules: [] });
    expect(on.defects.map((defect) => defect.field)).toEqual(["options", "what", "question", "whyYou"]);

    const off = checkReactNowCards({ applyFraming: false, applyVoice: true, html, nowIso: NOW_ISO, rules: [] });
    expect(off.defects).toEqual([]);
    expect(off.cardsChecked).toBe(1);
  });
});
