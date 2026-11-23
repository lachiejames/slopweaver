/**
 * The form's caps, one refusal each.
 *
 * Every fixture starts from one well-shaped card and breaks exactly one thing, so a failing test names the
 * cap that moved rather than "the form is wrong". The exact message is asserted, not a fragment, because
 * the message is the contract with a machine caller filling this form — it has to say what to do next.
 */
import { describe, expect, it } from "vitest";

import { cardAboveFoldWords } from "../../../../../outbound/briefing/aboveFoldText.js";
import { pageAboveFoldWords } from "../../../../../outbound/briefing/pageAboveFold.js";
import type { BriefingCard } from "../../../../../outbound/briefing/types.js";
import { CARD, dataUriOfBytes, FORM, sentenceOfWords, text, withCard, withMineCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form's caps", () => {
  it("admits a well-shaped page", () => {
    expect(refusals({ form: FORM })).toEqual([]);
  });

  it("refuses a `what` over the word cap and names the fold to move it into", () => {
    const over = { what: text({ value: [30, 31].map((count) => sentenceOfWords({ count })).join(" ") }) };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.what: what runs over the cap of 60 words above the fold. Cut it, or move the rest into the " +
        "card's `detail` fold.",
    ]);
  });

  it("admits in the fold the exact words it refuses above it — that is the whole of the fold loosening", () => {
    const wall = [200, 200].map((count) => sentenceOfWords({ count })).join(" ");

    expect(refusals({ form: withCard({ over: { what: text({ value: wall }) } }) })).toEqual([
      "reactNow.teamFacing.0.what: what runs over the cap of 60 words above the fold. Cut it, or move the rest into the " +
        "card's `detail` fold.",
      "reactNow.teamFacing.0: the whole card runs over the cap of 200 words above the fold. Every field is short " +
        "enough on its own and the card still is not. Fold something.",
    ]);
    const folded = {
      detail: { blocks: [{ content: text({ value: wall }), kind: "para" as const }], summary: "the long version" },
    };
    expect(refusals({ form: withCard({ over: folded }) })).toEqual([]);
  });

  it("admits a fold paragraph running on past the four sentences it would be held to above the fold", () => {
    const runOn = text({ value: Array.from({ length: 17 }, () => "It landed.").join(" ") });
    const over = {
      detail: { blocks: [{ content: runOn, kind: "para" as const }], summary: "the long version" },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
    // The same run-on above the fold still refuses, so the case above is the fold being exempt rather than
    // the sentence counter having stopped firing.
    expect(refusals({ form: { ...FORM, recent: [{ headline: runOn }] } })).toEqual([
      "recent.0.headline: headline runs over the cap of 4 sentences above the fold. Keep the ones a reader has to " +
        "read to decide, and fold the rest.",
    ]);
  });

  it("admits a fold list item carrying a paragraph — one sentence a bullet is the house shape, not a gate", () => {
    const over = {
      detail: {
        blocks: [
          {
            items: [
              text({ value: "It landed." }),
              text({ value: `It landed. Then it did not. ${sentenceOfWords({ count: 200 })}` }),
            ],
            kind: "list" as const,
            ordered: false,
          },
        ],
        summary: "the long version",
      },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("refuses a fold carrying more than four blocks, and admits exactly four", () => {
    const para = { content: text({ value: "It landed." }), kind: "para" as const };
    const foldOf = ({ count }: { count: number }): Partial<BriefingCard> => ({
      detail: { blocks: Array.from({ length: count }, () => para), summary: "the long version" },
    });

    expect(refusals({ form: withCard({ over: foldOf({ count: 4 }) }) })).toEqual([]);
    expect(refusals({ form: withCard({ over: foldOf({ count: 5 }) }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks: this fold carries more than 4 blocks. Depth goes DOWN a level rather " +
        "than sideways — group the tail behind a nested `fold`, which counts as one block.",
    ]);
  });

  it("still names the block cap when one of the blocks is itself malformed", () => {
    const para = { content: text({ value: "It landed." }), kind: "para" as const };
    const over = {
      detail: { blocks: [para, para, para, para, { kind: "para" }], summary: "the long version" },
    } as unknown as Partial<BriefingCard>;

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks.4.content: Invalid input: expected array, received undefined",
      "reactNow.teamFacing.0.detail.blocks: this fold carries more than 4 blocks. Depth goes DOWN a level rather " +
        "than sideways — group the tail behind a nested `fold`, which counts as one block.",
    ]);
  });

  it("still refuses four maximal blocks that break the fold's SHAPE, so the block cap is not the only rule left", () => {
    const over = {
      detail: {
        blocks: [
          { alt: "the queue", data: dataUriOfBytes({ bytes: 8 }), kind: "image" as const },
          { content: text({ value: sentenceOfWords({ count: 400 }) }), kind: "para" as const },
        ],
        summary: "the long version",
      },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.detail: an image block sits ahead of a para, list, draft or paste block in the same " +
        "fold. A card reads text then images, the way the Slack post it describes would — move every image to the " +
        "end of `blocks`.",
    ]);
  });

  it("counts a NESTED fold's blocks by the same number as the fold that holds it", () => {
    const para = { content: text({ value: "It landed." }), kind: "para" as const };
    const over = ({ count }: { count: number }): Partial<BriefingCard> => ({
      detail: {
        blocks: [
          { fold: { blocks: Array.from({ length: count }, () => para), summary: "one level down" }, kind: "fold" },
        ],
        summary: "the long version",
      },
    });

    expect(refusals({ form: withCard({ over: over({ count: 4 }) }) })).toEqual([]);
    expect(refusals({ form: withCard({ over: over({ count: 5 }) }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks.0.fold.blocks: this fold carries more than 4 blocks. Depth goes DOWN a " +
        "level rather than sideways — group the tail behind a nested `fold`, which counts as one block.",
    ]);
  });

  it("refuses a `what` carrying fewer than two sentences of background", () => {
    const over = { what: text({ value: "It is a template." }) };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.what: what carries fewer than two sentences of background.",
    ]);
  });

  it("refuses a `why you` running to two sentences", () => {
    const over = { whyYou: text({ value: "It is your post. It goes out under your name." }) };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.whyYou: whyYou runs over the cap of 1 sentence above the fold. Keep the ones a reader has to read " +
        "to decide, and fold the rest.",
    ]);
  });

  it("refuses a question that is not one sentence ending in a question mark", () => {
    const over = { question: "Send the draft." };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.question: a question is exactly one sentence, phrased as a question ending in `?`.",
    ]);
  });

  it("refuses a question over the word cap", () => {
    const over = { question: `${Array.from({ length: 31 }, () => "alpha").join(" ")}?` };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.question: a question runs over the cap of 30 words.",
    ]);
  });

  it("refuses a fifth option, and a lettering gap", () => {
    const five = ["A", "B", "C", "D", "E"].map((letter) => ({ letter, text: "Hold." }));

    // Since zod 4.6.6 an over-long array fails on its size cap before any option or later refine runs.
    expect(refusals({ form: withCard({ over: { options: five } }) })).toEqual([
      "reactNow.teamFacing.0.options: Too big: expected array to have <=4 items",
    ]);
    expect(
      refusals({
        form: withCard({
          over: {
            options: [
              { letter: "A", text: "Hold." },
              { letter: "C", text: "Go." },
            ],
          },
        }),
      }),
    ).toEqual(["reactNow.teamFacing.0.options: options must be lettered from A with no gaps: A, B, C, D."]);
  });

  it("refuses an option that is not one full sentence, and one over the word cap", () => {
    const bare = [{ letter: "A", text: "2-way" }];
    const long = [{ letter: "A", text: `${Array.from({ length: 26 }, () => "alpha").join(" ")}.` }];

    expect(refusals({ form: withCard({ over: { options: bare } }) })).toEqual([
      "reactNow.teamFacing.0.options.0.text: an option must be a full sentence ending in terminal punctuation.",
      "reactNow.teamFacing.0.options.0.text: an option is one sentence. Split it, or fold it.",
    ]);
    expect(refusals({ form: withCard({ over: { options: long } }) })).toEqual([
      "reactNow.teamFacing.0.options.0.text: an option runs over the cap of 25 words.",
    ]);
  });

  it("refuses an option and an `if silent` that route the owner anywhere but the supervisor chat", () => {
    const replyOption = [{ letter: "A", text: "Reply on the DM card and the session lands it." }];
    const reactSilent = text({ value: "If you do not react by morning, it stays parked." });

    expect(refusals({ form: withCard({ over: { options: replyOption } }) })).toEqual([
      "reactNow.teamFacing.0.options.0.text: an option routes the owner somewhere other than the supervisor chat. " +
        'The owner only ever answers there, so word it "tell the supervisor <word>".',
    ]);
    expect(refusals({ form: withCard({ over: { ifSilent: reactSilent } }) })).toEqual([
      "reactNow.teamFacing.0.ifSilent: `if silent` routes the owner somewhere other than the supervisor chat. " +
        'The owner only ever answers there, so word it "tell the supervisor <word>".',
    ]);
  });

  // A COMMAND IS NEVER ONLY BEHIND A CLICK. On the setup-token card both its commands sat in `detail`, and
  // the owner could not find either. The pair below is that card's own two versions — see `src/briefing/commandAboveFold.ts` for the criterion and its measurement.
  it("refuses a me-facing card whose fold carries a command its cells never name", () => {
    const over = {
      detail: {
        blocks: [
          {
            items: [
              [{ kind: "code" as const, text: "claude setup-token" }],
              [{ kind: "code" as const, text: "pbpaste | slopweaver claude token --plan plan-four --stdin" }],
            ],
            kind: "list" as const,
            ordered: true,
          },
        ],
        summary: "the two commands",
      },
      what: text({ value: "The first command is claude setup-token. It prints a token the plan then holds." }),
    };

    expect(refusals({ form: withMineCard({ over }) })).toEqual([
      "reactNow.meFacing.0.detail: the card asks you to run " +
        "`pbpaste | slopweaver claude token --plan plan-four --stdin` and names it only inside the fold. " +
        "A command you have to type belongs in the cells you cannot avoid, not behind a click — put it in " +
        "`what` verbatim and leave the explanation in the fold. If that runs the cell over its cap, fold " +
        "other prose: never the command. If it is EVIDENCE rather than something you run — a command a " +
        "session already ran — it is not a `code` run: write it as plain text and this rule leaves it " +
        "alone.",
    ]);
  });

  it("passes the same card once both commands are named above the fold", () => {
    const over = {
      detail: {
        blocks: [
          {
            items: [
              [{ kind: "code" as const, text: "claude setup-token" }],
              [{ kind: "code" as const, text: "pbpaste | slopweaver claude token --plan plan-four --stdin" }],
            ],
            kind: "list" as const,
            ordered: true,
          },
        ],
        summary: "what each command does",
      },
      what: text({
        value:
          "The first command is claude setup-token. With the token copied, the second is " +
          "pbpaste | slopweaver claude token --plan plan-four --stdin.",
      }),
    };

    expect(refusals({ form: withMineCard({ over }) })).toEqual([]);
  });

  it("leaves the same hidden command alone on a team-facing card, which this rule does not govern", () => {
    const over = {
      detail: {
        blocks: [{ content: [{ kind: "code" as const, text: "gh pr view 742" }], kind: "para" as const }],
        summary: "how it was read",
      },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("refuses a me-facing `what` and option that put an action in the owner's own hands", () => {
    const own = {
      options: [{ letter: "A", text: "Add it now and the session moves on." }],
      what: text({ value: "The rule lives in your own file. Nothing else changed." }),
    };

    expect(refusals({ form: withMineCard({ over: own }) })).toEqual([
      'reactNow.meFacing.0.what: `what` puts an action in the owner\'s own hands with "your own file". The owner never edits ' +
        'a file, runs a command or clicks a console themselves, so name the session as the actor: "tell the ' +
        'supervisor <word> and the session does it".',
      'reactNow.meFacing.0.options.0.text: an option puts an action in the owner\'s own hands with "Add". The owner never ' +
        "edits a file, runs a command or clicks a console themselves, so name the session as the actor: " +
        '"tell the supervisor <word> and the session does it".',
    ]);
  });

  it("refuses an option, a lean and an `if silent` that offer an administrator merge, on BOTH groupings", () => {
    const offer = {
      ifSilent: text({ value: "It waits, unless you say admin merge." }),
      lean: text({ value: "B, then merge it as admin." }),
      options: [{ letter: "A", text: "Admin merge it tonight and pull the base." }],
    };
    const advice =
      "A base branch that requires a review is governed by branch protection or a repository ruleset, and a " +
      "ruleset's requirement is not something admin permission or enforce_admins can waive — so an admin " +
      "merge there is not a risky choice, it is one GitHub refuses. Offer the review instead: `slopweaver " +
      "github review-state` names who owes one and `slopweaver github pr request-review` asks them.";

    expect(refusals({ form: withCard({ over: offer }) })).toEqual([
      `reactNow.teamFacing.0.lean: \`lean\` offers an administrator merge with "merge it as admin". ${advice}`,
      `reactNow.teamFacing.0.ifSilent: \`ifSilent\` offers an administrator merge with "admin merge". ${advice}`,
      `reactNow.teamFacing.0.options.0.text: \`options\` offers an administrator merge with "Admin merge". ${advice}`,
    ]);
    expect(refusals({ form: withMineCard({ over: offer }) })).toHaveLength(3);
  });

  it("admits the same words on a team-facing card, which the rule deliberately does not govern", () => {
    const own = {
      options: [{ letter: "A", text: "Add it now and the session moves on." }],
      what: text({ value: "The rule lives in your own file. Nothing else changed." }),
    };

    expect(refusals({ form: withCard({ over: own }) })).toEqual([]);
  });

  it("admits a me-facing card that names the session as the actor", () => {
    const routed = {
      options: [
        { letter: "A", text: "Tell the supervisor keep and it stays." },
        { letter: "B", text: "Tell the supervisor revert and the session backs it out." },
      ],
      what: text({ value: "The session edited the settings file on your word. Nothing is waiting on you." }),
    };

    expect(refusals({ form: withMineCard({ over: routed }) })).toEqual([]);
  });

  it("admits the supervisor-routed wording the refusal asks for", () => {
    const over = {
      ifSilent: text({ value: "It stays parked until you tell the supervisor." }),
      options: [
        { letter: "A", text: "Tell the supervisor land and it goes through the queue." },
        { letter: "B", text: "Tell the supervisor hold and it stays a draft." },
      ],
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("refuses a paragraph that packs a numbered list, naming the list block to use instead", () => {
    const over = { lean: text({ value: "Take 1) this 2) then 3) that." }) };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.lean.0.text: packs more than 2 numbers into running prose. A numbered set of items is a real " +
        'list — use a `{ "kind": "list" }` block, one item per entry.',
    ]);
  });

  it("refuses a whole card that is over budget while every field is inside its own cap", () => {
    const over: Partial<BriefingCard> = {
      ifSilent: text({ value: `${sentenceOfWords({ count: 29 })}` }),
      lean: text({ value: `${sentenceOfWords({ count: 29 })}` }),
      options: ["A", "B", "C", "D"].map((letter) => ({ letter, text: sentenceOfWords({ count: 24 }) })),
      question: `${Array.from({ length: 29 }, () => "alpha").join(" ")}?`,
      what: text({ value: `${sentenceOfWords({ count: 29 })} ${sentenceOfWords({ count: 29 })}` }),
      // "only you" is the WARRANT the card has to carry by owner ruling, and it keeps the count
      // at 29 so the whole-card budget this test measures is unchanged.
      whyYou: text({ value: `only you ${sentenceOfWords({ count: 27 })}` }),
    };

    expect(cardAboveFoldWords({ card: { ...CARD, ...over } })).toBe(270);
    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0: the whole card runs over the cap of 200 words above the fold. Every field is short enough " +
        "on its own and the card still is not. Fold something.",
    ]);
  });

  it("caps the recent section at the page's own unfolded-block budget, not a second number", () => {
    const note = { headline: text({ value: "It landed." }) };

    expect(refusals({ form: { ...FORM, recent: [note, note, note, note] } })).toEqual([]);
    expect(refusals({ form: { ...FORM, recent: [note, note, note, note, note, note] } })).toEqual([
      "recent: Too big: expected array to have <=5 items",
    ]);
  });

  it("refuses an unknown key and names the nearest field", () => {
    expect(
      refusals({ form: withCard({ over: { whyyou: text({ value: "Yours." }) } as Partial<BriefingCard> }) }),
    ).toEqual([
      'reactNow.teamFacing.0: unknown field "whyyou" — REFUSED, not ignored. Did you mean "whyYou"?\n' +
        "this form's fields are: detail, ifSilent, lean, options, premise, question, readiness, subject, what, " +
        "whyYou",
    ]);
  });

  it("counts only what a reader meets: a folded section adds nothing to the page budget", () => {
    const buried = {
      notes: [
        {
          detail: {
            blocks: [{ content: text({ value: sentenceOfWords({ count: 60 }) }), kind: "para" as const }],
            summary: "everything",
          },
          headline: text({ value: "It landed." }),
        },
      ],
      summary: "history",
    };

    expect(pageAboveFoldWords({ form: { ...FORM, history: [buried] } })).toBe(pageAboveFoldWords({ form: FORM }));
    expect(refusals({ form: { ...FORM, history: [buried] } })).toEqual([]);
  });

  it("admits a history note's 376-word fold, which is the section the loosening was measured over", () => {
    const note = ({ blocks }: { blocks: number }): unknown => ({
      notes: [
        {
          detail: {
            blocks: Array.from({ length: blocks }, () => ({
              content: text({ value: sentenceOfWords({ count: 376 }) }),
              kind: "para" as const,
            })),
            summary: "everything",
          },
          headline: text({ value: "It landed." }),
        },
      ],
      summary: "history",
    });

    expect(refusals({ form: { ...FORM, history: [note({ blocks: 1 })] } })).toEqual([]);
    // The block cap reaches an archive note exactly as it reaches a card, so the case above is the WORDS
    // being uncapped rather than `history` being outside the fold schema altogether.
    expect(refusals({ form: { ...FORM, history: [note({ blocks: 5 })] } })).toEqual([
      "history.0.notes.0.detail.blocks: this fold carries more than 4 blocks. Depth goes DOWN a level rather " +
        "than sideways — group the tail behind a nested `fold`, which counts as one block.",
    ]);
  });

  it("caps a recent block's sentences, and leaves a folded section's headline alone", () => {
    const runOn = text({ value: Array.from({ length: 5 }, () => "It landed.").join(" ") });
    const long = text({ value: `${sentenceOfWords({ count: 40 })} ${sentenceOfWords({ count: 40 })}` });

    expect(refusals({ form: { ...FORM, recent: [{ headline: runOn }] } })).toEqual([
      "recent.0.headline: headline runs over the cap of 4 sentences above the fold. Keep the ones a reader has to " +
        "read to decide, and fold the rest.",
    ]);
    // No per-block WORD cap: the section renders folded, and a 60-word cap drafted here refused a real
    // 62-word block the shipped check passed.
    expect(refusals({ form: { ...FORM, recent: [{ headline: long }] } })).toEqual([]);
    expect(refusals({ form: { ...FORM, history: [{ notes: [{ headline: runOn }], summary: "history" }] } })).toEqual(
      [],
    );
  });

  it("admits an empty react-now block, which is a real state rather than a defect", () => {
    expect(refusals({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] } } })).toEqual([]);
  });
});
