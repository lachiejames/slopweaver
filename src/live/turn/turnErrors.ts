/**
 * The typed failures `src/live/turn` authors itself — binding an answer's images to its uploads, recording what
 * a reviewer saw, resolving mentions, a witness warn, folding a completion, the routing admissibility
 * check, naming the thread, settling the tag's reaction and reading the progress log.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside `errors.ts`'s three narrower domains rather
 * than inside them: none of them shares a caller with this one. A variant carrying `reasons` keeps one line per
 * problem, and {@link turnErrorLines} is how a caller prints them without re-composing the joined `message`.
 */

import { type NotPerformed, notPerformedLines } from "../../admit/doorRefusal.js";
import type { ProfileReadError } from "../../profileStore.js";
import type { IdentityRosterError } from "../../silver/identityRosterErrors.js";

/** The answer's image paths and the uploads read for them do not correspond, one line per disagreement. */
export interface UploadBindingRefusedError {
  readonly code: "UPLOAD_BINDING_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The image records for one attachment could not be read, decoded or appended. */
export interface ImageRecordFailedError {
  readonly code: "IMAGE_RECORD_FAILED";
  readonly message: string;
  readonly stage: "read" | "decode" | "append";
  readonly filename: string;
  readonly cause: string;
}

/** One or more of the reviewer's observations could not be made durable, one line per attachment. */
export interface ImageObservationsUnrecordedError {
  readonly code: "IMAGE_OBSERVATIONS_UNRECORDED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The answer mentions people or groups the identity layers cannot resolve safely, one line per refusal. */
export interface MentionsRefusedError {
  readonly code: "MENTIONS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
  /** The identity roster's own code, when the refusal is that the roster could not be read at all. */
  readonly rosterCode?: IdentityRosterError["code"];
}

/** The witness warn is not one line of text. */
export interface WarnNotOneLineError {
  readonly code: "WARN_NOT_ONE_LINE";
  readonly message: string;
}

/** The witness warn names a dispatch that is no longer the ask's current one. */
export interface WarnStaleDispatchError {
  readonly code: "WARN_STALE_DISPATCH";
  readonly message: string;
  readonly expected: string;
  readonly current: string;
}

/** The current dispatch already carries its one witness note. */
export interface WarnAlreadyRecordedError {
  readonly code: "WARN_ALREADY_RECORDED";
  readonly message: string;
}

/** The combination a turn's outcome broke; each names one arm of the completion fold. */
export type CompletionInvariant =
  | "answered-with-failure"
  | "answered-without-ts"
  | "withheld-and-failed"
  | "withheld-without-ts"
  | "failed-without-reason"
  | "no-working-ts";

/** What each broken combination says — the sentence the `string[]` it replaced carried, verbatim. */
const COMPLETION_INVARIANT_MESSAGES: Readonly<Record<CompletionInvariant, string>> = {
  "answered-with-failure": "answered:true cannot combine with a failure or a withheld reply",
  "answered-without-ts": "an answered turn requires answerTs",
  "failed-without-reason": "an unanswered, non-withheld turn requires a failure reason",
  "no-working-ts": "a completion requires workingTs — the working message always exists before a turn settles",
  "withheld-and-failed": "a turn cannot be both withheld and failed",
  "withheld-without-ts": "a withheld turn requires its notice timestamp as answerTs",
};

/** A turn's outcome names a combination no real turn can end in, so it folds into no completion. */
export interface CompletionInvalidError {
  readonly code: "COMPLETION_INVALID";
  readonly message: string;
  readonly invariant: CompletionInvariant;
}

/** A proposal ask's decision names no required leg that could establish whether the thing already exists. */
export interface PresentStateUncheckedError {
  readonly code: "PRESENT_STATE_UNCHECKED";
  readonly message: string;
  readonly trigger: string;
  readonly sourceClasses: string;
}

/** The decision's tier is not admissible in the execution context it was judged under. */
export interface TierInadmissibleError {
  readonly code: "TIER_INADMISSIBLE";
  readonly message: string;
  readonly tier: "read-only-subagent";
}

/** The admit door refused the thread title, or Slack failed to set it. */
export interface ThreadNameRefusedError {
  readonly code: "THREAD_NAME_REFUSED";
  readonly message: string;
}

/** Slack declined a reaction change, or the change threw, so the tag's reaction is unsettled. */
export interface ReactionUnsettledError {
  readonly code: "REACTION_UNSETTLED";
  readonly message: string;
}

/** The ask's progress log exists but could not be read. */
export interface ProgressLogUnreadableError {
  readonly code: "PROGRESS_LOG_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * A declared plan, or the step a status names in it, would break the card's above-the-fold budget or point at
 * nothing — refused, never truncated (`AGENTS.md` rule 7). One line per problem.
 */
export interface PlanRefusedError {
  readonly code: "PLAN_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A second answer declared `followThrough` while this turn's first answer already stands in the thread. */
export interface FirstAnswerStandsError {
  readonly code: "FIRST_ANSWER_STANDS";
  readonly message: string;
  /** When the standing first answer was posted. */
  readonly postedIso: string;
  /** The standing first answer's own Slack `ts`. */
  readonly answerTs: string;
}

/** Every failure `src/live/turn` authors outside `errors.ts`'s three narrower domains. */
export type TurnError =
  | PlanRefusedError
  | FirstAnswerStandsError
  | UploadBindingRefusedError
  | ImageRecordFailedError
  | ImageObservationsUnrecordedError
  | MentionsRefusedError
  | WarnNotOneLineError
  | WarnStaleDispatchError
  | WarnAlreadyRecordedError
  | CompletionInvalidError
  | PresentStateUncheckedError
  | TierInadmissibleError
  | ThreadNameRefusedError
  | ReactionUnsettledError
  | ProgressLogUnreadableError;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({
  code,
  reasons,
}: {
  code: C;
  reasons: readonly string[];
}): {
  code: C;
  message: string;
  reasons: readonly string[];
} {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const TurnErrors = {
  completionInvalid: ({ invariant }: { invariant: CompletionInvariant }): CompletionInvalidError => ({
    code: "COMPLETION_INVALID",
    invariant,
    message: COMPLETION_INVARIANT_MESSAGES[invariant],
  }),
  firstAnswerStands: ({ answerTs, postedIso }: { answerTs: string; postedIso: string }): FirstAnswerStandsError => ({
    answerTs,
    code: "FIRST_ANSWER_STANDS",
    message:
      `a first answer for this ask already stands (posted ${postedIso}, Slack ts ${answerTs}), so this post must ` +
      "be the FINAL one — drop `followThrough` from the form, carry the outcome, and have it re-reviewed",
    postedIso,
  }),
  imageObservationsUnrecorded: ({ failures }: { failures: readonly TurnError[] }): ImageObservationsUnrecordedError =>
    listed({ code: "IMAGE_OBSERVATIONS_UNRECORDED", reasons: failures.flatMap((error) => turnErrorLines({ error })) }),
  imageRecordFailed: ({
    cause,
    filename,
    stage,
  }: {
    cause: string;
    filename: string;
    stage: "read" | "decode" | "append";
  }): ImageRecordFailedError => {
    const lead = {
      append: `could not record what the reviewer saw in ${filename}`,
      decode: `could not decode ${filename} to record what the reviewer saw`,
      read: `could not read the image records for ${filename}`,
    }[stage];
    return { cause, code: "IMAGE_RECORD_FAILED", filename, message: `${lead}: ${cause}`, stage };
  },
  mentionsRefused: ({ reasons }: { reasons: readonly string[] }): MentionsRefusedError =>
    listed({ code: "MENTIONS_REFUSED", reasons }),
  mentionsRosterUnread: ({ error }: { error: IdentityRosterError }): MentionsRefusedError => ({
    ...listed({ code: "MENTIONS_REFUSED", reasons: [error.message] }),
    rosterCode: error.code,
  }),
  mentionsUnresolved: ({ missing }: { missing: readonly string[] }): MentionsRefusedError =>
    listed({
      code: "MENTIONS_REFUSED",
      reasons: [`the answer mentions ${missing.join(", ")}, which do not resolve in the identity map`],
    }),
  presentStateUnchecked: ({
    sourceClasses,
    trigger,
  }: {
    sourceClasses: string;
    trigger: string;
  }): PresentStateUncheckedError => ({
    code: "PRESENT_STATE_UNCHECKED",
    message:
      `this ask proposes something ("${trigger}"), so it assumes the thing does not exist yet — but ` +
      "the decision names no REQUIRED leg that could check whether it already does. Add a required need " +
      `whose capability is ${sourceClasses}-class and go and look before costing it; a leg that only describes ` +
      "this installation or its history cannot establish that a named thing is absent",
    sourceClasses,
    trigger,
  }),
  planRefused: ({ reasons }: { reasons: readonly string[] }): PlanRefusedError =>
    listed({ code: "PLAN_REFUSED", reasons }),
  progressLogUnreadable: ({ cause, path }: { cause: string; path: string }): ProgressLogUnreadableError => ({
    code: "PROGRESS_LOG_UNREADABLE",
    message: `could not read the progress log at ${path}: ${cause}`,
    path,
  }),
  reactionDeclined: ({ action, emoji }: { action: "add" | "remove"; emoji: string }): ReactionUnsettledError => ({
    code: "REACTION_UNSETTLED",
    message:
      action === "add"
        ? `slack declined to add the :${emoji}: reaction`
        : `slack declined to remove the stale :${emoji}: reaction`,
  }),
  reactionThrew: ({ reason }: { reason: string }): ReactionUnsettledError => ({
    code: "REACTION_UNSETTLED",
    message: reason,
  }),
  threadNameFailed: ({ reason }: { reason: string }): ThreadNameRefusedError => ({
    code: "THREAD_NAME_REFUSED",
    message: reason,
  }),
  threadNameRefused: ({ through }: { through: NotPerformed }): ThreadNameRefusedError => ({
    code: "THREAD_NAME_REFUSED",
    message: notPerformedLines({ command: "naming this thread", through }).join("\n"),
  }),
  threadNameUnreadableProfile: ({ error }: { error: ProfileReadError }): ThreadNameRefusedError => ({
    code: "THREAD_NAME_REFUSED",
    message: `refused to name the thread: ${error.message}`,
  }),
  tierInadmissible: ({ tier }: { tier: "read-only-subagent" }): TierInadmissibleError => ({
    code: "TIER_INADMISSIBLE",
    message:
      "read-only-subagent blocks its calling session for the whole investigation, so it is not admissible " +
      "for the continuous drain loop — re-judge as inline or fresh-visible-session",
    tier,
  }),
  uploadCountMismatch: ({ paths, uploads }: { paths: number; uploads: number }): UploadBindingRefusedError =>
    listed({
      code: "UPLOAD_BINDING_REFUSED",
      reasons: [
        `this answer names ${String(paths)} image(s) but carries ${String(uploads)} upload(s), ` +
          "so no attachment can be matched to the path it came from",
      ],
    }),
  uploadsOutOfOrder: ({
    mismatches,
  }: {
    mismatches: readonly { index: number; filename: string; path: string }[];
  }): UploadBindingRefusedError =>
    listed({
      code: "UPLOAD_BINDING_REFUSED",
      reasons: mismatches.map(
        ({ filename, index, path }) =>
          `attachment ${String(index + 1)} is named "${filename}" but its path is "${path}" — ` +
          "the uploads are not in the answer's own image order",
      ),
    }),
  warnAlreadyRecorded: (): WarnAlreadyRecordedError => ({
    code: "WARN_ALREADY_RECORDED",
    message: "this dispatch already carries a witness note — one note is the witness's whole output",
  }),
  warnNotOneLine: (): WarnNotOneLineError => ({
    code: "WARN_NOT_ONE_LINE",
    message: "--warn must be a one-line observation",
  }),
  warnStaleDispatch: ({ current, expected }: { current: string; expected: string }): WarnStaleDispatchError => ({
    code: "WARN_STALE_DISPATCH",
    current,
    expected,
    message:
      `--warn-dispatched ${expected} is not this ask's current dispatch (${current}) — ` +
      "it was re-dispatched after the sweep you judged; read the next sweep's evidence first",
  }),
} as const;

/**
 * The lines a {@link TurnError} prints, one per problem. A list-carrying variant gives each entry its own line,
 * as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function turnErrorLines({ error }: { error: TurnError }): readonly string[] {
  if (
    error.code === "UPLOAD_BINDING_REFUSED" ||
    error.code === "IMAGE_OBSERVATIONS_UNRECORDED" ||
    error.code === "MENTIONS_REFUSED" ||
    error.code === "PLAN_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
