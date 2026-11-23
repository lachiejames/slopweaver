/**
 * The FORM the fleet briefing is filled into — every cap in `../../briefing/caps.ts`, enforced at the door.
 *
 * `src/briefing/check.ts` is the READER: it parses a page a session hand-wrote and reports what it broke.
 * This is the WRITER, and the difference is the point of the owner's ruling. A check refuses a
 * wall after someone composed one; a schema means the wall has no representation. Both survive, because the
 * check still has to read the hand-written pages that already exist and the pages other tools produce.
 *
 * ## The caps are IMPORTED, never restated
 *
 * Every number here comes from `../../briefing/caps.ts`, which carries the measurement each one came from.
 * Restating one as a literal is how the two halves of a gate drift into disagreeing, and this pair is
 * unusually exposed to that: `briefing render` runs `briefing check` over its own output, so a schema that
 * admitted what the check refuses would produce a verb that cannot succeed.
 *
 * ## What is deliberately NOT here
 *
 * Anything about the words. No banned terms, no em-dash rule, no packing check. Those are the operator's
 * private `profile.json` configuration plus a per-invocation break-glass, and both are things a schema
 * shipped in this repository cannot see or honour — so they sit at the door in
 * `../../cli/commands/briefing/renderRun.ts`, exactly the split `../../cli/aboveFoldDoor.ts` makes at every
 * other outbound surface.
 *
 * ## The runs, blocks and folds come from `./vocabulary.ts`
 *
 * Everything a reader meets on this page — an inline run, a paragraph, a list, an image, a draft, a
 * `<details>` fold, and the two cap combinators every cell is built from — lives there. It was split out
 * when the ranked-list page needed the same vocabulary, and it stays split after that page was folded back
 * in: what belongs there is what "above the fold" MEANS, and what stays here is the briefing's
 * own sections — a react-now card, the owner's list, the alignment line, the artifacts it sends them to.
 *
 * ## Sentences and words are counted with the CHECK's own counters
 *
 * `sentenceCount` and `wordCount` are imported from `../../briefing/text.ts` rather than reimplemented. A
 * second counter would be a second opinion about the same cap, and the whole claim of this form is that
 * what it admits is what the gate passes.
 */
import { z } from "zod";
import { ADMIN_MERGE_ADVICE, adminMergeOffer } from "../../briefing/adminMergeOffer.js";
import {
  ALIGNMENT_MAX_SENTENCES,
  ALIGNMENT_MAX_WORDS,
  AWAITING_MAX_ITEMS,
  AWAITING_MAX_SENTENCES,
  AWAITING_MAX_WORDS,
  BLOCK_MAX_SENTENCES,
  CARD_ABOVE_FOLD_MAX_WORDS,
  HISTORY_MAX_SECTIONS,
  IMAGE_TOTAL_MAX_BYTES,
  MAX_OPTIONS,
  OPEN_ARTIFACT_ASK_MAX_SENTENCES,
  OPEN_ARTIFACT_ASK_MAX_WORDS,
  OPEN_ARTIFACTS_MAX_ITEMS,
  OPTION_MAX_WORDS,
  PAGE_ABOVE_FOLD_MAX_WORDS,
  PAGE_UNFOLDED_BLOCKS_MAX,
  QUESTION_MAX_WORDS,
  REACT_NOW_MAX_CARDS,
  SHORT_FIELD_MAX_SENTENCES,
  SHORT_FIELD_MAX_WORDS,
  SUPERSEDED_BY_MAX_CHARS,
  WAITING_EVENT_MAX_SENTENCES,
  WAITING_EVENT_MAX_WORDS,
  WAITING_SESSION_MAX_CHARS,
  WHAT_MAX_SENTENCES,
  WHAT_MAX_WORDS,
  WHY_YOU_MAX_SENTENCES,
} from "../../briefing/caps.js";
import { READINESS_ADVICE, sessionStillWorking } from "../../briefing/cardReadiness.js";
import { NOWHERE_TO_GO_MESSAGE, subjectSelfLinkIssues } from "../../briefing/cardSubject.js";
import { codeRunsOfFold, commandAboveFoldRefusal, hiddenCommand } from "../../briefing/commandAboveFold.js";
import {
  DOCTRINE_SETTLED_ADVICE,
  doctrineSettled,
  MECHANISM_ADVICE,
  mechanismFramed,
  missingWarrant,
  WARRANT_ADVICE,
} from "../../briefing/doctrineSettled.js";
import { FLEET_JARGON_ADVICE, ungloss } from "../../briefing/fleetJargon.js";
import { markdownSubjectIssues } from "../../briefing/markdownSubject.js";
import { SENT_ELSEWHERE_ADVICE, sentElsewhere } from "../../briefing/optionPickability.js";
import { OWN_HAND_ADVICE, ownHandAction } from "../../briefing/ownHandAction.js";
import { misroutedReplyChannel, REPLY_CHANNEL_ADVICE } from "../../briefing/replyChannel.js";
import { sentenceCount, wordCount } from "../../briefing/text.js";
import { strictForm } from "../strictForm.js";
import { cardAboveFoldProse, cardAboveFoldReadable, cardAboveFoldWords } from "./aboveFoldText.js";
import { autonomySchema } from "./autonomySchema.js";
import { handStepsSchema } from "./handStepsSchema.js";
import { ownerBeliefsSchema } from "./ownerBeliefsSchema.js";
import { pageAboveFoldRefusal, pageAboveFoldRegions } from "./pageAboveFold.js";
import { quizSchema } from "./quizSchema.js";
import { anchorsOfForm, anchorTargetsOfForm, pageImageBytes, sectionIdsOfForm } from "./schemaWalk.js";
import { sectionQualityIssues } from "./sectionQuality.js";
import { projectedSectionFields, sectionSchema } from "./sectionSchema.js";
import { subjectSchema } from "./subjectForm.js";
import type { BriefingCard, BriefingContent } from "./types.js";
import { cappedContent, cappedSentences, contentSchema, foldSchema, proseLine, textOfContent } from "./vocabulary.js";
import { yourListSchema } from "./yourListSchema.js";

