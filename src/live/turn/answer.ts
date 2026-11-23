/**
 * The turn's NOTICE content, pure: the checklist frames, the shared notice primitives, and the held form.
 *
 * Nothing here posts, reads a clock, or touches the corpus. Given the same inputs this file emits the same
 * bytes forever, which is what makes a frame assertable to the character and what lets the turn's ordering
 * be tested with no network at all.
 *
 * The turn's SUCCESS reply no longer lives here — `../../outbound/assistant/answerMessage.ts`'s
 * `renderAssistantAnswer` builds it directly from a parsed `AnswerFormAnswer`, with its own evidence trail.
 * This module keeps the notice a turn posts when its answer was held for review, plus the primitives every
 * notice is built from. The other two notices each moved to a sibling when this file outgrew its size floor,
 * and each imports this module's primitives rather than the other way round: the one a turn posts when it
 * broke or its answer was refused lives in `./failureForm.ts`, and the one a turn posts when a step is
 * BLOCKED ON THE OWNER lives in `./blockedForm.ts`. Every notice still goes through
 * `../../outbound/assistant/answerMessage.ts`'s `renderAssistantMessage` (the `UpdateArtifact` renderer),
 * because a notice is a report about the turn, never the routed content `renderAssistantAnswer` exists for.
 *
 * ## Why every shortening is REPORTED
 *
 * `updateArtifactSchema` refuses an over-long field rather than trimming it, so a notice that fills a form
 * past a cap does not post a slightly-too-long card — it posts nothing. The obvious fix is to clamp, and
 * the obvious clamp is silent, which would make a turn's notice quietly lossy in exactly the way this
 * repo's silent-failure ledger keeps recording. So {@link clampVisible} is used explicitly at every field
 * that can overflow, and every shortening is named in the notice's own bullets.
 *
 * ## Why the quoted question goes through `./quotedQuestion.ts` first
 *
 * Every notice built on these primitives QUOTES the asker's own words into the plain-string `tldr`, and
 * `updateArtifactSchema` refuses raw Slack markup in a plain string — so a question carrying `<@U0SYN000002>`
 * made the card unpostable, and the bot could not answer BECAUSE of markup in the message it was answering.
 * Each `tldr` therefore runs the question through `questionForPlainField` BEFORE {@link clampVisible} measures it; that
 * ordering is the rule, not a detail, and the reason is beside each call.
 */
import {
  BULLET_ITEM_VISIBLE_MAX,
  BULLETS_MAX_ITEMS,
  PARAGRAPH_VISIBLE_MAX,
  TLDR_VISIBLE_MAX,
} from "../../outbound/artifact/schema.js";
import type { BulletsDetail, InlineRun, ParagraphDetail, UpdateArtifact } from "../../outbound/artifact/types.js";
import type { TodoState, TodoStep } from "../../outbound/assistant/todoBlock.js";
import { questionForPlainField } from "./quotedQuestion.js";
import { tagSafeCut } from "./taskLabel.js";
import type { ExecutionTier } from "./tier.js";

/** The marker appended to any text this module shortened. */
export const CLAMP_MARKER = "…";

/**
 * How many characters of any one card line are shown.
 *
 * Lives here rather than in `./progressCard.js` (which otherwise owns it) so `./run.js` can reach it too:
 * both import this file and it imports neither back, so a constant shared through this leaf can never
 * turn into an import cycle — the same reason `strippedAddressing`, which they also share, lives in the
 * leaf `./taskLabel.js` rather than in `run.js`.
 */
export const CARD_LINE_CAP = 120;

/**
 * A run of 10+ identical non-alphanumeric characters — a box-drawing or dash divider (`─────…`, `======…`)
 * that Slack wraps unpredictably once it crosses a line. Measured live: a fresh-visible-session's
 * own screen text carried one of these into a progress card's `now:` line and overflowed it across the whole
 * width of the channel — see {@link ./liveStatus.ts}'s own header for why that scrape has no fixed grammar to
 * filter on before the text reaches this seam.
 */
const DIVIDER_RUN = /([^\p{L}\p{N}\s])\1{9,}/gu;

/**
 * An internal cmux workspace name for an ask or review session (`ask-<channel>-<ts>`, `review-<channel>-<ts>`,
 * from `../../cmux/plan.ts`'s `workspaceName`) — operator plumbing that must never render into a card a Slack
 * user reads, exactly like the divider run above.
 */
const SESSION_KEY = /\b(?:ask|review)-\S+-\d+\.\d+\b/g;

