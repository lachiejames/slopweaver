/**
 * Evaluating a doc's `doneWhen:` probes against a real repository. The effectful half of {@link ./probe}.
 *
 * ## Reading bytes ourselves, not asking a text tool
 *
 * `present:`/`absent:` are answered by `readFileSync`, deliberately, and never by shelling out to `grep`.
 * Measured on this board's own docs: `linear-full-corpus-build.md` carries a single raw NUL byte, which makes
 * `file` call it `data` and makes grep silently blind to the whole file — so a grep-backed `absent:` probe
 * reports "the symbol is gone" having read nothing. Node reads that file correctly, so this seam can answer
 * where a shell pipeline cannot.
 *
 * A file that genuinely cannot be read yields `undefined`, which {@link ./probe} turns into `not-evaluated`
 * rather than a pass. "I could not look" is not "it is absent".
 *
 * ## Finding a doc's branch: exact names only
 *
 * Three sources, in descending trustworthiness, and only the first two are facts: the branch the LEDGER recorded
 * at `handover start`, the branch the doc's own `branch:` front-matter declares, and then two conventional
 * guesses — the slug and `worktree-<slug>`.
 *
 * The guesses exist only for docs predating the other two, and they are measurably weak: a review of the live
 * board found a real 14-commit worktree they missed, because its branch was `v2-atlas-rebuild` while the slug
 * was `v2-datadog-atlas-rebuild`. The answer to that is NOT to match on name similarity — that is the fuzzy
 * matching this repo forbids, and a frequently-wrong `in-flight` is worse than none. The answer is to let the
 * author state it, which `branch:` now allows.
 *
 * `handover list` does not read the ledger (it prints every doc and would pay a journal read per doc), so on the
 * board the declared `branch:` is the exact signal.
 *
 * An unmatched doc reports zero commits and falls back to its declared status — silent rather than wrong, which
 * is the right direction to err.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { gitEnv } from "#lib/gitRepo.js";
import { isRecord } from "#lib/parsers.js";
import { resolveTrunk } from "../measurement/measure.js";
import { type CommandProbeOutcome, type ProbeSeams, textContainsSymbol } from "./probe.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** Plenty for a `rev-list --count` or a branch listing, and a bound rather than an unbounded pipe. */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * The branches a row's work is STATED to be on: the one its run journal recorded at `handover start`, then
 * the one its `branch:` front matter declares — deduplicated, and nothing else.
 *
 * Pure. Both are facts somebody wrote down, which is what lets a reader that must stay exact join on them; the
 * slug conventions {@link branchCandidates} adds after them are guesses, and a join that must never infer a
 * row by name stops here. An ask row declares no `branch:` but its seat still opens a run on one, so a reader
 * taking only the declaration misses every ask a seat is working.
 *
 * @param recordedBranch the branch the current cycle's `started` event recorded, when a run has opened
 * @param declaredBranch the branch the doc's `branch:` front matter names, when it names one
 * @returns the stated branch names, without duplicates or empty strings, recorded first
 */
export function statedBranches({
  recordedBranch,
  declaredBranch,
}: {
  recordedBranch: string | undefined;
  declaredBranch: string | undefined;
}): readonly string[] {
  const stated = [recordedBranch, declaredBranch].filter((name): name is string => name !== undefined && name !== "");
  return [...new Set(stated)];
}

/**
 * The exact branch names that may carry a doc's work, most trustworthy first.
 *
 * Pure, and deliberately a SHORT closed list. The ledger's recorded branch is exact — it was written when the
 * run opened — so it comes first and the conventions are only a fallback for docs that predate the ledger.
 *
 * @param slug the doc's slug
 * @param recordedBranch the branch the run ledger recorded, when there is a run
 * @param declaredBranch the branch the doc's `branch:` front-matter names, when it names one
 * @returns candidate branch names, without duplicates, most trustworthy first
 */
export function branchCandidates({
  slug,
  recordedBranch,
  declaredBranch,
}: {
  slug: string;
  recordedBranch: string | undefined;
  declaredBranch?: string | undefined;
}): readonly string[] {
  // Ledger first (written when the run opened), then the doc's own declaration, then the conventions. The first
  // two are FACTS someone stated; the last two are guesses, and they are the ones that measurably missed a real
  // 14-commit worktree whose branch name did not match its slug.
  return [...new Set([...statedBranches({ declaredBranch, recordedBranch }), slug, `worktree-${slug}`])];
}

