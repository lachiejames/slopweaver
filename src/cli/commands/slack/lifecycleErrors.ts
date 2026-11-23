/**
 * The typed failures the `slack` lifecycle lanes author once an invocation has parsed: an `edit --as me` form
 * describing more than one message, an `edit` form asking to republish a no-fold message as a card, a parked
 * draft that cannot be found, whose approval names other bytes, whose form the register never kept, whose stored
 * attachment is gone or changed, that is released with the wrong verb for its thread or whose why says a thread
 * its row never named, that is released under an identity other than the one it was recorded as, or that is a
 * finding parked as them at the top level of a channel (that posts as the bot), that still
 * waits on their pick between the original and Codex's draft beside it, and the
 * refusals a lifecycle pass forwards from the modules that wrote them.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the edit/delete/release lifecycle in this
 * directory; reading the `edit`/`delete` invocation itself is `./argumentErrors.ts`'s, as every other verb's is.
 * A list of problems rides as `reasons`, and {@link slackLifecycleErrorLines} prints it one line each, as the
 * `readonly string[]` it replaced did.
 */
import type { Result } from "../../../lib/result.js";
import { pickOwedRefusal } from "../../../outbound/slack/draftComparison.js";

/** `slack edit --as me` replaces one message, but its form described `count` of them. */
export interface SlackLifecycleSingleMessageRequiredError {
  readonly code: "SINGLE_MESSAGE_REQUIRED";
  readonly message: string;
  readonly count: number;
}