/**
 * Every option letter a card may offer, in order, so `MAX_OPTIONS` and the alphabet cannot disagree.
 *
 * @internal — read by this file's own refusal messages; no caller outside the form names it.
 */
export const OPTION_LETTERS: readonly string[] = ["A", "B", "C", "D", "E", "F"].slice(0, MAX_OPTIONS);

/** The `what` cell: at least two sentences of background, and never more than the cap allows. */
const whatSchema = cappedSentences({
  field: "what",
  schema: cappedContent({ field: "what", words: WHAT_MAX_WORDS }),
  sentences: WHAT_MAX_SENTENCES,
}).refine((content) => sentenceCount({ text: textOfContent({ content }) }) >= 2, {
  message: "what carries fewer than two sentences of background.",
});

/** A short cell: one claim, at most the short-field caps. */
function shortField({ field, sentences }: { field: string; sentences: number }): z.ZodType<BriefingContent> {
  return cappedSentences({
    field,
    schema: cappedContent({ field, words: SHORT_FIELD_MAX_WORDS }),
    sentences,
  });
}

/**
 * The `if silent` cell: a short field that may not route the owner anywhere but the supervisor chat.
 *
 * It describes what happens when the owner says nothing, so a channel word in it is the same misrouting an option
 * carries — "if you don't react by morning" tells them to react, inside the sentence about not answering.
 */
const ifSilentSchema = shortField({ field: "ifSilent", sentences: SHORT_FIELD_MAX_SENTENCES }).refine(
  (content) => misroutedReplyChannel({ text: textOfContent({ content }) }) === undefined,
  {
    message: `\`if silent\` routes the owner somewhere other than the supervisor chat. ${REPLY_CHANNEL_ADVICE}`,
  },
);

const optionSchema = strictForm({
  letter: z.string().refine((letter) => OPTION_LETTERS.includes(letter), {
    message: `an option's letter must be one of ${OPTION_LETTERS.join(", ")}.`,
  }),
  text: proseLine
    .refine((text) => /[.!?]$/.test(text), {
      message: "an option must be a full sentence ending in terminal punctuation.",
    })
    .refine((text) => sentenceCount({ text }) === 1, { message: "an option is one sentence. Split it, or fold it." })
    .refine((text) => wordCount({ text }) <= OPTION_MAX_WORDS, {
      message: `an option runs over the cap of ${String(OPTION_MAX_WORDS)} words.`,
    })
    .refine((text) => misroutedReplyChannel({ text }) === undefined, {
      message: `an option routes the owner somewhere other than the supervisor chat. ${REPLY_CHANNEL_ADVICE}`,
    })
    // PICKABLE WHERE IT SITS. An option that makes the owner go and read
    // something before they can choose is not a choice. Option-local, so the form catches it before bytes
    // exist; the scope-changing half needs the card's premise and lives in the rendered check. See
    // `../../briefing/optionPickability.ts` for the criterion and the house habit it retires.
    .refine((text) => sentElsewhere({ text }) === undefined, {
      message: `an option sends the owner somewhere else to decide. ${SENT_ELSEWHERE_ADVICE}`,
    }),
});

/**
 * The options list: lettered from A with no gaps, so a card can never offer `A` and `C`.
 *
 * The gate reads the letters out of the rendered text and would happily accept a gap; a form can refuse it,
 * which is the extra a typed pre-image buys over a reader.
 */
