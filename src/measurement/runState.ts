/**
 * What a run's journal says has happened to it, and whether its work has measurably landed — both derived,
 * never stored.
 *
 * ## This is not the deleted fleet driver
 *
 * A prior version of this file also decided what an automated driver should do next — launch, resume or stop a
 * headless `claude -p` turn. That decision engine is gone along with the driver that acted on it (`fleet up`,
 * `src/fleet/driveLoop.ts`): AGENTS.md rule 2 bans a headless, detached agent outright, so there is no longer
 * anything to decide FOR. What is left here is pure journal derivation — facts, not actions.
 *
 * Those facts still matter with no driver in the picture. `handover start` (a human, in a visible session)
 * journals the exact same `launched` event a driven turn used to, so that a run's journal can name which
 * session opened it. `driveStateOf` below reads that fact regardless of which verb wrote it, and `fleet status`
 * uses it to report whether a session is attached to a run — a plain measurement, not a launch decision.
 *
 * ## Completion is measured, never self-reported
 *
 * An agent claiming success is not evidence, so {@link completionOf} asks the world instead: the branch is on
 * the remote, a pull request is open, the doc's own probes pass, and the PR's checks are green. Measured: both of the costliest attention drains sat downstream of "branch pushed and PR open" — a pull
 * request whose unit tests went red on the very commit its agent reported as done, and a capped ingest that
 * silently never wrote its watermark. Neither needed a human; both needed the agent to still be watching.
 *
 * ## A recorded question ends a run's drive — and an ANSWER releases it
 *
 * If the agent runs `handover ask`, the run parks on the owner and does not nag. That is the repo's standing
 * rule — writing down what only the owner can settle is the wanted artifact. The other half of that ending:
 * measured, an `answered` stamped after a `drive-ended` releases it, and the release resets that
 * accounting rather than merely un-setting a flag. See {@link DriveState.releasedByAnswer} for why the
 * difference is the whole fix.
 */

import type { RunEvent, RunPhase } from "../handover/ledger.js";
import type { CheckRollup } from "./status.js";

/**
 * A run's phase as this module sees it, with "nobody has ever started this" kept apart from "it is closed".
 *
 * `RunState`'s own `closed` covers both, and defaulting to it is right for the lifecycle verbs — nothing is
 * open, so nothing may be answered or finished. Here it was a defect: `NO_RUN.phase` is `closed`, so a
 * newly-created run reported itself `settled` before its first turn. See the measured defect this fixed.
 *
 * So this distinguishes them: `no-run` means nothing has been journalled for this doc yet.
 */
export type DrivePhase = RunPhase | "no-run";

/** The measurable consequences of a workstream's work having landed. */
export interface CompletionFacts {
  /** Whether the doc's branch exists on the remote. */
  readonly branchOnRemote: boolean;
  /** Whether a pull request is open for it. */
  readonly prOpen: boolean;
  /** What the PR's check rollup says. */
  readonly checks: CheckRollup;
  /** How many of the doc's declared probes fail. */
  readonly probesFailing: number;
  /** How many were never examined. Counted apart, because "nothing looked" is not "it passed". */
  readonly probesUnchecked: number;
}

/** Whether the work is done, and — when it is not — exactly what is missing. */
export interface Completion {
  readonly complete: boolean;
  /** One phrase per unmet condition, in the order a reader would fix them. Empty iff `complete`. */
  readonly missing: readonly string[];
}

/**
 * Whether a workstream's work has measurably landed.
 *
 * Every condition is a question put to the world, and the reason each is here is that the alternative was
 * believing the agent. A `pending` or `unknown` rollup is NOT green: the first means the answer has not
 * arrived, the second that nothing could ask, and treating either as done is the overclaim the whole probe
 * design exists to remove.
 *
 * @param facts the measured facts
 * @returns whether it is complete, and what is missing when it is not
 */
export function completionOf({ facts }: { facts: CompletionFacts }): Completion {
  const missing: string[] = [];
  if (!facts.branchOnRemote) {
    missing.push("the branch is not on the remote");
  }
  if (!facts.prOpen) {
    missing.push("no pull request is open for it");
  }
  if (facts.probesFailing > 0) {
    missing.push(`${String(facts.probesFailing)} declared probe(s) still fail`);
  }
  if (facts.probesUnchecked > 0) {
    missing.push(`${String(facts.probesUnchecked)} declared probe(s) were never examined`);
  }
  missing.push(...checksMissing({ checks: facts.checks }));
  return { complete: missing.length === 0, missing };
}

