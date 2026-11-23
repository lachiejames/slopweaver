/**
 * The typed failures the `turn` verb directory authors itself — reading its input files, the dispatch and
 * review subjects, the fresh session's permalink and pickup, the budget warn's write, and the supervisor a
 * card edit is attributed to.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. What another module
 * refused — `parseFlags`, `parseRoutingDecision`, the answer form's decoder, `src/live/turn`'s own
 * `TurnError` — is not re-authored here: it rides in `UPSTREAM_REFUSED` as the lines it came as.
 * A variant carrying `reasons` keeps one line per problem, and {@link turnCommandErrorLines} prints them.
 */
import { ROUND_CLOCK_HEADING } from "../../../live/turn/reviewThroughput.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A failure naming the `--dispatch` token it could not use. */
interface DispatchError<C extends string> extends Plain<C> {
  readonly dispatchId: string;
}

/**
 * Every failure the `turn` verb directory authors. A `Listed` variant is another module's refusal forwarded as
 * its lines, required flags not given, a pickup that could not be sent with what to do about it, or `turn
 * review`'s contradicting mode flags. `ASK_REFUSED` is a fact about the ask no file handed in can override;
 * `LIVE_ANSWER_UNAVAILABLE` is a fresh session with no ready answer; `PACKET_WITHOUT_CLOCK` withheld a
 * reviewer's pickup because its packet carries no clock block.
 */
export type TurnCommandError =
  | Listed<"UPSTREAM_REFUSED">
  | Listed<"INPUTS_MISSING">
  | (Plain<"FILE_UNREADABLE"> & { readonly what: string; readonly path: string })
  | (Plain<"DOCUMENT_NOT_JSON"> & { readonly what: string })
  | (Plain<"DECISION_NOT_RESPONDABLE"> & { readonly purpose: "answer" | "review" })
  | (Plain<"ASK_REFUSED"> & { readonly why: "blocked-on-human" | "resolved-since" | "decision-mismatch" })
  | Plain<"WARN_UNRECORDED">
  | Plain<"WARN_TARGET_MISSING">
  | (Plain<"SLACK_CREDENTIAL_MISSING"> & { readonly credential: "bot" | "read" })
  | Plain<"SLACK_WORKSPACE_REFUSED">
  | Plain<"DISPATCH_INVARIANT_BROKEN">
  | Listed<"PICKUP_UNSENT">
  | Plain<"SUBAGENT_DISPATCH_MISSING">
  | (Plain<"LIVE_ANSWER_UNAVAILABLE"> & { readonly state: "failed" | "unreachable" | "phantom" | "working" })
  | DispatchError<"DISPATCH_TOKEN_INVALID">
  | DispatchError<"DISPATCH_RECORD_MISSING">
  | (Plain<"REVIEW_TARGET_MISSING"> & { readonly usage: string })
  | Listed<"REVIEW_MODE_REFUSED">
  | Plain<"REVIEW_NOT_OPEN">
  | Plain<"ANSWER_PREFLIGHT_REFUSED">
  | Plain<"REVIEWER_BOOT_FAILED">
  | (Plain<"PACKET_WITHOUT_CLOCK"> & { readonly packetPath: string; readonly workspaceRef: string })
  | (Plain<"SUPERVISOR_UNAVAILABLE"> & { readonly verb: string })
  | (Plain<"REACHABILITY_UNCHECKED"> & { readonly origins: readonly string[] });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** A thrown value's own text, the way every reason in this directory has always reported one. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The ask-level refusals, keyed by why — the sentences the loader returned as plain strings before. */
const ASK_REFUSALS = {
  "decision-mismatch":
    "the --decision file does not match the decision this ask was actually dispatched under — reuse the " +
    "exact file `turn dispatch` printed, never a re-composed one",
  "resolved-since":
    "this ask has already been resolved (answered, triaged as no-response, or withheld) since it was last " +
    "dispatched — no decision file can authorise posting another answer for it",
} as const;

