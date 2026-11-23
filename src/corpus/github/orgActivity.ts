/**
 * The GitHub org-mode ACTIVITY fan-out: run the EXISTING per-repo search/activity pipeline
 * ({@link ../github/fetch.FetchGithubItems}) across every selected org repo, bounded by a shared concurrency
 * cap ({@link ../../lib/resilience.createConcurrencyLimiter}) and paced by a shared rate gate
 * ({@link ../../lib/resilience.createRateScheduler}) so a large org never becomes a thundering herd. Each
 * repo windows from its OWN per-repo cursor (so a re-run re-fetches nothing unchanged), and one repo's fetch
 * failure is a warning + skip — never fatal — so a single unreadable repo can't sink the whole org pass.
 */

import type { Repository } from "../../config.js";
import { createConcurrencyLimiter, createRateScheduler } from "../../lib/resilience.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { resolveSince } from "../watermark.js";
import type { FetchGithubItems } from "./fetch.js";
import { projectGithubRecords } from "./project.js";
import { computeRepoWatermarks, type RepoWatermarkAdvance } from "./repoWatermark.js";

/** Per-repo progress (non-blocking) — fired as each repo's fetch completes, naming the repo + its yield. */
export type OrgRepoProgress = (progress: { done: number; total: number; repo: string; recordCount: number }) => void;

/** The combined org-activity outcome: all repos' records, warnings, and each repo's per-repo cursor advance. */
export interface OrgActivityResult {
  readonly records: readonly CorpusRecord[];
  readonly warnings: readonly string[];
  readonly advances: readonly RepoWatermarkAdvance[];
}

/**
 * The durable per-REPO commit seam: append one finished repo's records to bronze and mark that repo
 * resumable, before the fan-out moves on.
 *
 * Absent ⇒ every repo's records accumulate in memory and the caller writes once at the end, so an org pass
 * killed at repo 40 of 300 keeps nothing and re-reads all 40 next time. The repo is the right container and
 * no smaller one is warranted: a repo's item set is hard-capped by GitHub's 1000-result search ceiling, so
 * it is already a bounded batch — unlike a Slack conversation, which is why that connector needs a
 * mid-container flush and this one does not.
 *
 * Returns the WARNINGS the commit produced, empty when it landed cleanly. A repo whose commit failed keeps
 * its records — {@link fetchOrgActivity} hands them to the closing write instead — and does NOT advance,
 * so the next run re-reads it rather than stepping over a window nothing was written for.
 */
export type OrgRepoCommit = (outcome: {
  readonly records: readonly CorpusRecord[];
  readonly repoKey: string;
}) => OrgRepoCommitOutcome;

/**
 * What one repo's durable commit did.
 *
 * `banked` and `warnings` are SEPARATE because the two failures inside a commit are not the same failure,
 * and collapsing them is a counting bug rather than a cosmetic one. A repo whose BRONZE WRITE failed is not
 * banked and must reach the closing write. A repo whose bronze write succeeded but whose CURSOR persist
 * failed IS banked — its rows are on disk — and re-offering them would count every one of them twice, once
 * in `committedPerContainer` and again as a dedup in the closing write, so a clean run would report half
 * its records as a re-fetch. Its cursor simply does not move, which is the safe direction: the next run
 * re-reads that repo and the write path dedups what it already holds.
 */
interface OrgRepoCommitOutcome {
  /** True when the repo's rows reached bronze, whatever else went wrong. */
  readonly banked: boolean;
  /** What went wrong, empty when the whole commit landed. Never a reason to re-offer banked rows. */
  readonly warnings: readonly string[];
}

/** One repo's fetch outcome (records + warnings + whether it was fetched at all, for the watermark advance). */
interface RepoOutcome {
  readonly repoKey: string;
  readonly fetched: boolean;
  readonly records: readonly CorpusRecord[];
  readonly warnings: readonly string[];
  /**
   * This repo's records already reached bronze through {@link OrgRepoCommit}, and its own cursor with them.
   *
   * Absent ⇒ false. It is what keeps the arithmetic honest in both directions: a banked repo's records are
   * withheld from the closing write so they are not counted twice
   * (`corpus/ingestSource.runCounts`), and its cursor advance is withheld from the pooled
   * {@link fetchOrgActivity} advances so the caller does not re-write a cursor the commit already wrote.
   */
  readonly banked?: boolean;
}

/**
 * Fetch + project ONE repo over its own window, then bank it durably when there is a seam to bank through.
 *
 * A fetch failure is a warning + skip (never a throw). A COMMIT failure is a warning too, and the repo then
 * falls back to the closing write exactly as it behaved before this seam existed — a repo whose own commit
 * failed has no other route to disk.
 */
