/**
 * The merge guard's board sweep — evaluates every orchestration doc's `doneWhen:` probes twice, once against
 * the base branch as it stands today and once against the head branch (the tree a squash-merge would make
 * the base BECOME, per the `../mergeGuard.js` module header), and reports any probe that regresses.
 *
 * ## Reusing the board's own evaluator, deliberately
 *
 * This does NOT write a second probe evaluator. It reuses `parseHandoverDoc` (via `scanBoard`) and
 * `evaluateProbes` verbatim; the only new thing here is a {@link ProbeSeams} that answers
 * present/absent/path-exists by reading a file AS OF A GIT REF (`git show <ref>:<path>` /
 * `git cat-file -e <ref>:<path>`) instead of off the live working tree the way
 * `../../handover/evaluate.js`'s `repoProbeSeams` does. That is what lets both states be measured without
 * checking anything out: `base` and `head` are read as they are IN THE REPOSITORY'S HISTORY, so nothing here
 * mutates the caller's working directory.
 *
 * `command:` probes are always declined here (`runCommand: undefined`), for the same reason `handover list`
 * declines them by default: there is no working tree at an arbitrary ref to run a command against, and a doc
 * naming one is simply not evaluable for either state — which surfaces as `not-evaluated` for that probe,
 * never as a silent pass.
 *
 * ## Never a pass over a board it could not see
 *
 * Measured incident (see `../mergeGuard.js`): the doc whose probe would have caught the squashed deletion said `status: done`
 * throughout, so a done-only reader would have skipped exactly the doc that mattered. Every doc with
 * `doneWhen:` probes is swept here regardless of its declared status.
 *
 * A missing `$SLOPWEAVER_HOME/handovers` directory, an unreadable doc, or a `base`/`head` ref this
 * repository cannot resolve are all reported as {@link MergeProbeSweep} `not-evaluated` — NEVER as zero
 * regressions. "Nothing was examined" and "nothing regressed" are different claims, and collapsing them is
 * the exact failure class `../../handover/probe.js`'s own header names.
 *
 * ## Which docs are in scope
 *
 * Only docs whose declared `repo:` resolves to the SAME path as the repository being merged — exact-match,
 * never fuzzy — because `base`/`head` are refs inside THAT repository; a doc about a different repository has
 * no meaningful "base" or "head" here, and a merge in this repository cannot regress a probe about another
 * one. A doc naming no `repo:` cannot be matched to anything and is skipped, exactly as
 * `../../handover/evaluate.js`'s callers already treat a repo-less doc.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { stripGitEnv } from "../../codex/gitRun.js";
import type { HandoverDoc } from "../../handover/doc.js";
import { insideRepo } from "../../handover/evaluate.js";
import {
  evaluateProbes,
  type Probe,
  type ProbeResult,
  type ProbeSeams,
  textContainsSymbol,
} from "../../handover/probe.js";
import { scanBoard } from "../../handover/store.js";
import { isRecord } from "../../lib/parsers.js";
import { GitReadStoppedError, throwIfStopped } from "./gitReadStopped.js";
import type { ProbeRegression } from "./mergeGuard.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Render a probe back to the `kind: value` text a finding should quote — the inverse of the parser in
 * `../../handover/probe.js`.
 *
 * @param probe the parsed probe to render
 * @returns the probe as it appears in a doc's `doneWhen:` list
 */
export function probeText({ probe }: { probe: Probe }): string {
  switch (probe.kind) {
    case "present":
      return `present: ${probe.file}#${probe.symbol}`;
    case "absent":
      return `absent: ${probe.file}#${probe.symbol}`;
    case "path":
      return `path: ${probe.path}`;
    case "command":
      return `command: ${probe.command}`;
  }
}

/**
 * A path's canonical form for repository identity comparisons: symlinks resolved, falling back to a lexical
 * resolve when the path cannot be realpath'd (e.g. it does not exist).
 *
 * Real, measured gap without this: `os.tmpdir()` on macOS returns `/var/folders/...`, a symlink to
 * `/private/var/folders/...`, and `git rev-parse --show-toplevel` answers with the REALPATH. A doc's `repo:`
 * written against the unresolved form and `repoRoot` resolved through git therefore compared unequal for the
 * identical repository, silently excluding every doc from the sweep. `src/__tests__/tempGitRepo.ts` already
 * carries this exact fix for the same reason.
 */
