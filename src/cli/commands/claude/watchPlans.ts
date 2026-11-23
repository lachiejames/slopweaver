/**
 * Which plans one `claude watch` run actually ticks, and what it says on the way in.
 *
 * Split out of `./watch.ts` because it is a real seam rather than a size trick: the loop's subject is the
 * plans the fleet MAY SPEND, which is not the same list as the plans the install has configured. A paused
 * plan is configured, deliberately out, and must be neither probed nor silently absent — and deciding that
 * inside the loop's own shell is what made a watch report a quieter fleet than exists.
 *
 * The announcement is a LIST rather than a string, so the caller writes one line per notice and a run with
 * nothing to announce writes nothing. A renderer returning `""` would have the shell print a blank line.
 */
import { pausedPlanLine } from "../../../claude/config.js";
import { type ClaudeAccount, probedClaudeAccount } from "../../../claude/contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "../../../claude/errors.js";
import { readClaudeFleet } from "../../../claude/spawnAccounts.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import type { ClaudeThresholds } from "../../../plans/thresholds.js";

/** The plans a watch run ticks, and the plans it deliberately will not. */
export interface ClaudeWatchPlans {
  /** Every configured plan that is neither paused nor monthly-spend — the list the loop probes and keeps alive. */
  readonly live: readonly ClaudeAccount[];
  /** One line per paused plan, saying what it is out for and since when. */
  readonly pausedLines: readonly string[];
  /**
   * Every unpaused monthly-spend plan. Each probe is a billed request and a rate-limit header says nothing about
   * dollars, so the loop never probes one's STORE; each tick judges it on its
   * recorded spend instead (`../../../claude/spendBudgets.ts`), off the local ledger and never the provider. The
   * tick's active-slot probe (`./watch.ts` `sweep`) is not this list's to filter: it reads whatever account the
   * shared slot holds in order to identify it, so a slot left on a monthly-spend account is still probed there,
   * exactly as on main.
   */
  readonly monthly: readonly ClaudeAccount[];
  /** One line per monthly-spend plan, saying it is judged on its recorded spend rather than probed. */
  readonly monthlyLines: readonly string[];
  /** The install's Claude thresholds, off the same register read, so each tick's trigger judges by today's bars. */
  readonly thresholds: ClaudeThresholds;
}

/**
 * Resolve the plans this watch run ticks from the install's own register.
 *
 * Through `readClaudeFleet` rather than the accounts file directly, so this loop and a spawn agree about
 * which fleet exists: after `slopweaver plans add` the register is the source and the accounts file is a
 * projection of it, and a second reader of the projection would tick whatever was last generated.
 *
 * An install with NOTHING configured is a failure HERE, unlike at a spawn, where it means the ambient slot.
 * A watch run's whole subject is the plans it ticks, so a run with none has nothing to do and says so rather
 * than looping over an empty fleet reporting it healthy.
 *
 * @param home the Slopweaver home whose register names the fleet
 * @param port where the plan register is read
 * @returns the live plans and the paused plans' notices, or the reason the configuration is unusable
 */
export async function watchPlans({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<ClaudeWatchPlans, ClaudeRotationError>> {
  const read = await readClaudeFleet({ home, port });
  if (read.isErr()) {
    return err(read.error);
  }
  const { accounts: configured, thresholds } = read.value;
  if (configured === undefined) {
    return err(
      ClaudeRotationErrors.accountConfigInvalid({
        problems: ["this install registers no Claude destination, so there is no fleet to watch"],
      }),
    );
  }
  const pausedLines = configured.flatMap((account) => {
    const line = pausedPlanLine({ account });
    return line === undefined ? [] : [line];
  });
  const unpaused = configured.filter((account) => account.paused === undefined);
  const monthly = unpaused.filter((account) => !probedClaudeAccount({ account }));
  const monthlyLines = monthly.map(
    (account) =>
      `${account.alias} is a monthly-spend plan: never probed, judged each tick on its spend reading — \`slopweaver claude spend --plan ${account.alias}\` records one, evidence for an hour`,
  );
  const live = unpaused.filter((account) => probedClaudeAccount({ account }));
  return ok({ live, monthly, monthlyLines, pausedLines, thresholds });
}

/**
 * Everything a watch run says before its first tick, one line each.
 *
 * The standing-loop line is suppressed on `--once`, where there is no interval to describe and the run is
 * over before a reader could act on it. The paused notices are NOT: a one-shot read of a fleet with a plan
 * deliberately out is exactly the read that must not report four healthy plans as the whole fleet.
 *
 * @param interval how many minutes apart the ticks are
 * @param once whether this is a single tick rather than a standing loop
 * @param plans what {@link watchPlans} resolved
 * @returns the lines to write to stderr, in order, possibly none
 */
export function watchOpeningLines({
  interval,
  once,
  plans,
}: {
  interval: number;
  once: boolean;
  plans: ClaudeWatchPlans;
}): readonly string[] {
  const standing = `watching ${String(plans.live.length)} plan(s) every ${String(interval)} minute(s), rotating when one runs out. Pass --dry-run to report without writing. Interrupt to stop.`;
  const notices = [...plans.pausedLines, ...plans.monthlyLines].map((line) => `claude watch: ${line}`);
  return [...notices, ...(once ? [] : [standing])];
}

/**
 * What a standing watch says when a tick's re-read of the register changed which plans it ticks — a plan resumed,
 * paused, added or removed while it ran — one line each, and nothing when the set is the same.
 *
 * @param previous the plans the last tick watched
 * @param next the plans this tick's re-read resolved
 * @returns the lines to write to stderr, in alias order, possibly none
 */
export function watchPlanChangeLines({
  previous,
  next,
}: {
  previous: ClaudeWatchPlans;
  next: ClaudeWatchPlans;
}): readonly string[] {
  const before = new Set(previous.live.map((account) => account.alias));
  const after = new Set(next.live.map((account) => account.alias));
  const joined = [...after].filter((alias) => !before.has(alias)).toSorted();
  const left = [...before].filter((alias) => !after.has(alias)).toSorted();
  if (joined.length === 0 && left.length === 0) {
    return [];
  }
  const count = `now watching ${String(after.size)} plan(s)`;
  return [
    ...joined.map((alias) => `claude watch: ${alias} is back in the register's live plans — ${count}`),
    ...left.map((alias) => `claude watch: ${alias} left the register's live plans — ${count}`),
  ];
}

/**
 * A standing watch's re-read of the register between ticks. Without it a plan resumed mid-run was never probed
 * again until the watch restarted, so the drawdown journal held no sample of it and every forecast over the fleet
 * read unmeasurable. An unreadable register skips the next tick rather than probing the last read's
 * plans, one of which may be paused now.
 *
 * @param home the Slopweaver home whose register names the fleet
 * @param port where the plan register is read — the watch's own, so every tick reads the same register
 * @param previous the plans the last readable read resolved
 * @returns the plans to tick next, whether the next tick may run at all, and the lines to write to stderr
 */
export async function rereadWatchPlans({
  home,
  port,
  previous,
}: {
  home: string;
  port: PlanRegisterPort;
  previous: ClaudeWatchPlans;
}): Promise<{
  readonly plans: ClaudeWatchPlans;
  readonly readable: boolean;
  readonly lines: readonly string[];
}> {
  const reread = await watchPlans({ home, port });
  if (reread.isErr()) {
    return {
      lines: [`claude watch: ${reread.error.message} — this tick is skipped; the next one reads it again`],
      plans: previous,
      readable: false,
    };
  }
  return { lines: watchPlanChangeLines({ next: reread.value, previous }), plans: reread.value, readable: true };
}