const optionsSchema = z
  .array(optionSchema)
  .min(1)
  .max(MAX_OPTIONS)
  .refine((options) => options.every((option, index) => option.letter === OPTION_LETTERS[index]), {
    message: `options must be lettered from A with no gaps: ${OPTION_LETTERS.join(", ")}.`,
  });

/**
 * Whether the card is the owner's to answer now, or waits on a session that has not finished.
 *
 * A discriminated union rather than a flag with two optional companions, for the reason
 * {@link BriefingCardReadiness} states: a `waiting` card that named neither the session nor the event would
 * be a card announcing it is not answerable and giving the owner nothing to do about it.
 *
 * `.default({ state: "ready" })` is the second field on this form to carry one, and it is the same call
 * `openArtifacts` made for the same reason — a supervisor mid-sweep on a `form.json` written before this
 * field existed would otherwise have its live page refused, and a gate that stops the briefing rendering has
 * taken the page away rather than improved it. The default is safe here in a way it would not be if it stood
 * alone: `ready` is a CLAIM, and the refine below refuses a card whose own `what` contradicts it.
 */
const readinessSchema = z
  .discriminatedUnion("state", [
    strictForm({ state: z.literal("ready") }),
    strictForm({
      event: proseLine
        .refine((text) => wordCount({ text }) <= WAITING_EVENT_MAX_WORDS, {
          message: `a waiting card's \`event\` runs over the cap of ${String(WAITING_EVENT_MAX_WORDS)} words.`,
        })
        .refine((text) => sentenceCount({ text }) <= WAITING_EVENT_MAX_SENTENCES, {
          message:
            "a waiting card's `event` names the one moment the wait ends, in one sentence. The `what` " +
            "carries the work.",
        }),
      session: z.string().min(1).max(WAITING_SESSION_MAX_CHARS),
      state: z.literal("waiting"),
    }),
  ])
  .default({ state: "ready" });

/**
 * An instant a card's premise names.
 *
 * Its own declaration rather than the eyebrow's `instant`, which is defined further down this file and whose
 * refusal message names the eyebrow. Same criterion, different sentence: a composer reading "an eyebrow
 * instant" while fixing a card's premise is a composer sent to the wrong field.
 */
const premiseIso = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "a premise instant must be ISO-8601, as in `2026-09-11T21:18:59Z`.",
  });

/**
 * WHERE the card's premise was read, and when — one arm per source.
 *
 * Required rather than defaulted, unlike `readiness` and `openArtifacts` above. There is no safe default for
 * an instant: `now` would make every stale card claim to be fresh, which is the exact failure a stale premise
 * causes, and the migration cost is one field per card. See `./types.ts`'s {@link BriefingCardPremise} for why it is three arms rather than one instant.
 */
const premiseSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("artifact"), landedIso: premiseIso, updatedIso: premiseIso.optional() }),
  strictForm({ kind: z.literal("pull-request"), observedIso: premiseIso }),
  strictForm({ kind: z.literal("composed"), readIso: premiseIso }),
]);

const cardSchema = strictForm({
  detail: foldSchema.optional(),
  ifSilent: ifSilentSchema,
  lean: shortField({ field: "lean", sentences: SHORT_FIELD_MAX_SENTENCES }),
  options: optionsSchema,
  // No separate ellipsis refine here: a question's own mandatory `?` terminal already forces the same
  // refusal path — a run cut with an ellipsis instead of finishing the sentence fails "ends in `?`" on its
  // own, so a second check here would refuse nothing the first does not already catch.
  question: z
    .string()
    .min(1)
    .refine((text) => text.endsWith("?") && sentenceCount({ text }) === 1, {
      message: "a question is exactly one sentence, phrased as a question ending in `?`.",
    })
    .refine((text) => wordCount({ text }) <= QUESTION_MAX_WORDS, {
      message: `a question runs over the cap of ${String(QUESTION_MAX_WORDS)} words.`,
    }),
  premise: premiseSchema,
  readiness: readinessSchema,
  subject: subjectSchema.optional(),
  what: whatSchema,
  whyYou: shortField({ field: "whyYou", sentences: WHY_YOU_MAX_SENTENCES }),
});

