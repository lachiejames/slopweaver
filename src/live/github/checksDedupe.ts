/**
 * The check records a checks rollup is counted in, and the newest-per-`kind:name` dedupe that picks which of a
 * re-run's duplicates is counted — every one it discards kept as a {@link SupersededGithubCheck}. Pure: no
 * imports, no I/O. `./checks.ts` shapes each raw context node into a {@link CheckWithSortKey} and hands the
 * list here; its own header says why a re-run leaves duplicates at all.
 */

/** One check's current state, collapsed from either a Check Run or a legacy commit Status. */
export type GithubCheckState = "passed" | "failed" | "running" | "queued";

/** One check — a GitHub Actions Check Run, or a legacy commit Status posted by some other CI system. */
export interface GithubCheck {
  readonly kind: "check-run" | "status";
  readonly name: string;
  readonly state: GithubCheckState;
  readonly url: string | undefined;
  /**
   * A Check Run's raw completed conclusion (`SUCCESS`, `SKIPPED`, `NEUTRAL`, …), absent for a legacy Status
   * and for a run not yet completed. `state` folds SKIPPED and NEUTRAL into `passed` for CI purposes; a
   * caller that needs proof a suite actually RAN green reads this instead.
   */
  readonly conclusion?: string | undefined;
  /**
   * The Actions workflow run GitHub itself ties this Check Run to (its check suite's `workflowRun`), absent
   * for a legacy Status, for a Check Run another app posted, and for a read that did not select it. Unlike
   * `url`, which the posting app writes, this is GitHub's own word that the check IS an Actions job.
   */
  readonly runId?: string | undefined;
  /**
   * The instant GitHub dated THIS run: a legacy Status's `createdAt`, a Check Run's `completedAt`; absent for a run
   * not yet completed and for one GitHub dated nothing. A Status and a Check Run another app posted carry no run id,
   * so this is the one field telling a re-run from the first run of the same name, state and URL.
   */
  readonly datedAt?: string | undefined;
}

/**
 * The run that TOOK a superseded check's slot in the latest-per-name view.
 *
 * Its own record rather than the whole {@link GithubCheck}, because the counted view carries a details URL
 * and drops the run identity, and identity is the entire point here: a caller acknowledging "a later run
 * replaced this failure" has to be able to name which run it was.
 *
 * @internal reached through {@link SupersededGithubCheck.replacedBy}; no caller names the type itself.
 */
export interface ReplacingGithubRun {
  readonly state: GithubCheckState;
  /** The Actions run that replaced it, when it was a Check Run. */
  readonly runId: string | undefined;
  /** When the replacing run finished, when GitHub reported one. */
  readonly completedAt: string | undefined;
}

/**
 * A check-run duplicate that lost {@link dedupeLatestByName}'s newest-per-name race — kept only to explain
 * why GitHub's aggregate `rollupState` can disagree with the latest-per-name view: the rollup folds in
 * EVERY check suite on the head commit, superseded ones included, so a re-run that fixed a failure still
 * leaves the rollup reading `FAILURE` even though nothing failing remains to look at.
 */
export interface SupersededGithubCheck {
  readonly kind: "check-run" | "status";
  readonly name: string;
  readonly state: GithubCheckState;
  /** The raw Check Run conclusion, as on {@link GithubCheck.conclusion}; an evidence gate reads a tie by it. */
  readonly conclusion?: string | undefined;
  /** When this run finished, when GitHub reported one (legacy Statuses never do). */
  readonly completedAt: string | undefined;
  /** The Actions run this check belonged to, when it was a Check Run. */
  readonly runId: string | undefined;
  /**
   * The run that took this name's slot, when GitHub's own timestamps put THIS run strictly BEFORE it.
   *
   * `undefined` is a real state and the whole reason this is a recorded field rather than something a
   * consumer derives. The latest-per-name race is settled by {@link isNewerTimestamp}, which resolves an
   * UNDATED side either way — an undated candidate never wins, and an undated incumbent always loses — so
   * a context GitHub dated nothing is discarded for where it sat in the connection rather than for being
   * earlier. Losing that race and having been superseded are then two different facts, and only this field
   * tells them apart, which is what a caller proving "a later run on the same head replaced this failure"
   * depends on (`../../cli/commands/github/landingPress.ts`).
   */
  readonly replacedBy: ReplacingGithubRun | undefined;
}