/**
 * Strip operator-only plumbing out of text on its way into a card field — a long divider run or an internal
 * ask/review session key — collapsing whatever whitespace or dangling connector the removal leaves behind.
 * Pure.
 *
 * @param text raw text bound for a card field, from a corpus quote, a worker's self-report or a screen scrape
 * @returns the text with any divider run or session key removed
 */
function stripCardNoise({ text }: { text: string }): string {
  return (
    text
      .replace(SESSION_KEY, "")
      .replace(DIVIDER_RUN, "")
      .replace(/[ \t]{2,}/g, " ")
      // A dangling ` — ` (or ` – `) left where a removed divider or session key used to sit. Only the em/en
      // dash, never a plain hyphen — a short hyphen-bordered divider like `-- message 1/3 --` is under the
      // 10-character threshold above and is legitimate content, not this defect.
      .replace(/\s[—–]\s*$/u, "")
      .trim()
  );
}

/**
 * The two steps an `inline`-tier turn takes: read the question, then answer from context and judgement
 * alone — no dispatch was needed, so there is nothing to delegate.
 *
 * Also the default for a caller that has not yet decided a tier at all, since it is the honest "nothing
 * tier-specific is known yet" frame — see {@link PENDING_ROUTE_STEPS} for the capture-time list that is
 * actually posted before `turn brief`/`turn dispatch` has run.
 */
export const INLINE_TURN_STEPS: readonly { readonly id: string; readonly title: string }[] = [
  { id: "question", title: "Read the question" },
  { id: "answer", title: "Answer inline, from context and judgement" },
];

/**
 * The two steps shown before routing has decided anything at all: read the question, then say only that an
 * answer is being worked out — nothing tier-specific yet, because nothing tier-specific is known yet.
 *
 * This is what `src/cli/commands/listen/run.ts` posts at CAPTURE, before `turn brief`/`turn dispatch` has
 * ever run. Posting a tier-specific list there instead was the defect: a delegated question showed steps
 * for work it never did, live and visible in Slack for as long as the actual investigation took. `./run.ts`'s
 * `beginTurn` corrects this frame to the real {@link turnStepsForTier} steps the moment it knows the tier,
 * which is the earliest point a WRITE can happen — `turn brief` itself posts nothing.
 */
export const PENDING_ROUTE_STEPS: readonly { readonly id: string; readonly title: string }[] = [
  { id: "question", title: "Read the question" },
  { id: "route", title: "Work out how to answer" },
];

/**
 * The two steps a `read-only-subagent`-tier turn takes: read the question, then investigate with one
 * bounded, read-only subagent before composing.
 *
 * A SEPARATE list from {@link INLINE_TURN_STEPS} rather than a shared one with steps skipped, because
 * showing "Answer inline" on a turn that dispatched a subagent instead is exactly the mismatch a live
 * checklist must never show: language for work that never happened.
 */
export const SUBAGENT_TURN_STEPS: readonly { readonly id: string; readonly title: string }[] = [
  { id: "question", title: "Read the question" },
  { id: "investigate", title: "Investigate with a bounded read-only subagent" },
];

/**
 * The two steps a `fresh-visible-session`-tier turn takes: read the question, then hand it to a separate,
 * fully visible session. Separate from {@link SUBAGENT_TURN_STEPS} for its own id/title, so the checklist
 * names the actual outcome rather than reusing a subagent's wording for a turn that opened a whole new
 * workspace instead.
 */
export const FRESH_SESSION_TURN_STEPS: readonly { readonly id: string; readonly title: string }[] = [
  { id: "question", title: "Read the question" },
  { id: "dispatch", title: "Investigate in a fresh visible session" },
];

/**
 * The checklist steps a turn actually takes for one execution tier.
 *
 * @param tier which tier executed the routing decision — the same three names H7's `ExecutionTier` and
 *   H9's `AskDispatchTier` both declare
 * @returns the steps that tier takes, in display order
 */
export function turnStepsForTier({
  tier,
}: {
  tier: ExecutionTier;
}): readonly { readonly id: string; readonly title: string }[] {
  switch (tier) {
    case "inline":
      return INLINE_TURN_STEPS;
    case "read-only-subagent":
      return SUBAGENT_TURN_STEPS;
    case "fresh-visible-session":
      return FRESH_SESSION_TURN_STEPS;
  }
}

/**
 * How far a turn has got.
 *
 * `completed` counts FINISHED steps, so the step at that index is the one in flight — one number rather
 * than a per-step state array, because the states are not independent: a turn cannot have finished step 3
 * without finishing step 2, and a shape that can express that is a shape a test has to rule out.
 */
