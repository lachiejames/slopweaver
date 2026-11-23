/**
 * The review-ask shape gate — a review ask as the owner, to one person in a DM, reads the way the owner would
 * write it.
 *
 * The case it came from: an ask to a reviewer for one pull request went out as a dot point list of one, gave the
 * reviewer no context for what it was, and the change was comment-only while the ask said review. Three shapes, each refused here rather than briefed, because a rule that
 * loads softly gets lost:
 *
 * - **One pull request is a sentence, never a dot point.** A `one-list` carrying one bullet is a batch that shrank.
 * - **A comment-only change asks for a tick, not a review**, and says so in the word "tick".
 * - **A person new to the conversation gets the context first.** The composer DECLARES whether the reviewer was in
 *   the conversation the work came from (`slack draft record --reviewer new|in-thread|not-an-ask`); for `new`, the
 *   opening line may carry neither the ask nor the pull request's link. Only the POSITION is checked, never the
 *   words, so the context is whatever work the change follows, from its PR body, and never a template sentence.
 *
 * **Scoped to a 1:1 DM.** That is where a review ask to one person goes (`skills/slack/reference/the-list-form.md`
 * § Where the ask goes), and it keeps a channel roster out: the vulnerability-fix digest opens "…PRs for your
 * review:" over one bullet per pull request, and a one-line day of it is a roster, not this ask.
 *
 * Reads authored text runs only. A link's LABEL is a pull request's own title, so "review" in a title never makes
 * a message an ask, and a `code` or `quoted` run is not the owner's voice. Pure: no network, no clock, no filesystem.
 */
import { asMeSequences, authoredWordsOf, listHeadlineCount } from "../artifact/runs.js";
import type { AsMeArtifact, DripInlineRun } from "../artifact/types.js";
import { VOICE_RULES_ESCAPE } from "../voice/exactRules.js";

/**
 * What the composer declares about a DM the gate read as a review ask: whether the person asked was in the
 * conversation the work came from, or `not-an-ask` where the phrases below read an ask into a message that makes
 * none ("did you need a review on this?"). That third value is what keeps a false positive one cheap flag rather
 * than a refusal whose only way through is declaring a reviewer the message does not have.
 */
export const REVIEWER_CONTEXTS = ["new", "in-thread", "not-an-ask"] as const;

/** What the composer declares about a DM the gate read as a review ask. */
export type ReviewerContext = (typeof REVIEWER_CONTEXTS)[number];

/**
 * What the gate knows about the reviewer: a declaration, `undeclared` where one is owed and was not given (a
 * recording), `approved` on a release of bytes the owner already said yes to — which this gate never refuses, since a
 * refusal there is a stall after the owner's approval — or `undefined` on a direct post, where only the declaration is
 * not asked for.
 */
export type ReviewerDeclaration = ReviewerContext | "undeclared" | "approved" | undefined;

/** A 1:1 DM: the member id `slack draft record --channel U…` takes, or the `D…` conversation id. */
const DIRECT_MESSAGE_ID = /^[DUW][A-Z0-9]+$/;

/** A GitHub pull request's own address, or a page under it. */
const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#]|$)/;

/**
 * The PHRASES an ask for a look is made in — "could I grab a review", "need your review", "pls review", "looking
 * for a tick". A phrase, never the bare word: "thanks for the review on that pull request" and "I left a review" link a pull
 * request in a DM too, and neither asks anybody for anything. A fixed list, as `./asMeBumpGate.ts`'s is: a miss
 * leaves an ask unshaped (the state before this gate), and a false read costs `--reviewer not-an-ask`.
 */
const ASK_WORDS = new RegExp(
  [
    String.raw`\b(?:could|can|may)\s+i\s+(?:grab|get|have|borrow)\s+(?:a\s+|your\s+)?(?:quick\s+)?(?:review|tick)\b`,
    String.raw`\b(?:grab|need|want|keen\s+for|love)\s+(?:a\s+|your\s+)?(?:quick\s+)?(?:review|tick)\b`,
    String.raw`\blooking\s+for\s+(?:a\s+|your\s+)?(?:quick\s+)?(?:review|tick)\b`,
    String.raw`\b(?:pls|please|could\s+you|can\s+you|would\s+you|you\s+mind)\s+(?:give\s+(?:it\s+)?a\s+)?(?:quick\s+)?(?:review|tick)\b`,
  ].join("|"),
  "i",
);

/** The word a comment-only ask is made in. */
const TICK_WORD = /\btick\b/i;

/** The change described as touching comments and nothing else. */
const COMMENT_ONLY = /\bcomments?[\s-]+only\b|\bonly\s+(?:touches|changes|fixes)\s+(?:some\s+)?comments\b/i;

/**
 * Whether a run sequence links a GitHub pull request.
 *
 * @returns true when a link run points at one
 */