/** The check rollup's contribution to the missing list. Only `green` contributes nothing. */
function checksMissing({ checks }: { checks: CheckRollup }): readonly string[] {
  switch (checks) {
    case "green":
      return [];
    case "failing":
      return ["the pull request's checks are failing"];
    case "pending":
      return ["the pull request's checks have not finished"];
    case "none":
      return ["the pull request reports no checks at all"];
    case "unknown":
      return ["the pull request's check rollup could not be read"];
  }
}

/** What a run journal says about a run's DRIVE — the session that opened it and any turns it recorded. */
export interface DriveState {
  /** The session recorded as driving this run, or `undefined` when nothing has been launched. */
  readonly sessionId: string | undefined;
  /**
   * The process id of the CURRENT turn, so liveness is a question about a real process rather than a guess.
   *
   * Folded from the last `launched` OR `resumed` that recorded one, not from the launch alone. A resume spawns a
   * new child — `claude -p` is one turn — so the launch pid is dead from turn two onwards. Reading only the
   * launch was therefore a probe about a process that had legitimately exited: it made a running drive answer
   * "not alive", which the pane printed as "the recorded process is NOT running" and which a reaper would have
   * taken as licence to end a healthy drive.
   */
  readonly pid: number | undefined;
  /**
   * Whether {@link pid} is this turn's process, or an earlier turn's that a journal never updated.
   *
   * Only a journal written before `resumed` carried a pid can be `false` here, and it exists so a reader can
   * decline to act rather than act on a stale fact.
   */
  readonly pidIsCurrentTurn: boolean;
  /** The worktree the current drive launched in. */
  readonly worktree: string | undefined;
  /** Turns spent: the launch plus every resume. */
  readonly attempts: number;
  /** When the current drive launched, so wall clock is measured rather than guessed. */
  readonly launchedIso: string | undefined;
  /** Whether a `drive-ended` was written after the last launch AND no later `answered` has released it. */
  readonly ended: boolean;
  /** When the `drive-ended` still in force was written, or `undefined` when none is. */
  readonly endedIso: string | undefined;
  /**
   * The owner's answer that released this drive's ending, when one did.
   *
   * Its presence is what distinguishes "no drive has ever run here" from "the drive that ran here is over and the
   * owner has authorised another", and the two must not print the same sentence. It also carries the answer TEXT,
   * because the next turn is launched precisely BECAUSE of that answer — a turn told to continue without being
   * told what the owner decided has learnt nothing, which is the same silent loss in a different place.
   */
  readonly releasedByAnswer: string | undefined;
  /** How many `said` messages have no matching `delivered` — an undelivered instruction, made visible. */
  readonly undelivered: number;
}

/** A drive nobody has started. The state a reader defaults to, so nothing is ever assumed live. */
export const NO_DRIVE: DriveState = {
  attempts: 0,
  ended: false,
  endedIso: undefined,
  launchedIso: undefined,
  pid: undefined,
  // Vacuously true: there is no turn, so no pid can be behind one. A reader with no pid at all is stopped by
  // `pid === undefined` long before this field, and defaulting it to `false` would report a staleness that has
  // no turn to be stale about.
  pidIsCurrentTurn: true,
  releasedByAnswer: undefined,
  sessionId: undefined,
  undelivered: 0,
  worktree: undefined,
};

/**
 * Whether an `answered` releases a `drive-ended` — the rule that makes `ask` → answer → continue a loop.
 *
 * Compared by TIMESTAMP rather than by deleting the ending, because the on-disk `drive-ended` read is what makes
 * a deliberate stop work across processes and that must keep working: a `drive-ended` stamped LATER than an
 * answer still holds, so the owner can answer, change their mind, and stop it again.
 *
 * A tie does not release, and neither does an unparseable stamp. Both are ambiguous, and the safe direction for
 * an ambiguous stop is to stay stopped.
 *
 * @param endedIso when the `drive-ended` in force was written, or `undefined` when none is
 * @param answeredIso when the owner answered, or `undefined` when nobody has
 * @returns true only when both stamps parse and the answer is strictly the later of the two
 */
export function answeredAfterEnding({
  endedIso,
  answeredIso,
}: {
  endedIso: string | undefined;
  answeredIso: string | undefined;
}): boolean {
  if (endedIso === undefined || answeredIso === undefined) {
    return false;
  }
  const ended = Date.parse(endedIso);
  const answered = Date.parse(answeredIso);
  return Number.isFinite(ended) && Number.isFinite(answered) && answered > ended;
}