const cardBudgeted = cardSchema
  .refine((card) => cardAboveFoldWords({ card }) <= CARD_ABOVE_FOLD_MAX_WORDS, {
    message:
      `the whole card runs over the cap of ${String(CARD_ABOVE_FOLD_MAX_WORDS)} words above the fold. ` +
      "Every field is short enough on its own and the card still is not. Fold something.",
  })
  // SOMEWHERE TO GO. Both `detail` and `subject` are optional on their own, so a card could offer neither and
  // ask the owner to decide from four capped cells alone, which cannot carry enough to answer a question
  // or say where to find the detail. Deliberately satisfied by EITHER, because a card whose subject links the pull request
  // has already answered "where would I go" and a mandatory fold on top of it is the ceremony rule 7 exists
  // to remove. That is also why this is not `detail`-required: an auto-generated open-pull-request card
  // carries its subject and needs no invented fold. A url-LESS subject is not one of those: `no page` names
  // the absence of a page, which is the opposite of somewhere to go, so such a card owes a `detail`.
  .refine((card) => card.detail !== undefined || card.subject?.url !== undefined, {
    message: NOWHERE_TO_GO_MESSAGE,
  })
  // READY IS A CLAIM the card's own words can contradict. A card sat at the top
  // of the block whose `what` said a session was still adopting and rewriting, above cards the owner could have
  // answered. Declaring `ready` is what puts a card above the waiting ones, so a `what` describing work still
  // in flight is the composer asserting two incompatible things at once — see
  // `../../briefing/cardReadiness.ts` for the criterion and why it is narrow rather than over-broad.
  .refine(
    (card) =>
      card.readiness.state === "waiting" ||
      sessionStillWorking({ text: textOfContent({ content: card.what }) }) === undefined,
    {
      message: `\`what\` says a session is still working while the card declares itself ready. ${READINESS_ADVICE}`,
      path: ["what"],
    },
  )
  // PLAIN WORDS BEFORE THE ASK. A card defines its terms: a fleet word may sit above the fold only where the card has already said what it
  // means, above the fold. MEASURED on the seven me-facing cards that cost the ruling — SIX of them used one
  // without glossing it. The refusal is UNGLOSSED, never the word itself, because the owner uses almost all of these
  // words too; `../../briefing/fleetJargon.ts` carries that measurement and every collocation.
  .superRefine((card, context) => {
    const found = ungloss({ aboveFold: cardAboveFoldProse({ card }) });
    if (found !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          `the card uses the fleet word "${found.used}" above the fold and never says what it means — ` +
          `"${found.term}" here is ${found.plainly}. ${FLEET_JARGON_ADVICE}`,
        path: ["what"],
      });
    }
  })
  // A CARD ONLY WHERE THE SUPERVISOR CANNOT DECIDE. The hard half: a question asking PERMISSION for an act
  // doctrine already authorises is refused with the rule named, because the owner cannot see why it is a
  // question. See
  // `../../briefing/doctrineSettled.ts` for the registry and for why the second half below is only a floor.
  .superRefine((card, context) => {
    const settled = doctrineSettled({ question: card.question });
    if (settled !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          `the question asks permission for ${settled.act}, which is already settled by ${settled.settledBy}. ` +
          DOCTRINE_SETTLED_ADVICE,
        path: ["question"],
      });
    }
  })
  // THE MECHANISM IS NOT THE OWNER'S TO PICK. A card that asks them to choose between implementations asks
  // about how it works internally, when they care about the outcome. The fact only
  // the owner holds is their CRITERION, such as how long an outage window is acceptable, and the card
  // should ask for that.
  .superRefine((card, context) => {
    const framed = mechanismFramed({ question: card.question });
    if (framed !== undefined) {
      context.addIssue({
        code: "custom",
        message: `the question asks the owner to choose between implementations, with "${framed}". ${MECHANISM_ADVICE}`,
        path: ["question"],
      });
    }
  })
  // The floor, and it is stated as one: `why you` must name a conflict between the owner's standing rules or a fact
  // only the owner holds. Six of the seven cards this rule was built from already cleared it, so it catches a
  // composer who forgot to say why and never one who said it untruthfully.
  .refine((card) => !missingWarrant({ whyYou: textOfContent({ content: card.whyYou }) }), {
    message: `\`why you\` names no reason the decision is the owner's. ${WARRANT_ADVICE}`,
    path: ["whyYou"],
  })
  // NEVER AN ADMIN MERGE. On BOTH groupings, unlike the own-hand rule below: a team-facing card offering one
  // is the same unanswerable choice, and the card that prompted the rule offered it as option B.
  // See `../../briefing/adminMergeOffer.ts` for the criterion, the measurement and why `what` is out of scope.
  .superRefine((card, context) => {
    const cells: readonly { readonly text: string; readonly path: readonly (string | number)[] }[] = [
      { path: ["lean"], text: textOfContent({ content: card.lean }) },
      { path: ["ifSilent"], text: textOfContent({ content: card.ifSilent }) },
      ...card.options.map((option, index) => ({ path: ["options", index, "text"], text: option.text })),
    ];
    for (const cell of cells) {
      const offer = adminMergeOffer({ text: cell.text });
      if (offer !== undefined) {
        context.addIssue({
          code: "custom",
          message: `\`${String(cell.path[0])}\` offers an administrator merge with "${offer}". ${ADMIN_MERGE_ADVICE}`,
          path: [...cell.path],
        });
      }
    }
  });