/** What each unavailable live answer says, keyed by the screen's state. */
const LIVE_ANSWER_LEADS = {
  failed: "the fresh session reported failure rather than an answer",
  phantom: "the fresh session no longer exists, so there is no answer coming",
  unreachable: "the fresh session's workspace could not be read",
} as const;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const TurnCommandErrors = {
  reachabilityUnchecked: ({ origins }: { origins: readonly string[] }): TurnCommandError => ({
    code: "REACHABILITY_UNCHECKED",
    message:
      `the answer's evidence leans on ${origins.join(", ")}, which no \`turn reach\` on this ask found signed in — ` +
      `run \`slopweaver turn reach --brief <brief> ${origins.map((origin) => `--url ${origin}`).join(" ")}\` first, ` +
      "so a signed-out page blocks the turn on the owner rather than reaching the thread as a gap",
    origins,
  }),
  answerPreflightRefused: ({ cause }: { cause: string }): Plain<"ANSWER_PREFLIGHT_REFUSED"> => ({
    code: "ANSWER_PREFLIGHT_REFUSED",
    message: `the answer would be refused before any review: ${cause}`,
  }),
  askBlockedOnHuman: ({ what }: { what: string }): TurnCommandError => ({
    code: "ASK_REFUSED",
    message:
      `this ask is still waiting on the owner — "${what}" — so it is not done and will not be ` +
      "posted as though it were. Run `slopweaver turn unblock` once the owner has done it, then answer.",
    why: "blocked-on-human",
  }),
  decisionNotRespondable: ({ purpose }: { purpose: "answer" | "review" }): TurnCommandError => ({
    code: "DECISION_NOT_RESPONDABLE",
    message:
      purpose === "answer"
        ? "the decision is `no-response` — there is nothing for `turn answer` to post"
        : "the decision is `no-response` — there is no answer to review",
    purpose,
  }),
  decisionUntrusted: ({ why }: { why: "resolved-since" | "decision-mismatch" }): TurnCommandError => ({
    code: "ASK_REFUSED",
    message: ASK_REFUSALS[why],
    why,
  }),
  dispatchInvariantBroken: ({
    kind,
  }: {
    kind: "expired-lease" | "wrong-tier";
  }): Plain<"DISPATCH_INVARIANT_BROKEN"> => ({
    code: "DISPATCH_INVARIANT_BROKEN",
    message:
      kind === "expired-lease"
        ? "the freshly minted lease is already expired — this should not happen"
        : "executeTier returned an inline/subagent result for a fresh-visible-session request — this should not happen",
  }),
  dispatchRecordMissing: ({ dispatchId }: { dispatchId: string }): DispatchError<"DISPATCH_RECORD_MISSING"> => ({
    code: "DISPATCH_RECORD_MISSING",
    dispatchId,
    message: `no dispatch record found for --dispatch "${dispatchId}" — was \`turn dispatch\` ever run for it?`,
  }),
  dispatchRecordMissingBecause: ({
    dispatchId,
    reason,
  }: {
    dispatchId: string;
    reason: string;
  }): DispatchError<"DISPATCH_RECORD_MISSING"> => ({
    code: "DISPATCH_RECORD_MISSING",
    dispatchId,
    message: `${reason} for --dispatch "${dispatchId}"`,
  }),
  dispatchTokenInvalid: ({ dispatchId }: { dispatchId: string }): DispatchError<"DISPATCH_TOKEN_INVALID"> => ({
    code: "DISPATCH_TOKEN_INVALID",
    dispatchId,
    message: `--dispatch "${dispatchId}" is not a token this build minted`,
  }),
  documentNotJson: ({ cause, what }: { cause: unknown; what: string }): TurnCommandError => ({
    code: "DOCUMENT_NOT_JSON",
    message: `the ${what} is not JSON: ${causeText({ cause })}`,
    what,
  }),
  fileUnreadable: ({ cause, path, what }: { cause: unknown; path: string; what: string }): TurnCommandError => ({
    code: "FILE_UNREADABLE",
    message: `could not read the ${what} at ${path}: ${causeText({ cause })}`,
    path,
    what,
  }),
  inputsMissing: ({ flags }: { flags: readonly string[] }): Listed<"INPUTS_MISSING"> => {
    const reasons = flags.map((flag) => `${flag} is required`);
    return listed({ code: "INPUTS_MISSING", reasons });
  },
  liveAnswerUnavailable: ({
    reason,
    state,
  }: {
    reason: string;
    state: "failed" | "unreachable" | "phantom";
  }): TurnCommandError => ({
    code: "LIVE_ANSWER_UNAVAILABLE",
    message: `${LIVE_ANSWER_LEADS[state]}: ${reason}`,
    state,
  }),
  liveAnswerWorking: (): TurnCommandError => ({
    code: "LIVE_ANSWER_UNAVAILABLE",
    message: "the fresh session has not confirmed a ready answer yet — its screen shows work still in progress",
    state: "working",
  }),
  packetWithoutClock: ({
    packetPath,
    workspaceRef,
  }: {
    packetPath: string;
    workspaceRef: string;
  }): TurnCommandError => ({
    code: "PACKET_WITHOUT_CLOCK",
    message:
      `the packet at ${packetPath} carries no clock block (${ROUND_CLOCK_HEADING}) — the pickup was NOT sent; ` +
      `close the reviewer with slopweaver cmux close ${workspaceRef}, since live/turn/review.ts dropped roundClockLines`,
    packetPath,
    workspaceRef,
  }),
  reviewerBootFailed: ({ cause }: { cause: string }): Plain<"REVIEWER_BOOT_FAILED"> => ({
    code: "REVIEWER_BOOT_FAILED",
    message: `the reviewer workspace could not be booted: ${cause}`,
  }),
  reviewerPickupUnsent: ({ cause, workspaceRef }: { cause: string; workspaceRef: string }): Listed<"PICKUP_UNSENT"> => {
    const reasons = [
      `the reviewer booted and its record is saved, but its pickup line was not delivered: ${cause}`,
      `read the surface before doing anything else: slopweaver cmux read-screen --workspace ${workspaceRef}`,
      `if it is genuinely empty, close it with slopweaver cmux close ${workspaceRef} and run turn review again —`,
      `hand-delivering into a session that failed its own readiness check is not a remedy this verb asks for`,
    ];
    return listed({ code: "PICKUP_UNSENT", reasons });
  },
  reviewModeRefused: ({
    pollWithClose,
    upstream,
    waitWithoutPoll,
  }: {
    pollWithClose: boolean;
    upstream: readonly string[];
    waitWithoutPoll: boolean;
  }): Listed<"REVIEW_MODE_REFUSED"> => {
    const reasons = [
      ...upstream,
      ...(pollWithClose ? ["--poll and --close are separate acts: reading a verdict never closes a session"] : []),
      ...(waitWithoutPoll ? ["--wait only means something with --poll"] : []),
    ];
    return listed({ code: "REVIEW_MODE_REFUSED", reasons });
  },
  reviewNotOpen: ({ channel, messageTs }: { channel: string; messageTs: string }): Plain<"REVIEW_NOT_OPEN"> => ({
    code: "REVIEW_NOT_OPEN",
    message: `no review has been opened for ${channel}/${messageTs} — run turn review with --answer first`,
  }),
  reviewTargetMissing: ({ mode, usage }: { mode: "poll" | "open"; usage: string }): TurnCommandError => ({
    code: "REVIEW_TARGET_MISSING",
    message:
      mode === "poll"
        ? "--poll and --close need --dispatch <id> or --brief <file> to say which review"
        : "pass --dispatch <id>, or both --brief <file> and --decision <file>",
    usage,
  }),
  slackCredentialMissing: ({ credential }: { credential: "bot" | "read" }): TurnCommandError => ({
    code: "SLACK_CREDENTIAL_MISSING",
    credential,
    message:
      credential === "bot"
        ? "no Slack bot token configured — run `slopweaver connect slack` first"
        : "no Slack read token configured (neither user nor bot) — run `slopweaver connect slack` first",
  }),
  slackWorkspaceMismatch: ({
    botTeam,
    readTeam,
  }: {
    botTeam: string;
    readTeam: string;
  }): Plain<"SLACK_WORKSPACE_REFUSED"> => ({
    code: "SLACK_WORKSPACE_REFUSED",
    message:
      `the Slack read token and bot token belong to different workspaces (bot team ${botTeam}, ` +
      `read team ${readTeam}) — refusing to build a permalink that could name the wrong workspace`,
  }),
  slackWorkspaceUnresolved: (): Plain<"SLACK_WORKSPACE_REFUSED"> => ({
    code: "SLACK_WORKSPACE_REFUSED",
    message: "could not resolve the Slack workspace URL (auth.test) for the read token — check its scopes",
  }),
  subagentDispatchMissing: (): Plain<"SUBAGENT_DISPATCH_MISSING"> => ({
    code: "SUBAGENT_DISPATCH_MISSING",
    message: "no open read-only-subagent dispatch is currently recorded for this ask",
  }),
  supervisorUnavailable: ({ problem, verb }: { problem: string; verb: string }): TurnCommandError => ({
    code: "SUPERVISOR_UNAVAILABLE",
    message: `${verb}: ${problem}`,
    verb,
  }),
  upstreamRefused: ({ reasons }: { reasons: readonly string[] }): Listed<"UPSTREAM_REFUSED"> =>
    listed({ code: "UPSTREAM_REFUSED", reasons }),
  warnLocked: ({ cause }: { cause: string }): Plain<"WARN_UNRECORDED"> => ({
    code: "WARN_UNRECORDED",
    message: `another budget warn write holds the lock, so nothing was recorded — ${cause}`,
  }),
  warnTargetMissing: (): Plain<"WARN_TARGET_MISSING"> => ({
    code: "WARN_TARGET_MISSING",
    message: "this ask has no active fresh-visible-session dispatch to warn — nothing is running to read a note",
  }),
  warnWriteFailed: ({ cause }: { cause: unknown }): Plain<"WARN_UNRECORDED"> => ({
    code: "WARN_UNRECORDED",
    message: `could not record the warn: ${causeText({ cause })}`,
  }),
  workerPickupUnsent: ({ cause }: { cause: string }): Listed<"PICKUP_UNSENT"> => {
    const reasons = [
      `the workspace booted and the dispatch record is saved, but the pickup command was not delivered: ${cause}`,
    ];
    return listed({ code: "PICKUP_UNSENT", reasons });
  },
} as const;

/**
 * The lines a {@link TurnCommandError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, and a missing review target is followed by the verb's usage.
 *
 * @returns one line per problem, in the order they were found
 */
export function turnCommandErrorLines({ error }: { error: TurnCommandError }): readonly string[] {
  if (
    error.code === "UPSTREAM_REFUSED" ||
    error.code === "INPUTS_MISSING" ||
    error.code === "PICKUP_UNSENT" ||
    error.code === "REVIEW_MODE_REFUSED"
  ) {
    return error.reasons;
  }
  if (error.code === "REVIEW_TARGET_MISSING") {
    return [error.message, error.usage];
  }
  return [error.message];
}
