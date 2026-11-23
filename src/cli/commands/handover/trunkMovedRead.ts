/**
 * The git read behind the reconcile-time trunk-moved hold — `../../../handover/trunkMoved.ts` is the pure
 * judgement and carries the measurement; this module only asks git what it needs to be asked.
 *
 * ## Cost
 *
 * At most two `git log` calls per distinct checkout, never one per row: one scoped to the union of every
 * candidate's paths and verb modules with `--name-only`, and one subject-only walk when any candidate names a
 * pull request of that checkout. Both start at the OLDEST candidate's floor, and each row then reads only the
 * commits after its own.
 *
 * ## An unread trunk is stated, and the rows are offered unchecked
 *
 * A checkout whose trunk ref, origin or log cannot be read is reported as UNREAD with the rows it would have
 * judged. They stay ready: holding every finding because git failed once would starve the ready set on an
 * outage, which is the opposite error from the one this hold exists to stop. The line says so, so the zero is
 * never silent — the same stance `./reconcileRows.ts`'s supersession read takes on an unreadable cmux.
 *
 * The trunk is as fresh as the checkout's last fetch; nothing here fetches.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveTrunkRef } from "../../../cli/staleSeatEffects.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { type EvidenceRefs, evidenceRefs } from "../../../handover/evidenceRefs.js";
import { verbRunModule } from "../../../handover/manifestVerbs.js";
import {
  floorSecondMs,
  isTrunkCheckCandidate,
  originSlug,
  parseTrunkLog,
  type RepoSlug,
  TRUNK_LOG_FORMAT,
  type TrunkCommit,
  type TrunkHeldRow,
  trunkCheckFloor,
  trunkMovesFor,
} from "../../../handover/trunkMoved.js";
import { gitEnv } from "../../../lib/gitRepo.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** A bound on one log's output rather than an unbounded pipe; a scoped log over weeks is far below it. */
const GIT_OUTPUT_MAX_BYTES = 32_000_000;

/** One checkout whose trunk could not be read, and the ready findings offered without the check. */
interface TrunkUnread {
  readonly repo: string;
  readonly why: string;
  readonly slugs: readonly string[];
}

/** What the trunk-moved read found across every checkout. */
export interface TrunkMovedRead {
  /**
   * Each held row's slug and moves, by doc PATH: two docs may share a slug, and a hold keyed by it would demote
   * a row whose own evidence moved nothing.
   */
  readonly held: ReadonlyMap<string, TrunkHeldRow>;
  readonly unread: readonly TrunkUnread[];
  /** Readable checkouts whose cited pulls could not be checked, why, and the rows whose cited pulls went unchecked. */
  readonly pullsUnchecked: readonly TrunkUnread[];
}

/** One candidate row, its floor and what its evidence names. */
interface Candidate {
  readonly path: string;
  readonly slug: string;
  readonly floorIso: string;
  readonly refs: EvidenceRefs;
  /** The trunk tip the row's last recheck ran against, when it recorded one. */
  readonly recheckedSha: string | undefined;
}

/**
 * Run one git command in a checkout, answering `undefined` on any failure rather than throwing. `core.quotePath`
 * is off because git otherwise prints a non-ASCII path octal-escaped in quotes, which never equals the path an
 * evidence item names. Pathspecs are literal because an evidence path is a NAME, and
 * one opening `:(` or carrying a glob would otherwise be read as magic, narrowing the log.
 */
