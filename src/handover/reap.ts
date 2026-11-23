/**
 * THE REAPER: which open run cycles are held by a session that is gone, and therefore owe an `orphaned`
 * closure that the dead session itself can never write.
 *
 * ## Why this exists at all — a detector with no actuator
 *
 * Every verdict this needs was already computed and none of it was ever written. {@link ./writerLiveness.ts}'s
 * `classifyWriterLiveness` already answers `dead`, and its three callers — the hook shell, the lifecycle core
 * and `session-start` — each only RENDER that verdict into a stand-off message. So a run whose session had
 * died stayed `active` for ever, and the board went on reporting work as in flight with nobody behind it.
 *
 * MEASURED over the whole board: **63 of 84** open cycles named a `claude-code` writer the
 * live-session registry proved dead, the oldest untouched for 17 days, against 15 genuinely live and 6 naming
 * no writer this can judge. Reproduce by joining `$SLOPWEAVER_HOME/runs/*.jsonl` against
 * `~/.claude/sessions/*.json` — the same two inputs this module takes.
 *
 * ## Why `orphaned` and never `abandoned`
 *
 * `handover abandon` means a session considered the work and gave up on it: a judgement about the WORK.
 * A reaped cycle carries no such judgement — the session crashed, was killed, or the machine restarted — so
 * the row stays runnable and the next session may pick it straight up. Writing `abandoned` on it would
 * mislabel live work as declined, the same class of lie as writing it on work that shipped.
 *
 * ## Why a `dead` verdict is the ONLY thing reaped
 *
 * `unknown` is never reaped, and that asymmetry is deliberate rather than conservative-by-default.
 * `sessionLiveness` answers `unknown` whenever ANY registry file would not decode, because a refusal names a
 * FILE rather than a session — so a live session hiding behind a half-written registry file is
 * indistinguishable from one that ended. Reaping on `unknown` would close a run out from under a session that
 * is still working in it. The count of skipped cycles is reported rather than dropped, so a reader can see
 * how much the measurement could not reach instead of reading silence as zero.
 *
 * Pure: takes decoded journal events, an injected pid probe and an injected registry lookup, and an explicit
 * clock. No filesystem, no process table, no registry read of its own.
 */

import type { CodexThreadObservation } from "../measurement/codexSessions.js";
import type { Measured } from "../measurement/status.js";
import { type RunDisposition, runDisposition } from "./boardTypes.js";
import { currentCycle, type RunEvent } from "./ledger.js";
import { type RunWriter, type WriterLiveness, writerOf } from "./runOwner.js";
import { classifyWriterLiveness } from "./writerLiveness.js";

/** One open cycle offered to the reaper, with everything the decision needs already derived. */
export interface ReapCandidate {
  readonly slug: string;
  readonly disposition: RunDisposition;
  /** The journal's current writer, or `undefined` when the cycle names none. */
  readonly writer: RunWriter | undefined;
  readonly liveness: WriterLiveness;
  /** The instant of the cycle's last journalled event. */
  readonly lastEventIso: string;
  /** How many events the current cycle held when this candidate was derived. */
  readonly cycleEvents: number;
}

/**
 * One cycle the reaper will close, carrying exactly what the `orphaned` event needs.
 *
 * @internal
 */
export interface Reapable {
  readonly slug: string;
  readonly deadSessionId: string;
  readonly lastEventIso: string;
  /**
   * How many events the current cycle held when this was decided — the cycle's IDENTITY at that instant.
   *
   * A timestamp is not an identity: valid events may share one, so a distinct event appended in the same
   * millisecond would leave `lastEventIso` unchanged and let a stale reap close a cycle that had moved. A
   * journal is append-only, so a count that still matches proves nothing was added since.
   */
  readonly cycleEvents: number;
}

/**
 * One cycle the reaper deliberately left alone, and why — never silence.
 *
 * @internal
 */
export interface ReapSkip {
  readonly slug: string;
  readonly why: string;
}

/** What one reaping pass decided, in full. */
export interface ReapPlan {
  readonly reapable: readonly Reapable[];
  readonly skipped: readonly ReapSkip[];
}

/**
 * One journal as the reaper sees it: its disposition, its current writer and that writer's liveness.
 *
 * Shared by the two callers that decide a reap — `handover reap` over the whole runs directory, and
 * `handover settle` over the one row it just settled — so the two can never disagree about which cycles are
 * held by a dead session. A cycle with no events at all is `undefined`: there is nothing in it to close.
 *
 * **The calling session is never judged by the registry.** `sessionLiveness` can find a live session briefly
 * absent before its registry entry exists, and a fully readable registry makes that absence read as `dead` —
 * so without this, the session that holds a run could reap its own run by settling it. The caller is running,
 * which is the one liveness fact that needs no measurement. It takes every id the caller could be, because an
 * environment naming both a Claude session and a Codex thread resolves to no single id and a guard over
 * `undefined` protects nobody — measured, and `../handover/runOwner.ts`'s `currentSessionIds` carries it. The
 * comparison trims both sides: the environment's ids arrive trimmed and a journal's writer id does not, so an
 * id with surrounding whitespace would otherwise read as a different session and defeat the guard.
 *
 * @param events the journal's decoded events, in order
 * @param unreadableLines the line numbers that did not decode — any makes the disposition `unreadable`
 * @param selfSessionIds every id the caller could be, each judged `live` outright — see `currentSessionIds`
 * @param processAlive whether an OS pid is alive, for a hostless legacy writer
 * @param sessionLive whether a session id is in the live-session registry, for a Claude Code writer
 * @param codexThread what Codex's open files say about a thread, for a Codex writer
 * @returns the candidate, or `undefined` when the current cycle is empty
 */
