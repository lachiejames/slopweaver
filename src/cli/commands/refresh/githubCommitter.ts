/**
 * The GitHub durable-commit half of `githubJobs.ts` — one held-open bronze committer per run, the two seams
 * it exposes (a mid-crawl batch of enriched items, a completed repo), and the durability note a run reports
 * from it.
 *
 * Split out of `githubJobs.ts` so that file stays about composing the two ingest shapes rather than about
 * how either reaches disk, and so the single-repo and org-mode lanes share ONE committer implementation
 * instead of growing two that drift.
 */

import type { Repository } from "../../../config.js";
import { createBronzeCommitter } from "../../../corpus/corpusWriter.js";
import type { GithubItemsCommit } from "../../../corpus/github/fetch.js";
import type { OrgRepoCommit } from "../../../corpus/github/orgActivity.js";
import { projectGithubRecords } from "../../../corpus/github/project.js";
import { advanceGithubRepoWatermarks } from "../../../corpus/github/repoWatermark.js";
import { newestTs } from "../../../corpus/newestTs.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** What a run's durable commits banked, and the newest instant they cover. */
export interface GithubCommitTally {
  /** Bronze lines the commits actually appended. */
  readonly written: number;
  /** Records those commits were OFFERED — written plus deduped. */
  readonly projected: number;
  /** The newest `tsIso` banked, or undefined when nothing was. */
  readonly committedCursor: string | undefined;
}

/**
 * A GitHub run's durable committer: the two seams plus a reader for what they cost.
 *
 * Both seams write through the SAME committer, which is why they live on one object. They differ in what
 * else they are allowed to do: {@link GithubRunCommitter.commitBatch} writes rows and nothing more, while
 * {@link GithubRunCommitter.commitRepo} writes rows AND marks that repo's own resume cursor, because a
 * repo that has been read to the end has genuinely earned one.
 */
export interface GithubRunCommitter {
  /** Rows on disk and NOTHING else — no cursor, no marker. A prefix of a repo is not a finished repo. */
  readonly commitBatch: GithubItemsCommit;
  /** One finished repo: its rows, then its own resume cursor. */
  readonly commitRepo: OrgRepoCommit;
  readonly tally: () => GithubCommitTally;
}

/**
 * Open the durable committer for one GitHub run.
 *
 * `undefined` for a BOUNDED run (`--sample`, `--fetch-cap`) or a CURSOR-ISOLATED one, which must stay on the
 * write-once path. Three independent reasons, each sufficient on its own:
 *
 *  - `--sample` is applied by `capPerContainer` (`corpus/ingestSource.ts`) AFTER the fetch returns, so a
 *    commit made DURING the crawl bypasses it entirely and a `--sample 5` run would put the whole window
 *    into bronze. That is a correctness bug, not a cosmetic one.
 *  - `--fetch-cap` describes a run that saw a prefix of its window, so it has not earned any cursor.
 *  - a cursor-isolated run (`store load` pulling into Supabase) is not the file corpus's crawl at all, and
 *    bronze IS the file corpus.
 *
 * ## The concurrency invariant, which is invisible from the call site
 *
 * Org mode fans repos out at `ORG_CONCURRENCY`, so this one committer is reached from interleaved async
 * callers. That is safe TODAY for a checkable reason rather than by convention: `BronzeCommitter.commit`
 * and `advanceGithubRepoWatermarks` are both synchronous end to end — no `await` between reading a store
 * and writing it — so the event loop cannot interleave two of them and neither a dedup-index mutation nor a
 * watermark read-modify-write can be observed half-done.
 *
 * **If either ever gains an `await` between its read and its write, this sharing becomes a lost-update bug
 * in both stores at once**: two callers would each see the same record as fresh and append it twice, and
 * each read the same watermark file so the later write discarded the earlier.
 *
 * @param bounded whether `--sample`/`--fetch-cap` bounded the run
 * @param cursorIsolated whether this run must leave every store in the home untouched
 * @param home the Slopweaver home
 * @param window the export window, which names the bronze file every commit appends to
 * @returns the committer, or `undefined` on a write-once run
 */
export function githubRunCommitter({
  bounded,
  cursorIsolated,
  home,
  window,
}: {
  bounded: boolean;
  cursorIsolated: boolean;
  home: string;
  window: ExportWindow;
}): GithubRunCommitter | undefined {
  if (bounded || cursorIsolated) {
    return undefined;
  }
  const spend: CommitSpend = { maxTsIso: undefined, offered: 0, written: 0 };
  const bank = bankInto({ committer: createBronzeCommitter({ home, window }), spend });
  return {
    commitBatch: ({ items, repo }) => {
      const records = projectGithubRecords({ items, repo: repoKeyOf({ repo }) });
      // No records means no ITEMS: the projector opens each item with its atom unconditionally
      // (`corpus/github/project.projectGithubRecords`), so a non-empty batch can never shape down to
      // nothing. That matters because the caller reads `ok` as "banked, do not retain" — if the projector
      // ever gains a drop path, a batch could be dropped here with a clean result to show for it.
      if (records.length === 0) {
        return ok({ written: 0 });
      }
      return bank({ records });
    },
    commitRepo: ({ records, repoKey }) => {
      const banked = bank({ records });
      if (banked.isErr()) {
        // The repo's rows did not reach disk, so it has NOT earned a cursor — withholding it is what makes
        // the next run re-read the repo instead of stepping over a window nothing was written for.
        return {
          banked: false,
          warnings: banked.error.map((line) => `repo ${repoKey}: bronze commit failed: ${line}`),
        };
      }
      // Banked either way from here: the rows ARE on disk, so a cursor that would not persist is a cursor
      // that does not move, never a reason to write those rows a second time. See `OrgRepoCommitOutcome`.
      return { banked: true, warnings: repoCursorWarnings({ home, records, repoKey, until: window.until }) };
    },
    tally: (): GithubCommitTally => ({
      committedCursor: spend.maxTsIso,
      projected: spend.offered,
      written: spend.written,
    }),
  };
}