function gitRead({ cwd, args }: { cwd: string; args: readonly string[] }): string | undefined {
  try {
    return execFileSync("git", ["--literal-pathspecs", "-C", cwd, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
}

/**
 * The commit a checkout's trunk points at now — what `handover recheck` records as seen.
 *
 * @param repo the row's checkout
 * @returns the full sha, or `undefined` when the trunk ref does not resolve there
 */
export function trunkTipSha({ repo }: { repo: string }): string | undefined {
  const trunk = resolveTrunkRef({ root: repo });
  if (trunk === undefined) {
    return undefined;
  }
  const sha = gitRead({ args: ["rev-parse", "--verify", "--end-of-options", `${trunk}^{commit}`], cwd: repo });
  return sha === undefined ? undefined : sha.trim();
}

/**
 * The commits a trunk carries that a recheck's tip did not — `undefined` when git cannot say (a malformed sha, or
 * one this checkout no longer has), and `readTrunkMoved` then states the row and offers it unchecked.
 */
function unseenSince({
  repo,
  sha,
  trunk,
}: {
  repo: string;
  sha: string;
  trunk: string;
}): ReadonlySet<string> | undefined {
  if (!/^[0-9a-f]{40}$/u.test(sha)) {
    return undefined;
  }
  const listed = gitRead({ args: ["rev-list", `${sha}..${trunk}`], cwd: repo });
  return listed === undefined ? undefined : new Set(listed.split("\n").filter((line) => line.length > 0));
}

/**
 * Every manifest's source in a checkout, keyed by file name — empty when it has none, which is every checkout but
 * this one.
 */
function manifestTexts({ repo }: { repo: string }): ReadonlyMap<string, string> {
  const dir = join(repo, "src", "cli", "manifests");
  const texts = new Map<string, string>();
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  } catch {
    return texts;
  }
  for (const name of names) {
    try {
      texts.set(name, readFileSync(join(dir, name), "utf8"));
    } catch {
      // An unreadable manifest binds no verb, and a verb it would have bound is dropped rather than guessed.
    }
  }
  return texts;
}

/** Each named verb's run module in this checkout, keyed `<noun> <verb>` — only the verbs that resolve exactly. */
function verbModulesOf({
  candidates,
  repo,
}: {
  candidates: readonly Candidate[];
  repo: string;
}): ReadonlyMap<string, string> {
  const verbs = candidates.flatMap((candidate) => candidate.refs.verbs);
  if (verbs.length === 0) {
    return new Map();
  }
  const manifests = manifestTexts({ repo });
  const modules = new Map<string, string>();
  for (const ref of verbs) {
    const module = verbRunModule({ manifests, ref });
    if (module !== undefined) {
      modules.set(`${ref.noun} ${ref.verb}`, module);
    }
  }
  return modules;
}

/** The earliest floor among the candidates — where both logs start. */
function oldestFloor({ candidates }: { candidates: readonly Candidate[] }): string {
  return candidates
    .map((candidate) => candidate.floorIso)
    .reduce((oldest, iso) => (Date.parse(iso) < Date.parse(oldest) ? iso : oldest));
}

/** What one readable checkout's trunk gave: its commits, its GitHub origin, and why its pulls went unchecked. */
interface TrunkCommits {
  readonly commits: readonly TrunkCommit[];
  readonly origin: RepoSlug | undefined;
  /** Set only when a candidate cites a pull and pulls could not be checked here. */
  readonly pullsWhy: string | undefined;
  /** The trunk ref both logs walked. */
  readonly trunk: string;
}

/**
 * The trunk commits since `since` touching a cited path or verb module: none when nothing is cited, `undefined`
 * when git fails.
 */
function pathCommitsOf({
  candidates,
  repo,
  since,
  trunk,
  verbModules,
}: {
  candidates: readonly Candidate[];
  repo: string;
  since: string;
  trunk: string;
  verbModules: ReadonlyMap<string, string>;
}): readonly TrunkCommit[] | undefined {
  const pathspecs = [...new Set([...candidates.flatMap((candidate) => candidate.refs.paths), ...verbModules.values()])];
  if (pathspecs.length === 0) {
    return [];
  }
  // The trunk's own line, each merge diffed against it: a pathspec log otherwise simplifies history, dropping a
  // merge that brought a cited file in after the floor because a branch commit dated before it already had
  // it. The FIRST parent only, named outright rather than left to how `-m` and the
  // checkout's `log.diffMerges` combine, so a merge never moves a file only its side parent differs at.
  const log = gitRead({
    args: [
      "log",
      since,
      "--first-parent",
      "--diff-merges=first-parent",
      `--format=${TRUNK_LOG_FORMAT}`,
      "--name-only",
      trunk,
      "--",
      ...pathspecs,
    ],
    cwd: repo,
  });
  return log === undefined ? undefined : parseTrunkLog({ text: log });
}

/**
 * The commits one checkout's trunk carries since the oldest floor, or why the trunk could not be read. A failure
 * of the PULL reads (the origin, the subject walk) leaves the path commits standing and names why the pulls went
 * unchecked: the paths were read, and discarding them offered a moved row as ready.
 */
function trunkCommitsOf({
  candidates,
  repo,
  verbModules,
}: {
  candidates: readonly Candidate[];
  repo: string;
  verbModules: ReadonlyMap<string, string>;
}): TrunkCommits | { readonly why: string } {
  const trunk = resolveTrunkRef({ root: repo });
  if (trunk === undefined) {
    return { why: "neither origin/HEAD nor origin/main resolves there" };
  }
  // `--since-as-filter`, never `--since`: the latter STOPS the walk at the first commit dated before it, so one
  // skewed committer date hid every commit under it. Filtering walks the whole trunk:
  // MEASURED 0.34s over 2382 slopweaver commits —
  // `time git log --since-as-filter="$(date -u -v-100d +%Y-%m-%dT%H:%M:%SZ)" --format=%H origin/main | wc -l`.
  // A second early, so git's own reading of the boundary can never drop the floor's second; `trunkMovesFor`
  // filters exactly.
  const sinceMs = floorSecondMs({ floorIso: oldestFloor({ candidates }) }) - 1000;
  const since = `--since-as-filter=${new Date(sinceMs).toISOString()}`;
  const pathCommits = pathCommitsOf({ candidates, repo, since, trunk, verbModules });
  if (pathCommits === undefined) {
    return { why: `git log over ${trunk} failed` };
  }
  if (!candidates.some((candidate) => candidate.refs.pulls.length > 0)) {
    return { commits: pathCommits, origin: undefined, pullsWhy: undefined, trunk };
  }
  const url = gitRead({ args: ["remote", "get-url", "origin"], cwd: repo });
  if (url === undefined) {
    return { commits: pathCommits, origin: undefined, pullsWhy: "its origin remote could not be read", trunk };
  }
  const origin = originSlug({ url });
  if (origin === undefined) {
    return { commits: pathCommits, origin: undefined, pullsWhy: "its origin names no github.com repository", trunk };
  }
  // The first-parent line too: a pull LANDS as a trunk commit, never as a commit a merge carried in on a side
  // branch.
  const subjects = gitRead({
    args: ["log", since, "--first-parent", `--format=${TRUNK_LOG_FORMAT}`, trunk],
    cwd: repo,
  });
  if (subjects === undefined) {
    return { commits: pathCommits, origin: undefined, pullsWhy: `the ${trunk} subjects could not be read`, trunk };
  }
  return { commits: pathCommits.concat(parseTrunkLog({ text: subjects })), origin, pullsWhy: undefined, trunk };
}

/** A row as a candidate this hold judges, or `undefined` when it is not one or names nothing it could check. */
function candidateOf({ model }: { model: BoardModel }): Candidate | undefined {
  if (!isTrunkCheckCandidate({ doc: model.doc, section: model.section })) {
    return undefined;
  }
  const floorIso = trunkCheckFloor({ doc: model.doc });
  const refs = evidenceRefs({ evidence: model.doc.evidence });
  const namesAnything = refs.paths.length + refs.verbs.length + refs.pulls.length > 0;
  if (floorIso === undefined || !namesAnything) {
    return undefined;
  }
  return { floorIso, path: model.doc.path, recheckedSha: model.doc.trunkRecheckedSha, refs, slug: model.doc.slug };
}

/** The candidates grouped by the checkout each names. */
function candidatesByRepo({ models }: { models: readonly BoardModel[] }): ReadonlyMap<string, readonly Candidate[]> {
  const byRepo = new Map<string, Candidate[]>();
  for (const model of models) {
    const candidate = candidateOf({ model });
    if (candidate === undefined) {
      continue;
    }
    // A candidate names a repo by construction (`isTrunkCheckCandidate`).
    const repo = model.doc.repo!;
    const group = byRepo.get(repo);
    if (group === undefined) {
      byRepo.set(repo, [candidate]);
    } else {
      group.push(candidate);
    }
  }
  return byRepo;
}

/**
 * Read every ready finding's trunk, once per checkout, and say which ones it has moved under.
 *
 * @param models the composed board
 * @returns the held rows with their moves, and every checkout that could not be read
 */
export function readTrunkMoved({ models }: { models: readonly BoardModel[] }): TrunkMovedRead {
  const byRepo = candidatesByRepo({ models });
  const held = new Map<string, TrunkHeldRow>();
  const unread: TrunkUnread[] = [];
  const pullsUnchecked: { readonly repo: string; readonly why: string; readonly slugs: readonly string[] }[] = [];
  for (const [repo, candidates] of byRepo) {
    const verbModules = verbModulesOf({ candidates, repo });
    const read = trunkCommitsOf({ candidates, repo, verbModules });
    if ("why" in read) {
      unread.push({ repo, slugs: candidates.map((candidate) => candidate.slug).toSorted(), why: read.why });
      continue;
    }
    if (read.pullsWhy !== undefined) {
      const citing = candidates.filter((candidate) => candidate.refs.pulls.length > 0);
      pullsUnchecked.push({ repo, slugs: citing.map((candidate) => candidate.slug).toSorted(), why: read.pullsWhy });
    }
    const judged = judgeCandidates({ candidates, read, repo, verbModules });
    for (const [path, row] of judged.held) {
      held.set(path, row);
    }
    if (judged.tipUnread.length > 0) {
      unread.push({
        repo,
        slugs: judged.tipUnread.toSorted(),
        why: "the trunk tip their recheck recorded is not in this checkout",
      });
    }
  }
  return { held, pullsUnchecked, unread };
}

/**
 * One readable checkout's candidates judged against its trunk: each held row by doc path, and the rows whose
 * recorded recheck tip git could not place. Git is asked once per tip, however many rows recorded it.
 */
function judgeCandidates({
  candidates,
  read,
  repo,
  verbModules,
}: {
  candidates: readonly Candidate[];
  read: TrunkCommits;
  repo: string;
  verbModules: ReadonlyMap<string, string>;
}): { readonly held: readonly (readonly [string, TrunkHeldRow])[]; readonly tipUnread: readonly string[] } {
  const unseenBySha = new Map<string, ReadonlySet<string> | undefined>();
  const unseenOf = ({ sha }: { sha: string }): ReadonlySet<string> | undefined => {
    if (!unseenBySha.has(sha)) {
      unseenBySha.set(sha, unseenSince({ repo, sha, trunk: read.trunk }));
    }
    return unseenBySha.get(sha);
  };
  const held: (readonly [string, TrunkHeldRow])[] = [];
  const tipUnread: string[] = [];
  for (const candidate of candidates) {
    const sha = candidate.recheckedSha;
    const unseen = sha === undefined ? undefined : unseenOf({ sha });
    // A recorded tip git cannot place is stated and the row offered unchecked, never judged on its date alone:
    // that would hold it again on a commit its recheck saw.
    if (sha !== undefined && unseen === undefined) {
      tipUnread.push(candidate.slug);
      continue;
    }
    const moves = trunkMovesFor({
      commits: read.commits,
      floorIso: candidate.floorIso,
      origin: read.origin,
      refs: candidate.refs,
      unseen,
      verbModules,
    });
    if (moves.length > 0) {
      held.push([candidate.path, { moves, slug: candidate.slug }]);
    }
  }
  return { held, tipUnread };
}
