/**
 * The merge guard's docs-budget sweep — measures the always-on documentation set and every skill body AS OF
 * THE TREE A SQUASH-MERGE WOULD ACTUALLY PRODUCE, never against `head`'s own pre-merge tip.
 *
 * ## The failure this exists to catch
 *
 * Measured: two pull requests each added lines to `skills/loop/SKILL.md`, and each ran
 * `alwaysOnDocsBudget.test.ts` GREEN at its own head — because each head's tree only ever contains that one
 * PR's own addition on top of the base it forked from, and neither addition alone crossed the 500-line
 * skill-body cap. Merged back-to-back, git's own three-way merge combined both additions into one file that
 * DID cross it, and nothing had ever measured that combined file before it landed on `main`. The merge gate
 * re-measured the PR against its own head — the same tree the PR's own CI had already measured — and never
 * re-ran the budget gates against what merging would actually produce.
 *
 * `git merge-tree --write-tree` (see `./probeSweep.js`'s header, which uses it for the identical reason) computes
 * that combined tree without touching the working tree, the index, or any ref, so it is measured HERE, before the
 * merge, rather than discovered afterwards as a red `main` that every other branch cut from it then inherits.
 *
 * ## Reuses the board sweep's own primitives, and the budget's own math
 *
 * ## The one way the two readers can still disagree, stated rather than discovered
 *
 * `gitShowAt` reads a blob, so a SYMLINKED canon file reads here as its target PATH while the disk gate
 * reads the file it points at — and an `@` import inside that target would then be counted on disk and not
 * at merge time. No canon file in this repository is a symlink, and making one would be the change that
 * needs this closed; it is named here so the next reader finds it written down rather than as a surprise.
 *
 * This does not shell `git merge-tree` a second, independently-written way, and it does not restate a single
 * ratchet number: {@link computeMergeTree}, {@link refResolves} and {@link gitShowAt} come straight from
 * `./probeSweep.js`, and every ceiling comes from `../../canon/alwaysOnDocs.js`'s {@link docBudgetsFor} — the
 * exact function the real-repository test calls over content read off disk. This module supplies only the
 * paths and the content, read as of the merged tree instead of off disk.
 */

import { execFileSync } from "node:child_process";

import {
  alwaysOnEntry,
  alwaysOnPaths,
  type DocBudget,
  docBudgetsFor,
  isPathScoped,
  type ReadDoc,
} from "../../canon/alwaysOnDocs.js";
import { stripGitEnv } from "../../codex/gitRun.js";
import { GitReadStoppedError, throwIfStopped } from "./gitReadStopped.js";
import { computeMergeTree, gitShowAt, mergeTreeUnavailable, refResolves } from "./probeSweep.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Every path at or below `directory` at `ref` whose name ends with `suffix`.
 *
 * **Recursive, and that is parity rather than generosity.** Claude Code discovers `.claude/rules/*.md`
 * recursively, and the disk gate's own listing (`git ls-files -- .claude/rules/*.md`) matches nested paths
 * too because a git pathspec `*` crosses `/`. A shallower listing here would measure a smaller set than the
 * gate that runs on the same tree — so a rule in a subdirectory would be free at merge time and counted on
 * disk, which is the disagreement this whole module exists to prevent.
 *
 * MEASURED: `git ls-tree --name-only HEAD -- .claude/rules` prints the single line
 * `.claude/rules` — the DIRECTORY — which the `.md` filter then dropped, so this returned an empty list on
 * every run and the merge-time always-on set was silently `CLAUDE.md` plus `AGENTS.md` and nothing else.
 * Reproduce both spellings with `git ls-tree --name-only HEAD -- .claude/rules` and `… -r … -- .claude/rules`.
 *
 * @param repo the repository to read
 * @param ref the tree-ish to list (a commit, or the merged tree's own hash)
 * @param directory the repo-relative directory to list under
 * @param suffix the filename suffix a listed path must carry
 * @returns every matching path, or an empty list when the directory does not exist at `ref`
 */
function filesUnderAt({
  repo,
  ref,
  directory,
  suffix,
}: {
  repo: string;
  ref: string;
  directory: string;
  suffix: string;
}): readonly string[] {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", directory], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(suffix));
  } catch (error: unknown) {
    throwIfStopped({ command: `ls-tree -r --name-only ${ref} -- ${directory}`, error, timeoutMs: GIT_READ_TIMEOUT_MS });
    return [];
  }
}

/**
 * Where a checkout may keep its own skills, tried in order until one has any — this build's own `skills/`
 * (slopweaver itself) first, then a checkout's `.agents/skills/` (acme-admin's layout, per
 * `../../live/turn/skillCatalogue.ts`'s own two roots). Never `.claude/skills`: on a real machine that is
 * commonly a symlink to `.agents/skills`, which `git ls-tree -r` does not follow, so it would only ever add
 * an empty candidate rather than a second copy to dedupe.
 */
const SKILLS_ROOT_CANDIDATES: readonly string[] = ["skills", ".agents/skills"];

/**
 * Every `SKILL.md` at `ref` under one candidate directory, one directory below it — recursive, since each
 * skill owns its own subdirectory.
 *
 * @param repo the repository to read
 * @param ref the tree-ish to list
 * @param directory the repo-relative skills root to list under
 * @returns every `<directory>/<name>/SKILL.md` path present at `ref`
 */
function skillFilesUnder({
  repo,
  ref,
  directory,
}: {
  repo: string;
  ref: string;
  directory: string;
}): readonly string[] {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", directory], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith("/SKILL.md"));
  } catch (error: unknown) {
    throwIfStopped({ command: `ls-tree -r --name-only ${ref} -- ${directory}`, error, timeoutMs: GIT_READ_TIMEOUT_MS });
    return [];
  }
}

