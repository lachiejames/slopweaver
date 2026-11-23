/**
 * The `seat` lane of `dev lint`: what a working seat runs before it hands work back, judged against the base it
 * resolved itself rather than one somebody had to remember to export.
 *
 * It exists because the diff gates compare a branch against its base, and a seat that ran them by hand with no
 * base compared nothing — `host-wording` once read clean in a seat and red on the lap for the same branch. So the lane
 * owns the base: it computes `git merge-base HEAD origin/main`, refuses when `origin/main` was fetched too long
 * ago to trust, prints both, and hands the SHA to every gate it spawns through that gate's own `env`.
 *
 * **A projection over the one registry, never a second list.** `lintChecks` stays the registry every proof reads;
 * {@link isSeatCheck} filters it and {@link projectSeatChecks} rewrites the one row whose seat form differs —
 * `oxlint`, narrowed from the whole tree to the files this branch changed. What the lane leaves out it NAMES on
 * every run ({@link seatUncovered}), because a green from a narrower bar reads as the whole bar otherwise.
 *
 * Pure decisions here, one effectful edge ({@link prepareSeatLint}); `devLint.ts` plans and prints.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { WHOLE_TREE_GATES } from "../admit/devLintInvocation.js";
import { err, ok, type Result } from "../lib/result.js";
import { type LintCheck } from "./devLint.js";
import { FLOOR_BASE_ENV, gitLines, gitNulFields } from "./gitAtCommit.js";

/**
 * How long ago `origin/main` may have been fetched before the seat lane refuses to trust its merge-base.
 *
 * A REFUSAL, not a warning: a warned run still prints PASS against what may be the wrong commit, which is the
 * hazard this lane exists to close. Fifteen minutes because main moves about hourly: MEASURED over one busy day,
 * its 17 commits landed 44 to 112 minutes apart (reproduce over any day with
 * `git log --since=<day> --until=<next day> --format=%cI refs/remotes/origin/main`),
 * so a fetch inside this bound is usually main's tip and at worst one landing behind — which CI's merge commit
 * then catches. The lane never fetches for you: a lint verb mutating refs behind a seat's back is a surprise.
 *
 * @internal — this module and its tests.
 */
export const SEAT_FETCH_MAX_AGE_MS = 15 * 60_000;

/**
 * The file types `oxlint` lints, so a changed-file run hands it nothing it would drop or choke on. From
 * Oxlint's own list (https://oxc.rs/docs/guide/usage/linter.html#what-oxlint-supports); re-check it on an
 * upgrade.
 */
const OXLINT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".astro",
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
]);

/** What the seat lane resolved before planning: the base, how fresh it is, and the files oxlint is narrowed to. */
export interface SeatLintContext {
  readonly baseSha: string;
  readonly changedOxlintFiles: readonly string[];
  readonly fetch: { readonly ageMs: number; readonly source: "FETCH_HEAD" | "origin/main reflog" };
}

/** No merge-base of HEAD and origin/main could be read; `detail` says which read failed, for a caller's own wording. */
export interface SeatBaseUnreadableError {
  readonly code: "BASE_UNREADABLE";
  readonly detail: string;
  readonly message: string;
}

/** Why the seat lane could not be prepared — each a state it could not get past, never a verdict on code. */
export type SeatPreparationError =
  | SeatBaseUnreadableError
  | { readonly code: "DIFF_UNREADABLE"; readonly message: string }
  | { readonly code: "FETCH_AGE_UNREADABLE"; readonly message: string }
  | { readonly code: "FETCH_STALE"; readonly message: string; readonly ageMs: number };

const FETCH_FIX = "run `git fetch origin main`, then re-run `slopweaver dev lint --lane seat`";

/**
 * Factories for {@link SeatPreparationError}, so a caller never hand-builds one.
 *
 * @internal — {@link prepareSeatLint} and this module's tests.
 */
