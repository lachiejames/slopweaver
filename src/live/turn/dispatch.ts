/**
 * The fresh-visible-session dispatch record, and reading LIVE terminal truth off it — never a cached
 * completion field.
 *
 * ## Why there is no digest-binding, and why that was a deliberate rejection
 *
 * An earlier review (P3) found the original dispatch-record design trustable-but-stale: a record's own
 * `state: "answerable"` field could be re-read as proof a tier ran, even after the ask it named was re-briefed
 * or the record itself had drifted. The proposed fix was to bind the record to a digest of the exact brief it
 * was created from and revalidate that digest on every read. The owner rejected it directly: persisted local
 * state "tends to get stale... not very trustworthy," and asked instead for the dispatch record to be an
 * ADDRESS — where the real session is — with completion read from that session's own live terminal every
 * time, via `readScreen` (`../../cmux/client.js`). A {@link FreshDispatchRecord} therefore carries only durable
 * REQUEST and LOCATOR facts; it never carries `state: "answerable"`, cached terminal output, or a report
 * treated as proof. {@link freshScreenTruth} is the read side of that: it classifies whatever the workspace's
 * screen currently shows, fresh, every time it is asked.
 *
 * ## The completion marker is an ordinary identity check, not a content digest
 *
 * `turn resume`'s child prints `SLOPWEAVER_TURN_READY {"dispatchId":"…","answerPath":"…"}` (or
 * `SLOPWEAVER_TURN_FAILED {"dispatchId":"…","reason":"…"}`), then carries on — since the worker posts its
 * own answer, READY is its validation report rather than the end of its work, and FAILED is its own
 * statement that no answer is coming. A real Codex tool result prefixes
 * that stdout line with `└ `; {@link freshScreenTruth} recognises that one measured host decoration as well
 * as raw terminal output. It looks for the LAST such marker on the current screen and accepts it only when
 * its `dispatchId` matches the one being polled — never a marker left over from a different ask that happened
 * to reuse the same surface. The validated ANSWER lives at the marker's own absolute path; the marker itself
 * proves nothing about that file's content, only that the live session says it finished.
 */
import { z } from "zod";

import { submittedMessageConfirmsSend } from "../../cmux/sendEvidence.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { SlackSelfIdentity } from "../../outbound/slack/lifecycleGuards.js";
import type { AskIdentity } from "../ask/identity.js";
import type { DispatchedEvent } from "../ask/lifecycle.js";
import { parseSlackThreadPermalink } from "../slack/permalink.js";
import { type RoutingExecutionContext, respondDecisionSchema } from "./judgement.js";
import { leaseState, type ReviewPosture, withinReviewHold } from "./leaseJudgement.js";
import { CHECKLIST_STALL_AFTER_MS } from "./liveStatus.js";
import { effectiveLeaseExpiresAt, type FreshVisibleSessionRef, type RespondDecision } from "./tier.js";

/**
 * The fresh-dispatch-record schema version. A record at a different version is refused, not reinterpreted —
 * see {@link parseFreshDispatchRecord} for the identity-bound V2 check, and `dispatchStore.ts`'s
 * `unmatchedDispatchRecordVersion` for the loud "re-dispatch this ask" diagnostic an old V1 file gets instead
 * of collapsing into a generic "no dispatch record found."
 */
export const FRESH_DISPATCH_SCHEMA_VERSION = 3;

/**
 * One `fresh-visible-session` dispatch, as durably recorded — request and locator facts only. See this
 * module's header for why it deliberately carries no completion state.
 *
 * `askPermalink` is the durable thread pointer scenario 3 hands a fresh session — never a pre-fetched thread
 * document, so no private Slack content lives in this record. {@link parseFreshDispatchRecord} requires its
 * parsed identity to equal this record's own `channel`/`messageTs`/`threadTs` exactly, so a hand-edited or
 * corrupted permalink can never point a fresh session at a different ask than the one that dispatched it.
 *
 * ## `briefPath` is the pointer; `question` deliberately does not live here too
 *
 * The brief-clobber incident's post-mortem asked whether this record should carry the question
 * as a second copy, reasoning that the brief was the ONLY place it survived and the dispatch record pointed
 * at nothing that could confirm it. That framing no longer holds: `turn brief` now REFUSES to overwrite a
 * brief whose ask already has a started turn (`../../cli/commands/turn/brief.ts`'s
 * `overwriteOfStartedBriefRefusal`), which is what actually closed the gap — a dispatched ask's brief can no
 * longer be silently clobbered out from under `briefPath`. Adding `question` here would duplicate durable
 * content this module's own header already argues against keeping: it is exactly the kind of persisted local
 * state the owner rates as untrustworthy, preferring an ADDRESS instead. `briefPath` already IS
 * that address, and the file it names is now the one guarded copy.
 */