/**
 * Whether a resolved path is still inside the repository it was resolved against.
 *
 * A doc is data, and a `path:` or `present:` target of `../../etc/passwd` must not make the board read outside
 * the tree it was pointed at. Lexical, so it is decided before any read happens.
 *
 * @param repo the repository root
 * @param target the repo-relative target from the doc
 * @returns the absolute path when it stays inside, otherwise `undefined`
 */
export function insideRepo({ repo, target }: { repo: string; target: string }): string | undefined {
  if (isAbsolute(target)) {
    return undefined;
  }
  const absolute = resolve(repo, target);
  const rel = relative(repo, absolute);
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : absolute;
}

/**
 * Probe seams over one repository's working tree.
 *
 * @param repo the repository the doc's paths resolve against
 * @param runCommand a command runner, or `undefined` to decline command probes — `handover list` declines,
 *   because the board recomputes on every print and would otherwise fan arbitrary shell from every doc
 * @returns the seams {@link ./probe}'s evaluator needs
 */
export function repoProbeSeams({
  repo,
  runCommand,
}: {
  repo: string;
  runCommand: ((args: { command: string }) => CommandProbeOutcome) | undefined;
}): ProbeSeams {
  // Resolved ONCE, and it is the difference between knowledge and ignorance. ENOENT on a file inside a real
  // repository means the symbol is definitively not there. ENOENT because the whole REPOSITORY is absent means
  // nothing was examined at all — and an adversarial pass showed that conflating them let a doc pointing at a
  // nonexistent repo pass every `absent:` probe and compute `landed`, which then made `start` refuse it as
  // already shipped. A missing repo now yields `not-evaluated` for every symbol probe.
  const repoPresent = existsSync(repo);
  return {
    fileContains: ({ file, symbol }) => {
      const absolute = insideRepo({ repo, target: file });
      if (absolute === undefined || !repoPresent) {
        return undefined;
      }
      try {
        return textContainsSymbol({ file, symbol, text: readFileSync(absolute, "utf8") });
      } catch (error: unknown) {
        // A file that DOES NOT EXIST is knowledge, not ignorance: the symbol is definitively not in it, so a
        // `present:` probe fails and an `absent:` one passes. Collapsing this into "nothing was checked" was a
        // real bug — the commonest probe of all is `present:` on a file the work has yet to create, and while
        // ENOENT read as unknown that probe could never fail, so the doc stayed in RUN NOW forever.
        //
        // Every OTHER failure — a permissions error, a directory, a bad mount — genuinely is ignorance, and
        // stays `undefined` so it can never be mistaken for absence.
        return isRecord(error) && error["code"] === "ENOENT" ? false : undefined;
      }
    },
    pathExists: ({ path }) => {
      const absolute = insideRepo({ repo, target: path });
      return absolute === undefined ? false : existsSync(absolute);
    },
    runCommand,
  };
}

/**
 * Commits on any candidate branch that are not on the base, or 0 when no candidate branch exists.
 *
 * Zero is returned for every failure mode — no such branch, not a checkout, git refused — because the caller
 * turns a non-zero count into the `in-flight` state, and inventing one would put a doc under "work already
 * exists" on the strength of a git error.
 *
 * @param repo the repository to ask
 * @param base the base branch commits are counted against, or `undefined` to resolve this repository's trunk
 * @param candidates exact branch names from {@link branchCandidates}
 * @returns the highest count any candidate carries, and 0 when none resolve
 */
export function commitsAhead({
  repo,
  base,
  candidates,
}: {
  repo: string;
  base: string | undefined;
  candidates: readonly string[];
}): number {
  return aheadFromIndex({ candidates, index: repoAheadIndex({ base, candidates, repo }) });
}

/**
 * Every full ref name a set of bare candidates could resolve to, in {@link refLookupOrder}'s order, each once.
 *
 * @param candidates bare branch names from {@link branchCandidates}
 * @returns the refs an index scoped to those candidates must cover, first-seen order
 */
export function candidateRefPatterns({ candidates }: { candidates: readonly string[] }): readonly string[] {
  return [...new Set(candidates.flatMap((name) => refLookupOrder({ name })))];
}

