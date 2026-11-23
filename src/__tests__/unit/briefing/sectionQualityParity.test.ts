/**
 * The two projections agree — the ONE property this pair cannot be shipped without.
 *
 * `briefing render` validates a form and then runs `briefing check` over the page it just rendered, so a
 * form the schema admits and the page's own check refuses is a verb that cannot succeed. Both halves read
 * the same rules out of `src/briefing/sectionQuality.ts`; what could still drift is what they feed it. This
 * renders one form that exercises every section and asserts the two projections produce the same sections,
 * with the same text at the same disclosure depth.
 */
import { describe, expect, it } from "vitest";
import { NO_OWNER_BELIEFS } from "../../../briefing/ownerBeliefs.js";

import { checkSectionQuality } from "../../../briefing/sectionQuality.js";
import { sectionQualityOfHtml } from "../../../briefing/sectionQualityHtml.js";
import { renderBriefing } from "../../../outbound/briefing/render.js";
import { briefingFormSchema } from "../../../outbound/briefing/schema.js";
import { sectionQualityOfForm } from "../../../outbound/briefing/sectionQuality.js";
import type { BriefingContent, BriefingForm } from "../../../outbound/briefing/types.js";

/** A one-pixel PNG, so the image block is a real one rather than a shape the schema would refuse. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** One text run, the shape most cells are. */
function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/**
 * A form carrying every section the projections read, each with prose that passes the rules.
 *
 * Deliberately not a minimal form: the parity claim is about the sections that DIFFER between the two
 * readings — a fold inside a note, the alignment line's two folds, the ranked index's marked ask — and a
 * fixture without them would assert parity over the easy half.
 */
const FORM: BriefingForm = {
  ownerBeliefs: NO_OWNER_BELIEFS,
  alignment: {
    detail: { blocks: [{ content: text({ value: "The board's own read." }), kind: "para" }], summary: "the read" },
    headline: text({ value: "2 of 3 live sessions are on the top 5." }),
    intake: text({ value: "Owner turns: 4 read across 1 session, all witnessed." }),
  },
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  awaiting: [],
  earlierToday: {
    notes: [
      {
        detail: {
          blocks: [
            { content: text({ value: "It closed at 21:10." }), kind: "para" },
            // A PASTE block, an IMAGE and a DRAFT: three block kinds whose composed words the page puts
            // somewhere a paragraph scan does not reach. a review pass built the paste case and the form
            // accepted a page its own check refused, crediting a gloss the reader could not see.
            { kind: "paste", label: "The scopes to paste", text: "one\ntwo" },
            // A NESTED fold, because its SUMMARY is the cell the two projections disagreed about — Codex's
            // r1 pass built exactly this shape too.
            {
              fold: { blocks: [{ content: text({ value: "The commands it ran." }), kind: "para" }], summary: "deeper" },
              kind: "fold",
            },
            // LAST, because a fold reads text then images.
            { alt: "The console, after the change", caption: "the console", data: PIXEL, kind: "image" },
          ],
          summary: "what it did",
        },
        headline: text({ value: "A quiet hour." }),
      },
    ],
    // TWO spaces, because the page collapses them and the form did not until a review pass built exactly
    // this: a summary reading "Rows on  the board" parsed clean and rendered refused, since the fleet
    // collocation only matches the single-spaced form.
    summary: "earlier  today, in order",
  },
  header: {
    handoff: "handoff-9012",
    lede: text({ value: "One thing needs your word." }),
    model: "opus",
    pinnedAt: "23:57",
    readyIso: "2026-09-12T01:40:00.000Z",
    refreshedIso: "2026-09-12T01:12:00.000Z",
    sleeping: false,
    workspace: "ws:598",
  },
  // The PROJECTED freshness section, because the form half once listed every section but this one: the page
  // rendered it and the reader scanned it, while the writer's projection never named it.
  freshness: { notes: [{ headline: text({ value: "Linear is late." }) }], summary: "atlas and corpus freshness" },
  history: [{ notes: [{ headline: text({ value: "The gate landed." }) }], summary: "history: 29 Aug" }],
  reactNow: {
    meFacing: [],
    openArtifacts: [
      {
        ask: text({ value: "Your read of the rewritten routing." }),
        label: "Scope split",
        landedIso: "2026-09-12T00:00:00Z",
        rank: 1,
        url: "https://example.invalid/page-1",
        validity: { mark: "valid" },
      },
    ],
    teamFacing: [
      {
        detail: {
          blocks: [{ content: text({ value: "The whole draft, as it stands." }), kind: "para" }],
          summary: "the draft in full",
        },
        ifSilent: text({ value: "The draft stays unsent." }),
        lean: text({ value: "A." }),
        options: [
          { letter: "A", text: "Send it as written." },
          { letter: "B", text: "Send it with edits." },
        ],
        premise: { kind: "composed", readIso: "2026-09-12T00:18:59Z" },
        question: "Are you happy with the draft?",
        readiness: { state: "ready" },
        what: text({ value: "The draft adds a template and a doc. It also adds a check that only reports." }),
        whyYou: text({ value: "It is a post to the team under your name." }),
      },
    ],
  },
  // A headline split across FOUR runs, two of them plain and adjacent, because the two halves read a split
  // cell differently in both directions until this landed: the page concatenates two plain runs and puts a
  // space where a tag was, so `["rea", "per"]` is one word and `["rea", strong "per"]` is two. A review
  // pass built each half in turn.
  recent: [
    {
      headline: [
        { kind: "text", text: "The render verb is " },
        { kind: "strong", text: "built" },
        { kind: "text", text: " and green. Two adjacent plain runs spell one wo" },
        { kind: "text", text: "rd." },
      ],
    },
  ],
};

