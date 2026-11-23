/**
 * Whether the `turn watch` ticker still has an owner — the one pure reading behind its self-reap, lifted
 * out of `./watch.ts` so it has a home a unit test can reach with no process on the machine.
 *
 * ## Why a ticker has to reap itself at all
 *
 * `./watch.ts`, `./core.ts`'s `TURN_WATCH_USAGE`, `./resume.ts`'s printed step 0a,
 * `skills/loop/reference/live-card.md` and `skills/loop/reference/worker-contract.md` all used to carry the
 * same rule: *"it must be a CHILD of this session … never `nohup`, never `disown`: a detached process
 * reparents to PID 1, outlives the session that owns it, and is invisible in the sidebar"* — while
 * prescribing `"<launcher>" turn watch --brief <path> &` as the way to get it.
 *
 * MEASURED on darwin, in an agent tool-call shell, two calls apart:
 *
 * ```
 * tail -f /dev/null & echo $!   →  pid 11604   ppid 11578 (the tool-call shell)
 * ps -o pid,ppid -p 11604       →  pid 11604   ppid 1      (11578 no longer exists)
 * ```
 *
 * No `nohup`, no `setsid`, no `disown` anywhere. An agent tool call gets a ONE-SHOT shell, so it exits the
 * instant the call returns and every background job it holds reparents immediately. The rule named a
 * protection that has never existed, and `./resume.ts` prints that line to EVERY dispatched worker, so the
 * orphan is universal rather than rare. Three live tickers in one loop session were the first
 * observation.
 *
 * `docs/listener-supervision/failure-and-evidence.md` had already measured the same class for the LISTENER —
 * *"a bare `&` with no detachment at all … was still running"* — and reached the conclusion this side never
 * got: what such a process needs is not immortality but for its death to be **noticed**, *"a death-watch
 * rather than a better hosting trick"*. This module is the ticker's half of that.
 *
 * ## What the reap is bounded by, and what it deliberately is not
 *
 * Before this, the only bound on an orphan was `--max-seconds`, defaulting to the two-hour dispatch lease,
 * so a worker that died WITHOUT answering left a process telling the thread its turn was alive for the rest
 * of it. The reap replaces the wall clock with the worker's own death — and refuses to fire on anything
 * weaker, because a ticker that stops while its worker works is the frozen card the whole verb exists to
 * prevent.
 *
 * **What it deliberately does NOT cover.** A worker that dies having made no tool call at all since the
 * turn began (its first stage, else the ask itself — `activityWindowStart`) leaves nothing to read, so it
 * is never reaped and `--max-seconds` is still its only bound. That is the same refusal as the Codex case below and for the same reason — nothing read is not a
 * death observed — and it is the rare shape: a worker that got far enough to start this ticker has a
 * transcript.
 */

import { WORKER_REVIEW_WAIT_SECONDS } from "./core.js";

/**
 * The pid a process is reparented to when whatever started it goes away — 1 on darwin and on Linux alike.
 *
 * Reading `process.ppid` against it is the whole orphan test, and it needs no process table on purpose:
 * `../../../live/listen/supervise/liveness.ts` carries the incident where a `pgrep` pattern matched the
 * monitor's own command line and reported a dead bot alive, twice.
 */
export const ORPHAN_PARENT_PID = 1;

/**
 * How long a worker's transcript may stand still before an ORPHANED ticker reads it as a death.
 *
 * DERIVED, never picked. The longest single wait the worker contract itself prescribes is
 * {@link WORKER_REVIEW_WAIT_SECONDS} — `turn review --poll --wait --timeout-seconds 1200`, issued as ONE
 * tool call — and a harness records a call when it is ISSUED, so a worker blocked in exactly that call has
 * a last transcript entry that old while being perfectly alive. This is that wait plus half again, the
 * smallest bound that clears it with real headroom.
 * `src/__tests__/unit/cli/commands/turn/tickerOwner.test.ts` asserts the RELATIONSHIP rather than the
 * number, so raising the review wait can never silently start reaping live turns.
 */
export const ORPHAN_SILENCE_MS = Math.round(WORKER_REVIEW_WAIT_SECONDS * 1000 * 1.5);

/** What one reap reading says: keep ticking, or stop, and the words for why. */
export type TickerOwnerVerdict = { readonly kind: "keep-ticking" } | { readonly kind: "reap"; readonly line: string };