export interface FreshDispatchRecord extends AskIdentity {
  readonly schemaVersion: 3;
  readonly askPermalink: string;
  readonly dispatchId: string;
  readonly briefPath: string;
  readonly decision: RespondDecision;
  readonly execution: RoutingExecutionContext;
  readonly leaseExpiresAt: string;
  readonly session: FreshVisibleSessionRef;
}

/** The strict parse-edge schema for a decoded fresh-dispatch record — the boundary the store reads through. */
const freshDispatchRecordSchema = z
  .object({
    askPermalink: z.string().min(1),
    briefPath: z.string().min(1),
    channel: z.string().min(1),
    decision: respondDecisionSchema,
    dispatchId: z.string().min(1),
    execution: z
      .object({
        mode: z.enum(["continuous-drain", "single-turn"]),
        supervisorHost: z.enum(["claude-code", "codex"]),
      })
      .strict(),
    leaseExpiresAt: z.string().min(1),
    messageTs: z.string().min(1),
    schemaVersion: z.literal(FRESH_DISPATCH_SCHEMA_VERSION),
    session: z
      .object({
        cwd: z.string().min(1).optional(),
        host: z.enum(["claude-code", "codex"]),
        sessionName: z.string().min(1).optional(),
        surfaceId: z.string().min(1),
        surfaceRef: z.string().min(1),
        workspaceId: z.string().min(1),
        workspaceRef: z.string().min(1),
      })
      .strict(),
    threadTs: z.string().min(1),
  })
  .strict() satisfies z.ZodType<FreshDispatchRecord>;

/**
 * Whether a parsed `askPermalink` genuinely names the SAME ask as the record it rides in — the fix for a
 * hand-edited or corrupted record whose permalink is well-shaped HTTPS Slack but points elsewhere.
 *
 * @param askIdentity the record's own `channel`/`messageTs`/`threadTs`
 * @param askPermalink the record's `askPermalink` field, already schema-validated as a non-empty string
 * @returns every mismatch reason, or none when the permalink's identity equals the record's own exactly
 */
function permalinkIdentityMismatches({
  askIdentity,
  askPermalink,
}: {
  askIdentity: AskIdentity;
  askPermalink: string;
}): readonly string[] {
  const parsed = parseSlackThreadPermalink({ permalink: askPermalink });
  if (parsed.isErr()) {
    return [`askPermalink is not a valid Slack permalink: ${parsed.error.message}`];
  }
  const target = parsed.value;
  const mismatches: string[] = [];
  if (target.channel !== askIdentity.channel) {
    mismatches.push(
      `askPermalink channel ${target.channel} does not match the record's own channel ${askIdentity.channel}`,
    );
  }
  if (target.addressedTs !== askIdentity.messageTs) {
    mismatches.push(
      `askPermalink addressed timestamp ${target.addressedTs} does not match the record's own messageTs ${askIdentity.messageTs}`,
    );
  }
  if (target.threadTs !== askIdentity.threadTs) {
    mismatches.push(
      `askPermalink thread root ${target.threadTs} does not match the record's own threadTs ${askIdentity.threadTs}`,
    );
  }
  return mismatches;
}

/**
 * Parse an already-decoded fresh-dispatch record.
 *
 * @param value the decoded JSON value
 * @returns the validated record, or every schema violation (including a permalink whose own identity
 *   disagrees with the record's `channel`/`messageTs`/`threadTs`)
 */
export function parseFreshDispatchRecord({ value }: { value: unknown }): Result<FreshDispatchRecord> {
  const parsed = freshDispatchRecordSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  const mismatches = permalinkIdentityMismatches({ askIdentity: parsed.data, askPermalink: parsed.data.askPermalink });
  return mismatches.length === 0 ? ok(parsed.data) : err(mismatches);
}