/**
 * A me-facing card, which additionally may not put an action in the owner's own hands, and may not hide a command
 * the owner has to type behind its own fold.
 *
 * Both extra rules live on this grouping alone because that is the scope the owner's ruling named and
 * where the two cards that prompted the correction sat — see `../../briefing/ownHandAction.ts` for the
 * criterion, the trade it takes and the shape a refused cell is reworded into, and
 * `../../briefing/commandAboveFold.ts` for the second rule's own measurement.
 */
const meFacingCard = cardBudgeted
  // A COMMAND IS NEVER ONLY BEHIND A CLICK. A card once put its two commands in
  // `detail` and the owner could not find either — see `../../briefing/commandAboveFold.ts` for why the criterion
  // reads `code` runs rather than prose, and what the prose version measured.
  .superRefine((card, context) => {
    if (card.detail === undefined) {
      return;
    }
    const hidden = hiddenCommand({
      aboveFold: cardAboveFoldReadable({ card }),
      commands: codeRunsOfFold({ fold: card.detail }),
    });
    if (hidden !== undefined) {
      context.addIssue({
        code: "custom",
        message: commandAboveFoldRefusal({ command: hidden }),
        path: ["detail"],
      });
    }
  })
  .superRefine((card, context) => {
    const inWhat = ownHandAction({ imperative: false, text: textOfContent({ content: card.what }) });
    if (inWhat !== undefined) {
      context.addIssue({
        code: "custom",
        message: `\`what\` puts an action in the owner's own hands with "${inWhat}". ${OWN_HAND_ADVICE}`,
        path: ["what"],
      });
    }
    card.options.forEach((option, index) => {
      const inOption = ownHandAction({ imperative: true, text: option.text });
      if (inOption !== undefined) {
        context.addIssue({
          code: "custom",
          message: `an option puts an action in the owner's own hands with "${inOption}". ${OWN_HAND_ADVICE}`,
          path: ["options", index, "text"],
        });
      }
    });
  });

/** Every question a card in one grouping asks, for the no-card-in-both-groupings refusal. */
function questionsOf({ cards }: { cards: readonly BriefingCard[] }): readonly string[] {
  return cards.map((card) => card.question);
}

/**
 * An instant a section states: ISO-8601, and one a `Date` actually parses.
 *
 * The second half is not ceremony over the first. `./stamp.ts` is deliberately not total on a bad input — it
 * throws out of `Intl` rather than degrading to a plausible-looking string — so this is what guarantees the
 * value parsed before a renderer ever sees it.
 *
 * Shared by the eyebrow's two freshness fields and by an open artifact's `landedIso`, because they are the
 * same claim: a time a reader will act on, stamped by the renderer rather than typed by a composer.
 */
const instant = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "an eyebrow instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-02T09:07:42Z`.",
  });

/**
 * One artifact's validity mark: `valid`, `partly-ruled` with its provenance, or `superseded` naming where the
 * live version went.
 *
 * The discriminated union is the mechanism, not decoration. A flat `{ mark, ruledIso?, by? }` would admit a
 * `superseded` entry naming nothing and a `partly-ruled` entry asserting a ruling with no date — a mark whose
 * provenance is optional is a mark a composer can write, which is the one thing
 * `./types.ts`'s {@link BriefingArtifactValidity} says this field may never be.
 */
const validitySchema = z.discriminatedUnion("mark", [
  strictForm({ mark: z.literal("valid") }),
  strictForm({
    mark: z.literal("partly-ruled"),
    outcome: z.string().min(1).max(40),
    ruledIso: instant,
  }),
  strictForm({
    by: z.string().min(1).max(SUPERSEDED_BY_MAX_CHARS),
    byUrl: z.url().optional(),
    mark: z.literal("superseded"),
  }),
]);

/**
 * One line of the ranked open-artifact index: rank, link, the session's one-sentence ask, when it landed, and
 * the derived validity mark.
 *
 * `ask` is capped exactly as an artifact's `waitingOn` is — one claim, one breath — because it is the same
 * kind of cell. `landedIso` is an {@link instant} rather than the free `since` string the standing band
 * carries: this band exists to answer "which of these came last", and a clock reading a composer writes
 * cannot be checked.
 *
 * @internal — exported for `../../briefing/openPageRow.ts`, which holds ONE row to this same schema before
 * `briefing card` writes it, so a row the render would refuse is never written.
 */
export const openArtifactSchema = strictForm({
  ask: cappedSentences({
    field: "an open artifact's `ask`",
    schema: cappedContent({ field: "an open artifact's `ask`", words: OPEN_ARTIFACT_ASK_MAX_WORDS }),
    sentences: OPEN_ARTIFACT_ASK_MAX_SENTENCES,
  }),
  label: z.string().min(1).max(120),
  landedIso: instant,
  rank: z.number().int().min(1),
  url: z.url(),
  validity: validitySchema,
});

