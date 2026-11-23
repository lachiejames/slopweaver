/**
 * The effectful half of `fleet landed`: main's history from git, the PR ledger by number, each row by its exact
 * slug, and the autonomy ledger — joined by `./landed.ts`.
 *
 * Every read past git is per entry and says what it could not read rather than failing the report: a row that
 * will not parse, or a ledger the store will not answer for, is a fact about that one landing, and a page that went blank over it
 * would hide every other change. Git is the one refusal, because without it there is no list to annotate.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { AutonomyLedgerPort } from "../autonomy/port.js";
import { foldAutonomy } from "../autonomy/query.js";
import { originRepositoryOf } from "../config.js";
import { resolveHisWords } from "../handover/hisWordsResolve.js";
import { isSafeSlug, readRunJournal } from "../handover/runStore.js";
import { readExactDoc } from "../handover/store.js";
import { type PrLedgerRead, readPrRecordsFor } from "../outbound/github/prLedgerByNumber.js";
import { outsideChairReason } from "../profile/supervisorWords.js";
import { stateHomePaths } from "../stateHome.js";
import { claudeHomeDir } from "../supervisor/chairRead.js";
import { landedBranchOf, landedCommitsOf, landedEntryOf, prNumberOf } from "./landed.js";
import { type LandedError, LandedErrors } from "./landedErrors.js";
import { readLandedLog, resolveLandedRef } from "./landedGit.js";
import type { LandedActs, LandedCommit, LandedReads, LandedReport, LandedRow, LandedWordsAt } from "./landedTypes.js";

/**
 * One row by its exact slug, with its run journal.
 *
 * @param handoverDir the top-level handovers directory
 * @param runsDir the run journals' directory
 * @param slug the branch the ledger names, which is a row's slug when the run was spawned by default
 * @returns the row, its absence, or why it would not read
 */
export function readLandedRow({
  handoverDir,
  runsDir,
  slug,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
}): LandedRow {
  if (!isSafeSlug({ slug })) {
    return { kind: "not-a-slug" };
  }
  const found = readExactDoc({ handoverDir, slug });
  if (found.isErr()) {
    return { kind: "unreadable", why: found.error.why };
  }
  if (found.value === undefined) {
    return { kind: "absent" };
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return { kind: "unreadable", why: `its run journal would not read: ${journal.error.message}` };
  }
  return {
    archived: found.value.archived,
    doc: found.value.doc,
    events: journal.value.events,
    kind: "read",
    undecoded: journal.value.unreadable.length,
  };
}

/**
 * The autonomy ledger folded, or why it would not read — the port refuses the whole read on one unreadable row,
 * since an act missing from the join would read as a landing the fleet never did for the owner.
 *
 * @param autonomy the autonomy ledger
 * @param home the state home it answers for
 * @returns the acts, or the reason
 */
async function readLandedActs({ autonomy, home }: { autonomy: AutonomyLedgerPort; home: string }): Promise<LandedActs> {
  const records = await autonomy.readRecords({ home });
  const folded = records.andThen((held) => foldAutonomy({ records: held }));
  if (folded.isErr()) {
    return { kind: "unread", why: folded.error.message };
  }
  return { acts: folded.value, kind: "read" };
}

/**
 * The owner's words at a ruling's anchor, each anchor read once per report — a transcript anchor walks a whole session file.
 *
 * @param home the state home the talk records live under
 * @param projectsDir `~/.claude/projects`, where a transcript anchor's session lives
 * @returns the reader `./landed.ts` is given
 */
function landedWordsReader({ home, projectsDir }: { home: string; projectsDir: string }): LandedWordsAt {
  const read = new Map<string, ReturnType<LandedWordsAt>>();
  return ({ anchor }) => {
    const known = read.get(anchor);
    if (known !== undefined) {
      return known;
    }
    const fresh = resolveHisWords({ anchor, home, projectsDir });
    read.set(anchor, fresh);
    return fresh;
  };
}

/** Every pull-request number the commits name. */
function prNumbersOf({ commits }: { commits: readonly LandedCommit[] }): Set<number> {
  const numbers = new Set<number>();
  for (const commit of commits) {
    const pr = prNumberOf({ subject: commit.subject });
    if (pr !== undefined) {
      numbers.add(pr.number);
    }
  }
  return numbers;
}

/** The row a commit's ledger record names by its branch, or `undefined` when the join stops before a branch. */
function landedRowFor({
  commit,
  ledger,
  home,
}: {
  commit: LandedCommit;
  ledger: PrLedgerRead;
  home: string;
}): LandedRow | undefined {
  const pr = prNumberOf({ subject: commit.subject });
  let hit;
  if (pr !== undefined && ledger.kind === "read") {
    hit = ledger.hits.get(pr.number);
  }
  const branch = landedBranchOf({ hit });
  if (branch === undefined) {
    return undefined;
  }
  const paths = stateHomePaths({ home });
  return readLandedRow({ handoverDir: paths.handovers, runsDir: paths.runs, slug: branch });
}

/**
 * What landed on main in a checkout, each change joined to the owner's words and its proof.
 *
 * @param dir the checkout whose main is read
 * @param home the state home holding the PR ledger and the board
 * @param autonomy the autonomy ledger the acts are joined from
 * @param refs the refs tried for main, in order
 * @param limit how many first-parent commits
 * @param nowIso the instant the report is stamped with
 * @returns the report, or why main's history could not be read
 */
export async function readLandedReport({
  dir,
  home,
  autonomy,
  refs,
  limit,
  nowIso,
}: {
  dir: string;
  home: string;
  autonomy: AutonomyLedgerPort;
  refs: readonly string[];
  limit: number;
  nowIso: string;
}): Promise<Result<LandedReport, LandedError>> {
  const origin = originRepositoryOf({ cwd: dir });
  if (origin.isErr()) {
    return err(LandedErrors.originUnreadable({ why: origin.error.join("; ") }));
  }
  const repo = `${origin.value.owner}/${origin.value.repo}`;
  const resolved = resolveLandedRef({ dir, refs });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const commits = readLandedLog({ dir, limit, sha: resolved.value.sha }).andThen((text) => landedCommitsOf({ text }));
  if (commits.isErr()) {
    return err(commits.error);
  }
  const numbers = prNumbersOf({ commits: commits.value });
  const ledger = readPrRecordsFor({ home, numbers, repo });
  // Only a landing that names a pull request is joined to an act, so the ledger is read only when one does; a
  // refusal then shows on every row that needed it, and a window with none never reads a ledger nothing shows.
  let acts: LandedActs = {
    kind: "unread",
    why: "no landing in this window names a pull request, so the autonomy ledger was not read",
  };
  if (numbers.size > 0) {
    acts = await readLandedActs({ autonomy, home });
  }
  const reads: LandedReads = {
    outsideChair: ({ anchor, atIso }) => outsideChairReason({ anchor, atIso, home }),
    wordsAt: landedWordsReader({ home, projectsDir: join(claudeHomeDir(), "projects") }),
  };
  const landings = commits.value.map((commit) =>
    landedEntryOf({ acts, commit, ledger, reads, repo, row: landedRowFor({ commit, home, ledger }) }),
  );
  let ledgerUnread: LandedReport["ledgerUnread"] = [];
  if (ledger.kind === "read") {
    ledgerUnread = ledger.unread;
  }
  return ok({
    landings,
    ledgerUnread,
    limit,
    observedAtIso: nowIso,
    ref: resolved.value.ref,
    refSha: resolved.value.sha,
    repo,
  });
}