function canonical({ path }: { path: string }): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/** Whether a doc's declared `repo:` is the exact repository being merged. No fuzzy matching. */
function docTargetsRepo({ doc, repoRoot }: { doc: HandoverDoc; repoRoot: string }): boolean {
  return doc.repo !== undefined && canonical({ path: doc.repo }) === canonical({ path: repoRoot });
}

/** One doc's regressions: probes that passed against `before` and fail against `after`, positionally paired. */
function regressionsForDoc({
  doc,
  before,
  after,
}: {
  doc: HandoverDoc;
  before: readonly ProbeResult[];
  after: readonly ProbeResult[];
}): readonly ProbeRegression[] {
  const regressions: ProbeRegression[] = [];
  doc.doneWhen.forEach((probe, index) => {
    if (before[index]?.outcome === "pass" && after[index]?.outcome === "fail") {
      regressions.push({ probe: probeText({ probe }), slug: doc.slug });
    }
  });
  return regressions;
}

/**
 * The tree a real merge of `headRef` into `baseRef` would produce, or a report that it does not merge cleanly.
 *
 * `git merge-tree --write-tree` performs the actual three-way merge and returns the resulting TREE object,
 * without touching the working tree, the index, or any ref — and `git show`/`git cat-file -e` accept that tree
 * hash exactly like a commit ref, which is what lets {@link refProbeSeams} stay unmodified below. This is what
 * makes "after" mean the tree a squash-merge would actually leave behind, rather than head's own raw pre-rebase
 * tip: a path base gained after head forked, and head's diff never touches, survives in this tree exactly as it
 * does in a real merge — which is the false regression this module used to raise.
 *
 * Not exported: `../../outbound/github/docsBudgetSweep.js` calls {@link computeMergeTree} to compute the
 * identical merged tree for its own re-measurement rather than shelling `git merge-tree` a second,
 * independently-written way, but it never names this type — the return value's shape is inferred.
 */
type MergeTreeResult =
  { readonly kind: "tree"; readonly sha: string } | { readonly kind: "conflict" } | { readonly kind: "timed-out" };

/**
 * Why a merged tree could not be had, as the opening clause of a `not-evaluated` reason: a conflict, or a
 * `git merge-tree` stopped at its bound — which is NOT a conflict, and reading it as one sends a reader to
 * resolve a merge that is clean.
 *
 * @param merged the non-tree result
 * @returns the clause naming which it was
 */
export function mergeTreeUnavailable({
  merged,
  baseRef,
  headRef,
}: {
  merged: { readonly kind: "conflict" } | { readonly kind: "timed-out" };
  baseRef: string;
  headRef: string;
}): string {
  if (merged.kind === "timed-out") {
    const minutes = String(GIT_READ_TIMEOUT_MS / 60_000);
    return `git merge-tree of "${baseRef}" and "${headRef}" was still running after ${minutes} minutes, so it was stopped`;
  }
  return `"${baseRef}" and "${headRef}" do not merge cleanly`;
}

/**
 * Compute {@link MergeTreeResult} for `baseRef`/`headRef` in `repo`.
 *
 * @param repo the repository to read
 * @param baseRef the branch being merged into
 * @param headRef the branch being merged from
 * @returns the merged tree's hash, a conflict report, or that the merge was stopped at its bound
 */
export function computeMergeTree({
  repo,
  baseRef,
  headRef,
}: {
  repo: string;
  baseRef: string;
  headRef: string;
}): MergeTreeResult {
  try {
    const sha = execFileSync("git", ["merge-tree", "--write-tree", baseRef, headRef], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
    return { kind: "tree", sha };
  } catch (error: unknown) {
    // Node reports a child killed at its bound as `code: "ETIMEDOUT"`; every other failure is git's conflict exit.
    return isRecord(error) && error["code"] === "ETIMEDOUT" ? { kind: "timed-out" } : { kind: "conflict" };
  }
}

/**
 * Whether a ref resolves to a real commit in this repository — the guard against a bad `base`/`head`.
 *
 * Exported for the same reason as {@link computeMergeTree}: `docsBudgetSweep.js` needs the identical check
 * before it trusts either ref.
 *
 * @param repo the repository to read
 * @param ref the ref to check
 * @returns whether `ref` resolves to a real commit
 */
export function refResolves({ repo, ref }: { repo: string; ref: string }): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repo,
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "ignore", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return true;
  } catch (error: unknown) {
    throwIfStopped({ command: `rev-parse --verify ${ref}^{commit}`, error, timeoutMs: GIT_READ_TIMEOUT_MS });
    return false;
  }
}