/** The tag `turn resume` prints before a JSON payload naming the dispatch it completed. */
export const TURN_READY_MARKER = "SLOPWEAVER_TURN_READY";

/** The tag `turn resume` prints before a JSON payload naming the dispatch that failed. */
export const TURN_FAILED_MARKER = "SLOPWEAVER_TURN_FAILED";

/**
 * What a fresh workspace's current screen says about one dispatch, read fresh every time it is asked.
 *
 * `working` is the screen's DEFAULT arm — no completion marker rendered — and on its own it is a statement
 * about progress, never about existence. `phantom` is the answer to the other question, and it does not come
 * from the screen at all: it comes from asking cmux about the recorded workspace id (`../../cmux/liveness.ts`).
 * A caller that reads `working` as "a session is alive" is making the exact mistake that cost an hour once
 * — see that module's header.
 */
export type FreshScreenTruth =
  | { readonly kind: "working" }
  | { readonly kind: "ready"; readonly dispatchId: string; readonly answerPath: string }
  | { readonly kind: "failed"; readonly dispatchId: string; readonly reason: string }
  | { readonly kind: "unreachable"; readonly reason: string }
  | { readonly kind: "phantom"; readonly reason: string; readonly workspaceId: string };

/**
 * The last well-formed marker payload of one tag on a screen, or `undefined` when none parses. Scans from
 * the end so a later marker (a retry's own completion) always wins over an earlier one still visible above it.
 *
 * @param screen the raw screen text
 * @param tag the marker tag to look for
 * @returns the decoded JSON payload following the last occurrence of `tag`, or `undefined`
 */
function lastMarkerPayload({ screen, tag }: { screen: string; tag: string }): Record<string, unknown> | undefined {
  const lines = screen.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const visibleLine = lines[index]!.trim();
    // Measured in a real visible Codex cmux workspace: successful tool stdout is rendered as `└ <line>`.
    // Accept only that command-output decoration. A general "find the marker anywhere" would also accept
    // assistant prose or quoted thread content, weakening the live-screen identity check this module owns.
    const line = visibleLine.startsWith("└ ") ? visibleLine.slice(2) : visibleLine;
    if (!line.startsWith(`${tag} `)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line.slice(tag.length + 1));
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Classify a fresh workspace's CURRENT screen for one dispatch. Never trusts a cached field — every call
 * re-reads whatever the screen says right now.
 *
 * @param dispatchId the dispatch being polled — a marker naming a different id is ignored, not accepted
 * @param screen the workspace's current screen text, from `readScreen`
 * @returns the live truth: still working, ready with its answer path, failed with its reason, or unreachable
 */
export function freshScreenTruth({ dispatchId, screen }: { dispatchId: string; screen: string }): FreshScreenTruth {
  if (screen.trim().length === 0) {
    return { kind: "unreachable", reason: "the workspace surface returned no visible text" };
  }
  const ready = lastMarkerPayload({ screen, tag: TURN_READY_MARKER });
  if (ready?.["dispatchId"] === dispatchId && typeof ready["answerPath"] === "string") {
    return { answerPath: ready["answerPath"], dispatchId, kind: "ready" };
  }
  const failed = lastMarkerPayload({ screen, tag: TURN_FAILED_MARKER });
  if (failed?.["dispatchId"] === dispatchId && typeof failed["reason"] === "string") {
    return { dispatchId, kind: "failed", reason: failed["reason"] };
  }
  return { kind: "working" };
}

/**
 * Whether the token that will resolve a fresh dispatch's permalink workspace URL, and the token that
 * captured the ask in the first place, may be trusted to name the SAME Slack workspace.
 *
 * User-token-first read resolution (`resolveSlackReadToken`) means the token that builds `slackAskPermalink`'s
 * `workspaceUrl` is not necessarily the bot token that captured the ask's own channel. A configuration
 * spanning two different workspaces would otherwise combine one workspace's URL with another's channel/
 * message identity — a link that round-trips perfectly through the pure parser, then fails against Slack for
 * an unrelated reason at resume time. `teamId` absent on EITHER side refuses rather than passes: "could not
 * tell" must never read as "same workspace."
 *
 * @param botIdentity the bot token's own `auth.test` identity — the one that captured this ask
 * @param readIdentity the read token's own `auth.test` identity — the one that will resolve the workspace URL
 * @returns whether both identities name the same team
 */
export function sameSlackWorkspace({
  botIdentity,
  readIdentity,
}: {
  botIdentity: SlackSelfIdentity;
  readIdentity: SlackSelfIdentity;
}): boolean {
  return botIdentity.teamId !== undefined && botIdentity.teamId === readIdentity.teamId;
}

/**
 * The `--dispatch <id>` token every fresh-session caller (`turn dispatch --poll`, `turn resume`,
 * `turn answer --dispatch`) shares — an injective encoding of the exact ask it names, so the token alone is
 * enough to find the ask's dispatch record without a second flag carrying the identity separately.
 *
 * @param askIdentity the ask to encode
 * @returns the dispatch id
 */
export function dispatchIdOf({ askIdentity }: { askIdentity: AskIdentity }): string {
  return JSON.stringify([askIdentity.channel, askIdentity.messageTs, askIdentity.threadTs]);
}

/**
 * The inverse of {@link dispatchIdOf} — recovers the exact ask a dispatch id names, or `undefined` when the
 * token is not one this module ever minted.
 *
 * @param dispatchId the token to decode
 * @returns the ask identity, or `undefined` when the token does not decode to one
 */
export function askIdentityFromDispatchId({ dispatchId }: { dispatchId: string }): AskIdentity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dispatchId);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    return undefined;
  }
  const [channel, messageTs, threadTs]: unknown[] = parsed;
  if (typeof channel !== "string" || typeof messageTs !== "string" || typeof threadTs !== "string") {
    return undefined;
  }
  return { channel, messageTs, threadTs };
}