/**
 * The react-now block: the two groupings, capped TOGETHER, with no card in both.
 *
 * ## The count is over the block, not over either half
 *
 * `REACT_NOW_MAX_CARDS` bounds what the owner scrolls, and they scroll one block. Capping each grouping separately
 * would admit twice the block the owner sized, which is the arithmetic the page budget already refuses to
 * make anywhere else.
 *
 * ## Why a duplicate question is a refusal rather than a tidy-up
 *
 * The grouping is the card's AUDIENCE — see {@link BriefingReactNow}. A card in both groupings claims both
 * that a colleague is on the other end of it and that nobody but the owner sees it, which is not a presentation
 * problem to dedupe silently; it is a composer who has not decided, and the answer the owner would give to one copy
 * would be wrong for the other.
 */
const reactNowSchema = strictForm({
  meFacing: z.array(meFacingCard),
  // The ranked index of every open artifact awaiting the owner's reaction. Bounded by its OWN cap rather than by
  // `AWAITING_MAX_ITEMS`, which governs the unranked pointer band alone:
  // a cap of three over fifteen open pages hid twelve of them. `../../briefing/caps.ts` carries the measurement.
  //
  // `.default([])` rather than required, and this is the ONE field on the block that gets one. A supervisor
  // is mid-sweep on a form.json written before this field existed, and a required field would have refused
  // the owner's live page at the next tick — a gate that stops the briefing rendering is a gate that took the page
  // away rather than improved it. The default is an EMPTY index, which renders nothing and claims nothing;
  // it is not a stand-in for a real one, and the composer contract in `skills/supervisor` is what fills it.
  openArtifacts: z
    .array(openArtifactSchema)
    .max(OPEN_ARTIFACTS_MAX_ITEMS)
    .refine((rows) => rows.every((row, index) => row.rank === index + 1), {
      message:
        "the open-artifact index must be ranked from 1 with no gaps — it is a projection of an ordered " +
        "list, and a page showing ranks 1, 2 and 4 is showing a list nobody ranked.",
    })
    .refine((rows) => new Set(rows.map((row) => row.url)).size === rows.length, {
      message:
        "two lines of the open-artifact index point at the same page, so its rank is asking the owner to open " +
        "one thing twice. Rank it once.",
    })
    .default([]),
  teamFacing: z.array(cardBudgeted),
})
  .refine((block) => block.teamFacing.length + block.meFacing.length <= REACT_NOW_MAX_CARDS, {
    message:
      `react now carries more than ${String(REACT_NOW_MAX_CARDS)} cards across both groupings. ` +
      "A block that long has stopped being a list of things to react to — land some of it, or fold it away.",
  })
  .refine(
    (block) => {
      const team = new Set(questionsOf({ cards: block.teamFacing }));
      return questionsOf({ cards: block.meFacing }).every((question) => !team.has(question));
    },
    {
      message:
        "the same question appears in both react-now groupings, so the card claims both that a colleague is " +
        "on the other end of it and that nobody but you sees it. Pick one.",
    },
  );

/**
 * A recent block: the same per-paragraph sentence cap every other paragraph on the page carries, and NO word
 * cap of its own.
 *
 * It no longer says "above the fold": `./render.ts` folds
 * the whole section behind a `<details>`, because the react-now section is the one the owner mainly reads.
 * The cap did not move with it — a note's headline is the line the owner reads on opening the fold, which is where
 * the sentence cap earns its place — but the reason for it did, and `../../briefing/sectionQuality.ts` is
 * what now reads these notes for the card gate's vocabulary rule.
 *
 * A 60-word cap was drafted here, borrowed from {@link WHAT_MAX_WORDS}. It was wrong twice over. The gate
 * over the rendered page holds no per-block word cap at all — only {@link BLOCK_MAX_SENTENCES} per
 * paragraph and {@link PAGE_ABOVE_FOLD_MAX_WORDS} for the page — so the cap was a second opinion about
 * something already decided. And measured against a real page it refused: that block ran
 * to 62 words, two over, while `briefing check` passed the file. The page total no longer bounds it either:
 * the section renders folded, so `./pageAboveFold.ts` charges it nothing, and what bounds it is
 * {@link PAGE_UNFOLDED_BLOCKS_MAX} notes of at most {@link BLOCK_MAX_SENTENCES} sentences each.
 */
const recentNoteSchema = strictForm({
  detail: foldSchema.optional(),
  headline: cappedSentences({ field: "headline", schema: contentSchema, sentences: BLOCK_MAX_SENTENCES }),
});

/**
 * One artifact the page sends the owner to, and what is waiting for them there.
 *
 * `waitingOn` is capped like a card's `why you`, because that is what it is: one claim, one breath, saying
 * why this link is on the owner's page at all. A link with a paragraph beside it is this page re-briefing them about a
 * decision that lives on another one.
 */
