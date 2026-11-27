/**
 * The shared vocabulary of a Codex orchestration pass. Pure types only — no imports that touch the SDK,
 * the filesystem or the clock, so every other module in `src/codex/` can depend on this one.
 *
 * Two shapes here exist BECAUSE of measured failures, and are the reason this file is worth reading:
 *
 *  1. {@link UsageMeasurement} and {@link ItemActivity} are DISCRIMINATED UNIONS whose `not-measured`
 *     branch carries no numbers at all. An aborted Codex turn rejects with `AbortError` and produces no
 *     `Turn` object, so neither its token usage nor its item list exists — and the predecessor's ledger
 *     silently substituted cumulative input for missing spend, making two near-identical runs read 4.4x
 *     apart. The pre-rewrite `src/gold/distilUsage.ts` had the softer version of that bug (it always built a
 *     numeric total, then appended a "usage missing" note) — moot now that `distil` no longer calls a model
 *     in-process (rule 2) and that file is gone. Making absence a separate branch with no numeric fields
 *     means no formatter CAN render an unmeasured attempt as zero: there is nothing to read.
 *  2. {@link CodexArtifactRecord}'s policy fields are named `requestedModel` / `requestedSandboxMode`,
 *     not `model` / `sandboxMode`. The SDK's `Turn` reports neither the model actually selected nor the
 *     sandbox actually applied, so calling them `model` and `sandbox` would present a request as an
 *     observation — the same silent-failure class the repo already rejects elsewhere.
 */

import type { CodexQuotaKind } from "./quotaTypes.js";

/**
 * The five token counters a completed Codex turn reports.
 *
 * Deliberately snake_case: these are the SDK's own field names, passed through verbatim. Renaming them
 * would invite quietly redefining them, and which of these overlap their parents is NOT established — so
 * nothing in this codebase sums them. See {@link UsageMeasurement}.
 */
export interface CodexUsage {
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly cache_write_input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_output_tokens: number;
}

/** Why an observation is absent. Every one of these was reachable in a real run. */
export type UnmeasuredReason =
  /** The turn was aborted at the bound; `run()` rejected, so no `Turn` and no usage ever existed. */
  | "aborted"
  /** The turn completed but the SDK reported `usage: null`. */
  | "sdk-reported-none"
  /** The call threw before completing, so nothing was reported. */
  | "transport-failed"
  /** The turn completed, but an item it started never reported completing, so its kind was never counted. */
  | "item-unfinished";

/**
 * Token usage for ONE attempt: either the five raw counters, or an explicit absence with a reason.
 *
 * The `not-measured` branch has NO numeric fields by construction. That is the whole point — "not
 * measured" and "zero" are different facts and must stay different in the type, not merely in a comment.
 */
export type UsageMeasurement =
  | { readonly kind: "measured"; readonly usage: CodexUsage }
  | { readonly kind: "not-measured"; readonly reason: UnmeasuredReason };

/** The kinds of item a Codex turn can produce. Mirrors the SDK's `ThreadItem` union. */
export type CodexItemKind =
  | "agent_message"
  | "reasoning"
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "web_search"
  | "todo_list"
  | "error"
  /**
   * An item whose `type` did not match any kind above — an SDK version ahead of this list, not a crash.
   * Counting it honestly here is what lets `client.ts` narrow the SDK's raw `string` without a cast: any
   * value outside {@link KNOWN_CODEX_ITEM_KINDS} falls here rather than being asserted into a named kind
   * it never actually was.
   */
  | "unknown";

/** Every `CodexItemKind` the SDK itself declares — everything but the {@link CodexItemKind} `"unknown"` catch-all. */
export const KNOWN_CODEX_ITEM_KINDS: readonly Exclude<CodexItemKind, "unknown">[] = [
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "todo_list",
  "error",
];

/**
 * What the model DID during an attempt, per item kind.
 *
 * Same union shape as {@link UsageMeasurement}, for the same reason: after an `AbortError` there is no
 * `Turn`, so `items` is exactly as unavailable as `usage`. Recording `command_execution: 0` for an
 * abandoned attempt would assert the model ran no commands when the truth is that nobody knows.
 *
 * Note a genuine measured zero IS meaningful and must print as `0`: a well-scoped review is TOLD not to
 * read other files, so zero tool calls is the healthy signature of the best runs, never a stall.
 */
export type ItemActivity =
  | { readonly kind: "measured"; readonly counts: Readonly<Partial<Record<CodexItemKind, number>>> }
  | { readonly kind: "not-measured"; readonly reason: UnmeasuredReason };