/**
 * A shaped check, plus the timestamp {@link dedupeLatestByName} orders re-run duplicates by, when known, and
 * the extra fields only a discarded duplicate ever needs to explain itself as a {@link SupersededGithubCheck}.
 */
export type CheckWithSortKey = GithubCheck & {
  readonly sortKey: string | undefined;
  readonly completedAt: string | undefined;
  readonly runId: string | undefined;
};

/** Whether `candidate`'s timestamp is strictly newer than `existing`'s — an unknown timestamp never wins. */
function isNewerTimestamp({
  candidate,
  existing,
}: {
  candidate: string | undefined;
  existing: string | undefined;
}): boolean {
  if (candidate === undefined) {
    return false;
  }
  return existing === undefined || candidate > existing;
}

/** One winner-and-its-losers dedupe pass's result: the counted view, plus the evidence behind a discard. */
interface DedupedChecks {
  readonly checks: readonly GithubCheck[];
  readonly superseded: readonly SupersededGithubCheck[];
}

/**
 * Shape one discarded duplicate as the record a rollup-mismatch explanation reads back, naming the run that
 * took its slot only when GitHub's timestamps put the loser strictly before the winner.
 *
 * The ordering test is made HERE rather than left to a consumer because this is the only place both sides'
 * sort keys are in hand: `dedupeLatestByName` discards an undated candidate for arriving second, and a
 * consumer looking at the resulting record could not tell that from a genuine supersession.
 *
 * It is a STRICTER test than the one that picked the winner, in the safe direction, and deliberately not
 * {@link isNewerTimestamp}: that one lets a dated candidate beat an UNDATED existing, which is the right
 * call for choosing a latest-per-name view and the wrong one here. A run GitHub dated nothing could have
 * started after the winner, so "this failure was replaced" is a claim only two timestamps can support.
 *
 * @param loser the duplicate being discarded
 * @param winner the check holding the `kind:name` slot after this comparison
 * @returns the discard record, with {@link SupersededGithubCheck.replacedBy} set only when ORDERED
 */
function toSupersededCheck({
  loser,
  winner,
}: {
  loser: CheckWithSortKey;
  winner: CheckWithSortKey;
}): SupersededGithubCheck {
  const bothDated = loser.sortKey !== undefined && winner.sortKey !== undefined;
  const ordered = bothDated && isNewerTimestamp({ candidate: winner.sortKey, existing: loser.sortKey });
  return {
    completedAt: loser.completedAt,
    conclusion: loser.conclusion,
    kind: loser.kind,
    name: loser.name,
    replacedBy: ordered ? { completedAt: winner.completedAt, runId: winner.runId, state: winner.state } : undefined,
    runId: loser.runId,
    state: loser.state,
  };
}

/**
 * Keep only the newest context per `kind:name` pair, by `sortKey` (an ISO-8601 timestamp, so lexicographic
 * comparison is chronological) — and keep every duplicate it discards along the way, since GitHub's own
 * aggregate `rollupState` folds ALL of them in, not just the newest. A name's first occurrence fixes its
 * position in the result — only the WINNING check's fields are ever replaced, never its slot — so output
 * order stays stable regardless of which duplicate GraphQL happened to list first.
 *
 * @param checks every shaped context, duplicates and all
 * @returns one check per `kind:name` (each the newest), plus every duplicate that lost
 */
export function dedupeLatestByName({ checks }: { checks: readonly CheckWithSortKey[] }): DedupedChecks {
  const latest = new Map<string, CheckWithSortKey>();
  const superseded: SupersededGithubCheck[] = [];
  for (const check of checks) {
    const key = `${check.kind}:${check.name}`;
    const existing = latest.get(key);
    if (existing === undefined) {
      latest.set(key, check);
    } else if (isNewerTimestamp({ candidate: check.sortKey, existing: existing.sortKey })) {
      superseded.push(toSupersededCheck({ loser: existing, winner: check }));
      latest.set(key, check);
    } else {
      superseded.push(toSupersededCheck({ loser: check, winner: existing }));
    }
  }
  // The sort key and completion time only ever explain a discard, so the counted view drops them; it keeps the
  // run GitHub ties a Check Run to, the one proof its details URL is that run's own job.
  return { checks: [...latest.values()].map(({ completedAt, sortKey, ...check }) => check), superseded };
}