const artifactLinkSchema = strictForm({
  label: z.string().min(1).max(120),
  pending: z.boolean(),
  since: z.string().min(1).max(80).optional(),
  url: z.url(),
  waitingOn: cappedSentences({
    field: "an artifact's `waitingOn`",
    schema: cappedContent({ field: "an artifact's `waitingOn`", words: AWAITING_MAX_WORDS }),
    sentences: AWAITING_MAX_SENTENCES,
  }),
});

/**
 * The alignment line. REQUIRED, which is the whole mechanism — a briefing that does not state what the fleet
 * is working against what the board says is urgent cannot be rendered at all.
 *
 * `intake` is required for that same reason and capped by NOTHING, which is not an oversight: `./render.ts`
 * puts it inside a fold of its own, and a fold is uncapped everywhere else on this page too. It is the other
 * half of `slopweaver handover reconcile --json` — see `./types.ts`'s `BriefingAlignment` for the 94-words-against-55
 * measurement that split it out of `headline`. `contentSchema` rather than `foldContentSchema`, because the
 * sentence is generated rather than composed and there is nobody to instruct about a bare-key link in it.
 */
const alignmentSchema = strictForm({
  detail: foldSchema.optional(),
  headline: cappedSentences({
    field: "alignment headline",
    schema: cappedContent({ field: "alignment headline", words: ALIGNMENT_MAX_WORDS }),
    sentences: ALIGNMENT_MAX_SENTENCES,
  }),
  intake: contentSchema,
});

const headerSchema = strictForm({
  handoff: z.string().min(1).max(40),
  // The lede's WORD cap — the one length the section rules move — lives in
  // `../../briefing/sectionQuality.ts`, so the reader enforces the same number with the same message, and
  // reaches this form through the refinement at the bottom of this file. A `cappedContent` here as well
  // would report one over-long lede twice.
  lede: cappedSentences({ field: "lede", schema: contentSchema, sentences: BLOCK_MAX_SENTENCES }),
  model: z.string().min(1).max(40),
  pinnedAt: z.string().min(1).max(40),
  readyIso: instant,
  refreshedIso: instant,
  sleeping: z.boolean(),
  // Declared because the verb INJECTS it (`../../cli/commands/briefing/renderCore.ts`'s `injectStamps`) and
  // this form is strict, so an undeclared field would make the injection refuse itself. Deliberately absent
  // from `../../briefing/sweepBlock.ts`'s `HEADER_KEYS` for the same reason the two instants are: a form
  // that could write its own staleness verdict is the composer-written freshness claim this page's whole
  // eyebrow exists to prevent.
  staleSnapshots: z.array(strictForm({ ageMs: z.number().nonnegative(), label: z.string().min(1).max(40) })).optional(),
  workspace: z.string().min(1).max(40),
});

/**
 * The whole fleet-briefing form.
 *
 * `reactNow`'s two groupings may BOTH be empty, which the shape reference calls a real, intentional state —
 * the block still renders, saying nothing is open above the line. `history` may be empty on a run's first
 * page.
 *
 * This is the SHAPE alone: every field and every field's own cap, and none of the whole-page rules below it.
 * Exported for one reader, `briefing render`'s refusal, which renders a form this shape accepts and the page
 * rules refuse so the refused page exists on disk to be read — pass 670 lost forty minutes to a whole-page
 * refusal that wrote nothing. Nothing may PUBLISH through it; {@link briefingFormSchema} is the gate.
 */