/**
 * What reading a file as of a git ref found: its content, a definite absence, or an unreadable outcome.
 *
 * Not exported: `docsBudgetSweep.js` calls {@link gitShowAt} for the exact same tri-state read, but never
 * names this type — the return value's shape is inferred.
 */
type GitShowResult =
  { readonly kind: "content"; readonly text: string } | { readonly kind: "absent" } | { readonly kind: "unknown" };

/**
 * `git show <ref>:<path>`, distinguishing "the path did not exist at that ref" (knowledge — the file is
 * definitively not there) from any other failure (ignorance — nothing here can say either way), exactly the
 * distinction `../../handover/evaluate.js`'s `repoProbeSeams` draws for `ENOENT` on the live filesystem.
 *
 * @param repo the repository to read
 * @param ref the git ref (or tree-ish) to read `path` from
 * @param path the repo-relative path to read
 * @returns the file's content, its definite absence at that ref, or an unreadable outcome
 */
export function gitShowAt({ repo, ref, path }: { repo: string; ref: string; path: string }): GitShowResult {
  try {
    const text = execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return { kind: "content", text };
  } catch (error: unknown) {
    throwIfStopped({ command: `show ${ref}:${path}`, error, timeoutMs: GIT_READ_TIMEOUT_MS });
    const stderr = isRecord(error) ? error["stderr"] : undefined;
    let message: string;
    if (typeof stderr === "string") {
      message = stderr;
    } else if (Buffer.isBuffer(stderr)) {
      message = stderr.toString("utf8");
    } else {
      message = "";
    }
    const isAbsent = message.includes("does not exist in") || message.includes("exists on disk, but not in");
    if (isAbsent) {
      return { kind: "absent" };
    } else {
      return { kind: "unknown" };
    }
  }
}