export const SeatPreparationErrors = {
  baseUnreadable: ({ detail }: { detail: string }): SeatBaseUnreadableError => ({
    code: "BASE_UNREADABLE",
    detail,
    message: `dev lint --lane seat: cannot resolve the merge-base of HEAD and origin/main (${detail}) — ${FETCH_FIX}`,
  }),
  diffUnreadable: ({ command }: { command: string }): SeatPreparationError => ({
    code: "DIFF_UNREADABLE",
    message: `dev lint --lane seat: cannot list the changed files (\`git ${command}\` failed), so oxlint has no scope`,
  }),
  fetchAgeUnreadable: ({ originMain }: { originMain: string }): SeatPreparationError => ({
    code: "FETCH_AGE_UNREADABLE",
    message:
      `dev lint --lane seat: cannot tell when origin/main was last fetched — no FETCH_HEAD names its ${originMain} ` +
      `and no reflog entry records a fetch to it — ${FETCH_FIX}`,
  }),
  fetchStale: ({ ageMs }: { ageMs: number }): SeatPreparationError => ({
    ageMs,
    code: "FETCH_STALE",
    message:
      `dev lint --lane seat: origin/main was last fetched ${ageLabel({ ms: ageMs })} ago, past the ` +
      `${ageLabel({ ms: SEAT_FETCH_MAX_AGE_MS })} bound, so its merge-base may not be main's tip — ${FETCH_FIX}`,
  }),
} as const;

/**
 * A duration as a person reads it: seconds under a minute, whole minutes under two hours, else hours.
 *
 * @param ms the duration in milliseconds
 * @returns the label, such as `40s`, `12 min` or `3 h`
 * @internal — this module and its tests.
 */
export function ageLabel({ ms }: { ms: number }): string {
  if (ms < 60_000) {
    return `${String(Math.round(ms / 1000))}s`;
  }
  if (ms < 2 * 60 * 60_000) {
    return `${String(Math.floor(ms / 60_000))} min`;
  }
  return `${String(Math.floor(ms / (60 * 60_000)))} h`;
}

/**
 * Judge a fetch time against the bound. A fetch time in the future (a skewed clock) reads as age zero.
 *
 * @param fetchedAtMs when origin/main was last fetched, epoch milliseconds
 * @param nowMs the instant of this run, epoch milliseconds
 * @param maxAgeMs the oldest fetch the lane trusts
 * @returns the fetch's age, or `FETCH_STALE` past the bound
 * @internal — {@link prepareSeatLint} and this module's tests.
 */
export function seatFetchVerdict({
  fetchedAtMs,
  nowMs,
  maxAgeMs,
}: {
  fetchedAtMs: number;
  nowMs: number;
  maxAgeMs: number;
}): Result<{ readonly ageMs: number }, SeatPreparationError> {
  const ageMs = Math.max(0, nowMs - fetchedAtMs);
  if (ageMs > maxAgeMs) {
    return err(SeatPreparationErrors.fetchStale({ ageMs }));
  }
  return ok({ ageMs });
}

/**
 * Whether a FETCH_HEAD's text records `main` fetched at the commit `origin/main` now names.
 *
 * Its mtime alone is not enough: any fetch rewrites it, so a fetch of another ref would make a stale
 * `origin/main` look fresh. A line naming branch `main` at origin/main's own SHA ties the time to that ref. The
 * remote URL is not matched — git writes it in a display form (`github.com:owner/repo`, no scheme, no `.git`)
 * that differs from `remote.origin.url` — so another remote's `main` at the very same commit also counts.
 *
 * @param text the FETCH_HEAD file's contents
 * @param originMain the full SHA `refs/remotes/origin/main` resolves to
 * @returns whether a line records that fetch
 * @internal — {@link prepareSeatLint} and this module's tests.
 */
export function fetchHeadNamesOriginMain({ text, originMain }: { text: string; originMain: string }): boolean {
  return text.split("\n").some((line) => {
    const [sha, , description] = line.split("\t");
    return sha === originMain && description?.startsWith("branch 'main' of ") === true;
  });
}