/** What a sweep found for one currently-`dispatched` ask — never an instruction to act, only a report. */
export type SweepAction =
  | { readonly kind: "still-working"; readonly ask: AskIdentity }
  | { readonly kind: "ready"; readonly ask: AskIdentity; readonly answerPath: string }
  | { readonly kind: "worker-failed"; readonly ask: AskIdentity; readonly reason: string }
  | { readonly kind: "lease-expired"; readonly ask: AskIdentity }
  | { readonly kind: "lease-held"; readonly ask: AskIdentity; readonly because: string }
  | { readonly kind: "phantom"; readonly ask: AskIdentity; readonly reason: string };

/**
 * Decide what a sweep should report for one currently-`dispatched` ask. A worker that reported its own
 * FAILURE is terminal before the lease has any say — `worker-failed` carries the reason the worker gave, and
 * the sweep finalises the thread from it, which is the loop's half of the worker contract: the worker reports
 * its terminal outcome, the loop makes the indicators tell it. Everything else is judged by the lease.
 *
 * **A `ready` report does not outrank the lease on its own word.** Since the worker posts its own answer,
 * `ready` means VALIDATED, not posted, and the door refuses an unreviewed answer. So `ready` is reported while
 * the lease is active or held — a clean verdict for the answer in hand, or a review in flight or open inside
 * `MAX_REVIEW_HOLD_HOURS` — or, past the lease, while cmux says its worker's workspace still holds a running
 * host (`readyWorkerAlive`): a live worker between rounds, having closed a `broken` round's reviewer to fix
 * the answer, can still carry it to the door. Otherwise it is `lease-expired`, exactly as `working` would be.
 * `alive` is the only reprieve; `unknown` and `phantom` both expire, because the lease is the bound and a
 * liveness check that could not run is no evidence anyone is left. And `alive` is CAPPED at
 * `MAX_REVIEW_HOLD_HOURS` past the lease through the same `withinReviewHold` every other hold uses: cmux calls
 * an idle Claude sitting at its prompt alive, and a paused session left open is exactly that, so an uncapped
 * reprieve would rebuild the forever-hold this fixes (`./leaseJudgement.ts` § Why the hold is capped). MEASURED on ask
 * `D0SYN000001/1789422881.103369`, a turn the owner paused: its turn marker read `ready` from
 * well before a lease that expired about an hour and a half later, and two hours after that the sweep still printed `0 lease-expired`
 * with no worker and no reviewer alive. Its `activeDispatch` never cleared, so `session respawn loop` refused
 * on "1 ask(s) still in flight" with no way out. Reproduce the shape over any live home:
 *
 * ```
 * cd "$SLOPWEAVER_HOME/live/slack/turn-markers" && jq -r 'select(.kind=="ready") | "\(input_filename) \(.leaseExpiresAt)"' -- *.json
 * ```
 *
 * `screenTruth` is `undefined` for `inline`/`read-only-subagent` dispatches — neither opens a separate
 * workspace, so there is no screen to poll, and only the lease can end their `dispatched` state here.
 *
 * A `ready` `screenTruth` is trusted only when its own carried `dispatchId` matches THIS ask's — never on
 * `kind` alone. The one real caller always builds `screenTruth` from this same ask's id, so this re-check
 * changes no live behaviour; it exists so this exported, directly-testable function cannot be made to
 * report an unrelated dispatch's readiness for this ask, the same live-truth-over-cached-state discipline
 * `freshScreenTruth` itself already applies to a marker on the screen.
 *
 * A `phantom` truth is reported only AFTER the lease has been given its say, so a dispatch that is both past
 * its lease and holds no session keeps reporting `lease-expired` — the branch that already finalises the
 * card, the reaction and the native status. `phantom` therefore fires in exactly the window that had no
 * honest answer before it: still inside the lease, and nothing behind the green light.
 *
 * **It is reported BEFORE a hold that does not outrank it**, and that split is what keeps the review holds
 * from blinding this sweep. Every hold in `./leaseJudgement.ts` except the verified-answer one is a claim
 * about a worker that is supposed to be ALIVE — a reviewer mid-verdict, or a round returned and the fix loop
 * running — so an EMPTY workspace refutes it, and reporting `lease-held` over one would hide a dead worker
 * for up to `MAX_REVIEW_HOLD_HOURS`. A verified answer is the exception the flag exists for: the work is
 * finished, so who is behind the green light no longer matters and calling it `phantom` would throw a
 * postable answer away.
 *
 * **A dispatch whose worker posted a FIRST answer is judged on the effective lease** — the later of the
 * dispatch's own and the one the first answer re-armed (`./tier.ts`'s `effectiveLeaseExpiresAt`) — and its
 * live builder gets the same capped reprieve a live `ready` worker does: past that lease, a worker cmux reports
 * alive is `still-working` for up to `MAX_REVIEW_HOLD_HOURS`, then `lease-expired`. Without it a four-PR build
 * expires at the two-hour mark and the stranded lane starts a second builder beside the first.
 *
 * @param ask the ask this dispatch is for
 * @param dispatched the ask-lifecycle's own last `dispatched` event, carrying the lease
 * @param screenTruth the fresh workspace's current screen truth, when this dispatch has one
 * @param nowIso the clock, as an ISO instant
 * @param review what this ask's review looks like right now — a reviewer mid-verdict, or a usable verdict
 *   already written, either of which outranks the wall clock. See `./leaseJudgement.ts` for why.
 * @param readyWorkerAlive cmux reports a running host in the worker's workspace — read by the caller only past
 *   the effective lease, for a `ready` truth or a first-answered builder, and false whenever it was not read
 * @param firstAnswer the lease the dispatch's first answer re-armed, when one has been posted
 * @returns the sweep's finding for this ask
 */