function linksPullRequest({ runs }: { runs: readonly DripInlineRun[] }): boolean {
  return runs.some((run) => run.type === "link" && PULL_REQUEST_URL.test(run.url));
}

/**
 * Whether an as-me message is a review ask to one person: a DM, whose authored words ask for a review or a tick,
 * that links a pull request.
 *
 * @param channel where the message goes
 * @param artifact the validated as-me form
 * @returns true when every part of that holds
 */
export function isDirectReviewAsk({ artifact, channel }: { artifact: AsMeArtifact; channel: string }): boolean {
  const sequences = asMeSequences({ artifact });
  return (
    DIRECT_MESSAGE_ID.test(channel) &&
    sequences.some(({ runs }) => ASK_WORDS.test(authoredWordsOf({ runs }))) &&
    sequences.some(({ runs }) => linksPullRequest({ runs }))
  );
}

/** How every voice-shape refusal here ends, the same grant the paragraph-spacing rule names. */
const OVERRIDE = `or for one deliberate exception run ${VOICE_RULES_ESCAPE}; the grant sends the original content unchanged.`;

/**
 * Why a review ask as the owner would not read the way they write one — nothing when it would, or when the message is not
 * a DM review ask at all.
 *
 * @param artifact the validated as-me form
 * @param channel where the message goes
 * @param reviewer what the composer declared about the person asked
 * @param enabled false when the voice-rules hatch is open, which lifts the three shape rules and never the
 *   declaration: saying which reviewer this is is always possible
 * @returns the refusal lines, in the order a composer would fix them
 */
export function reviewAskShapeRefusal({
  artifact,
  channel,
  reviewer,
  enabled,
}: {
  artifact: AsMeArtifact;
  channel: string;
  reviewer: ReviewerDeclaration;
  enabled: boolean;
}): readonly string[] {
  if (reviewer === "approved" || reviewer === "not-an-ask" || !isDirectReviewAsk({ artifact, channel })) {
    return [];
  }
  const undeclared =
    reviewer === "undeclared"
      ? [
          "this is a review ask as the owner in a DM, so the recording says whether the person asked was in the " +
            "conversation the work came from: pass `--reviewer in-thread` or `--reviewer new`. A " +
            "person new to it gets one line of context on the work the change follows before the ask. A message " +
            "that asks nobody for a review, read as one by its wording, passes `--reviewer not-an-ask`.",
        ]
      : [];
  if (!enabled) {
    return undeclared;
  }
  return [
    ...undeclared,
    ...singleBulletLines({ artifact }),
    ...commentOnlyLines({ artifact }),
    ...contextFirstLines({ artifact, reviewer }),
  ];
}

/**
 * The one-bullet rule.
 *
 * @returns the refusal, or nothing when the form is not a one-bullet list
 */
function singleBulletLines({ artifact }: { artifact: AsMeArtifact }): readonly string[] {
  if (artifact.kind !== "one-list" || listHeadlineCount({ artifact }) !== 1) {
    return [];
  }
  return [
    "this review ask is a list of ONE dot point, and one pull request is a sentence (a batch " +
      'that shrank to one keeps no bullet). Write it as a {"kind":"one-card"} line or a drip message, ' +
      OVERRIDE,
  ];
}

/**
 * The tick rule.
 *
 * @returns the refusal, or nothing when the change is not called comment-only or the ask already says tick
 */
function commentOnlyLines({ artifact }: { artifact: AsMeArtifact }): readonly string[] {
  const words = asMeSequences({ artifact })
    .map(({ runs }) => authoredWordsOf({ runs }))
    .join(" ");
  if (!COMMENT_ONLY.test(words) || TICK_WORD.test(words)) {
    return [];
  }
  return [
    "this review ask calls the change comment-only and asks for a review: a comment-only change asks for a " +
      'TICK, not a review, and says so plainly, e.g. "just fixing up some inaccurate comments, looking for a tick, ' +
      'not a review", ' +
      OVERRIDE,
  ];
}

/**
 * The context-first rule, for a reviewer declared new to the conversation.
 *
 * @returns the refusal, or nothing when the reviewer was in the conversation or the opening line is context
 */
function contextFirstLines({
  artifact,
  reviewer,
}: {
  artifact: AsMeArtifact;
  reviewer: ReviewerDeclaration;
}): readonly string[] {
  const [first] = asMeSequences({ artifact });
  if (reviewer !== "new" || first === undefined) {
    return [];
  }
  const { runs } = first;
  if (!ASK_WORDS.test(authoredWordsOf({ runs })) && !linksPullRequest({ runs })) {
    return [];
  }
  return [
    "this review ask goes to a person new to the conversation the work came from, and it opens on the ask. Open " +
      "on one line of the work the change follows, taken from its PR body, as its own first line (a one-card " +
      "line or a first drip message) carrying neither the ask nor the link, then ask: they should not have to " +
      "wonder why this reached them, " +
      OVERRIDE,
  ];
}