/**
 * When origin/main's reflog last recorded a FETCH moving it to the commit it names now, in epoch milliseconds.
 *
 * The file's mtime is not that: `git update-ref refs/remotes/origin/main <sha>` by hand rewrites the reflog with
 * no fetch, which would make a stale `origin/main` look fresh — an adversarial review's counterexample. So only the LAST entry
 * is read, and it counts only when its new SHA is origin/main's and its message is one a fetch writes — `fetch…`,
 * or `pull…`, whose fetch carries pull's reflog action. Its time is the entry's own, not the file's. A fetch
 * that found main unchanged writes no entry; FETCH_HEAD is the witness for that one.
 *
 * @param text the reflog file's contents, oldest entry first
 * @param originMain the full SHA `refs/remotes/origin/main` resolves to
 * @returns the entry's instant, or `undefined` when the last entry is not that fetch
 * @internal — {@link prepareSeatLint} and this module's tests.
 */
export function reflogFetchAtMs({ text, originMain }: { text: string; originMain: string }): number | undefined {
  const last = text.split("\n").findLast((line) => line.length > 0);
  if (last === undefined) {
    return undefined;
  }
  const entry = /^[0-9a-f]{40} ([0-9a-f]{40}) .*> (\d+) [+-]\d{4}\t(.*)$/.exec(last);
  if (entry === null || entry[1] !== originMain || !/^(fetch|pull)\b/.test(entry[3]!)) {
    return undefined;
  }
  return Number(entry[2]) * 1000;
}

/**
 * The files oxlint is narrowed to: every path this branch committed, changed in the working tree or added
 * untracked, that still exists and is a type oxlint lints — deduplicated, in path order.
 *
 * @param committed paths changed between the base and HEAD
 * @param working tracked paths changed since HEAD, staged or not
 * @param untracked new files git does not ignore
 * @param existing which of those paths exist on disk now — a deleted file has nothing left to lint
 * @returns the eligible repo-relative paths
 * @internal — {@link prepareSeatLint} and this module's tests.
 */
export function oxlintChangedFiles({
  committed,
  working,
  untracked,
  existing,
}: {
  committed: readonly string[];
  working: readonly string[];
  untracked: readonly string[];
  existing: ReadonlySet<string>;
}): readonly string[] {
  const all = new Set([...committed, ...working, ...untracked]);
  return [...all].filter((path) => existing.has(path) && OXLINT_EXTENSIONS.has(extname(path))).toSorted();
}

/**
 * Whether a registry row runs in the seat lane: everything but the whole-project gates. `oxlint` is kept, to be
 * narrowed by {@link projectSeatChecks}; every other `exclusive` gate, each whole-tree CI gate the seat guard
 * already names (`WHOLE_TREE_GATES`: `prettier --check .` and `knip`, their cost measured there — and the
 * `pre-commit` hook formats every staged file anyway) are out, and {@link seatUncovered} names each.
 *
 * @param check one registry row
 * @returns whether the seat lane plans it
 */
export function isSeatCheck({ check }: { check: LintCheck }): boolean {
  if (check.name === "oxlint") {
    return true;
  }
  return check.exclusive !== true && !WHOLE_TREE_GATES.has(check.name);
}

/**
 * The seat lane's checks as they will be spawned: `oxlint` narrowed to the changed files (dropped when there are
 * none, since a bare `oxlint` lints the whole tree), run last and alone rather than first, and every check
 * handed the base.
 *
 * @param checks the seat lane's selection, in plan order
 * @param seat what the lane resolved
 * @returns the checks to spawn, in plan order
 */
export function projectSeatChecks({
  checks,
  seat,
}: {
  checks: readonly LintCheck[];
  seat: SeatLintContext;
}): readonly LintCheck[] {
  const projected: LintCheck[] = [];
  for (const check of checks) {
    const env = { ...check.env, [FLOOR_BASE_ENV]: seat.baseSha };
    if (check.name !== "oxlint") {
      projected.push({ ...check, env });
      continue;
    }
    if (seat.changedOxlintFiles.length === 0) {
      continue;
    }
    // Rebuilt rather than spread, so `exclusive` cannot ride along and `runsLast` replaces it: a narrowed run
    // still peaks past the bespoke-gate slot (its row in `gateGroups.ts` carries the measurement), so it runs
    // alone, and last, where the lane can withhold it if a lap took the machine meanwhile.
    const args = [
      ...check.args.filter((arg) => arg !== "."),
      "--no-error-on-unmatched-pattern",
      "--",
      ...seat.changedOxlintFiles,
    ];
    projected.push({ args, cmd: check.cmd, env, name: check.name, runsLast: true });
  }
  return projected;
}

