/**
 * What `github bump-drive` prints, and the `--json` document a recipe row's next reader gets.
 *
 * Pure. The shell owns every write; this module owns every sentence, so what one firing SAYS is assertable
 * without a network — which matters more here than on a read-only verb, because these lines are the only
 * evidence an unattended pass leaves anywhere a person looks.
 */

import type { BumpAct, BumpSignal } from "../../../review/bumpSelection.js";

/** What happened to one bump on this pass. */
export interface BumpDriveOutcome {
  readonly repoSlug: string;
  readonly number: number;
  readonly url: string;
  readonly signal: BumpSignal;
  readonly act: BumpAct;
  /** `acted` covers every performed act; which one it was is `act`. */
  readonly outcome: "acted" | "would-act" | "skipped" | "failed";
  readonly detail: string;
}

/** The document `--json` emits, selection and all. */
export interface BumpDriveDocument {
  readonly repos: readonly string[];
  /** Every open pull request the read returned, bumps and not — the denominator for the count below. */
  readonly openCount: number;
  readonly dryRun: boolean;
  readonly nowIso: string;
  readonly outcomes: readonly BumpDriveOutcome[];
  /** A read this pass could not complete and what it therefore did not do, so a quiet pass is never mistaken for a clean one. */
  readonly notes: readonly string[];
}

/** The order outcome groups print in: what happened first, what needs a person last. */
const OUTCOME_ORDER: readonly BumpDriveOutcome["outcome"][] = ["failed", "acted", "would-act", "skipped"] as const;

/** One bump's line. */
function outcomeLine({ outcome }: { outcome: BumpDriveOutcome }): string {
  return `  #${String(outcome.number)} ${outcome.act} (${outcome.signal}) — ${outcome.detail}`;
}

/**
 * The report, headline first.
 *
 * `failed` leads rather than trails, because a pass that undrafted a bump and then could not queue it has left
 * the repository in a state somebody has to look at, and a reader who stops after the first line must see that.
 *
 * @param outcomes what happened to every selected bump
 * @param openCount every open pull request the read returned, so the selection is legible beside the acts
 * @param notes every read this pass could not complete, printed last
 * @returns the lines to print, in order
 */
export function bumpDriveLines({
  outcomes,
  openCount,
  notes,
}: {
  outcomes: readonly BumpDriveOutcome[];
  openCount: number;
  notes: readonly string[];
}): readonly string[] {
  const noted = notes.length === 0 ? [] : ["", `notes — ${String(notes.length)}`, ...notes.map((note) => `  ${note}`)];
  if (outcomes.length === 0) {
    return [`no dependency bumps among the ${String(openCount)} open pull request(s)`, ...noted];
  }
  const lines: string[] = [
    `${String(outcomes.length)} dependency bump(s) of ${String(openCount)} open pull request(s)`,
  ];
  for (const group of OUTCOME_ORDER) {
    const members = outcomes.filter((outcome) => outcome.outcome === group);
    if (members.length === 0) {
      continue;
    }
    lines.push("");
    lines.push(`${group} — ${String(members.length)}`);
    for (const outcome of members) {
      lines.push(outcomeLine({ outcome }));
    }
  }
  return [...lines, ...noted];
}

/**
 * The `--json` document, which carries the selection beside the answer.
 *
 * `openCount` and `dryRun` ride in it for the same reason `github bottleneck`'s document carries its draft
 * setting: three acts out of four bumps and three out of forty are different facts, and a dry run's document
 * read as a real one would have a recipe row reporting acts nobody took.
 *
 * @param outcomes what happened to every selected bump
 * @param repos the repositories this pass read
 * @param openCount every open pull request the read returned
 * @param dryRun whether the pass described its acts instead of performing them
 * @param nowIso when the pass ran
 * @param notes every read this pass could not complete
 * @returns the machine-readable document
 */
export function bumpDriveDocument({
  outcomes,
  repos,
  openCount,
  dryRun,
  nowIso,
  notes,
}: {
  outcomes: readonly BumpDriveOutcome[];
  repos: readonly string[];
  openCount: number;
  dryRun: boolean;
  nowIso: string;
  notes: readonly string[];
}): BumpDriveDocument {
  return { dryRun, notes, nowIso, openCount, outcomes, repos };
}