/**
 * Whether this ticker should stop because nothing owns it any more. Pure — the parent pid, the clock and
 * the worker's last activity are all parameters, so every arm is reachable from a unit test with no process
 * running, the same discipline `src/claude/watchSession.ts` applies to its own liveness verdict.
 *
 * **Every condition is required**, and each of the four refusals below is the point rather than a guard:
 *
 * - **Blocked on the owner** — a turn waiting on THE OWNER is a first-class resumable state
 *   (`../../../live/ask/lifecycle.ts`'s `BlockedOnHumanEvent`). Its worker sits idle making no tool calls
 *   for as long as the owner takes, and its card is the surface telling the thread what the owner owes, so silence there
 *   is the turn working as designed. This arm is why the reap is a fix rather than a new defect: without
 *   it, every block longer than {@link ORPHAN_SILENCE_MS} would lose its card.
 * - **Parented** — some host really is holding this process, so that host's own lifetime already bounds it,
 *   and reaping here would kill a ticker whose session is alive.
 * - **No activity instant** — an unreadable or empty transcript, which is a Codex worker's normal state
 *   (`../../../live/turn/workerLog.ts` returns an empty fold for one, deliberately). Nothing read is not a
 *   death observed, exactly as an unreadable process table is not a verdict in `./sweepCard.ts`.
 * - **Unparseable instant** — the same reasoning: no reading, no verdict. A FUTURE instant lands here too,
 *   via the comparison rather than a branch: a clock skew reads as zero silence, never as a death.
 *
 * @param blockedOnHuman whether this ask is waiting on the owner right now
 * @param latestActivityIso when the worker's transcript last recorded a tool call, if it recorded one
 * @param nowMs the instant to judge the silence against
 * @param parentPid this process's parent — `process.ppid` in production
 * @param silenceMs the bound to judge against, defaulted to {@link ORPHAN_SILENCE_MS}
 * @returns the verdict, carrying the line to print when it reaps
 */
export function orphanedTickerVerdict({
  blockedOnHuman,
  latestActivityIso,
  nowMs,
  parentPid,
  silenceMs = ORPHAN_SILENCE_MS,
}: {
  blockedOnHuman: boolean;
  latestActivityIso: string | undefined;
  nowMs: number;
  parentPid: number;
  silenceMs?: number;
}): TickerOwnerVerdict {
  if (blockedOnHuman) {
    return { kind: "keep-ticking" };
  }
  if (parentPid !== ORPHAN_PARENT_PID) {
    return { kind: "keep-ticking" };
  }
  if (latestActivityIso === undefined) {
    return { kind: "keep-ticking" };
  }
  const lastMs = Date.parse(latestActivityIso);
  if (Number.isNaN(lastMs)) {
    return { kind: "keep-ticking" };
  }
  const silentMs = nowMs - lastMs;
  if (silentMs < silenceMs) {
    return { kind: "keep-ticking" };
  }
  return {
    kind: "reap",
    line:
      `orphaned (ppid ${String(ORPHAN_PARENT_PID)}), and its worker made no tool call for ` +
      `${String(Math.floor(silentMs / 60_000))}m — last one ${latestActivityIso}`,
  };
}

/**
 * The one command that starts a card's ticker, as every handoff that asks for one prints it — the fresh
 * worker's step 0a (`./resumeLines.ts`) and the inline and read-only-subagent handoffs
 * (`./dispatchInitial.ts`), so those handoffs can never ask for different processes. The sweep's
 * `card-stale:` remedy still spells its own, `--home`-less, form (`./sweepCard.ts`).
 *
 * @param briefPath the ask's brief, the one argument `turn watch` resolves everything else from
 * @param home the resolved state home, spelled out so the ticker never falls back to the ambient one
 * @param launcher the RESOLVED absolute `bin/slopweaver` path — never `CLAUDE_PLUGIN_ROOT`, see `bundledLauncherPath`
 * @returns the command, backgrounded with a bare `&`
 */
export function tickerStartCommand({
  briefPath,
  home,
  launcher,
}: {
  briefPath: string;
  home: string;
  launcher: string;
}): string {
  return `"${launcher}" turn watch --brief ${briefPath} --home ${home} &`;
}
