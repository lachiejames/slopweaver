/**
 * The hook decision cores: what to tell a session at start, after a compaction, and when it tries to stop.
 *
 * ## Why a hook at all, and why only these three
 *
 * A command can refuse when it can SEE the problem — `finish` refusing a partial run has real teeth and has
 * never trapped anyone. What no command can see is a session quietly ending mid-run, or a compaction erasing
 * the rules that governed it. Those are the two events these hooks exist for, and nothing else here needs one.
 *
 * `PostCompact` is the direct fix and it is better than the design this replaced. It was assumed a compaction
 * could not be observed, so re-entry was to be nudged from `SessionStart`; in fact `PostCompact` fires at the
 * exact moment the context was lost. Both are wired, because `SessionStart` still catches the case where a
 * session died entirely rather than compacted, and both are READ-ONLY: they inject context and can never block.
 *
 * ## The danger is not blocking, it is UNBOUNDED blocking
 *
 * A stale gate that refuses is a session that cannot be ended, and it presents as inexplicable agent behaviour
 * rather than as "a hook stopped you". So every rule below closes one specific way a hook becomes a trap, and
 * none is a style preference:
 *
 *  - **Inert by default.** No open run → allow, immediately. The machine's resting state is a hook with no
 *    effect at all.
 *  - **Bounded by the harness's own signal.** A `Stop` payload carries `stop_hook_active`, which is true once a
 *    hook has already blocked this turn; the documented contract is to succeed while it is true. That is used
 *    rather than a counter of our own, because it cannot desync from what the harness believes. The harness
 *    additionally overrides after a fixed number of consecutive blocks, so a refusal loop is impossible by
 *    construction rather than by good behaviour.
 *  - **Staleness disarms.** A ledger naming a branch that no longer exists is a reason to REPORT, never to
 *    refuse.
 *  - **Never blocks a typed ending.** A recorded question, a finish and an abandon are all allowed exits. The
 *    escape from the gate is to write the question down, which is cheap and is itself the wanted artifact.
 *  - **A kill switch, honoured first.** Named in every refusal, so a blocked reader always has a way out.
 *  - **Fail OPEN.** Enforced by the entry file: any throw, any timeout, any unparseable state allows the stop.
 *    A crashing gate that blocks would be the worst object in this design.
 *  - **Only ever about THIS session's runs.** A run another session holds is never blocked on and never offered
 *    an exit, because every exit writes to that session's run. See {@link ./runOwner} — the gate without this
 *    was a mechanism for cross-session damage rather than a guard against abandonment.
 *  - **Only on state re-checked at this moment.** The tally in a refusal is evaluated when the gate fires, never
 *    read off a journal. See {@link ./gateReport} — the previous version reported an authored number as the
 *    reason to block, and it was wrong every single time it was hand-checked.
 *  - **Silent while the run is progressing.** A branch that gained a commit or a tally that improved is a
 *    session doing its job. Nine identical interruptions teach the reader to skip the tenth.
 *
 * What this honestly claims: the rules are put in front of the model every cycle, the state lives on disk, and
 * a session cannot silently end in an undefined state. NOT that the model will comply — a hook cannot make
 * anything reason correctly, and claiming otherwise would be the overclaim this whole feature exists to stop.
 *
 * Pure: the caller supplies the payload and the runs it found.
 */

import { absentAs } from "#lib/absent.js";
import { isRecord } from "#lib/parsers.js";
import type { RunClaim } from "../measurement/overlap.js";
import {
  anythingChecked,
  deltaLine,
  type GateObservation,
  type ProbeTally,
  type Progress,
  unmetOf,
} from "./gateReport.js";
import type { RunPhase } from "./ledger.js";
import type { AskSettlement } from "./rowKind.js";
import { foreignRunLine, mayMutate, type RunOwnership, type WriterLiveness } from "./runOwner.js";

/**
 * The env var that turns every gate here off. Named in every refusal, so a block is always escapable.
 *
 * Spelled to match the one house shape the owner ruled on, `SLOPWEAVER_ALLOW_<SUFFIX>`, so `src/hatch/registry.ts` can carry it without an
 * exception. {@link HOOK_KILL_SWITCH_PRIOR_SPELLING} is still honoured so a session that already exported the old
 * spelling is not stranded mid-run; refusals name the new one only.
 */
export const HOOK_KILL_SWITCH = "SLOPWEAVER_ALLOW_NO_RUN_GATE";

/** The pre-rename spelling, still read so an in-flight session keeps working. Never printed. */
export const HOOK_KILL_SWITCH_PRIOR_SPELLING = "SLOPWEAVER_NO_RUN_GATE";