/** An `edit` form asked to re-render a no-fold message as a card; `reasons` is the refusal then the way out. */
export interface SlackLifecycleNoFoldEditRefusedError {
  readonly code: "NO_FOLD_EDIT_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The parked draft a release names could not be found; `reason` is what the register said. */
export interface SlackLifecycleDraftNotFoundError {
  readonly code: "DRAFT_NOT_FOUND";
  readonly message: string;
  readonly reason: string;
}

/** A release's `--approve` is not the named draft's digest, so the approval binds other bytes. */
export interface SlackLifecycleDraftApprovalMismatchError {
  readonly code: "DRAFT_APPROVAL_MISMATCH";
  readonly message: string;
  readonly approve: string;
  readonly draftId: string;
  readonly digest: string;
}

/** A draft recorded from stdin before the register kept its form cannot be re-prepared without `--form`. */
export interface SlackLifecycleDraftFormRequiredError {
  readonly code: "DRAFT_FORM_REQUIRED";
  readonly message: string;
  readonly draftId: string;
}

/** A draft's stored attachment is gone or no longer the bytes it recorded; `reason` is what the store said. */
export interface SlackLifecycleDraftMediaUnavailableError {
  readonly code: "DRAFT_MEDIA_UNAVAILABLE";
  readonly message: string;
  readonly draftId: string;
  readonly reason: string;
}

/**
 * A release typed with the verb the ROW does not go out as: `slack post` on a thread reply, which would land
 * it top-level in the channel, or `slack reply` on a top-level post. `command` is the one that sends it.
 */
export interface SlackLifecycleDraftVerbMismatchError {
  readonly code: "DRAFT_VERB_MISMATCH";
  readonly message: string;
  readonly draftId: string;
  readonly command: string;
}

/**
 * A top-level row whose own why says it is a thread reply — the incident's shape, recorded before a
 * draft could name its thread. No verb can send it where the why says, so it is re-recorded, never released.
 */
export interface SlackLifecycleDraftWhySaysThreadError {
  readonly code: "DRAFT_WHY_SAYS_THREAD";
  readonly message: string;
  readonly draftId: string;
}

/**
 * A release typed under the identity the ROW was not recorded as — `--as me` on a bot row, or `--as bot` on one
 * recorded as them. The digest binds the recorded author, so the other identity could never match it; refused by
 * name first rather than as a digest drift nobody can read. `command` is the one that sends it.
 */
export interface SlackLifecycleDraftActorMismatchError {
  readonly code: "DRAFT_ACTOR_MISMATCH";
  readonly message: string;
  readonly draftId: string;
  readonly command: string;
}

/**
 * An as-me row that is a finding shared at the top level of a channel, recorded before the ruling
 * put such a post under the bot's name and naming no reason the bot cannot post there. `reasons` is the ruling
 * and the re-record that sends it.
 */
export interface SlackLifecycleDraftFindingIdentityError {
  readonly code: "DRAFT_FINDING_IDENTITY";
  readonly message: string;
  readonly draftId: string;
  readonly reasons: readonly string[];
}

/**
 * A row carrying Codex's draft beside the original, released before they chose either: the digest a session typed
 * binds one of the two, and only their pick says which (`../../../outbound/slack/draftComparison.ts`).
 */
export interface SlackLifecycleDraftPickOwedError {
  readonly code: "DRAFT_PICK_OWED";
  readonly message: string;
  readonly draftId: string;
}

/** Refusals another module authored, forwarded by a lifecycle pass in the order it asked them. */
export interface SlackLifecycleUpstreamRefusedError {
  readonly code: "UPSTREAM_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure the lifecycle lanes in this directory author. */
export type SlackLifecycleError =
  | SlackLifecycleSingleMessageRequiredError
  | SlackLifecycleNoFoldEditRefusedError
  | SlackLifecycleDraftNotFoundError
  | SlackLifecycleDraftApprovalMismatchError
  | SlackLifecycleDraftFormRequiredError
  | SlackLifecycleDraftMediaUnavailableError
  | SlackLifecycleDraftVerbMismatchError
  | SlackLifecycleDraftWhySaysThreadError
  | SlackLifecycleDraftActorMismatchError
  | SlackLifecycleDraftFindingIdentityError
  | SlackLifecycleDraftPickOwedError
  | SlackLifecycleUpstreamRefusedError;

/** What a lifecycle step here answers: the value, or this union's typed refusal. */
export type SlackLifecycle<T> = Result<T, SlackLifecycleError>;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SlackLifecycleErrors = {
  draftApprovalMismatch: ({
    approve,
    draftId,
    digest,
  }: {
    approve: string;
    draftId: string;
    digest: string;
  }): SlackLifecycleDraftApprovalMismatchError => ({
    approve,
    code: "DRAFT_APPROVAL_MISMATCH",
    digest,
    draftId,
    message:
      `--approve ${approve} is not draft ${draftId}'s digest (${digest}) — the approval names other ` +
      `bytes, so nothing was sent. \`slopweaver slack draft show ${draftId}\` prints the one it binds.`,
  }),
  draftFormRequired: ({ draftId }: { draftId: string }): SlackLifecycleDraftFormRequiredError => ({
    code: "DRAFT_FORM_REQUIRED",
    draftId,
    message:
      `draft ${draftId} was recorded from stdin before the register kept the form it read, so it cannot be ` +
      "re-prepared from the row. Pass the form that renders it with --form <json|-> — the digest still " +
      "refuses anything but the approved bytes.",
  }),
  draftMediaUnavailable: ({
    draftId,
    reason,
  }: {
    draftId: string;
    reason: string;
  }): SlackLifecycleDraftMediaUnavailableError => ({
    code: "DRAFT_MEDIA_UNAVAILABLE",
    draftId,
    message: `draft ${draftId} cannot be released as approved: ${reason}`,
    reason,
  }),
  draftVerbMismatch: ({
    command,
    draftId,
    shape,
  }: {
    command: string;
    draftId: string;
    shape: "top-level" | "thread";
  }): SlackLifecycleDraftVerbMismatchError => ({
    code: "DRAFT_VERB_MISMATCH",
    command,
    draftId,
    message:
      shape === "thread"
        ? `draft ${draftId} is a THREAD reply, and \`slack post\` would land it top-level in the channel under ` +
          `your name — nothing was sent. Send it into its thread with: ${command}`
        : `draft ${draftId} is a TOP-LEVEL post, not a thread reply — nothing was sent. Send it with: ${command}`,
  }),
  draftWhySaysThread: ({ draftId }: { draftId: string }): SlackLifecycleDraftWhySaysThreadError => ({
    code: "DRAFT_WHY_SAYS_THREAD",
    draftId,
    message:
      `draft ${draftId} is parked TOP-LEVEL, but its why says it is a thread reply — releasing it would post ` +
      "it into the channel under your name, the public mistake. Nothing was sent. Re-record it into its " +
      `thread, which spends this row and carries their yes: \`slopweaver slack draft record --thread-ts <root ts> ` +
      `--supersedes ${draftId}\`.`,
  }),
  draftActorMismatch: ({
    command,
    draftId,
    recorded,
  }: {
    command: string;
    draftId: string;
    recorded: "me" | "bot";
  }): SlackLifecycleDraftActorMismatchError => ({
    code: "DRAFT_ACTOR_MISMATCH",
    command,
    draftId,
    message:
      `draft ${draftId} was recorded --as ${recorded}, and their approval binds that identity — nothing was sent. ` +
      `Send it with: ${command}`,
  }),
  draftFindingIdentity: ({
    draftId,
    reasons,
  }: {
    draftId: string;
    reasons: readonly string[];
  }): SlackLifecycleDraftFindingIdentityError => ({
    code: "DRAFT_FINDING_IDENTITY",
    draftId,
    message: `draft ${draftId} is a finding shared at the top level of a channel, and goes out as the bot`,
    reasons,
  }),
  draftPickOwed: ({ draftId, pending }: { draftId: string; pending: boolean }): SlackLifecycleDraftPickOwedError => ({
    code: "DRAFT_PICK_OWED",
    draftId,
    message: `${pickOwedRefusal({ id: draftId, pending })} — nothing was sent.`,
  }),
  draftNotFound: ({ reason }: { reason: string }): SlackLifecycleDraftNotFoundError => ({
    code: "DRAFT_NOT_FOUND",
    message: `${reason} — nothing was sent.`,
    reason,
  }),
  noFoldEditRefused: (): SlackLifecycleNoFoldEditRefusedError => {
    const reasons = [
      "this verb re-renders its form as a CARD, and a card sits in the attachment wrapper that was measured " +
        "to make a Slack message fold — so editing a `no-fold` message through it would republish it as the " +
        "very thing it exists not to be. Nothing was changed.",
      "post a new no-fold message with `slopweaver slack post --as bot --form -` and delete the old one with " +
        "`slopweaver slack delete`, or raise the no-fold edit path.",
    ];
    return { code: "NO_FOLD_EDIT_REFUSED", message: reasons.join("; "), reasons };
  },
  singleMessageRequired: ({ count }: { count: number }): SlackLifecycleSingleMessageRequiredError => ({
    code: "SINGLE_MESSAGE_REQUIRED",
    count,
    message:
      `slack edit --as me replaces ONE message, but --form described ${String(count)}. ` +
      "Pass a single-message drip (one entry in `messages`), or use --body for the plain escape hatch.",
  }),
  upstreamRefused: ({ reasons }: { reasons: readonly string[] }): SlackLifecycleUpstreamRefusedError => ({
    code: "UPSTREAM_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
} as const;

/**
 * The lines a {@link SlackLifecycleError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function slackLifecycleErrorLines({ error }: { error: SlackLifecycleError }): readonly string[] {
  if (error.code === "NO_FOLD_EDIT_REFUSED" || error.code === "UPSTREAM_REFUSED") {
    return error.reasons;
  }
  if (error.code === "DRAFT_FINDING_IDENTITY") {
    return [error.message, ...error.reasons];
  }
  return [error.message];
}