export function sweepDecision({
  ask,
  dispatched,
  firstAnswer,
  review,
  screenTruth,
  nowIso,
  readyWorkerAlive = false,
}: {
  ask: AskIdentity;
  dispatched: DispatchedEvent;
  firstAnswer?: { readonly leaseExpiresAt: string } | undefined;
  screenTruth: FreshScreenTruth | undefined;
  nowIso: string;
  review: ReviewPosture;
  readyWorkerAlive?: boolean;
}): SweepAction {
  const thisDispatchId = dispatchIdOf({ askIdentity: ask });
  const workerFailed = screenTruth?.kind === "failed" && screenTruth.dispatchId === thisDispatchId;
  if (workerFailed) {
    return { ask, kind: "worker-failed", reason: screenTruth.reason };
  }
  const leaseExpiresAt = effectiveLeaseExpiresAt({ activeDispatch: dispatched, firstAnswer });
  const lease = leaseState({ leaseExpiresAt, nowIso, review });
  const readyForThisAsk = screenTruth?.kind === "ready" && screenTruth.dispatchId === thisDispatchId;
  const aliveInsideCap = readyWorkerAlive && withinReviewHold({ nowIso, spawnedAt: leaseExpiresAt });
  const readyStands = readyForThisAsk && (lease.kind !== "expired" || aliveInsideCap);
  if (readyStands) {
    return { answerPath: screenTruth.answerPath, ask, kind: "ready" };
  }
  if (lease.kind === "expired") {
    return expiredSweepAction({ ask, builderAliveInsideCap: firstAnswer !== undefined && aliveInsideCap === true });
  }
  if (lease.kind === "held" && lease.outranksScreenTruth) {
    return { ask, because: lease.because, kind: "lease-held" };
  }
  if (screenTruth?.kind === "phantom") {
    return { ask, kind: "phantom", reason: screenTruth.reason };
  }
  if (lease.kind === "held") {
    return { ask, because: lease.because, kind: "lease-held" };
  }
  return { ask, kind: "still-working" };
}