export function reapCandidateOf({
  slug,
  events,
  unreadableLines,
  selfSessionIds,
  processAlive,
  sessionLive,
  codexThread,
}: {
  slug: string;
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
  selfSessionIds: readonly string[];
  processAlive: (args: { pid: number }) => boolean;
  sessionLive: (args: { sessionId: string }) => Measured<boolean>;
  codexThread: (args: { threadId: string }) => CodexThreadObservation;
}): ReapCandidate | undefined {
  const cycle = currentCycle({ events });
  const last = cycle[cycle.length - 1];
  if (last === undefined) {
    return undefined;
  }
  const writer = writerOf({ events: cycle });
  let liveness: WriterLiveness;
  if (writer === undefined) {
    liveness = { kind: "unknown", why: "the cycle names no writer" };
  } else if (selfSessionIds.some((id) => id.trim() === writer.sessionId.trim())) {
    liveness = { kind: "live" };
  } else {
    liveness = classifyWriterLiveness({ codexThread, processAlive, sessionLive, writer });
  }
  return {
    cycleEvents: cycle.length,
    disposition: runDisposition({ events, unreadableLines }),
    lastEventIso: last.atIso,
    liveness,
    slug,
    writer,
  };
}

/**
 * Whether a disposition is one the reaper may close — an OPEN cycle, and nothing else.
 *
 * `waiting-on-owner` is deliberately included: a run paused on a question whose session then died is exactly
 * as stranded as one that was mid-work, and its recorded question survives in the journal either way, so
 * reaping loses nothing a reader had. A cycle already `finished`, `abandoned` or `orphaned` has its ending.
 */
function isOpenCycle({ disposition }: { disposition: RunDisposition }): boolean {
  return disposition.kind === "active" || disposition.kind === "waiting-on-owner";
}

/**
 * Decide which candidates owe an `orphaned` closure, and say why every other one was left.
 *
 * @param candidates every cycle to consider, open or not — filtering here rather than at the call site keeps
 *   the "why was this skipped" accounting complete
 * @returns what to reap and what was skipped, both in the order given
 */
export function planReap({ candidates }: { candidates: readonly ReapCandidate[] }): ReapPlan {
  const reapable: Reapable[] = [];
  const skipped: ReapSkip[] = [];
  for (const candidate of candidates) {
    if (!isOpenCycle({ disposition: candidate.disposition })) {
      skipped.push({ slug: candidate.slug, why: `the cycle is already ${candidate.disposition.kind}` });
      continue;
    }
    if (candidate.writer === undefined) {
      skipped.push({ slug: candidate.slug, why: "the cycle names no writer, so there is no session to judge" });
      continue;
    }
    if (candidate.liveness.kind === "live") {
      skipped.push({ slug: candidate.slug, why: `${candidate.writer.sessionId} is still in the live registry` });
      continue;
    }
    if (candidate.liveness.kind === "unknown") {
      skipped.push({ slug: candidate.slug, why: `liveness could not be established — ${candidate.liveness.why}` });
      continue;
    }
    // The ending carries this instant, and the write door's schema requires a real one. A journal whose last
    // event has an unparseable `atIso` is decodable but unreapable, so it is skipped HERE rather than promised
    // and then refused at the append — found by an adversarial review pass, which reproduced both halves.
    if (Number.isNaN(Date.parse(candidate.lastEventIso))) {
      skipped.push({
        slug: candidate.slug,
        why: `the cycle's last event carries no readable instant ("${candidate.lastEventIso}"), so no ending could be written`,
      });
      continue;
    }
    reapable.push({
      cycleEvents: candidate.cycleEvents,
      deadSessionId: candidate.writer.sessionId,
      lastEventIso: candidate.lastEventIso,
      slug: candidate.slug,
    });
  }
  return { reapable, skipped };
}

/**
 * The one-line summary a reaping pass prints, stating what it could not reach rather than only what it did.
 *
 * A pass that printed only its reap count would report "0 reaped" identically for a board with nothing to reap
 * and a board whose entire registry failed to decode — the exact silence {@link ./writerLiveness.ts}'s
 * `unknown` verdict exists to prevent.
 *
 * @param plan the decided pass
 * @param applied whether the pass actually wrote, so a dry run never claims an act it did not perform
 * @returns the summary line
 */
export function reapSummary({ plan, applied = true }: { plan: ReapPlan; applied?: boolean }): string {
  const unjudgeable = plan.skipped.filter((skip) => skip.why.startsWith("liveness could not be established"));
  // A dry run says "would reap" rather than "reaped". The caller already prints "(dry run)" and "nothing was
  // written", so this is not the only signal — but a log line that states an act which did not happen is a
  // false claim wherever it is later quoted, and this whole row exists because records outlive their context.
  const verb = applied ? "reaped" : "would be reaped";
  const reaped = `${String(plan.reapable.length)} cycle(s) ${verb}`;
  return unjudgeable.length === 0
    ? `${reaped}; every open cycle's writer was judgeable`
    : `${reaped}; ${String(unjudgeable.length)} left because their writer's liveness could not be established`;
}