export const briefingFormShape = strictForm({
  alignment: alignmentSchema,
  // What the fleet did for the owner under graduated autonomy. `.default` for the reason
  // `reactNow.openArtifacts` has one: a supervisor mid-sweep on a `form.json` written before this field
  // existed must still be able to render, and a gate that stops the briefing rendering is a gate that took
  // the page away. The default is an EMPTY section, which renders nothing and claims nothing; what fills it
  // is `briefing render --autonomy-ledger`.
  autonomy: autonomySchema.default({ notShown: 0, rows: [] }),
  // Every step waiting on the owner's own hands, with the command to paste. `.default` for the reason `autonomy`
  // one line above has one: a supervisor mid-sweep on a `form.json` written before this field existed must
  // still be able to render, and a gate that stops the briefing rendering is a gate that took the page
  // away. The default is an EMPTY section, which renders nothing and claims nothing; what fills it is
  // `briefing render --hand-steps`.
  handSteps: handStepsSchema.default({ notShown: 0, rows: [], unreadable: 0 }),
  // The proposed beliefs waiting on the owner's mark. `.default` for the reason `reactNow.openArtifacts` has one: a
  // supervisor mid-sweep on a `form.json` written before this field existed must still be able to render, and
  // a gate that stops the briefing rendering is a gate that took the page away. The default is an EMPTY
  // block, which renders nothing and claims nothing; what fills it is `briefing render --owner-beliefs`.
  ownerBeliefs: ownerBeliefsSchema.default({ notShown: 0, rows: [] }),
  // The one question this sweep asks. OPTIONAL rather than defaulted, unlike `ownerBeliefs` above: an
  // empty correction block is a shape the projection can express, while "no question this sweep" has no
  // row shape at all. What fills it is `briefing render --knowledge-quiz --sweep <tick-id>`.
  quiz: quizSchema.optional(),
  // Every other artifact holding something of the owner's. Capped at `AWAITING_MAX_ITEMS` because this is the section
  // that turns a one-index page into a link farm — every surface that ever wants the owner's attention would add
  // itself here if nothing refused the fourth one.
  awaiting: z.array(artifactLinkSchema).max(AWAITING_MAX_ITEMS),
  earlierToday: sectionSchema.optional(),
  // Projected by `briefing render --freshness` and `--nothing-stale`, never authored — see
  // `BriefingForm.freshness` and `BriefingForm.nothingStale`, and `./sectionSchema.ts` for why they are accepted.
  ...projectedSectionFields,
  header: headerSchema,
  history: z.array(sectionSchema).max(HISTORY_MAX_SECTIONS, {
    message:
      `the page carries at most ${String(HISTORY_MAX_SECTIONS)} history sections. Run ` +
      "`slopweaver briefing archive --form <path>` to move the oldest sections into a dated archive file.",
  }),
  reactNow: reactNowSchema,
  // The recent blocks ARE the page's unfolded blocks outside the cards, so this is
  // `PAGE_UNFOLDED_BLOCKS_MAX` rather than a second number about the same thing. A tighter cap was drafted
  // at two, which a real page exceeded within the hour, so the form
  // would have refused the owner's own page while `briefing check` passed it. That is the two halves of one
  // gate disagreeing, which is the failure this form exists to make impossible.
  recent: z.array(recentNoteSchema).max(PAGE_UNFOLDED_BLOCKS_MAX),
  yourList: yourListSchema.optional(),
});

/**
 * The whole fleet-briefing form: {@link briefingFormShape} and every rule that reads the whole page at once.
 */
export const briefingFormSchema = briefingFormShape
  .refine(
    (form) => {
      const targets = anchorTargetsOfForm({ form });
      return anchorsOfForm({ form }).every((run) => run.kind === "anchor" && targets.has(run.target));
    },
    {
      message:
        "an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    },
  )
  .refine((form) => new Set(sectionIdsOfForm({ form })).size === sectionIdsOfForm({ form }).length, {
    message: "two collapsed sections on this page carry the same `id`, so an anchor into either is ambiguous.",
  })
  // NEVER A LINK BACK TO THIS PAGE. A card whose subject links the page the owner is already
  // reading has no point. A `superRefine` so every offending card is reported at its
  // own path in one parse. The criterion, what it deliberately does not catch, and the walk that finds them
  // all live in `../../briefing/cardSubject.ts`.
  .superRefine((form, context) => {
    const { meFacing, teamFacing } = form.reactNow;
    for (const issue of subjectSelfLinkIssues({ meFacing, teamFacing })) {
      context.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    }
  })
  // NEVER A MARKDOWN DOCUMENT. A finding card whose subject is the finding's own handover doc puts a
  // markdown file in front of the owner, which is not easy to react to. A finding reaches them as a rendered page or not at all — criterion, words and
  // the walk are `../../briefing/markdownSubject.ts`; every offender at its own path in one parse.
  .superRefine((form, context) => {
    const { meFacing, teamFacing } = form.reactNow;
    for (const issue of markdownSubjectIssues({ meFacing, teamFacing })) {
      context.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    }
  })
  .superRefine((form, context) => {
    const regions = pageAboveFoldRegions({ form });
    if (regions.reduce((total, one) => total + one.words, 0) > PAGE_ABOVE_FOLD_MAX_WORDS) {
      context.addIssue({ code: "custom", message: pageAboveFoldRefusal({ regions }) });
    }
  })
  // EVERY SECTION READS THE WAY A CARD DOES, because the card gate's way of writing is much easier to
  // read. The rules, their disclosure scope and the measurement that sized them are in
  // `../../briefing/sectionQuality.ts`, and this form's projection into them is `./sectionQuality.ts`.
  // `applyFraming` is true here because a FORM is what a composer writes — the break-glass is the READER's.
  .superRefine((form, context) => {
    for (const issue of sectionQualityIssues({ form })) {
      context.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    }
  })
  .refine((form) => pageImageBytes({ form }) <= IMAGE_TOTAL_MAX_BYTES, {
    message:
      `the page embeds over the cap of ${String(IMAGE_TOTAL_MAX_BYTES)} bytes of image data, summed across ` +
      "every image. Drop one, or resize the largest.",
  });