/**
 * One item a pass produced, observed AS IT HAPPENS rather than counted at the end.
 *
 * The counted {@link ItemActivity} above only exists once a turn resolves, which is why a pass pointed at the
 * wrong workspace used to burn its whole bound before anyone could tell. These are the same items, narrowed to
 * the fields two consumers need: the progress line, and the tripwire that decides whether a pass has gone
 * hunting. Nothing here is an SDK type — the adapter in `client.ts` is the only place those exist.
 *
 * `exitCode` is the load-bearing field. `command` is a raw shell line, so extracting paths from it is a
 * heuristic; a burst of NON-ZERO exits early in a pass is the structured signal that it is looking for
 * something that is not there.
 */
export interface CodexObservedItem {
  readonly itemKind: CodexItemKind;
  /** The command line, for `command_execution` items. Raw and unparsed. */
  readonly command?: string | undefined;
  /** Present once a command exits. Absent while it is still running. */
  readonly exitCode?: number | undefined;
  /** The query, for `web_search` items. */
  readonly query?: string | undefined;
  /** The paths a patch touched, for `file_change` items. */
  readonly changedPaths?: readonly string[] | undefined;
  /**
   * The text, for `agent_message` items.
   *
   * Carried so an ABORTED turn is not a total loss. The adapter used to drop this field, and the only place
   * the model's words survived was the `Turn` a rejected `run()` never returns — so a pass that had produced
   * a message and then ran out of bound recorded nothing at all.
   */
  readonly text?: string | undefined;
}

/**
 * What a pass had actually done at the moment it stopped without a verdict.
 *
 * This exists because of a measured total loss: a pass ran 90-plus commands of real investigation, hit its
 * bound, and its artifact recorded `items: - (not measured: aborted)` and no response. Both of those are
 * honest about the SDK — an aborted `run()` returns no `Turn`, so neither its usage nor its item list ever
 * existed — but they are not the whole truth, because every one of those commands had already been STREAMED
 * and folded into {@link CodexActivity} before the abort.
 *
 * So this is deliberately a SEPARATE field from the attempt's `items`/`usage` rather than a fix to them. Those
 * two stay `not-measured`, because they report what the SDK measured and the SDK measured nothing. This
 * reports what the caller OBSERVED, which is a different claim with a different provenance, and conflating
 * the two would be exactly the substitution `./types.UsageMeasurement` was written to prevent.
 *
 * Token spend is absent by construction. Usage arrives only on `turn.completed`, so an aborted pass's cost is
 * genuinely unknown and there is nothing here to mistake for it.
 */
export interface PassSalvage {
  /** Commands observed on the stream before the stop. */
  readonly commands: number;
  /** How many of those exited non-zero. */
  readonly failedCommands: number;
  /** Web searches observed. */
  readonly searches: number;
  /** Files the pass wrote in its own scratch workspace. */
  readonly fileChanges: number;
  /** The most recent shell lines, oldest first, capped by the fold that produced them. */
  readonly recentCommands: readonly string[];
  /**
   * The last complete `agent_message` the pass emitted, or `null` when it never emitted one.
   *
   * Nullable rather than optional because "the pass said nothing" and "we did not look" are different facts,
   * and the second one must not be spellable here.
   */
  readonly lastAgentMessage: string | null;
}

/** One step of a pass, as it happens. */
export type CodexObservedEvent =
  | { readonly kind: "thread-started"; readonly threadId: string }
  | { readonly kind: "item"; readonly item: CodexObservedItem }
  | { readonly kind: "turn-completed" }
  | { readonly kind: "turn-failed"; readonly message: string };

/**
 * Where observed events go. Fire-and-forget: a throwing sink is swallowed by the adapter, because a broken
 * progress relay must never be able to abort a pass that is otherwise working.
 */
export type CodexEventSink = (event: CodexObservedEvent) => void;

/** The three planning passes and the three review passes. */
export type PlanPassId = "p1" | "p2" | "p3";
export type ReviewPassId = "r1" | "r2" | "r3";
export type CodexPassId = PlanPassId | ReviewPassId;

/** A single falsifiable claim a review pass attacks. One per call — never a list. */
export interface ReviewProperty {
  /** A short, path-safe, unique id (for example a review arm number and a property ordinal). */
  readonly id: string;
  /** The claim itself, stated so a concrete input could disprove it. */
  readonly statement: string;
}

/** What a pass was pointed at. The review arm carries everything needed to prove WHICH diff was judged. */
export type CodexPassScope =
  | { readonly mode: "plan"; readonly pass: PlanPassId; readonly promptSha256: string; readonly promptBytes: number }
  | {
      readonly mode: "review";
      readonly pass: ReviewPassId;
      readonly property: ReviewProperty;
      readonly baseRef: string;
      /** The resolved merge-base commit the diff was taken from. */
      readonly baseSha: string;
      /** `HEAD` at capture time, so a later commit is detectable. */
      readonly headSha: string;
      readonly diffSha256: string;
      readonly diffBytes: number;
    };