/** One run the gate found on disk. */
export interface OpenRun {
  readonly slug: string;
  readonly phase: RunPhase;
  readonly branch: string | undefined;
  /**
   * Whether the recorded branch still resolves in the doc's repository.
   *
   * `false` is STALENESS, and staleness disarms. A ledger pointing at a deleted branch describes a run that no
   * longer exists in any actionable sense, and refusing on its behalf is precisely how a gate becomes haunted.
   */
  readonly branchResolves: boolean;
  /**
   * The probe tally RE-CHECKED as the gate fired.
   *
   * Not the journal's last snapshot, which is what the previous version quoted and labelled `unverified` in the
   * same breath as presenting it as grounds to block a turn.
   */
  readonly tally: ProbeTally;
  /** Which session holds this run, so the gate can tell its own work from a neighbour's. */
  readonly ownership: RunOwnership;
  /**
   * Whether the foreign holder is still alive — derived ONLY for an open run held elsewhere, `undefined` for
   * every other run, so closed and waiting journals never cost a pid probe. What it buys: the brief's
   * stand-off line can point a reader at the takeover that actually works instead of telling them to ask a
   * dead session for a release.
   */
  readonly writerLiveness: WriterLiveness | undefined;
  /** How many board docs claim the slug — claim needs one; a duplicate defeats every verb; "unknown" means
   * the board scan was partial, so no doc-dependent command may be recommended. */
  readonly docClaim: "one" | "none" | "duplicate" | "unknown";
  /** Whether the journal carries undecodable lines — every transfer verb refuses such a journal. */
  readonly journalAmbiguous: boolean;
  /** Whether the run has moved since the gate last looked at it. */
  readonly progress: Progress;
  /** What the gate recorded seeing last time, for the delta. `undefined` on a first look. */
  readonly previous: GateObservation | undefined;
  /** The branch head observed now, or `undefined` when it could not be read. */
  readonly head: string | undefined;
  /**
   * What this run claims to be building, or `undefined` when no doc on the board owns the slug.
   *
   * Carried so the brief can say WHAT a neighbouring session is building rather than only that one exists. Naming
   * the run was not enough: a session was told two unfamiliar door verbs belonged to another session and
   * launched a doc over that exact scope twenty-four minutes later.
   */
  readonly claim: RunClaim | undefined;
  /**
   * The owning row's settlement, or `undefined` when the row is unsettled or no single doc owns the slug.
   *
   * Carried so the brief never tells a session to take over landed work: a settled row's open cycle held by a
   * DEAD session is a missing ending, not work in flight, and `handover claim` on it would reopen what shipped.
   */
  readonly settled: { readonly settlement: AskSettlement; readonly witness: string | undefined } | undefined;
  /**
   * Whether the REAPER would close this cycle — its own decision, not a second reading of the same journal.
   *
   * Load-bearing, and measured by an adversarial review pass: this gate derives a phase with `runStateOf`
   * while the reaper derives a disposition with `runDisposition`, and the two disagree on a journal whose
   * `answered` event follows a `finished` one. Reading only the phase, the brief named `handover reap` over a
   * cycle the reaper skips as already finished, which is a command that writes nothing.
   */
  readonly reapable: boolean;
}

/** What the stop gate decided, and why — the reason is always printable. */
export type StopDecision =
  { readonly kind: "allow"; readonly why: string } | { readonly kind: "block"; readonly lines: readonly string[] };

/**
 * Whether the harness says a hook has already blocked this turn.
 *
 * @param payload the parsed hook payload
 * @returns true only when `stop_hook_active` is exactly `true`
 */
export function stopHookActive({ payload }: { payload: unknown }): boolean {
  return isRecord(payload) && payload["stop_hook_active"] === true;
}

/**
 * Whether one run is a reason to refuse a stop.
 *
 * Five conditions, each closing one way the gate was wrong or unhelpful. Only an `open` run qualifies (a
 * recorded question, a finish and an abandon are all typed endings); its branch must still resolve (staleness
 * disarms); it must not be held by another session (every exit would mutate that session's run); at least one
 * probe must actually have returned an answer (blocking on ignorance is not blocking on evidence); and it must
 * not have moved since the gate last looked (a run making progress is not an abandoned one).
 */
function blocksStop({ run }: { run: OpenRun }): boolean {
  return (
    run.phase === "open" &&
    run.branchResolves &&
    mayMutate({ ownership: run.ownership }) &&
    anythingChecked({ tally: run.tally }) &&
    run.progress.kind !== "moved"
  );
}

/** Why one non-blocking open run was let through, in the words the `allow` reason prints. */
function standDownReason({ run }: { run: OpenRun }): string | undefined {
  if (run.phase !== "open") {
    return undefined;
  }
  if (!run.branchResolves) {
    return `${run.slug} names a branch that no longer exists`;
  }
  if (!mayMutate({ ownership: run.ownership })) {
    return run.ownership.kind === "released"
      ? `${run.slug} was released and has not been claimed since`
      : `${run.slug} is held by another session`;
  }
  if (!anythingChecked({ tally: run.tally })) {
    return `${run.slug} has no probe anything could evaluate`;
  }
  return run.progress.kind === "moved" ? `${run.slug} is progressing (${run.progress.because})` : undefined;
}