/**
 * The live lap holding this machine, as the `dev lint` command read it (`github lap-seat show`'s read of
 * `laps/lock.json`). Handed in as DATA: the reader lives in the command layer, which this tree may not import.
 */
export interface SeatLapHolder {
  readonly pid: number;
  readonly phase: string;
  readonly subject: string;
}

/**
 * Why the seat lane withholds its changed-file oxlint right now, or `undefined` when it may run. A lap's own
 * whole-tree oxlint peaks near 5.7 GB, and the narrowed one past the 3,072 MiB slot, so the two together are
 * the out-of-memory a seat lane must never cause; every other seat gate still runs.
 *
 * @param holder the live lap holding this machine, read just before oxlint would spawn
 * @returns the reason, naming the lap, or `undefined` when no lap holds the machine
 */
export function seatOxlintWithheld({ holder }: { holder: SeatLapHolder | undefined }): string | undefined {
  if (holder === undefined) {
    return undefined;
  }
  return (
    `a lap holds this machine (pid ${String(holder.pid)}, ${holder.phase}, ${holder.subject}), and its own oxlint ` +
    "beside this one would exhaust memory — re-run `slopweaver dev lint --lane seat --only oxlint` once the lap ends"
  );
}

/**
 * What the seat lane does not cover, by name, derived from the registry so a new whole-project gate is named
 * without anyone editing this: every `exclusive` gate but oxlint and each whole-tree CI gate, then the two things
 * no lint gate is — whole-tree oxlint and the typecheck.
 *
 * @param checks the whole registry
 * @returns the names a seat verdict prints
 */
export function seatUncovered({ checks }: { checks: readonly LintCheck[] }): readonly string[] {
  const names = checks.filter((check) => !isSeatCheck({ check })).map((check) => check.name);
  return [...names, "whole-tree oxlint", "typecheck"];
}

/**
 * The lines the seat lane prints before it spawns anything: the base it will judge against, how fresh that is,
 * and how many files oxlint is narrowed to.
 *
 * @param seat what the lane resolved
 * @returns the lines, without trailing newlines
 */
export function seatContextLines({ seat }: { seat: SeatLintContext }): readonly string[] {
  const count = seat.changedOxlintFiles.length;
  return [
    `dev lint --lane seat: base ${seat.baseSha} (merge-base of HEAD and origin/main)`,
    `dev lint --lane seat: origin/main last fetched ${ageLabel({ ms: seat.fetch.ageMs })} ago (${seat.fetch.source})`,
    `changed-file oxlint: ${String(count)} eligible file(s)${count === 0 ? " — not run" : ""}`,
  ];
}

/**
 * One git read that must answer exactly one full SHA.
 *
 * @param cwd the checkout
 * @param args the git arguments
 * @returns the lowercased SHA, or `undefined` when git failed or answered anything else
 */
function oneSha({ cwd, args }: { cwd: string; args: readonly string[] }): string | undefined {
  const lines = gitLines({ args, root: cwd });
  if (lines?.length !== 1 || !/^[0-9a-fA-F]{40}$/.test(lines[0]!)) {
    return undefined;
  }
  return lines[0]!.toLowerCase();
}

/**
 * The newest fetch of origin/main this checkout can prove: a FETCH_HEAD — this worktree's or the shared one —
 * that names origin/main's commit, or origin/main's last reflog entry when a fetch wrote it ({@link reflogFetchAtMs}).
 *
 * @param cwd the checkout
 * @param originMain the SHA origin/main resolves to
 * @returns when and from what, or `undefined` when nothing proves a fetch
 */