/**
 * Which tree the pass read, captured when it STARTED.
 *
 * Sits beside {@link CodexPassScope} rather than inside it because both arms need it: a planning pass reads
 * the repository too, and the PR6 pre-mortem that went stale mid-run was a planning pass. Recording it only
 * on the review arm would leave the exact failure this exists for undetectable.
 *
 * "When it started" is the load-bearing part. Compared against the tree now, it answers the only question a
 * consumer of an artifact actually has: is this verdict still about the code we have?
 */
export interface CodexPassTree {
  /**
   * The branch the pass ran on, or `null` on a detached HEAD.
   *
   * Nullable rather than absent because a detached HEAD is ordinary here — the snapshot a pass reads is
   * itself detached — and an optional field would make "we did not look" and "there was no branch"
   * indistinguishable.
   */
  readonly branch: string | null;
  /** The full tree digest at pass start. See `src/codex/fingerprint.ts` for why HEAD alone will not do. */
  readonly fingerprint: string;
  /** `HEAD` at pass start, kept alongside the digest so drift can be explained, not merely detected. */
  readonly headSha: string;
  /** Git's content-addressed tree object at pass start. Survives a squash or rebase; the commit does not. */
  readonly treeSha?: string;
  /** Bytes of uncommitted patch at pass start — a non-zero value means the pass read a dirty tree. */
  readonly dirtyBytes: number;
  /**
   * The unreachable commit of the FROZEN COPY the pass actually read, when one could be made.
   *
   * Recorded because `repoRoot` alone overstates: it names the repository the pass was about, and a reader
   * reasonably takes that to mean the files it opened. When a snapshot exists the pass never touched those
   * files — it read a copy that cannot move — and the difference is the whole reason a verdict can be
   * trusted after the agent kept working. `undefined` means the live tree was read, which is the weaker
   * position and is stated rather than left ambiguous.
   */
  readonly snapshotCommit?: string;
}

/**
 * One attempt at getting an answer: the initial turn, the wrap-up turn after a warn, or the ONE fresh thread a
 * review earns after the provider's content-policy refusal (`./policyRefusal.ts`).
 */
export interface CodexAttempt {
  readonly kind: "initial" | "policy-retry" | "conclusion";
  /** The SDK thread id, or null when the abort landed before it existed (measured at ~235ms). */
  readonly threadId: string | null;
  readonly status: "answered" | "aborted" | "failed";
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly elapsedMs: number;
  readonly usage: UsageMeasurement;
  readonly items: ItemActivity;
  /**
   * What the transport said, on an attempt that FAILED — absent on every other status, and on every attempt
   * recorded before the field existed.
   *
   * Per attempt, not only on the outcome, because a refused turn followed by an answering retry would
   * otherwise leave no trace of the refusal, and a fallback grounded on "both turns were refused" needs both
   * causes in hand rather than one outcome and an inference.
   */
  readonly cause?: TransportFaultCause;
}

/** A plan pass's validated answer. */
export interface PlanAnswer {
  readonly verdict: "READY" | "BLOCKED";
  readonly summary: string;
  readonly bodyMarkdown: string;
  readonly blockers: readonly string[];
}

/** A review pass's validated answer. `BROKEN` is a SUCCESSFUL review — it found the thing it looked for. */
export interface ReviewAnswer {
  readonly verdict: "CLEAN" | "BROKEN";
  readonly propertyId: string;
  readonly summary: string;
  readonly evidence: string;
  /** A concrete input/state that breaks the property. Required for `BROKEN`, empty for `CLEAN`. */
  readonly counterexample: string;
}

/** Why a pass produced no usable verdict. Each is a legitimate non-success STATUS, not a crash. */
export type NoVerdictReason =
  /** The response did not conform, or failed domain validation (wrong property id, missing evidence…). */
  | "invalid-output"
  /** Aborted at the bound with no thread id, so no wrap-up turn was possible. */
  | "unrecoverable-abort"
  /** The wrap-up turn also failed to produce a valid verdict inside the original deadline. */
  | "no-conclusion-in-bound"
  /** Killed early: the pass was clearly reading the wrong thing, so the bound was not spent on it. */
  | "off-track";

/**
 * The outcome of a plan or review pass: an answer, an honest non-answer, or a transport fault. The artifact, the
 * ledger and every exit code read this alias; the bounded engine itself runs over {@link StructuredPassOutcome}.
 */
export type CodexPassOutcome = StructuredPassOutcome<PlanAnswer | ReviewAnswer>;

/**
 * The outcome of ANY bounded pass, over the answer type its own validator admits. Generic because a Slack draft pass
 * (`./slackDraftPass.ts`) answers with a drip form, and calling that a plan or a review would lie about its domain.
 */
