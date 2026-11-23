/**
 * The Automations report as terminal lines — the same fields the console page shows, one block per row. Pure.
 */
import type { SyncRunView } from "../syncRun/fold.js";
import type { AutomationCard } from "./card.js";
import type { AutomationsReport } from "./read.js";
import { spanWords } from "./runStats.js";

/**
 * One sync run in a line: its state, what it wrote, and the containers that had something new.
 *
 * @param run the folded run
 * @returns the line
 */
function syncRunLine({ run }: { run: SyncRunView }): string {
  const kinds = Object.entries(run.newByKind)
    .map(([kind, n]) => `${String(n)} ${kind}`)
    .join(", ");
  const wrote = kinds.length === 0 ? "nothing new" : kinds;
  const top = run.containers
    .slice(0, 5)
    .map((container) => `${container.label} +${String(container.written)}`)
    .join(", ");
  const elapsed = run.elapsedMs === null ? "" : ` over ${spanWords({ ms: run.elapsedMs })}`;
  const where = top.length === 0 ? "" : ` · ${top}`;
  const quiet =
    run.quietContainers.length === 0 ? "" : ` · ${String(run.quietContainers.length)} read with nothing new`;
  return `${run.state} ${String(run.startedAtIso)}${elapsed} · ${wrote}${where}${quiet}`;
}

/** The tail the firing history line carries for scheduled times that never ran — nothing when it was not counted. */
function unrunWords({ unrun }: { unrun: AutomationCard["firings"]["unrun"] }): string {
  if (unrun === null) {
    return "";
  }
  const floor = unrun.bound === "at-least" ? "at least " : "";
  return `; ${floor}${String(unrun.count)} scheduled time(s) went by with no run`;
}

/** What a broken account adds beneath the head: the fix, then what it said and the record it was told from. */
function accountLines({ account }: { account: NonNullable<AutomationCard["account"]> }): string[] {
  const lines = [`  fix: ${account.fix.words}`];
  if (account.said !== null) {
    lines.push(`  it said: ${account.said}`);
  }
  if (account.detail !== null) {
    lines.push(`  detail: ${account.detail}`);
  }
  return lines;
}

/**
 * One card's block. The head says the plain answer when the row owes one (`./brokenAccount.ts`), and the record it
 * was told from sits on its own `detail:` line beneath, so the words the owner reads first are never the record's.
 */
function cardLines({ card }: { card: AutomationCard }): string[] {
  const head = card.account === null ? card.why : card.account.why;
  const lines = [
    `${card.recipeId} · ${card.health.toUpperCase()} · ${head}`,
    `  how long: ${card.durationWords}`,
    `  how often it works: ${card.reliabilityWords}`,
    `  now: ${card.nowDoing}`,
  ];
  if (card.firingsGap !== null) {
    lines.push(`  history unread, so a run may be missing from both answers: ${card.firingsGap}`);
  }
  if (card.waitingOn !== null) {
    lines.push(`  waiting on: ${card.waitingOn}`);
  }
  if (card.fixRow !== null) {
    lines.push(`  fix row: ${card.fixRow}`);
  }
  if (card.pauseReason !== null) {
    lines.push(`  paused because: ${card.pauseReason}`);
  }
  if (card.account !== null) {
    lines.push(...accountLines({ account: card.account }));
  }
  const { firings } = card;
  if (firings.recorded > 0) {
    lines.push(
      `  ${String(firings.recorded)} firing(s) recorded since ${String(firings.sinceIso)}: ${String(firings.succeeded)} ok, ` +
        `${String(firings.failed)} failed, ${String(firings.dead)} dead, ${String(firings.deferred)} deferred, ${String(firings.open)} open` +
        unrunWords({ unrun: firings.unrun }),
    );
  }
  if (card.lastBrokeIso !== null) {
    lines.push(`  last broke ${card.lastBrokeIso}`);
  }
  // The store lists runs by when they started, and two can overlap, so this one is the last STARTED.
  for (const run of card.syncRuns.slice(0, 1)) {
    lines.push(`  last started sync: ${syncRunLine({ run })}`);
  }
  return lines;
}

/**
 * The report as lines, rejected files and unreadable stores first so they cannot scroll past.
 *
 * @param report the read report
 * @returns the lines
 */
export function automationsLines({ report }: { report: AutomationsReport }): readonly string[] {
  const lines: string[] = [];
  for (const issue of report.issues) {
    lines.push(`ISSUE · ${issue}`);
  }
  for (const rejected of report.rejected) {
    lines.push(`REJECTED · ${rejected.file} · ${rejected.why}`);
  }
  for (const card of report.cards) {
    lines.push(...cardLines({ card }));
  }
  for (const sync of report.unscheduledSyncs) {
    const newest = sync.runs[0];
    if (newest !== undefined) {
      lines.push(`sync ${sync.source} (not scheduled) · ${syncRunLine({ run: newest })}`);
    }
  }
  return lines;
}