/**
 * The commits-ahead-of-trunk of every ref the candidates could name — or, with no candidates given, of every
 * ref — in ONE git call, so a board of N docs costs one process per REPOSITORY rather than five per DOC.
 *
 * MEASURED on the owner's own board, and it is why this exists rather than being a tidy-up: 1,387
 * docs against a checkout holding 1,550 refs made `slopweaver handover list` take **474 seconds**, with zero
 * bytes on stdout or stderr until the very end, so every caller with a sane timeout saw an empty board — and
 * `AGENTS.md` makes that board the only register of what is in flight. Reproduce the before-number on any
 * board with `time slopweaver handover list | wc -l`. The cost was `commitsAhead` per doc: a trunk resolution
 * (one `symbolic-ref` plus up to two `rev-parse`) and one `rev-list --count` per candidate branch, none of
 * which changes between docs in the same tree. One `for-each-ref` over the same 1,550 refs answers all of it
 * in **1.1 s** — reproduce with
 * `time git for-each-ref --format='%(refname) %(ahead-behind:refs/heads/main)' refs`.
 *
 * `%(ahead-behind:<base>)` needs git 2.41. An older git fails the whole invocation rather than answering
 * wrongly, so `byRef` is `undefined` there and {@link aheadFromIndex} falls back to the per-candidate
 * `rev-list` this replaced — slow, and exactly as correct as it always was.
 *
 * Then the ref count outgrew even one walk. MEASURED: acme-admin carries 25,558 refs and the full
 * walk took 9.9 s of the 26 s `handover list --json` the console's queue waits on, while the same walk scoped
 * to the 350 acme-admin docs' candidates (2,800 patterns, 143 refs matched) took 0.47 s. Reproduce with
 * `time git -C <repo> for-each-ref --format='%(refname) %(ahead-behind:<trunk>)' refs | wc -l` against
 * `... --stdin < patterns`. So a caller that knows its candidates names them, and the walk covers only the refs
 * {@link candidateRefPatterns} expands them to: every spelling {@link aheadFromIndex} looks up is asked for, so
 * absence from a scoped index is still non-existence. A git that refuses `--stdin` gets the whole walk instead.
 *
 * @param repo the repository to ask
 * @param base the base commits are counted against, or `undefined` to resolve this repository's own trunk
 * @param candidates EVERY candidate the caller will look up in this index, or `undefined` for every ref — a
 *   candidate left out would read as 0 however far ahead it is
 * @returns the index, which a caller holds for as long as it is asking about ONE repository
 */
export function repoAheadIndex({
  repo,
  base: trunk = trunkOr({ repo }),
  candidates,
}: {
  repo: string;
  base: string | undefined;
  candidates?: readonly string[] | undefined;
}): RepoAheadIndex {
  // Resolved per REPOSITORY. A shared `main` counted every doc in a repository whose trunk is something else
  // against a ref that does not exist there — and because every failure here answers 0, that read as "no work
  // exists for this doc" rather than as an error.
  if (trunk === undefined) {
    return { byRef: new Map(), repo, trunk: undefined };
  }
  if (candidates === undefined) {
    return { byRef: readAheadByRef({ repo, trunk }), repo, trunk };
  }
  // Answered here, never by git: `for-each-ref --stdin` given no pattern lists EVERY ref (git 2.54).
  if (candidates.length === 0) {
    return { byRef: new Map(), repo, trunk };
  }
  const scoped = readAheadByRef({ patterns: candidateRefPatterns({ candidates }), repo, trunk });
  if (scoped !== undefined) {
    return { byRef: scoped, repo, trunk };
  }
  return { byRef: readAheadByRef({ repo, trunk }), repo, trunk };
}

/** One repository's ahead-of-trunk counts, built once by {@link repoAheadIndex} and read many times. */
export interface RepoAheadIndex {
  /** The repository the index was built against — carried so the fallback can still shell out. */
  readonly repo: string;
  /** The resolved trunk, or `undefined` when it could not be established; every count is then 0. */
  readonly trunk: string | undefined;
  /** Ahead counts by FULL ref name, or `undefined` when the one-call form was refused. */
  readonly byRef: ReadonlyMap<string, number> | undefined;
}

/**
 * The full ref names a bare candidate could resolve to, in git's own precedence order.
 *
 * Pure, and a transcription of `gitrevisions`' rule rather than a convenience: `rev-list main..foo` prefers
 * `refs/tags/foo` over `refs/heads/foo`, so an index that looked up heads first would answer a different
 * number than the `rev-list` it replaced, on the one repository that happens to carry both. The `$GIT_DIR/<name>`
 * step (`HEAD`, `FETCH_HEAD`, …) is deliberately absent: a candidate here is a branch name from
 * {@link branchCandidates}, never a pseudo-ref, and inventing coverage for a case that cannot arise would
 * make this harder to check against the manual page it copies.
 *
 * @param name the bare candidate name
 * @returns the full ref names to try, most preferred first
 */
export function refLookupOrder({ name }: { name: string }): readonly string[] {
  return [
    `refs/${name}`,
    `refs/tags/${name}`,
    `refs/heads/${name}`,
    `refs/remotes/${name}`,
    `refs/remotes/${name}/HEAD`,
  ];
}