/**
 * The finding for a dispatch whose effective lease has expired — `still-working` for a first-answered
 * builder cmux reports alive inside the capped reprieve, else `lease-expired`. Split out of
 * {@link sweepDecision} to keep that function under the cognitive-complexity ceiling.
 *
 * @returns the expired-lease sweep finding
 */
function expiredSweepAction({
  ask,
  builderAliveInsideCap,
}: {
  ask: AskIdentity;
  builderAliveInsideCap: boolean;
}): SweepAction {
  return builderAliveInsideCap ? { ask, kind: "still-working" } : { ask, kind: "lease-expired" };
}

/** The sweep findings that END an ask — the only ones whose reviewer has no door left to hand a verdict to. */
export type TerminalSweepAction = Extract<SweepAction, { kind: "worker-failed" | "lease-expired" | "phantom" }>;

/**
 * Whether a sweep finding ends the ask, narrowing it when it does. Pure and total — the ONE definition the
 * sweep routes on, so a non-terminal arm added to {@link SweepAction} lands on the working side by default.
 *
 * MEASURED on ask `D0SYN000001/1789200887.208859`: `lease-held` was added after
 * the sweep's terminal path had grown `reapAskReviewer` as its first line, and the routing was
 * `action.kind !== "still-working"`, so the arm whose whole meaning is "an independent reviewer is
 * mid-verdict" closed that reviewer on every lap — three rounds reaped within 25 minutes. A fresh-visible-session worker never met it then because its `ready` marker was read before the
 * lease was consulted (no longer so — see {@link sweepDecision}); an `inline` dispatch has no screen, so its
 * reviewer had no way to survive a sweep.
 * Reproduce on the old routing: `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/live/turn/dispatch.test.ts -t "mid-verdict"` fails on `terminalSweepAction`.
 *
 * @param action what the sweep found for one dispatched ask
 * @returns the same action, narrowed, when it ends the ask — else `undefined`
 */
export function terminalSweepAction({ action }: { action: SweepAction }): TerminalSweepAction | undefined {
  return action.kind === "worker-failed" || action.kind === "lease-expired" || action.kind === "phantom"
    ? action
    : undefined;
}

/**
 * How long a turn that has ALREADY reported ready has been sitting without its answer going through the
 * door, as a clause worth printing — or `undefined` while that wait is still short enough to be ordinary.
 * Since the worker posts its own answer, `ready` is normally momentary — validated, reviewed, posted — so a
 * long wait here means the worker stalled BETWEEN validating and posting: a reviewer that never returned,
 * most likely, which is where the loop looks first.
 *
 * The other end of the same green-light stall {@link FreshScreenTruth}'s `phantom` arm closes. A dispatch
 * that finished and a dispatch that never started are indistinguishable to the person waiting in the thread:
 * both show a half-ticked card. `--sweep` has always reported `ready`; what it could not say is that the
 * ready has been sitting there for forty minutes, and only the second reads as something to act on.
 *
 * Pure — the clock is injected, never read. Shares {@link CHECKLIST_STALL_AFTER_MS} with the card's own
 * staleness line rather than choosing a second number, because both answer the same question: is the reader
 * still being told the truth?
 *
 * @param recordedAtIso when the session recorded its completion, or `undefined` on a marker written before
 *   that field existed
 * @param nowIso the current instant
 * @param stallAfterMs how long an uncarried answer may sit before it is worth saying; defaults to
 *   {@link CHECKLIST_STALL_AFTER_MS}
 * @returns the clause, or `undefined` when there is nothing worth saying or either instant is unreadable
 */
