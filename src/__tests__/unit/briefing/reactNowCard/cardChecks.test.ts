/*
 * `checkReactNowCards` over one card's shape: the five fields it must carry and how each is judged, the empty
 * block and the missing heading, where a card is read from, the reply-routing and own-hands wording rules, a
 * command left only behind a fold, and which card a defect is numbered against across both groupings.
 */
import { describe, expect, it } from "vitest";

import { AGE_LINE, artifact, card, check, groupedArtifact } from "./harness.js";

describe("checkReactNowCards", () => {
  it("passes a fully-shaped card with zero defects", () => {
    const result = check({ html: artifact({ cards: [card()] }) });

    expect(result.cardsChecked).toBe(1);
    expect(result.defects).toEqual([]);
    expect(result.parseProblems).toEqual([]);
  });

  it("refuses a card missing `why you`", () => {
    const html = artifact({
      cards: [
        `<div class="need"><div class="q">1. Ship it?</div>${AGE_LINE}` +
          `<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.</dd>` +
          `<dt>options</dt><dd>A: send it as written. B: hold it for now.</dd>` +
          `<dt>lean</dt><dd>A.</dd>` +
          `<dt>if silent</dt><dd>nothing ships.</dd></dl></div>`,
      ],
    });

    const result = check({ html });

    expect(result.defects).toEqual([{ card: 1, field: "whyYou", question: "Ship it?", reason: "missing" }]);
  });

  it("refuses a `what` with fewer than two sentences of background", () => {
    const result = check({ html: artifact({ cards: [card({ what: "Only one sentence here." })] }) });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "what",
        question: "Ship the thing: are you happy with the draft?",
        reason: "fewer than two sentences of background",
      },
    ]);
  });

  it("refuses a two-sentence question", () => {
    const result = check({
      html: artifact({ cards: [card({ question: "1. Ship the thing. Are you happy?" })] }),
    });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "question",
        question: "Ship the thing. Are you happy?",
        reason: "must be exactly one sentence, phrased as a question ending in `?`",
      },
    ]);
  });

  it("refuses a question that is not phrased as a question", () => {
    const result = check({ html: artifact({ cards: [card({ question: "1. Ship the thing." })] }) });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "question",
        question: "Ship the thing.",
        reason: "must be exactly one sentence, phrased as a question ending in `?`",
      },
    ]);
  });

  it("refuses an option carrying an undefined bare number-word label", () => {
    const result = check({
      html: artifact({ cards: [card({ options: "A: run the 2-way sync. B: hold it for now." })] }),
    });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason: 'option A uses an undefined label: "2-way"',
      },
    ]);
  });

  it("does not flag a number-word label the card itself defines", () => {
    const result = check({
      html: artifact({
        cards: [
          card({
            options: "A: run the 2-way sync. B: hold it for now.",
            what: "This proposes a 2-way sync between the two stores. It replaces the one-way pull.",
          }),
        ],
      }),
    });

    expect(result.defects).toEqual([]);
  });

  it("refuses an option carrying an undefined Title Case label", () => {
    const result = check({
      html: artifact({ cards: [card({ options: "A: adopt the Data Retention plan. B: hold it for now." })] }),
    });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason: 'option A uses an undefined label: "Data Retention"',
      },
    ]);
  });

  it("refuses an option that is not a full sentence", () => {
    const result = check({
      html: artifact({ cards: [card({ options: "A: ship it now. B: hold" })] }),
    });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason: 'option B is not a full sentence: "hold"',
      },
    ]);
  });

  it("refuses options not shaped as lettered choices", () => {
    const result = check({ html: artifact({ cards: [card({ options: "just send it, probably." })] }) });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason: "not shaped as `A: … B: …`",
      },
    ]);
  });

  it("refuses a card missing `lean`", () => {
    const html = artifact({
      cards: [
        `<div class="need"><div class="q">1. Ship it?</div>${AGE_LINE}` +
          `<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.</dd>` +
          `<dt>why you</dt><dd>It is your call.</dd>` +
          `<dt>options</dt><dd>A: send it as written. B: hold it for now.</dd>` +
          `<dt>if silent</dt><dd>nothing ships.</dd></dl></div>`,
      ],
    });

    expect(check({ html }).defects).toEqual([{ card: 1, field: "lean", question: "Ship it?", reason: "missing" }]);
  });

  it("refuses a card missing `if silent`", () => {
    const html = artifact({
      cards: [
        `<div class="need"><div class="q">1. Ship it?</div>${AGE_LINE}` +
          `<dl class="f"><dt>what</dt><dd>Two sentences here. Background continues.</dd>` +
          `<dt>why you</dt><dd>It is your call.</dd>` +
          `<dt>options</dt><dd>A: send it as written. B: hold it for now.</dd>` +
          `<dt>lean</dt><dd>A.</dd></dl></div>`,
      ],
    });

    expect(check({ html }).defects).toEqual([{ card: 1, field: "ifSilent", question: "Ship it?", reason: "missing" }]);
  });

  it("refuses a card compressed to one line with no field grid at all", () => {
    const html = artifact({
      cards: [`<div class="need"><div class="q">1. Ship the PR review reply?</div>${AGE_LINE}</div>`],
    });

    const result = check({ html });

    expect(result.cardsChecked).toBe(1);
    expect(result.defects).toEqual([
      { card: 1, field: "what", question: "Ship the PR review reply?", reason: "missing" },
      { card: 1, field: "whyYou", question: "Ship the PR review reply?", reason: "missing" },
      { card: 1, field: "options", question: "Ship the PR review reply?", reason: "missing" },
      { card: 1, field: "lean", question: "Ship the PR review reply?", reason: "missing" },
      { card: 1, field: "ifSilent", question: "Ship the PR review reply?", reason: "missing" },
    ]);
  });

  it("passes an empty react-now block as a real, intentional state", () => {
    const html =
      "<h1>Fleet Briefing</h1><h2>react now</h2>" +
      "<p>nothing open above the line right now</p>" +
      "<h2>done since you last looked</h2>";

    const result = check({ html });

    expect(result.cardsChecked).toBe(0);
    expect(result.defects).toEqual([]);
    expect(result.parseProblems).toEqual([]);
  });

  it("reports a parse problem when no react-now heading exists", () => {
    const result = check({ html: "<h1>Fleet Briefing</h1><h2>done since you last looked</h2>" });

    expect(result.cardsChecked).toBe(0);
    expect(result.parseProblems).toEqual(["no `<h2>react now</h2>` heading found"]);
  });

  it("never reads a card from the done section, past the next heading", () => {
    const html =
      `<h2>react now</h2>${card()}<h2>done since you last looked</h2>` +
      `<div class="need"><div class="q">a one-line done item, no grid at all</div></div>`;

    const result = check({ html });

    expect(result.cardsChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses an option that tells the owner to reply on the card, and names the shape to use instead", () => {
    const html = artifact({
      cards: [card({ options: "A: reply on the card and the session lands it. B: hold it for now." })],
    });

    const result = check({ html });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          'option A routes the owner to "reply" rather than the supervisor chat. ' +
          'The owner only ever answers there, so word it "tell the supervisor <word>".',
      },
    ]);
  });

  it("refuses an `if silent` that tells the owner to react, and passes one that names the supervisor", () => {
    const reacting = check({ html: artifact({ cards: [card({ ifSilent: "nothing ships until you react." })] }) });
    const routed = check({
      html: artifact({
        cards: [
          card({
            ifSilent: "nothing ships until you tell the supervisor.",
            options: "A: tell the supervisor send and it goes out. B: tell the supervisor hold.",
          }),
        ],
      }),
    });

    expect(reacting.defects).toEqual([
      {
        card: 1,
        field: "ifSilent",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          'if silent routes the owner to "react" rather than the supervisor chat. ' +
          'The owner only ever answers there, so word it "tell the supervisor <word>".',
      },
    ]);
    expect(routed.defects).toEqual([]);
  });

  // A COMMAND IS NEVER ONLY BEHIND A CLICK. See
  // `src/briefing/commandAboveFold.ts`. The gate reads the RENDERED bytes, so its evidence is a `<code>`
  // inside a `<details>`, which is what the form's `detail` fold becomes.
  it("refuses a me-facing card whose fold holds a command the cells never name", () => {
    const hidden = card({
      what:
        "Plan-four is where the gauge sends Fable spawns. It has the most five-hour headroom left. " +
        "<details><summary>the two commands</summary><ol>" +
        "<li><code>claude setup-token</code></li>" +
        "<li><code>pbpaste | slopweaver claude token --plan plan-four --stdin</code></li>" +
        "</ol></details>",
      whyYou: "Minting one means running claude setup-token as that account, which only you hold.",
    });

    const mine = check({ html: groupedArtifact({ mine: [hidden], team: [] }) });
    const team = check({ html: groupedArtifact({ mine: [], team: [hidden] }) });

    expect(mine.defects).toEqual([
      {
        card: 1,
        field: "what",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          "the card asks you to run `pbpaste | slopweaver claude token --plan plan-four --stdin` and names " +
          "it only inside the fold. A command you have to type belongs in the cells you cannot avoid, not " +
          "behind a click — put it in `what` verbatim and leave the explanation in the fold. If that runs " +
          "the cell over its cap, fold other prose: never the command. If it is EVIDENCE rather than " +
          "something you run — a command a session already ran — it is not a `code` run: write it as " +
          "plain text and this rule leaves it alone.",
      },
    ]);
    expect(team.defects).toEqual([]);
  });

  it("passes a me-facing card that names the same command above its own fold", () => {
    const named = card({
      what:
        "The command is <code>pbpaste | slopweaver claude token --plan plan-four --stdin</code>. " +
        "It hands the minted token to the plan the gauge routes Fable spawns at. " +
        "<details><summary>why each flag is there</summary><p>" +
        "<code>pbpaste | slopweaver claude token --plan plan-four --stdin</code> reads the clipboard.</p>" +
        "</details>",
    });

    expect(check({ html: groupedArtifact({ mine: [named], team: [] }) }).defects).toEqual([]);
  });

  it("passes a me-facing card whose fold carries a name rather than a command", () => {
    const named = card({
      what:
        "The plan is the one with headroom. The gauge already routes Fable spawns at it. " +
        "<details><summary>which plan</summary><p>It is <code>plan-four</code> on the gauge.</p></details>",
    });

    expect(check({ html: groupedArtifact({ mine: [named], team: [] }) }).defects).toEqual([]);
  });

  it("refuses a me-facing card that puts an action in the owner's own hands, and leaves the team-facing one alone", () => {
    const own = card({
      options: "A: add it now and the session moves on. B: tell the supervisor hold.",
      what: "The rule lives in your own file. Nothing else changed.",
    });

    const mine = check({ html: groupedArtifact({ mine: [own], team: [] }) });
    const team = check({ html: groupedArtifact({ mine: [], team: [own] }) });

    expect(mine.defects).toEqual([
      {
        card: 1,
        field: "options",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          'option A puts an action in the owner\'s own hands with "add". The owner never edits a file, runs a command or ' +
          'clicks a console themselves, so name the session as the actor: "tell the supervisor <word> and the ' +
          'session does it".',
      },
      {
        card: 1,
        field: "what",
        question: "Ship the thing: are you happy with the draft?",
        reason:
          'what puts an action in the owner\'s own hands with "your own file". The owner never edits a file, runs a command ' +
          'or clicks a console themselves, so name the session as the actor: "tell the supervisor <word> and ' +
          'the session does it".',
      },
    ]);
    expect(team.defects).toEqual([]);
  });

  it("numbers a me-facing card after the team-facing ones it renders below", () => {
    const own = card({ what: "The rule lives in your own file. Nothing else changed." });

    const result = check({ html: groupedArtifact({ mine: [own], team: [card()] }) });

    expect(result.cardsChecked).toBe(2);
    expect(result.defects.map((defect) => defect.card)).toEqual([2]);
  });

  it("checks every card and names which one a defect belongs to", () => {
    const html = artifact({
      cards: [card({ question: "1. First one, all fine?" }), card({ question: "2. Second one, no lean?", lean: "" })],
    });

    const result = check({ html });

    expect(result.cardsChecked).toBe(2);
    expect(result.defects).toEqual([{ card: 2, field: "lean", question: "Second one, no lean?", reason: "missing" }]);
  });
});
