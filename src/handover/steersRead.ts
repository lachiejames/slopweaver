/**
 * The effectful half of `handover steers`: the board scan, the run journals of the rows that may be steers, and each
 * named repository's main joined through the PR ledger — handed to `./steers.ts`, which decides everything.
 *
 * No probe is resolved (`handover list` spends most of its seconds there), nothing is fetched, nothing is written.
 * A repository whose main will not read is a fact about ITS rows, never a refusal of the page: those rows read
 * `landing-unknown` and the report names why. The board scan is the one refusal, because without it there is no list.
 */
import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";

import { originRepositoryOf } from "../config.js";
import { landedBranchOf, landedCommitsOf, prNumberOf } from "../fleet/landed.js";
import { DEFAULT_LANDED_REFS, readLandedLogSince, resolveLandedRef } from "../fleet/landedGit.js";
import type { LandedCommit } from "../fleet/landedTypes.js";
import { type PrLedgerRead, readPrRecordsFor } from "../outbound/github/prLedgerByNumber.js";
import { stateHomePaths } from "../stateHome.js";
import type { HandoverDoc } from "./doc.js";
import { NO_RUN, type RunState, runStateOf } from "./ledger.js";
import { readRunJournal } from "./runStore.js";
import { mayBeSteer, type RepoLandings, type SteerEntry, type SteerLanding, steersOf } from "./steers.js";
import { scanBoard } from "./store.js";

/**
 * One repository's main as the report states it.
 *
 * @internal — the shape of {@link SteersReport}'s `repos`; callers read it through the report.
 */
export type SteersRepo =
  | {
      readonly kind: "read";
      readonly dir: string;
      readonly repo: string;
      readonly ref: string;
      readonly refSha: string;
      /** How many first-parent commits the window held. */
      readonly commits: number;
      /** PR-ledger files that would not read, so a join reading "not landed" may have missed a record. */
      readonly ledgerUnread: number;
      /** Landed PRs the ledger holds no record of, so no branch joins to them — only a settlement witness can. */
      readonly unjoined: number;
    }
  | { readonly kind: "unread"; readonly dir: string; readonly why: string };

/** What `handover steers` reports. */
export interface SteersReport {
  readonly observedAtIso: string;
  readonly steers: readonly SteerEntry[];
  readonly repos: readonly SteersRepo[];
  /** Board files the scan could not read — counted, never dropped. */
  readonly unreadableDocs: number;
  /** Rows whose journal would not read, so whether a run was started on them is unknown. */
  readonly unreadableJournals: readonly string[];
}

/** The oldest instant any candidate row records, so main's history is read back exactly that far. */
function oldestIso({ docs }: { docs: readonly HandoverDoc[] }): string | undefined {
  let oldest: string | undefined;
  for (const doc of docs) {
    const at = doc.askedIso;
    if (at === undefined || Number.isNaN(Date.parse(at))) {
      continue;
    }
    if (oldest === undefined || Date.parse(at) < Date.parse(oldest)) {
      oldest = at;
    }
  }
  return oldest;
}

/**
 * Each landed commit's pull request, keyed both ways: by number for every PR on main, and by head branch only where
 * the PR ledger holds a record naming one.
 *
 * @param commits main's first-parent commits, newest first
 * @param hits the PR ledger read for those commits' numbers
 * @param repo the `owner/name` the PR links are built under
 * @returns both maps, and how many landed PRs had no ledger branch to join by
 */