async function fetchOneRepo({
  repo,
  window,
  repoCursors,
  fetchItems,
  onRepoCommit,
}: {
  repo: Repository;
  window: ExportWindow;
  repoCursors: ReadonlyMap<string, string>;
  fetchItems: FetchGithubItems;
  onRepoCommit?: OrgRepoCommit;
}): Promise<RepoOutcome> {
  const repoKey = `${repo.owner}/${repo.repo}`;
  const since = resolveSince({ cursor: repoCursors.get(repoKey), fallbackSince: window.since });
  const result = await fetchItems({ repo, window: { since, until: window.until } });
  if (result.isErr()) {
    return { fetched: false, records: [], repoKey, warnings: [`repo ${repoKey}: ${result.error.message}`] };
  }
  const records = projectGithubRecords({ items: result.value.items, repo: repoKey });
  if (onRepoCommit === undefined) {
    return { fetched: true, records, repoKey, warnings: result.value.warnings };
  }
  const committed = onRepoCommit({ records, repoKey });
  return {
    banked: committed.banked,
    fetched: true,
    // A banked repo hands the closing write NOTHING — including one whose cursor persist failed, whose rows
    // are on disk regardless. A failed bronze write hands it everything, unchanged.
    records: committed.banked ? [] : records,
    repoKey,
    warnings: [...result.value.warnings, ...committed.warnings],
  };
}

/** The per-repo `{repo, tsIso}` observations from a fetched repo (empty-but-fetched still marks the repo seen). */
function repoObservations({ outcome }: { outcome: RepoOutcome }): readonly { repo: string; tsIso: string }[] {
  if (!outcome.fetched) {
    return []; // a failed repo is NOT advanced, so it retries next run
  }
  if (outcome.banked === true) {
    return []; // its cursor was written the instant its bronze commit landed — see `OrgRepoCommit`
  }
  if (outcome.records.length === 0) {
    return [{ repo: outcome.repoKey, tsIso: "" }]; // seen-but-empty ⇒ advances to `until`, no re-scan
  }
  return outcome.records.map((record) => ({ repo: outcome.repoKey, tsIso: record.tsIso }));
}

/**
 * Fan the per-repo pipeline across the selected repos, concurrency-capped + rate-paced, windowing each from
 * its own cursor. Returns the combined records + warnings + each repo's cursor advance (empty/failed repos
 * handled per {@link repoObservations}).
 *
 * @param repos the selected repo coordinates
 * @param window the base window — `since` is only a FALLBACK, not a floor: a repo with a stored cursor is
 *   windowed from that cursor even when it is LATER than `window.since`, so a caller that must honour a
 *   wider window has to withhold the cursors (pass an empty `repoCursors`) rather than widen `window`
 * @param repoCursors the per-repo stored cursors (`owner/repo` → cursor); empty ⇒ every repo uses `window`
 * @param fetchItems the injected per-repo fetch seam (the existing GitHub pipeline)
 * @param concurrency the max repos fetched at once
 * @param ratePerSec the sustained per-repo-fetch rate ceiling
 * @param onProgress optional per-repo progress callback
 * @param onRepoCommit the durable per-repo commit seam; a repo it banks contributes NEITHER records to the
 *   returned batch NOR an advance to the returned list, because both already reached disk
 * @returns the records the caller still has to write, warnings, and the per-repo advances still owed
 */
export async function fetchOrgActivity({
  repos,
  window,
  repoCursors,
  fetchItems,
  concurrency,
  ratePerSec,
  onProgress,
  onRepoCommit,
}: {
  repos: readonly Repository[];
  window: ExportWindow;
  repoCursors: ReadonlyMap<string, string>;
  fetchItems: FetchGithubItems;
  concurrency: number;
  ratePerSec: number;
  onProgress?: OrgRepoProgress;
  onRepoCommit?: OrgRepoCommit;
}): Promise<OrgActivityResult> {
  const limit = createConcurrencyLimiter({ concurrency });
  const gate = createRateScheduler({ ratePerSec });
  let done = 0;
  const outcomes = await Promise.all(
    repos.map((repo) =>
      limit(async () => {
        const outcome = await gate(() =>
          fetchOneRepo({
            fetchItems,
            repo,
            repoCursors,
            window,
            ...(onRepoCommit !== undefined ? { onRepoCommit } : {}),
          }),
        );
        done += 1;
        onProgress?.({ done, recordCount: outcome.records.length, repo: outcome.repoKey, total: repos.length });
        return outcome;
      }),
    ),
  );
  const observed = outcomes.flatMap((outcome) => repoObservations({ outcome }));
  return {
    advances: computeRepoWatermarks({ fallbackUntil: window.until, observed }),
    records: outcomes.flatMap((outcome) => outcome.records),
    warnings: outcomes.flatMap((outcome) => outcome.warnings),
  };
}