/** Every section one projection found, as `name :: text`, in the order it found them. */
function shape({ scopes }: { scopes: readonly { readonly section: string; readonly text: string }[] }): string[] {
  return scopes.map((scope) => `${scope.section} :: ${scope.text}`);
}

describe("the writer's projection and the reader's projection see the same page", () => {
  const html = renderBriefing({ form: FORM });

  /**
   * What both halves must see. Pinned rather than only compared to each other: two projections that both
   * found nothing would agree perfectly, and that is the failure mode a parity assertion alone cannot see.
   */
  const EXPECTED: readonly string[] = [
    "the lede :: One thing needs your word.",
    "the ranked open-pages index :: Your read of the rewritten routing.",
    "the alignment line :: 2 of 3 live sessions are on the top 5. · owner intake — every turn the owner typed, and " +
      "whether a row holds it · the read",
    "the alignment line :: Owner turns: 4 read across 1 session, all witnessed.",
    "the alignment line :: The board's own read.",
    '"done since you last looked" :: The render verb is built and green. Two adjacent plain runs spell one ' + "word.",
    '"atlas and corpus freshness" :: atlas and corpus freshness · Linear is late.',
    '"earlier today, in order" :: earlier today, in order · A quiet hour. · what it did',
    '"earlier today, in order" :: It closed at 21:10. · The scopes to paste · The console, after the change · ' +
      "the console · deeper",
    '"earlier today, in order" :: The commands it ran.',
    '"history: 29 Aug" :: history: 29 Aug · The gate landed.',
  ];

  it("produces the same sections, in the same order, with the same text", () => {
    expect(shape({ scopes: sectionQualityOfHtml({ html }).scopes })).toEqual(EXPECTED);
    expect(shape({ scopes: sectionQualityOfForm({ form: FORM }).scopes })).toEqual(EXPECTED);
  });

  it("puts each level's enclosing text in the same place, so a gloss travels the same way in both", () => {
    expect(sectionQualityOfHtml({ html }).scopes.map((scope) => scope.ancestors)).toEqual(
      sectionQualityOfForm({ form: FORM }).scopes.map((scope) => scope.ancestors),
    );
  });

  it("reads the same asks off both", () => {
    expect(sectionQualityOfHtml({ html }).asks.map((ask) => ask.text)).toEqual(
      sectionQualityOfForm({ form: FORM }).asks.map((ask) => ask.text),
    );
  });

  it("finds no defect on either, which is what makes the render verb able to succeed at all", () => {
    expect(checkSectionQuality({ applyFraming: true, input: sectionQualityOfHtml({ html }) }).defects).toEqual([]);
    expect(checkSectionQuality({ applyFraming: true, input: sectionQualityOfForm({ form: FORM }) }).defects).toEqual(
      [],
    );
  });

  it("is a form the shipped schema accepts, so the fixture is not proving parity over an illegal page", () => {
    expect(briefingFormSchema.safeParse(FORM).success).toBe(true);
  });
});

describe("the counterexample a review pass built", () => {
  /**
   * A fleet word in a NESTED fold's summary. The writer's projection dropped every nested summary while the
   * reader collected them, so this form parsed clean and rendered to a page the same gate refused — the one
   * failure mode this pair cannot ship with.
   */
  const NESTED: BriefingForm = {
    ...FORM,
    earlierToday: {
      notes: [
        {
          detail: {
            blocks: [
              {
                fold: {
                  blocks: [{ content: text({ value: "A quiet hour." }), kind: "para" }],
                  summary: "This tick closed the chair.",
                },
                kind: "fold",
              },
            ],
            summary: "what it did",
          },
          headline: text({ value: "A quiet hour." }),
        },
      ],
      summary: "earlier today, in order",
    },
  };

  it("is refused by the form, not only by the page it would have rendered", () => {
    const parsed = briefingFormSchema.safeParse(NESTED);

    expect(parsed.success).toBe(false);
  });

  it("is refused by the page's own check for the same word", () => {
    const defects = checkSectionQuality({
      applyFraming: true,
      input: sectionQualityOfHtml({ html: renderBriefing({ form: NESTED }) }),
    }).defects;

    expect(defects.map((defect) => defect.rule)).toEqual(["fleet-jargon"]);
    expect(defects[0]!.reason).toContain('uses the fleet word "This tick"');
  });
});
