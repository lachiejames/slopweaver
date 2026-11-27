/**
 * `machine free-disk`'s pure renderers: the plan's lines, one apply's outcome lines, and the one `--json`
 * document. Sizes are GB (10^9 bytes, Finder's unit) to two decimals, so a 0.3 GB cache does not read as zero.
 */
import { volumeFreeGb } from "../diskFootprint.js";

import type { FreeDiskTarget } from "./registry.js";
import type {
  FreeDiskAction,
  FreeDiskItemOutcome,
  FreeDiskPlan,
  FreeDiskPlanItem,
  FreeDiskReport,
  FreedBasis,
} from "./types.js";

/**
 * Bytes as GB to two decimals.
 *
 * @returns the figure with its unit
 */
export function gbOf({ bytes }: { bytes: number }): string {
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * The target as a caller would type it.
 *
 * @returns the positional, with `--bundle` for an app
 */
export function targetLabel({ target }: { target: FreeDiskTarget }): string {
  if (target.kind === "app") {
    return `app --bundle ${JSON.stringify(target.bundle)}`;
  }
  return target.kind;
}

/** What one action would run, for the plan line. */
function actionText({ action }: { action: FreeDiskAction }): string {
  switch (action.kind) {
    case "remove-tree":
      return `rm -r ${action.path}`;
    case "docker-trim":
      return `docker ${action.argv.join(" ")}`;
    case "move-to-trash":
      return `mv ${JSON.stringify(action.source)} ${JSON.stringify(action.destination)}`;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/** One plan line: disposition, held and expected-freed bytes, label, path, reason, and the act beneath. */
function planItemLines({ item }: { item: FreeDiskPlanItem }): readonly string[] {
  const held = `  ${item.disposition.padEnd(6)} ${item.label}: holds ${gbOf({ bytes: item.allocatedBytes })}`;
  if (item.action === undefined) {
    // A kept or absent row frees nothing because nothing is done to it — saying "frees 0.00 GB" would read as
    // a measurement of what removing it would free.
    return [`${held} — ${item.path}`, `         ${item.reason}`];
  }
  return [
    `${held}, frees ${gbOf({ bytes: item.expectedFreedBytes })} — ${item.path}`,
    `         ${item.reason}`,
    `         would run: ${actionText({ action: item.action })}`,
  ];
}

/**
 * The plan as lines, opening on the state home's free space.
 *
 * @param freeGb the state home volume's `df`-available GB when the plan was read
 * @returns the lines, the dry run's closing line not included
 */
export function planLines({ plan, freeGb }: { plan: FreeDiskPlan; freeGb: number | undefined }): readonly string[] {
  let free = "unread";
  if (freeGb !== undefined) {
    free = `${String(freeGb)} GB free (df)`;
  }
  const lines = [`machine free-disk ${targetLabel({ target: plan.target })} — state home volume ${free}`];
  for (const item of plan.items) {
    lines.push(...planItemLines({ item }));
  }
  const freed = plan.items.reduce((sum, item) => sum + item.expectedFreedBytes, 0);
  const acting = plan.items.filter((item) => item.action !== undefined).length;
  lines.push(`  ${String(acting)} to act on, expected to free ${gbOf({ bytes: freed })}`);
  return lines;
}

/** The dry run's last line. */
export const DRY_RUN_CLOSING = "nothing changed — re-run with --apply";

/** The verb a completed act is reported with. */
const DONE_VERB: Readonly<Record<FreeDiskAction["kind"], string>> = {
  "docker-trim": "trimmed",
  "move-to-trash": "moved to the Trash",
  "remove-tree": "removed",
};

/** What each basis adds after the freed figure. */
const BASIS_NOTE: Readonly<Record<FreedBasis, string>> = {
  "counted-at-recheck": " (its single-link files, counted at the recheck)",
  "measured-after": " (measured after the act)",
  "after-read-failed": " (the read after the act failed, so nothing was measured)",
  "none-until-trash-emptied": "",
};

/** A figure the outcome may not have: `null` is an after-read that failed, printed as unread, never as 0. */
function gbOrUnread({ bytes }: { bytes: number | null }): string {
  if (bytes === null) {
    return "unread";
  }
  return gbOf({ bytes });
}

/**
 * One act's outcome line, saying whether its freed figure was counted at the recheck or measured after.
 *
 * @returns the line
 */
export function outcomeLine({ outcome }: { outcome: FreeDiskItemOutcome }): string {
  let line =
    `  ${DONE_VERB[outcome.operation]} ${outcome.label}: held ${gbOf({ bytes: outcome.allocatedBeforeBytes })}, ` +
    `now ${gbOrUnread({ bytes: outcome.allocatedAfterBytes })}, freed ${gbOrUnread({ bytes: outcome.freedBytes })}` +
    BASIS_NOTE[outcome.freedBasis];
  if (outcome.movedBytes > 0) {
    line += `, moved ${gbOf({ bytes: outcome.movedBytes })} (lands once the Trash is emptied)`;
  }
  if (outcome.detail !== undefined) {
    line += ` — ${outcome.detail}`;
  }
  return line;
}

/**
 * The volume line an apply closes on: both readings and their difference, never attributed to one item.
 *
 * @returns the line
 */
export function volumeLine({ report }: { report: FreeDiskReport }): string {
  const before = volumeFreeGb({ volume: report.volumeBefore });
  const after = volumeFreeGb({ volume: report.volumeAfter });
  if (before === undefined || after === undefined) {
    return `  state home volume: ${String(before)} GB free before, after unread`;
  }
  const deltaGb = Math.round((after - before) * 10) / 10;
  return (
    `  state home volume: ${String(before)} GB free before, ${String(after)} GB after ` +
    `(${deltaGb >= 0 ? "+" : ""}${String(deltaGb)} GB; the whole volume, which other writers move too)`
  );
}