export type StructuredPassOutcome<TAnswer> =
  | { readonly kind: "answered"; readonly rawFinalResponse: string; readonly answer: TAnswer }
  | {
      readonly kind: "no-verdict";
      readonly reason: NoVerdictReason;
      readonly rawFinalResponse: string | null;
      /**
       * What the pass had done when it stopped, or `null` when nothing was observed.
       *
       * REQUIRED and nullable, not optional. Every construction site has to state whether work was salvaged,
       * because an absent field would let a future no-verdict path silently discard a pass's work again — which
       * is the defect this was added for.
       */
      readonly salvage: PassSalvage | null;
    }
  | {
      readonly kind: "fatal";
      readonly error: { readonly kind: string; readonly operation: string; readonly message: string };
      /**
       * What the transport actually SAID when it failed.
       *
       * REQUIRED on every write, and still read defensively, because a record written before it existed has
       * none. Measured: twenty-plus passes recorded only `the Codex transport failed` while Codex's
       * own rollout log held `You hit your spend cap set by the owner of your workspace`, and four sessions
       * narrowed diffs that were never the problem because the gate blocking them could not say why.
       */
      readonly cause: TransportFaultCause;
      /**
       * What the pass had done when the transport failed, or `null` when nothing was observed.
       *
       * REQUIRED and nullable for the same reason the `no-verdict` arm's is, and added because the hole that
       * comment warned about opened here. MEASURED on one pass artifact: the
       * initial turn ran 764,968ms of real investigation, was aborted at the 85% warn as designed, and the
       * conclusion turn then died on a transport fault at 24,063ms. A conclusion that runs out of CLOCK
       * salvages that fold; a conclusion that loses the NETWORK threw all of it away, so the same pass kept or
       * discarded twelve minutes of work on nothing but which of the two stopped it.
       */
      readonly salvage: PassSalvage | null;
    };

/**
 * The cause of a transport fault, as the transport reported it — never inferred beyond that.
 *
 * Two channels, kept apart because they disagree in practice: the event stream can name the provider's own
 * refusal before the process exits, and the thrown boundary error can carry an HTTP status, an errno or a
 * retry hint the stream never mentioned. Either can be the only one with anything in it.
 */
export interface TransportFaultCause {
  /** The last failure the event stream itself reported (`turn.failed` / `error`), or null when it reported none. */
  readonly reported: string | null;
  /** The boundary error's own message, e.g. `Codex Exec exited with code 1: …`. */
  readonly thrown: string;
  /** The HTTP status the thrown error carried, when it carried one. */
  readonly status?: number;
  /** The errno or SDK code the thrown error carried, when it carried one. */
  readonly code?: string;
  /** A retry hint in milliseconds, when the thrown error exposed one. */
  readonly retryAfterMs?: number;
  /**
   * Which usage exhaustion the reported wording names, or null when it names none.
   *
   * Classified only from wording captured against a REAL exhausted account (`./quotaBanner.ts`), so a new
   * phrasing reads as null — an unclassified cause — rather than being guessed into a quota state.
   */
  readonly quota: CodexQuotaKind | null;
}

/**
 * The bound for one pass. Every field is derived from an explicitly supplied total — there is no default
 * anywhere, because a default a machine caller inherits silently is a habit rather than a bound.
 */
export interface PassBound {
  readonly totalMs: number;
  /** 85% of the total: where the run is interrupted and asked to conclude rather than killed outright. */
  readonly warnAfterMs: number;
  /** What remains for the wrap-up turn. The warn NEVER extends the deadline. */
  readonly conclusionWindowMs: number;
}

/** Everything one pass did, rendered to the durable artifact. */
export interface CodexArtifactRecord {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly createdAtIso: string;
  readonly repoRoot: string;
  /**
   * The checkout's `origin` as `owner/name`, read while it existed (`./originBinding.ts`). What lets a landing read
   * re-prove this record once `repoRoot` is deleted; absent on records written before it existed, which therefore
   * stay NOT RUN after their worktree is gone.
   */
  readonly originRepository?: string;
  /**
   * The model and policy REQUESTED. The SDK reports neither the selected model nor the applied sandbox,
   * so these are requests — naming them `model`/`sandboxMode` would dress a request up as an observation.
   */
  readonly requestedModel: string;
  readonly requestedReasoningEffort: string;
  readonly requestedSandboxMode: string;
  readonly requestedNetworkAccess: boolean;
  readonly requestedWebSearch: boolean;
  readonly requestedWritableRoots: readonly string[];
  readonly requestedApprovalPolicy: string;
  readonly bound: PassBound;
  /** Wall-clock actually consumed, reported separately from the requested bound (they can differ). */
  readonly observedElapsedMs: number;
  readonly scope: CodexPassScope;
  /** The tree as it stood when the pass started. Absent only on records written before this field existed. */
  readonly tree?: CodexPassTree;
  readonly attempts: readonly CodexAttempt[];
  readonly outcome: CodexPassOutcome;
}