/** A run's running commit totals, MUTATED by {@link bankInto} as each container lands. */
interface CommitSpend {
  offered: number;
  written: number;
  maxTsIso: string | undefined;
}

/**
 * The one write both seams go through: append a batch and fold what it cost into the run's totals.
 *
 * Extracted so {@link githubRunCommitter} reads as the two seams it returns rather than as the accounting
 * they share — and so there is exactly ONE place the totals are advanced, which is what keeps
 * `committedPerContainer` and `projectedPerContainer` incapable of disagreeing.
 *
 * @param committer the held-open bronze committer, whose dedup index spans the whole run
 * @param spend the run's running totals, MUTATED in place on a successful append
 * @returns the bank function the two seams close over
 */
function bankInto({
  committer,
  spend,
}: {
  committer: ReturnType<typeof createBronzeCommitter>;
  spend: CommitSpend;
}): (args: { records: readonly CorpusRecord[] }) => Result<{ written: number }> {
  return ({ records }) => {
    const written = committer.commit({ records });
    if (written.isErr()) {
      return err(written.error);
    }
    spend.offered += records.length;
    spend.written += written.value.written;
    const batchNewest = newestTs({ records });
    if (batchNewest !== undefined && (spend.maxTsIso === undefined || batchNewest > spend.maxTsIso)) {
      spend.maxTsIso = batchNewest;
    }
    return ok({ written: written.value.written });
  };
}

/**
 * The `owner/repo` key a repository is filed under in bronze and in the per-repo cursor store.
 *
 * @param repo the repository coordinates
 * @returns the key
 */
export function repoKeyOf({ repo }: { repo: Repository }): string {
  return `${repo.owner}/${repo.repo}`;
}

/**
 * Mark ONE repo resumable, the instant its bronze commit lands.
 *
 * Written here rather than once at the end of the org pass for the reason this whole change exists: a pass
 * killed at repo 40 of 300 used to leave every one of those 40 repos' cursors exactly where it found them,
 * so the next run re-read all of them. The advance is MAX-merged at the leaf, so a narrower re-run can
 * never move a cursor backwards.
 *
 * A repo that yielded no usable timestamp falls back to the window end — that is what gives a read-but-quiet
 * repo an entry at all, and so stops it being re-scanned from scratch every run.
 *
 * @param home the Slopweaver home
 * @param records the repo's projected records, whose newest `tsIso` is the cursor
 * @param repoKey the `owner/repo` the cursor belongs to
 * @param until the window end, stored for a repo that yielded no usable timestamp
 * @returns the persist-failure warnings, or an empty list when the cursor landed
 */
function repoCursorWarnings({
  home,
  records,
  repoKey,
  until,
}: {
  home: string;
  records: readonly CorpusRecord[];
  repoKey: string;
  until: string;
}): readonly string[] {
  // Spelled as an `if` rather than a ternary or a `??`: the two cases are genuinely different claims — "this
  // repo yielded work, resume from its newest row" and "this repo was read and held nothing, resume from the
  // window end" — and `no-silent-fallback` bans the `??` that would collapse them.
  const newest = newestTs({ records });
  let cursor = until;
  if (newest !== undefined) {
    cursor = newest;
  }
  const advanced = advanceGithubRepoWatermarks({ advances: [{ cursor, repo: repoKey }], home });
  if (advanced.isOk()) {
    return [];
  }
  return advanced.error.map((line) => `per-repo watermark persist failed for ${repoKey}: ${line}`);
}

/**
 * What the durable commits banked, as the note lines a run reports.
 *
 * Reported rather than left to the counts alone because a store that fills up invisibly is
 * indistinguishable from one that never fills at all — the property this change exists to fix. A run that
 * banked nothing says nothing, so silence still means the write-once path.
 *
 * @param tally the run's accumulated totals, or undefined on a write-once run
 * @returns zero or one note line
 */
export function githubDurabilityNotes({ tally }: { tally: GithubCommitTally | undefined }): readonly string[] {
  if (tally === undefined || tally.projected === 0) {
    return [];
  }
  return [
    `durability: banked ${String(tally.written)} record(s) to bronze during the crawl (${String(tally.projected)} offered) — an interruption keeps them`,
  ];
}