export interface TurnProgress {
  /** How many steps are finished. Clamped into range by {@link turnChecklist}. */
  readonly completed: number;
  /** The detail clause for each finished step, by index. A missing entry renders no clause. */
  readonly details?: readonly (string | undefined)[] | undefined;
  /** When set, the step at `completed` FAILED with this reason rather than running. */
  readonly failure?: string | undefined;
  /**
   * A live, in-flight detail for the step at `completed` — what a `fresh-visible-session` turn's own live
   * screen currently shows, sourced by `turn dispatch --sweep`. Distinct from `failure`: this step has not
   * failed, it is genuinely still running, and this is the ONE place a caller may show text for a step that
   * is neither done nor failed. `failure` always wins when both are set — a real failure reason must never
   * be masked by a stale live-status string a sweep read moments before the turn actually broke.
   */
  readonly runningDetail?: string | undefined;
}

/**
 * The checklist frame for a given progress. Pure and total — an out-of-range `completed` is clamped rather
 * than trusted, because the alternative is a frame that renders fewer lines than the last one and reads as
 * work being undone.
 *
 * @param progress how far the turn has got
 * @param steps the checklist this tier actually takes; defaults to {@link INLINE_TURN_STEPS} for a
 *   caller that has not yet decided a tier (the capture-time checklist posted before `turn brief` has run)
 * @returns one {@link TodoStep} per entry in `steps`, in display order
 */
export function turnChecklist({
  progress,
  steps = INLINE_TURN_STEPS,
}: {
  progress: TurnProgress;
  steps?: readonly { readonly id: string; readonly title: string }[];
}): readonly TodoStep[] {
  const completed = Math.max(0, Math.min(steps.length, Math.trunc(progress.completed)));
  const failure = progress.failure;
  const { details } = progress;
  return steps.map((step, index) => {
    let detail: string | undefined;
    if (index < completed) {
      // No list at all is no clause for any finished step, exactly as a missing entry in one is.
      detail = details?.[index];
    } else if (index === completed) {
      detail = failure ?? progress.runningDetail;
    }
    let state: TodoState;
    if (index < completed) {
      state = "done";
    } else if (index === completed) {
      state = failure === undefined ? "running" : "failed";
    } else {
      state = "pending";
    }
    return {
      id: step.id,
      state,
      title: step.title,
      ...(detail === undefined || detail.length === 0 ? {} : { detail }),
    };
  });
}

/**
 * Shorten text to a visible cap, marking that it happened. Pure.
 *
 * This is the one seam every visible card field passes through (see this file's own header), so
 * {@link stripCardNoise} runs here rather than at each caller — a divider run or an internal ask/review
 * session key is removed before the cap is even applied. The marker replaces the last character rather than
 * being appended past the cap, so the result always satisfies the cap it was given — a clamp that overshoots
 * by one character is a clamp that still fails validation.
 *
 * @param text the text to fit
 * @param cap the maximum number of characters allowed
 * @returns the cleaned text unchanged when it fits, else the prefix plus {@link CLAMP_MARKER}
 */
export function clampVisible({ text, cap }: { text: string; cap: number }): string {
  if (cap <= 0) {
    return "";
  }
  const clean = stripCardNoise({ text });
  if (clean.length <= cap) {
    return clean;
  }
  return `${clean.slice(0, tagSafeCut({ at: Math.max(0, cap - CLAMP_MARKER.length), text: clean }))}${CLAMP_MARKER}`;
}

/**
 * The provenance footer, as structural runs.
 *
 * NO session link, and that is a ruling rather than an omission. Claude Code and Codex expose opaque local
 * harness identities, not shareable URLs. Rendering either as a link would look checkable while opening for
 * nobody else.
 *
 * The model stays. The owner wants it named, because it tells a reader which model was used, and it is
 * the part of this line that is actually checkable by a reader.
 *
 * @returns the footer runs, model first
 */
export function provenanceRuns({ modelId }: { modelId: string }): readonly InlineRun[] {
  return [
    { code: true, text: modelId, type: "text" },
    { text: " · BM25 only, semantic retrieval off", type: "text" },
  ];
}

/**
 * The bullets block: truncation, conservation, and anything a notice shortened.
 *
 * @param notes one line each, in display order; past `BULLETS_MAX_ITEMS` the tail becomes a count
 * @returns the block, with an overflow row when the notes did not fit
 */
export function notesBullets({ notes }: { notes: readonly string[] }): BulletsDetail {
  const fits = notes.length <= BULLETS_MAX_ITEMS;
  const shown = fits ? notes : notes.slice(0, BULLETS_MAX_ITEMS - 1);
  const overflow = notes.length - shown.length;
  const items = shown.map((note): readonly InlineRun[] => [
    { text: clampVisible({ cap: BULLET_ITEM_VISIBLE_MAX, text: note }), type: "text" },
  ]);
  return {
    items: fits ? items : [...items, [{ text: `+${String(overflow)} more note(s) not shown`, type: "text" }]],
    type: "bullets",
  };
}