/**
 * Every `SKILL.md` at `ref`, under whichever of {@link SKILLS_ROOT_CANDIDATES} this repo actually uses —
 * the first candidate with any match wins, so a repo whose skills live under `.agents/skills/` is measured
 * there instead of being read as having no skills at all.
 *
 * @param repo the repository to read
 * @param ref the tree-ish to list
 * @returns every skill's `SKILL.md` path present at `ref`, from the first non-empty root
 */
function skillFilesAt({ repo, ref }: { repo: string; ref: string }): readonly string[] {
  for (const directory of SKILLS_ROOT_CANDIDATES) {
    const found = skillFilesUnder({ directory, ref, repo });
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/** `path`'s content at `ref`, or `undefined` when it is absent or unreadable there. */
function contentAtOrUndefined({ repo, ref, path }: { repo: string; ref: string; path: string }): string | undefined {
  const shown = gitShowAt({ path, ref, repo });
  return shown.kind === "content" ? shown.text : undefined;
}

/** Read every path's content at `ref`, dropping any path that turned out absent or unreadable there. */
function readDocsAt({ repo, ref, paths }: { repo: string; ref: string; paths: readonly string[] }): readonly ReadDoc[] {
  const docs: ReadDoc[] = [];
  for (const path of paths) {
    const content = contentAtOrUndefined({ path, ref, repo });
    if (content !== undefined) {
      docs.push({ content, path });
    }
  }
  return docs;
}

/** What sweeping the docs budget concluded: the budgets to check, or a reason nothing could be measured. */
export type MergeDocsBudgetSweep =
  | { readonly kind: "evaluated"; readonly budgets: readonly DocBudget[] }
  | { readonly kind: "not-evaluated"; readonly reason: string };

/**
 * Measure the always-on documentation set and every skill body against the tree a squash-merge of `headRef`
 * into `baseRef` would actually produce.
 *
 * @param repoRoot the repository being merged
 * @param baseRef the branch being merged into, as a ref this repository can resolve
 * @param headRef the branch being merged from, as a ref this repository can resolve
 * @returns every budget to check, or why the merged tree could not be measured
 */
export function sweepMergeDocsBudget({
  repoRoot,
  baseRef,
  headRef,
}: {
  repoRoot: string;
  baseRef: string;
  headRef: string;
}): MergeDocsBudgetSweep {
  try {
    return sweepDocsBudget({ baseRef, headRef, repoRoot });
  } catch (error: unknown) {
    if (error instanceof GitReadStoppedError) {
      return { kind: "not-evaluated", reason: `${error.message} — the docs budget was not checked` };
    }
    throw error;
  }
}

/** {@link sweepMergeDocsBudget}'s body; a git read stopped at its bound throws out of it. */
function sweepDocsBudget({
  repoRoot,
  baseRef,
  headRef,
}: {
  repoRoot: string;
  baseRef: string;
  headRef: string;
}): MergeDocsBudgetSweep {
  if (!refResolves({ ref: baseRef, repo: repoRoot }) || !refResolves({ ref: headRef, repo: repoRoot })) {
    return {
      kind: "not-evaluated",
      reason: `could not resolve "${baseRef}" and/or "${headRef}" as git refs in ${repoRoot} — the docs budget was not checked`,
    };
  }
  const merged = computeMergeTree({ baseRef, headRef, repo: repoRoot });
  if (merged.kind !== "tree") {
    const why = mergeTreeUnavailable({ baseRef, headRef, merged });
    return { kind: "not-evaluated", reason: `${why} — the docs budget was not checked against a simulated result` };
  }
  const ref = merged.sha;
  const ruleFiles = filesUnderAt({ directory: ".claude/rules", ref, repo: repoRoot, suffix: ".md" });
  const ruleDocs = readDocsAt({ paths: ruleFiles, ref, repo: repoRoot });
  const unscopedRulePaths = ruleDocs.filter((doc) => !isPathScoped({ content: doc.content })).map((doc) => doc.path);
  // An UNREADABLE instructions file counts as present, so the walk reaches it and the missing-document refusal
  // below fires, rather than quietly measuring `AGENTS.md` in a repository whose host reads something else.
  const entry = alwaysOnEntry({ exists: ({ path }) => gitShowAt({ path, ref, repo: repoRoot }).kind !== "absent" });
  const wanted = alwaysOnPaths({
    entry,
    readDoc: ({ path }) => contentAtOrUndefined({ path, ref, repo: repoRoot }),
    unscopedRules: unscopedRulePaths,
  });
  const alwaysOn = readDocsAt({ paths: wanted, ref, repo: repoRoot });
  const skills = readDocsAt({ paths: skillFilesAt({ ref, repo: repoRoot }), ref, repo: repoRoot });
  if (alwaysOn.length < wanted.length) {
    const missing = wanted.filter((path) => !alwaysOn.some((doc) => doc.path === path));
    return {
      kind: "not-evaluated",
      reason: `merged tree ${ref} is missing always-on document(s) reached by an @ import: ${missing.join(", ")} — refusing to report a clean budget over a smaller set`,
    };
  }
  if (alwaysOn.length === 0 || skills.length === 0) {
    return {
      kind: "not-evaluated",
      reason: `merged tree ${ref} carried no readable always-on docs or no skills — refusing to report a clean budget`,
    };
  }
  return { budgets: docBudgetsFor({ alwaysOn, skills }), kind: "evaluated" };
}