export function uncarriedAnswerDetail({
  recordedAtIso,
  nowIso,
  stallAfterMs = CHECKLIST_STALL_AFTER_MS,
}: {
  recordedAtIso: string | undefined;
  nowIso: string;
  stallAfterMs?: number;
}): string | undefined {
  if (recordedAtIso === undefined) {
    return undefined;
  }
  const recordedAt = Date.parse(recordedAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(recordedAt) || Number.isNaN(now)) {
    return undefined;
  }
  const waitedMs = now - recordedAt;
  if (waitedMs < stallAfterMs) {
    return undefined;
  }
  return (
    `ready and unposted for ${String(Math.floor(waitedMs / 60_000))}m — the worker validated this answer but has not ` +
    "taken it through the door; check its workspace and its reviewer"
  );
}

/**
 * The pickup prompt sent into a freshly booted `fresh-visible-session` workspace — plain-English
 * instructions the visible agent reads and acts on, not a shell command.
 *
 * @param dispatchId the dispatch this session is picking up
 * @returns the exact line to send once the session has booted
 */
export function freshSessionPickupPrompt({ dispatchId }: { dispatchId: string }): string {
  return (
    "You are the worker for one dispatched Slack ask, in a fresh visible session, and you own it to its " +
    `terminal outcome. Run \`slopweaver turn resume --dispatch ${dispatchId}\` to load your brief and the ` +
    "decision that dispatched you here, then follow the numbered steps it prints, in order, to the end. Its " +
    "step 0a is the one people in the thread see: start `turn watch` in the background before you " +
    "investigate anything, so the card moves while you work. Then investigate, validate your answer, get it " +
    "reviewed by an independent reviewer (`turn review`), and post it yourself through the door " +
    "(`turn answer --dispatch … --verdict …`). Nobody else posts for you, and if you cannot answer, report " +
    "that with `turn resume --failed` rather than stopping silently."
  );
}

/**
 * Whether a later look at cmux's own delivery record CORROBORATES an unwitnessed dispatch's pickup — the
 * reconciliation `../../cli/commands/turn/dispatchSweep.ts` runs on every sweep, as a pure decision.
 *
 * The comparison target is rebuilt rather than stored, and that is what makes this cheap: a fresh session's
 * pickup line is a pure function of its `dispatchId` ({@link freshSessionPickupPrompt}), and the sweep
 * already derives that id from the ask. So no dispatch-record schema change was needed to make an
 * unwitnessed dispatch reconcilable — a v3 record written before this existed reconciles exactly as well as
 * one written after.
 *
 * `submittedMessageConfirmsSend` is a truncation-aware PREFIX comparison, which matters here: cmux keeps
 * only the first 240 characters of a submitted message and this prompt is far longer, so an equality or
 * `includes` check would never match (`../../cmux/sendEvidence.ts` carries the measurement).
 *
 * What a match proves is bounded and worth stating: the agent session on that surface ACCEPTED this exact
 * pickup as a submitted prompt. It does not prove the worker is still alive — that is the sweep's own
 * liveness check, which runs regardless — only that the dispatch's pickup was not lost.
 *
 * @param askIdentity the ask being reconciled, which the expected pickup line is derived from
 * @param latestSubmittedMessage cmux's own `latest_submitted_message` for the recorded workspace
 * @returns the reason to record, or `undefined` when nothing corroborates it yet
 */
export function unwitnessedPickupCorroboration({
  askIdentity,
  latestSubmittedMessage,
}: {
  askIdentity: AskIdentity;
  latestSubmittedMessage: string | undefined;
}): string | undefined {
  const confirmed = submittedMessageConfirmsSend({
    latestSubmittedMessage,
    sentText: freshSessionPickupPrompt({ dispatchId: dispatchIdOf({ askIdentity }) }),
  });
  return confirmed
    ? "cmux's own latest_submitted_message for the recorded workspace corroborates the pickup command"
    : undefined;
}