/**
 * Derive a run's drive state from its journal.
 *
 * Only the MOST RECENT `launched` counts, the same way `runStateOf` reads only from the last `started`: a
 * workstream may legitimately be driven more than once, and folding old drives in would leave a finished one
 * looking permanently live and its attempts double-counted.
 *
 * @param events the journal's events, in order
 * @returns the derived drive state, or {@link NO_DRIVE} when nothing has been launched
 */
export function driveStateOf({ events }: { events: readonly RunEvent[] }): DriveState {
  const lastLaunch = events.map((event) => event.kind).lastIndexOf("launched");
  if (lastLaunch === -1) {
    return NO_DRIVE;
  }
  const launch = events[lastLaunch];
  let state: DriveState =
    launch?.kind === "launched"
      ? {
          ...NO_DRIVE,
          attempts: 1,
          launchedIso: launch.atIso,
          pid: launch.pid,
          sessionId: launch.sessionId,
          worktree: launch.worktree,
        }
      : NO_DRIVE;
  for (const event of events.slice(lastLaunch + 1)) {
    state = applyDriveEvent({ event, state });
  }
  return state;
}

/** Fold one post-launch event into the derived drive state. */
function applyDriveEvent({ state, event }: { state: DriveState; event: RunEvent }): DriveState {
  switch (event.kind) {
    case "resumed":
      return resumedDrive({ pid: event.pid, state });
    case "said":
      return { ...state, undelivered: state.undelivered + 1 };
    case "delivered":
      // Floored at zero rather than trusting the arithmetic: a journal is append-only and hand-editable, and
      // a negative "undelivered" would print as a fact about a message that never existed.
      return { ...state, undelivered: Math.max(0, state.undelivered - event.count) };
    case "drive-ended":
      // The release, if there was one, is superseded: a stop stamped after an answer is the owner changing their
      // mind, and keeping the answer alongside it would let the next reader think the drive was still released.
      return { ...state, ended: true, endedIso: event.atIso, releasedByAnswer: undefined };
    case "answered":
      return answeredAfterEnding({ answeredIso: event.atIso, endedIso: state.endedIso })
        ? releasedDrive({ answer: event.answer, state })
        : state;
    case "started":
    case "probed":
    case "amended":
    case "question":
    case "question-posted":
    case "question-corrected":
    case "question-offered":
    case "question-reconfirmed":
    case "question-examples":
    case "question-shot":
    case "question-withdrawn":
    case "question-shaped":
    case "lessons":
    case "finished":
    case "closed":
    case "abandoned":
    case "orphaned":
    case "artifact":
    case "launched":
    case "claimed":
    case "released":
    case "parked":
    case "park-cleared":
    case "park-wake-suspended":
    case "steer-risk":
    case "gated":
    case "dispatched":
    case "signed-off":
    case "tagged":
    case "ruling":
      // `ruling` is inert here even though `answered` above is not, and the difference is the point: an
      // answer RELEASES a drive that stopped waiting for one, while a ruling only records what the owner
      // decided about the row. Treating one as the other would restart a drive nobody answered.
      //
      // `gated` is inert here for the same reason the rest are: the stop gate observing a run says nothing about
      // the DRIVE. It fires in whichever session hit its Stop hook — often the owner's own foreground one — so
      // counting it would inflate `attempts` with turns no driver ever spent. `dispatched` and `signed-off` are
      // inert for the same reason from the other side: they are the SUPERVISOR acting on the run, and a
      // supervisor is not a driver — counting either would attribute someone else's turn to the drive.
      return state;
  }
}

/**
 * One resume: a turn spent, and — when the journal recorded one — a NEW pid for that turn's process.
 *
 * A resume with no recorded pid keeps the pid it had and marks it not-current, which is the only honest reading
 * of an older journal: the number is real, it is simply about a process from an earlier turn.
 */
function resumedDrive({ state, pid }: { state: DriveState; pid: number | undefined }): DriveState {
  if (pid === undefined) {
    return { ...state, attempts: state.attempts + 1, pidIsCurrentTurn: false };
  }
  return { ...state, attempts: state.attempts + 1, pid, pidIsCurrentTurn: true };
}

/**
 * The state an answer leaves behind: that drive is OVER, and the run is drivable again.
 *
 * Resetting the accounting rather than only clearing the flag is the difference between a fix and a cosmetic
 * one. The session id goes too, so the next turn a reader sees journalled is a LAUNCH rather than a resume.
 *
 * The WORKTREE is kept, because it is where the previous drive's commits are and the pane measures git in it.
 */
function releasedDrive({ state, answer }: { state: DriveState; answer: string }): DriveState {
  return { ...NO_DRIVE, releasedByAnswer: answer, undelivered: state.undelivered, worktree: state.worktree };
}