/**
 * A notice's prose paragraph, clamped and marked.
 *
 * @returns the paragraph block
 */
export function proseParagraph({ text }: { text: string }): ParagraphDetail {
  return { runs: [{ text: clampVisible({ cap: PARAGRAPH_VISIBLE_MAX, text }), type: "text" }], type: "paragraph" };
}

/** A card, plus everything it had to shorten to fit. */
export interface TurnAnswerCard {
  /** The form, ready for `updateArtifactSchema` and then the card renderer. */
  readonly artifact: UpdateArtifact;
  /** Each field this module shortened, named. Empty when nothing was clamped. */
  readonly clamped: readonly string[];
}

/** Where a withheld draft ended up: filed under an id, or not filed and why. */
export type QueuedOutcome = { readonly id: string } | { readonly failure: string };

/**
 * The card a turn posts when its answer was WITHHELD.
 *
 * Somebody asked a question, so somebody is waiting. Silence is the failure mode this exists to prevent: a
 * thread that simply stops reads as a broken bot, and the reader has no way to tell "held for review" apart
 * from "died". So the held reply is as visible as an answer would have been, in the same thread, and it says
 * three things — that it was held, why, and what the id is that acts on it.
 *
 * `queued` is a UNION rather than an id, because a queue write can fail, and the honest card for that case is
 * not "queued as undefined" — it is a card that says the draft was held and could NOT be filed, so the reader
 * knows the draft is gone rather than waiting on a review that will never come.
 *
 * It carries NONE of the draft. The point of holding a reply is that its contents have not been judged fit to
 * say in this room, and putting the tl;dr into the notice would say them anyway.
 *
 * @param question the question as asked
 * @param names what each Slack user id in the question reads as — see {@link questionForPlainField}
 * @param reason why the reply was held, in the judgement's own words
 * @param queued the queue id the draft was filed under, or why filing failed
 * @param modelId the model that composed it
 * @returns the form and the list of fields it had to shorten
 */
export function turnHeldForm({
  question,
  names = {},
  reason,
  queued,
  modelId,
}: {
  question: string;
  names?: Readonly<Record<string, string>>;
  reason: string;
  queued: QueuedOutcome;
  modelId: string;
}): TurnAnswerCard {
  return {
    artifact: {
      citations: [],
      detail: [
        proseParagraph({
          text:
            "I drafted an answer and held it rather than sending it, so it can be reviewed before it stands " +
            `as something said in this thread. ${reason}`,
        }),
        notesBullets({
          notes: [
            "id" in queued
              ? `Queued for review as \`${queued.id}\`.`
              : `The draft could NOT be filed for review — ${queued.failure} — so there is nothing to release.`,
            "Nothing was sent, and the draft is not shown here — that is the point of holding it.",
          ],
        }),
        { runs: provenanceRuns({ modelId }), type: "paragraph" },
      ],
      index: [[{ text: "held for review — nothing was sent", type: "text" }]],
      kind: "update",
      media: [],
      // Resolved BEFORE the clamp, never after — see {@link questionForPlainField}'s own note: a clamp
      // through the middle of `<@U0SYN…` leaves a span the gate no longer matches and a reader cannot read.
      tldr: clampVisible({
        cap: TLDR_VISIBLE_MAX,
        text: `Held for review, not sent: ${questionForPlainField({ names, question })}`,
      }),
    },
    clamped: [],
  };
}

/**
 * Why a turn ended without an answer, in the only vocabulary the card's FACE distinguishes.
 *
 * Two arms rather than one, because the two ask the reader for genuinely different things and only one of
 * them is good news about the bot. `unproven` is the outbound gate working — an answer existed and did not
 * clear the bar, so it was not said — and `broke` is a fault. A single "it failed" wording for both is what
 * made a working gate read as a malfunction in the thread.
 */
export type TurnFailureCause = "unproven" | "broke";

/**
 * The identity-map key a failure card's owner tag is written against.
 *
 * A FIXED key rather than a roster lookup, and that is the property worth having: the card and the poster
 * that renders it both spell the owner this one way, so the ping cannot go stale, cannot resolve to somebody
 * else, and cannot fail because the derived roster has drifted. `../../live/turn/poster.ts` is the only
 * place that binds it to a Slack user id.
 */
export const OWNER_MENTION_KEY = "owner";