/**
 * Decide whether a session may stop.
 *
 * @param payload the parsed `Stop` hook payload, read only for `stop_hook_active`
 * @param runs every run journal the caller found
 * @param env the environment, read only for the kill switch
 * @returns the decision, carrying the exact lines to print when it blocks
 */
export function stopGateDecision({
  payload,
  runs,
  env,
}: {
  payload: unknown;
  runs: readonly OpenRun[];
  env: NodeJS.ProcessEnv;
}): StopDecision {
  if (env[HOOK_KILL_SWITCH] === "1" || env[HOOK_KILL_SWITCH_PRIOR_SPELLING] === "1") {
    return { kind: "allow", why: `${HOOK_KILL_SWITCH}=1` };
  }
  // The harness's own signal, checked next (only the kill switch outranks it). It is true once this gate has
  // already blocked this turn, and the documented contract is to succeed while it is — one refusal, then it
  // disarms.
  if (stopHookActive({ payload })) {
    return { kind: "allow", why: "already blocked once this turn (stop_hook_active)" };
  }
  const blocking = runs.filter((run) => blocksStop({ run }));
  if (blocking.length === 0) {
    const stoodDown = runs.map((run) => standDownReason({ run })).filter((why): why is string => why !== undefined);
    return {
      kind: "allow",
      why: stoodDown.length === 0 ? "no run is open" : stoodDown.join("; "),
    };
  }
  return { kind: "block", lines: blockLines({ runs: blocking }) };
}

/**
 * The refusal, which must be actionable in one read.
 *
 * The FIRST line is the delta, not a restatement — a gate that says the same thing nine times teaches the reader
 * to skip it, and that is measured rather than feared. Every escape is then spelled out. A refusal the reader
 * cannot act on is the thing that makes hooks feel haunted, and one instance of that is enough to justify
 * deleting this gate.
 *
 * Every run reaching here is one this session may act on: {@link blocksStop} has already dropped anything held
 * elsewhere, so no line below can point a session at a neighbour's run.
 */
function blockLines({ runs }: { runs: readonly OpenRun[] }): readonly string[] {
  const lines = [
    `slopweaver run gate — ${String(runs.length)} of THIS session's orchestration run(s) is still OPEN:`,
    "",
  ];
  for (const run of runs) {
    lines.push(
      `  ${deltaLine({ head: run.head, previous: run.previous, slug: run.slug, tally: run.tally })}`,
      `      ${String(run.tally.passed)} passing, ${String(run.tally.failed)} failing, ${String(run.tally.notEvaluated)} unexamined${run.branch === undefined ? "" : ` — on ${run.branch}`}`,
      `      slopweaver handover resume ${run.slug}`,
    );
  }
  lines.push(
    "",
    "Any ONE of these ends the run legitimately:",
    ...runs.flatMap((run) => [
      `  record what you are blocked on:  slopweaver handover ask ${run.slug} --question "<question>"`,
      `  close it out:                    slopweaver handover finish ${run.slug}`,
      `  give up on it:                   slopweaver handover abandon ${run.slug} --why "<reason>"`,
    ]),
    "",
    `This gate blocks at most once per turn and disarms itself. To switch it off entirely: ${HOOK_KILL_SWITCH}=1`,
  );
  return lines;
}

/**
 * The runs this session may record a `gated` observation against.
 *
 * Broader than {@link blocksStop} in one direction and narrower in another, deliberately. A PROGRESSING run is
 * included even though it did not block, because the whole point of the record is that the next firing compares
 * against the latest thing seen — omitting it would leave the baseline frozen at the last interruption and make
 * the delta grow stale. A run held ELSEWHERE is excluded, because appending to its journal is the cross-session
 * write this change exists to prevent.
 *
 * @param runs every run the caller found
 * @returns the runs whose journals this session may append to
 */
export function observableRuns({ runs }: { runs: readonly OpenRun[] }): readonly OpenRun[] {
  return runs.filter((run) => run.phase === "open" && run.branchResolves && mayMutate({ ownership: run.ownership }));
}

/**
 * What a foreign run is building, for the brief.
 *
 * Printed only for a claim that still STANDS. An expired claim names files nobody is holding, and a brief that
 * warned about those would train the reader to ignore the ones that matter. The gaps are stated alongside, so a
 * partial claim never reads as a complete inventory.
 */