/** `git cat-file -e <ref>:<path>` — exists (exit 0) or not; `path:` probes carry no tri-state in the original either. */
function pathExistsAtRef({ repo, ref, path }: { repo: string; ref: string; path: string }): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${path}`], {
      cwd: repo,
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "ignore", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return true;
  } catch (error: unknown) {
    throwIfStopped({ command: `cat-file -e ${ref}:${path}`, error, timeoutMs: GIT_READ_TIMEOUT_MS });
    return false;
  }
}

/**
 * {@link ProbeSeams} over one repository AS OF ONE REF, so `evaluateProbes` can be reused unmodified against a
 * historical tree.
 *
 * @param repo the repository the doc's paths resolve against
 * @param ref the git ref this seam reads (a branch, a remote-tracking ref, or any resolvable commit-ish)
 * @returns the seams `../../handover/probe.js`'s evaluator needs
 */
function refProbeSeams({ repo, ref }: { repo: string; ref: string }): ProbeSeams {
  return {
    fileContains: ({ file, symbol }) => {
      if (insideRepo({ repo, target: file }) === undefined) {
        return undefined;
      }
      const shown = gitShowAt({ path: file, ref, repo });
      if (shown.kind === "content") {
        return textContainsSymbol({ file, symbol, text: shown.text });
      }
      return shown.kind === "absent" ? false : undefined;
    },
    pathExists: ({ path }) =>
      insideRepo({ repo, target: path }) === undefined ? false : pathExistsAtRef({ path, ref, repo }),
    runCommand: undefined,
  };
}

/** What sweeping the board concluded: real regressions, or a reason nothing could be examined. */
export type MergeProbeSweep =
  | { readonly kind: "evaluated"; readonly regressions: readonly ProbeRegression[]; readonly docsChecked: number }
  | { readonly kind: "not-evaluated"; readonly reason: string };

/**
 * The board scan, made unevaluable when the board is absent, unreadable, or partially unreadable.
 *
 * A discriminated union rather than `readonly HandoverDoc[] | { reason }` — narrowing a UNION containing a
 * readonly array with `Array.isArray` is not reliable across TypeScript's negated-branch inference, so the
 * kind tag is explicit instead of inferred from the shape.
 */
type ApplicableDocs =
  | { readonly kind: "docs"; readonly docs: readonly HandoverDoc[] }
  | { readonly kind: "blind"; readonly reason: string };

/** The board scan, made unevaluable when either candidate ref cannot be resolved. */
function applicableDocs({ handoversDir, repoRoot }: { handoversDir: string; repoRoot: string }): ApplicableDocs {
  if (!existsSync(handoversDir)) {
    return { kind: "blind", reason: `no orchestration board at ${handoversDir} — probes were not checked` };
  }
  const scanned = scanBoard({ handoverDir: handoversDir });
  if (scanned.isErr()) {
    return {
      kind: "blind",
      reason: `could not read ${handoversDir}: ${scanned.error.message} — probes were not checked`,
    };
  }
  const { docs, unreadable } = scanned.value;
  if (unreadable.length > 0) {
    return {
      kind: "blind",
      reason: `${String(unreadable.length)} handover doc(s) could not be read (${unreadable.join(", ")}) — probes were not checked`,
    };
  }
  return { docs: docs.filter((doc) => doc.doneWhen.length > 0 && docTargetsRepo({ doc, repoRoot })), kind: "docs" };
}

/**
 * Evaluate every applicable handover doc's probes against `base` and `head`, and report any that regress.
 *
 * @param handoversDir the directory holding the orchestration docs (`$SLOPWEAVER_HOME/handovers`)
 * @param repoRoot the repository being merged — only docs declaring this exact `repo:` are in scope
 * @param baseRef the branch being merged into, as a ref this repository can resolve
 * @param headRef the branch being merged from, as a ref this repository can resolve
 * @returns the regressions found, or a reason nothing could be examined
 */
export function sweepMergeProbeRegressions({
  handoversDir,
  repoRoot,
  baseRef,
  headRef,
}: {
  handoversDir: string;
  repoRoot: string;
  baseRef: string;
  headRef: string;
}): MergeProbeSweep {
  try {
    return sweepProbes({ baseRef, handoversDir, headRef, repoRoot });
  } catch (error: unknown) {
    if (error instanceof GitReadStoppedError) {
      return { kind: "not-evaluated", reason: `${error.message} — probes were not checked` };
    }
    throw error;
  }
}

/** {@link sweepMergeProbeRegressions}'s body; a git read stopped at its bound throws out of it. */
function sweepProbes({
  handoversDir,
  repoRoot,
  baseRef,
  headRef,
}: {
  handoversDir: string;
  repoRoot: string;
  baseRef: string;
  headRef: string;
}): MergeProbeSweep {
  const applicable = applicableDocs({ handoversDir, repoRoot });
  if (applicable.kind === "blind") {
    return { kind: "not-evaluated", reason: applicable.reason };
  }
  if (!refResolves({ ref: baseRef, repo: repoRoot }) || !refResolves({ ref: headRef, repo: repoRoot })) {
    return {
      kind: "not-evaluated",
      reason: `could not resolve "${baseRef}" and/or "${headRef}" as git refs in ${repoRoot} — probes were not checked`,
    };
  }
  const merged = computeMergeTree({ baseRef, headRef, repo: repoRoot });
  if (merged.kind !== "tree") {
    const why = mergeTreeUnavailable({ baseRef, headRef, merged });
    return { kind: "not-evaluated", reason: `${why} — probes were not checked against a simulated result` };
  }
  const before = refProbeSeams({ ref: baseRef, repo: repoRoot });
  const after = refProbeSeams({ ref: merged.sha, repo: repoRoot });
  const regressions = applicable.docs.flatMap((doc) =>
    regressionsForDoc({
      after: evaluateProbes({ probes: doc.doneWhen, seams: after }),
      before: evaluateProbes({ probes: doc.doneWhen, seams: before }),
      doc,
    }),
  );
  return { docsChecked: applicable.docs.length, kind: "evaluated", regressions };
}