function lastFetch({
  cwd,
  originMain,
}: {
  cwd: string;
  originMain: string;
}): { readonly atMs: number; readonly source: SeatLintContext["fetch"]["source"] } | undefined {
  const paths = gitLines({
    args: ["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD", "--git-common-dir"],
    root: cwd,
  });
  if (paths?.length !== 2) {
    return undefined;
  }
  const [worktreeFetchHead, commonDir] = paths;
  if (worktreeFetchHead === undefined || commonDir === undefined) {
    return undefined;
  }
  const candidates: { atMs: number; source: SeatLintContext["fetch"]["source"] }[] = [];
  for (const path of new Set([worktreeFetchHead, join(commonDir, "FETCH_HEAD")])) {
    if (existsSync(path) && fetchHeadNamesOriginMain({ originMain, text: readFileSync(path, "utf8") })) {
      candidates.push({ atMs: statSync(path).mtimeMs, source: "FETCH_HEAD" });
    }
  }
  const reflog = join(commonDir, "logs", "refs", "remotes", "origin", "main");
  const reflogAtMs = existsSync(reflog)
    ? reflogFetchAtMs({ originMain, text: readFileSync(reflog, "utf8") })
    : undefined;
  if (reflogAtMs !== undefined) {
    candidates.push({ atMs: reflogAtMs, source: "origin/main reflog" });
  }
  return candidates.toSorted((a, b) => b.atMs - a.atMs)[0];
}

/**
 * The full merge-base of HEAD and `origin/main`, and the commit `origin/main` names — the base the seat lane
 * hands every gate, and the one `dev profile` hands a profiled gate so it measures the real comparison rather
 * than the no-base refusal.
 *
 * @param cwd the checkout
 * @returns both full SHAs, or the base this checkout cannot resolve
 */
export function resolveSeatBase({
  cwd,
}: {
  cwd: string;
}): Result<{ readonly baseSha: string; readonly originMain: string }, SeatBaseUnreadableError> {
  const originMain = oneSha({ args: ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], cwd });
  if (originMain === undefined) {
    return err(SeatPreparationErrors.baseUnreadable({ detail: "refs/remotes/origin/main does not resolve" }));
  }
  const baseSha = oneSha({ args: ["merge-base", "HEAD", "refs/remotes/origin/main"], cwd });
  if (baseSha === undefined) {
    return err(SeatPreparationErrors.baseUnreadable({ detail: "`git merge-base HEAD origin/main` found none" }));
  }
  return ok({ baseSha, originMain });
}

/**
 * The effectful edge: resolve the base, prove origin/main is fresh, and list the changed files.
 *
 * @param cwd the checkout the lane runs in
 * @param nowMs the instant of this run, epoch milliseconds
 * @returns what the lane plans with, or the state it could not get past
 */
export function prepareSeatLint({
  cwd,
  nowMs,
}: {
  cwd: string;
  nowMs: number;
}): Result<SeatLintContext, SeatPreparationError> {
  const base = resolveSeatBase({ cwd });
  if (base.isErr()) {
    return err(base.error);
  }
  const { baseSha, originMain } = base.value;
  const fetched = lastFetch({ cwd, originMain });
  if (fetched === undefined) {
    return err(SeatPreparationErrors.fetchAgeUnreadable({ originMain }));
  }
  const verdict = seatFetchVerdict({ fetchedAtMs: fetched.atMs, maxAgeMs: SEAT_FETCH_MAX_AGE_MS, nowMs });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  const reads = {
    committed: ["diff", "--name-only", "-z", `${baseSha}...HEAD`],
    untracked: ["ls-files", "--others", "--exclude-standard", "-z"],
    working: ["diff", "--name-only", "-z", "HEAD"],
  } as const;
  const lists: Record<keyof typeof reads, readonly string[]> = { committed: [], untracked: [], working: [] };
  for (const key of ["committed", "working", "untracked"] as const) {
    const fields = gitNulFields({ args: reads[key], root: cwd });
    if (fields === undefined) {
      return err(SeatPreparationErrors.diffUnreadable({ command: reads[key].join(" ") }));
    }
    lists[key] = fields;
  }
  const { committed, working, untracked } = lists;
  const existing = new Set([...committed, ...working, ...untracked].filter((path) => existsSync(join(cwd, path))));
  return ok({
    baseSha,
    changedOxlintFiles: oxlintChangedFiles({ committed, existing, untracked, working }),
    fetch: { ageMs: verdict.value.ageMs, source: fetched.source },
  });
}
