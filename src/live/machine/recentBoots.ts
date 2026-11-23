/**
 * Boots in flight — the sessions that started so recently the 1-minute load average cannot see them yet.
 *
 * ## The defect this reading closes
 *
 * The capacity gate read the load BEFORE each spawn and nothing else about CPU, so six boots opened in one
 * pass and the load reached 45.9 before the next reading. That is the gauge's own arithmetic rather than bad
 * luck: macOS's 1-minute load is an exponentially-damped average with a 60 s time constant, so a step in
 * runnable work shows 63% of itself after 60 s and 95% after 180 s (1 − e^−3). A spawn that reads the load
 * seconds after the previous one booted reads the load from BEFORE that boot, and every spawn in a quick
 * list reads the same pre-burst number. Reproduce the lag: `sysctl -n vm.loadavg` immediately after a spawn,
 * and again three minutes later.
 *
 * ## Why the registry and `ps`, and not a ledger of spawns
 *
 * Both inputs are reads `machine capacity` already takes — `~/.claude/sessions/<pid>.json` (the `sessions`
 * seam) and `ps -o etime` (the `elapsed` seam) — so every boot counts whichever path opened it: `cmux spawn`,
 * `automation seat`, `turn dispatch`, or a session the owner opened by hand. A ledger written by one spawn verb would
 * see only that verb, and would need a writer that can fail. Reproduce a reading:
 * `for f in ~/.claude/sessions/*.json; do ps -o pid=,etime= -p "$(basename "$f" .json)"; done`.
 *
 * Residue, stated: a Codex-hosted seat does not register in Claude's session registry, so it is not counted
 * here; the load hold still reads it once the load catches up. A pid reused after its session exited is not
 * detectable from one `ps` snapshot, the same residue `./sessionOwner.ts` states.
 *
 * ## The two numbers, and which one is measured
 *
 * {@link BOOT_WINDOW_SECONDS} is the load average's own 3τ — after it, the load hold sees the boot, so this
 * reading stops needing to. {@link DEFAULT_RECENT_BOOTS_HOLD} is a JUDGEMENT, not a measurement: a boot's
 * CPU is mostly its hooks and children, which exit and cannot be read after the fact (the `claude` process
 * itself drew 19.5 CPU-s over its first five minutes on this machine —
 * `ps -o etime=,time= -p <pid>`). The hold is six per window, so a six-in-one-pass burst starts whole and the
 * seventh waits for the load hold to read the first six. The window is NOT widened: it is the gauge's own 3τ,
 * and widening it would hold more boots, the opposite of what the owner wants.
 */
import { NOT_STANDING } from "./capacityVerdict.js";
import type { ProcessElapsed } from "./fleetLoad.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** How recently a session must have started to count as in flight — the 1-minute load average's 3τ. */
export const BOOT_WINDOW_SECONDS = 180;

/** How many boots in flight HOLD a spawn. A judgement, sized in this module's header. */
export const DEFAULT_RECENT_BOOTS_HOLD = 6;

/**
 * One live session that started inside the boot window.
 *
 * @internal
 */
export interface RecentBoot {
  readonly pid: number;
  readonly sessionId: string;
  readonly cwd: string;
  /** How long its process has been running. */
  readonly seconds: number;
}

/** What the boot reading found, and the thresholds it was judged against. */
export interface RecentBootsReading {
  /** Every session inside the window, newest first. */
  readonly boots: readonly RecentBoot[];
  readonly windowSeconds: number;
  /** The count at or above which a spawn HOLDs. */
  readonly hold: number;
}

/**
 * The live sessions whose process started less than `windowSeconds` ago, newest first. A session whose pid
 * `ps` did not list is not counted: with no elapsed time there is nothing to say it is young.
 *
 * @param sessions every live Claude Code session the registry names
 * @param elapsedRows how long each process has been running, from `ps -o etime`
 * @param windowSeconds how recent a start still counts as in flight
 * @param hold the count at or above which a spawn holds
 * @returns the sessions in flight and the thresholds they were judged against
 */