export function landingsOf({
  commits,
  hits,
  repo,
}: {
  commits: readonly LandedCommit[];
  hits: PrLedgerRead;
  repo: string;
}): { byBranch: Map<string, SteerLanding>; byNumber: Map<number, SteerLanding>; unjoined: number } {
  const byBranch = new Map<string, SteerLanding>();
  const byNumber = new Map<number, SteerLanding>();
  let unjoined = 0;
  for (const commit of commits) {
    const pr = prNumberOf({ subject: commit.subject });
    if (pr === undefined) {
      continue;
    }
    let branch: string | undefined;
    if (hits.kind === "read") {
      branch = landedBranchOf({ hit: hits.hits.get(pr.number) });
    }
    const landing: SteerLanding = {
      branch,
      mergedIso: commit.mergedIso,
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${repo}/pull/${String(pr.number)}`,
    };
    // Every landed PR joins by its number, so a settlement witness finds it whether or not the ledger holds it.
    byNumber.set(pr.number, landing);
    if (branch === undefined) {
      unjoined += 1;
      continue;
    }
    // Newest first, so a branch landed twice keeps its LATEST landing.
    if (!byBranch.has(branch)) {
      byBranch.set(branch, landing);
    }
  }
  return { byBranch, byNumber, unjoined };
}

/** One repository's main, joined through the ledger, or why not. */
function readRepo({ dir, home, sinceIso }: { dir: string; home: string; sinceIso: string }): {
  landings: RepoLandings;
  repo: SteersRepo;
} {
  const origin = originRepositoryOf({ cwd: dir });
  if (origin.isErr()) {
    const why = `${dir}'s origin would not read: ${origin.error.join("; ")}`;
    return { landings: { kind: "unread", why }, repo: { dir, kind: "unread", why } };
  }
  const repo = `${origin.value.owner}/${origin.value.repo}`;
  const read = resolveLandedRef({ dir, refs: DEFAULT_LANDED_REFS }).andThen((resolved) =>
    readLandedLogSince({ dir, sha: resolved.sha, sinceIso })
      .andThen((text) => landedCommitsOf({ text }))
      .map((commits) => ({ commits, resolved })),
  );
  if (read.isErr()) {
    const why = `${repo}'s main would not read in ${dir}: ${read.error.message}`;
    return { landings: { kind: "unread", why }, repo: { dir, kind: "unread", why } };
  }
  const { commits, resolved } = read.value;
  const numbers = new Set<number>();
  for (const commit of commits) {
    const pr = prNumberOf({ subject: commit.subject });
    if (pr !== undefined) {
      numbers.add(pr.number);
    }
  }
  const hits = readPrRecordsFor({ home, numbers, repo });
  if (hits.kind === "unreadable") {
    const why = `slopweaver's PR ledger would not list: ${hits.why}`;
    return { landings: { kind: "unread", why }, repo: { dir, kind: "unread", why } };
  }
  const { byBranch, byNumber, unjoined } = landingsOf({ commits, hits, repo });
  return {
    landings: { byBranch, byNumber, kind: "read", ref: resolved.ref, refSha: resolved.sha, repo },
    repo: {
      commits: commits.length,
      dir,
      kind: "read",
      ledgerUnread: hits.unread.length,
      ref: resolved.ref,
      refSha: resolved.sha,
      repo,
      unjoined,
    },
  };
}

/**
 * Every steer on the board and where it stands.
 *
 * @param home the state home holding the board, the run journals and the PR ledger
 * @param nowIso the instant the report is stamped with
 * @returns the report, or why the board would not scan
 */
export function readSteersReport({
  home,
  nowIso,
}: {
  home: string;
  nowIso: string;
}): Result<SteersReport, IngestError> {
  const paths = stateHomePaths({ home });
  const scan = scanBoard({ handoverDir: paths.handovers });
  if (scan.isErr()) {
    return err(scan.error);
  }
  const candidates = scan.value.docs.filter((doc) => mayBeSteer({ doc }));
  const runs = new Map<string, RunState>();
  const unreadableJournals: string[] = [];
  for (const doc of candidates) {
    const journal = readRunJournal({ runsDir: paths.runs, slug: doc.slug });
    if (journal.isErr()) {
      unreadableJournals.push(doc.slug);
      continue;
    }
    runs.set(doc.slug, runStateOf({ events: journal.value.events }));
  }
  const repoDirs = [...new Set(candidates.flatMap((doc) => (doc.repo === undefined ? [] : [doc.repo])))].toSorted();
  const landings = new Map<string, RepoLandings>();
  const repos: SteersRepo[] = [];
  const sinceIso = oldestIso({ docs: candidates });
  for (const dir of repoDirs) {
    if (sinceIso === undefined) {
      const why = "no candidate row records when it was asked, so no window of main could be chosen";
      landings.set(dir, { kind: "unread", why });
      repos.push({ dir, kind: "unread", why });
      continue;
    }
    const read = readRepo({ dir, home, sinceIso });
    landings.set(dir, read.landings);
    repos.push(read.repo);
  }
  return ok({
    observedAtIso: nowIso,
    repos,
    steers: steersOf({ docs: candidates, landings, noRun: NO_RUN, runs, unreadRuns: new Set(unreadableJournals) }),
    unreadableDocs: scan.value.unreadable.length,
    unreadableJournals,
  });
}