function claimLines({ run }: { run: OpenRun }): readonly string[] {
  const claim = run.claim;
  if (claim === undefined || !claim.liveness.live || claim.paths.length === 0) {
    return [];
  }
  const gaps =
    claim.blind.length === 0 ? "" : ` It does NOT cover: ${claim.blind.join("; ")}, so assume it claims more.`;
  return [`   It is building: ${claim.paths.join(", ")}.${gaps} Do not start work on those paths.`];
}

/**
 * The line for an open cycle on a SETTLED row whose holder is dead — or `undefined` for every other run.
 *
 * MEASURED: five atlas asks settled `answered` on merged pull requests still had cycles ending at `launched`, and
 * this brief told each fresh session "that session is DEAD … take the run over with `handover claim`" — an
 * instruction to reopen landed work. This repository's own SessionStart brief said it about a card row settled
 * `answered` on a merged pull request.
 *
 * Three conditions, and each closes one way the line could mislead. The row must be settled and claimed by
 * exactly ONE doc, because a partial board scan could have skipped a second claimant and the existing
 * board-unreadable line speaks there instead. The run must be held ELSEWHERE, since this session's own run is
 * not something to hand back. And {@link OpenRun.reapable} must be the REAPER's own verdict, so the line can
 * never name a `handover reap` that would skip this cycle — a live or unjudgeable holder, an unreadable
 * journal and a cycle the reaper reads as already ended are all excluded by that one test.
 */
function settledDeadRunLine({ run }: { run: OpenRun }): string | undefined {
  if (run.settled === undefined || run.docClaim !== "one" || run.ownership.kind !== "elsewhere" || !run.reapable) {
    return undefined;
  }
  return (
    `✓ The run "${run.slug}" belongs to a row already settled ${run.settled.settlement} ` +
    `(witness: ${absentAs({ value: run.settled.witness, whenAbsent: "none recorded" })}) — there is nothing to take over; do NOT claim it. ` +
    `Its session ${run.ownership.writer.sessionId} died without closing the cycle, and ` +
    "`slopweaver handover reap` writes the ending it never could."
  );
}

/**
 * The brief a session is handed at start, and again after a compaction.
 *
 * Read-only by construction — it returns text to inject and has no way to refuse anything. A run waiting on the
 * owner is stated FIRST, because that is the case an abandoned run most needs to announce.
 *
 * ## This is where a foreign run is reported, and the interrupt is not
 *
 * "Another session is driving this" is information a reading session cannot act on, so it does not belong in the
 * channel that blocks a turn. It does belong somewhere — a session that starts in a worktree whose run is held
 * elsewhere needs to know before it touches the branch, and that collision is what produced two competing
 * all-green PRs for one fix. So the read-only brief names the holder and says which verbs are off-limits, and
 * the stop gate stays silent about it entirely.
 *
 * @param runs every run journal the caller found
 * @param flagSuffix the caller's non-default routing flags, embedded in recommended invocations
 * @param readerIdentified whether the hooked session could identify itself — takeover verbs need identity
 * @returns the lines to inject, empty when there is nothing to say
 */
export function runBriefLines({
  runs,
  flagSuffix,
  readerIdentified,
}: {
  runs: readonly OpenRun[];
  flagSuffix: string;
  readerIdentified: boolean;
}): readonly string[] {
  const waiting = runs.filter((run) => run.phase === "waiting-on-owner");
  const open = runs.filter((run) => run.phase === "open");
  if (waiting.length === 0 && open.length === 0) {
    return [];
  }
  const lines: string[] = [];
  for (const run of waiting) {
    lines.push(
      `⏸ The orchestration run "${run.slug}" is WAITING ON THE OWNER. Do not resume it until answered.`,
      `   slopweaver handover resume ${run.slug}`,
    );
  }
  for (const run of open) {
    const settled = settledDeadRunLine({ run });
    if (settled !== undefined) {
      lines.push(settled);
      continue;
    }
    const foreign = foreignRunLine({
      docClaim: run.docClaim,
      flagSuffix,
      journalAmbiguous: run.journalAmbiguous,
      liveness: run.writerLiveness,
      ownership: run.ownership,
      phase: run.phase,
      readerIdentified,
      slug: run.slug,
    });
    if (foreign !== undefined) {
      lines.push(foreign, ...claimLines({ run }));
      continue;
    }
    lines.push(
      `▶ The orchestration run "${run.slug}" is OPEN${run.branchResolves ? "" : " (its branch no longer exists)"} with ${String(unmetOf({ tally: run.tally }))} of ${String(run.tally.passed + unmetOf({ tally: run.tally }))} probe(s) unmet, re-checked just now.`,
      `   Run this BEFORE anything else — it rebuilds the brief from the journal, not from memory:`,
      `   slopweaver handover resume ${run.slug}`,
    );
  }
  return lines;
}