/**
 * The highest ahead-count any candidate carries, read from a prebuilt index.
 *
 * A candidate absent from the index answers 0, which is the same answer the `rev-list` form gave for a branch
 * that does not exist — the index covers every ref under `refs/`, so absence there IS non-existence.
 *
 * @param index the repository's index from {@link repoAheadIndex}
 * @param candidates exact branch names from {@link branchCandidates}
 * @returns the highest count any candidate carries, and 0 when none resolve
 */
export function aheadFromIndex({
  index,
  candidates,
}: {
  index: RepoAheadIndex;
  candidates: readonly string[];
}): number {
  const trunk = index.trunk;
  if (trunk === undefined) {
    return 0;
  }
  const byRef = index.byRef;
  if (byRef === undefined) {
    return Math.max(0, ...candidates.map((branch) => countAhead({ base: trunk, branch, repo: index.repo })));
  }
  const counts = candidates.map((name) => {
    for (const ref of refLookupOrder({ name })) {
      const ahead = byRef.get(ref);
      if (ahead !== undefined) {
        return ahead;
      }
    }
    return 0;
  });
  return Math.max(0, ...counts);
}

/**
 * Parse `for-each-ref`'s ahead/behind pairs into a lookup, or `undefined` when git would not answer.
 *
 * A ref name cannot contain a space, so splitting on the first one is exact rather than a heuristic. A ref
 * whose count git could not compute prints an empty field and is simply left out of the map, which the
 * caller reads as 0 — the same answer its `rev-list` would have produced.
 */
function readAheadByRef({
  repo,
  trunk,
  patterns,
}: {
  repo: string;
  trunk: string;
  patterns?: readonly string[];
}): ReadonlyMap<string, number> | undefined {
  const format = `--format=%(refname) %(ahead-behind:${trunk})`;
  let out: string;
  try {
    // The patterns go through stdin: a board's worth of them is far past what an argv may carry.
    if (patterns === undefined) {
      out = execFileSync("git", ["-C", repo, "for-each-ref", format, "refs"], {
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: GIT_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      });
    } else {
      out = execFileSync("git", ["-C", repo, "for-each-ref", "--stdin", format], {
        encoding: "utf8",
        env: gitEnv(),
        input: `${patterns.join("\n")}\n`,
        maxBuffer: GIT_MAX_BUFFER,
        stdio: ["pipe", "pipe", "ignore"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      });
    }
  } catch {
    // Git older than 2.41 rejects the atom outright, and a repository with more refs than the buffer holds
    // overflows it. Both mean "no index", never "no commits" — the caller falls back to asking per candidate.
    return undefined;
  }
  const byRef = new Map<string, number>();
  for (const line of out.split("\n")) {
    const space = line.indexOf(" ");
    if (space <= 0) {
      continue;
    }
    const parsed = Number.parseInt(line.slice(space + 1), 10);
    if (Number.isFinite(parsed)) {
      byRef.set(line.slice(0, space), parsed);
    }
  }
  return byRef;
}

/**
 * How many commits the repository's checkout is behind its own upstream.
 *
 * Every probe here reads the WORKING TREE, so a merged PR does not flip a probe until someone pulls. Measured:
 * an atlas PR merged, all four of its probes passed against `origin/<branch>`, and the board still reported
 * "nothing it promised is observable yet" — because that checkout was 68 commits behind. The board was
 * describing a tree from days earlier and saying nothing about it, which reads as "the work is not done".
 *
 * So this is reported alongside the verdicts. Zero for a repo with no upstream, which is silent rather than
 * alarming — plenty of checkouts legitimately have none.
 *
 * @param repo the repository to ask
 * @returns commits on the upstream that the checkout does not have, or 0 when that cannot be determined
 */
export function commitsBehindUpstream({ repo }: { repo: string }): number {
  try {
    const out = execFileSync("git", ["-C", repo, "rev-list", "--count", "HEAD..@{u}"], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
    const parsed = Number.parseInt(out, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** This repository's trunk, or `undefined` when it could not be resolved — the caller answers 0 for that. */
function trunkOr({ repo }: { repo: string }): string | undefined {
  const resolved = resolveTrunk({ worktree: repo });
  return resolved.known ? resolved.value : undefined;
}

function countAhead({ repo, base, branch }: { repo: string; base: string; branch: string }): number {
  try {
    const out = execFileSync("git", ["-C", repo, "rev-list", "--count", `${base}..${branch}`], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
    const parsed = Number.parseInt(out, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}