export function recentBoots({
  sessions,
  elapsedRows,
  windowSeconds = BOOT_WINDOW_SECONDS,
  hold = DEFAULT_RECENT_BOOTS_HOLD,
}: {
  sessions: readonly ClaudeSession[];
  elapsedRows: readonly ProcessElapsed[];
  windowSeconds?: number;
  hold?: number;
}): RecentBootsReading {
  const secondsByPid = new Map(elapsedRows.map((row) => [row.pid, row.seconds]));
  const boots: RecentBoot[] = [];
  for (const session of sessions) {
    const seconds = secondsByPid.get(session.pid);
    if (seconds !== undefined && seconds < windowSeconds) {
      boots.push({ cwd: session.cwd, pid: session.pid, seconds, sessionId: session.sessionId });
    }
  }
  return { boots: boots.toSorted((left, right) => left.seconds - right.seconds), hold, windowSeconds };
}

/**
 * Whether the boots in flight have reached the hold.
 *
 * @param reading the boot reading
 * @returns true when a spawn now would add to a burst the load average cannot yet see
 */
export function recentBootsHolding({ reading }: { reading: RecentBootsReading }): boolean {
  return reading.boots.length >= reading.hold;
}

/**
 * The clause a verdict prints for a boots hold — the count, the window, the threshold, and why the load
 * itself does not already say so.
 *
 * @param reading the boot reading
 * @returns one clause, e.g. `3 sessions booted in the last 3m, hold at 3 — the 1-min load cannot see them yet`
 */
export function recentBootsClause({ reading }: { reading: RecentBootsReading }): string {
  const count = reading.boots.length;
  const noun = count === 1 ? "session" : "sessions";
  return (
    `${String(count)} ${noun} booted in the last ${windowPhrase({ seconds: reading.windowSeconds })}, ` +
    `hold at ${String(reading.hold)} — the 1-min load cannot see them yet`
  );
}

/** {@link NOT_STANDING} read against a subject a `--json` document carries as plain text. */
const NOT_STANDING_TEXT: ReadonlySet<string> = NOT_STANDING;

/**
 * Whether a hold is about the MACHINE rather than only about boots in flight or a full disk. A boots-only hold
 * is a pause that clears itself inside the window, and a disk-only hold is cleared by `worktree prune`: each must
 * hold a spawn, but neither is an anomaly to investigate — seating an investigation into one is one more boot,
 * and one more worktree on a full volume — nor a `capacity-hold` for the sweep to react to, nor a hold the tick
 * must answer for. A hold naming no subject (a document older than subjects) counts as the machine, because a
 * gate that reads silence as clean is the failure every gate here refuses.
 *
 * @param hold the report's `hold`
 * @param holdSubjects the report's `holdSubjects`, as the report or its `--json` document carries them
 * @returns true when something other than boots in flight or the disk floor is holding
 */
export function machineHoldStands({ hold, holdSubjects }: { hold: boolean; holdSubjects: readonly string[] }): boolean {
  return hold && (holdSubjects.length === 0 || holdSubjects.some((subject) => !NOT_STANDING_TEXT.has(subject)));
}

/**
 * Whether a `--wait` spawn should keep waiting on this hold. Boots clear with time, so a wait outlasts them; the
 * disk floor does not clear while anything waits — `./read.ts` reads the disk once per process, and only
 * `worktree prune` frees it — so a disk-only hold never blocks a wait, which would otherwise time out every reseat. A hold naming
 * no subject blocks, for the reason {@link machineHoldStands} gives.
 *
 * @param hold the report's `hold`
 * @param holdSubjects the report's `holdSubjects`
 * @returns true when something other than the disk floor is holding
 */
export function holdBlocksWait({ hold, holdSubjects }: { hold: boolean; holdSubjects: readonly string[] }): boolean {
  return hold && (holdSubjects.length === 0 || holdSubjects.some((subject) => subject !== "disk"));
}

/** A window as the shortest honest phrase: whole minutes when it is whole minutes, seconds otherwise. */
function windowPhrase({ seconds }: { seconds: number }): string {
  return seconds % 60 === 0 ? `${String(seconds / 60)}m` : `${String(seconds)}s`;
}
