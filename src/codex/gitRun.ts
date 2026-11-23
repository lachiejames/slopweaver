/**
 * The git RUNNER the codex modules shell `git` through: one child per command, its environment stripped of
 * `GIT_*`, its rendering config pinned, its output strictly decoded and its run bounded.
 *
 * `execFileSync` with an argv ARRAY, exactly like `src/config.ts` and every `devLint` scanner — never a
 * shell string, so there is no quoting, word-splitting or redirection to get wrong. This file is listed in
 * `SANCTIONED_SEAMS` as a `read-only-tool` for that reason.
 *
 * Split out of `./gitDiff.ts`, which plans and assembles the review diff and the tree fingerprint over these
 * runs, when that file passed the size cap.
 */

import { execFileSync } from "node:child_process";
import { asIoError, decodeStrict } from "./gitOutput.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * How long a git command that writes or deletes a WHOLE working tree may take — the snapshot pool's
 * `worktree add`, `worktree remove`, `reset --hard` and `clean -ffdxq`. That is filesystem-bound work, not a
 * read: one acme-admin `git worktree remove` took 7m45s (545k entries, 429k of them
 * hardlinks-local `node_modules`, `docs/worktree-prune/operations.md`). Ten minutes is the bound
 * `src/worktree/pruneRefusal.ts` already puts on that same removal.
 */
export const GIT_TREE_WRITE_TIMEOUT_MS = 10 * 60_000;

/** The most git output we will hold. Above this the read itself fails rather than silently truncating. */
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

/**
 * Config pinned on EVERY invocation, so git's output depends on the repository and nothing else.
 *
 * {@link gitCleanEnv} already stops `GIT_*` environment variables deciding which repository is read. This is
 * the other half of the same guarantee: stopping local *config* decide how that repository is rendered. The
 * two are easy to conflate, and stripping the environment does nothing about `.git/config`.
 *
 * Found by a Codex review of the fingerprint it protects, then reproduced: commit `café.ts`, edit it, and
 * capture twice while toggling only `core.quotepath`. Git renders the identical path as `café.ts` or as
 * `"caf\303\251.ts"`, the patch bytes differ, and the digest changes for a tree that never moved. Left
 * alone it would have broken the CI half of the loop gate quietly — a runner's config differs from a
 * laptop's, so any branch touching a non-ASCII path would fail with no visible cause.
 *
 * Each entry pins one thing that alters the BYTES rather than the content:
 *
 *  - `core.quotepath`      — whether non-ASCII path bytes are octal-escaped
 *  - `diff.algorithm`      — hunk splitting; `patience` and `myers` disagree on identical input
 *  - `diff.context`        — how many context lines surround each hunk
 *  - `diff.noprefix` / `diff.mnemonicPrefix` — whether headers read `a/`…`b/` or `i/`…`w/` or nothing
 *  - `core.abbrev`         — the length of the shas in each `index` line
 *
 * And one global option that pins which OBJECTS a name reads, rather than how they render:
 *
 *  - `--no-replace-objects` — git otherwise honours a local `refs/replace/<sha>` even for a full object name,
 *    so a checkout can make a commit read as a DIFFERENT commit. Found by a Codex review of the carried-diff
 *    rule (`./diffCarry.ts`): a replacement pointing a pull request's changed head at a commit holding the old
 *    patch hashed to the reviewed digest and lifted a stale review. Every digest here — a captured review
 *    diff, a recomputed one, a tree fingerprint — is now about the objects the names really denote.
 */
const CANONICAL_CONFIG: readonly string[] = [
  "--no-replace-objects",
  "-c",
  "core.quotepath=false",
  "-c",
  "diff.algorithm=myers",
  "-c",
  "diff.context=3",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "core.abbrev=40",
];

/**
 * Run one git command, returning stdout STRICTLY decoded.
 *
 * Deliberately captures a Buffer and decodes with `fatal: true` rather than passing `encoding: "utf8"`.
 * A lossy decode silently substitutes U+FFFD, and by the time you hold the string the evidence is gone —
 * so the only honest place to detect bad bytes is here, before decoding. Scanning the decoded text instead
 * false-positives on source that legitimately contains U+FFFD (this repo's own diff fixtures do).
 *
 * @returns the command's stdout, strictly decoded as UTF-8
 */
export function git({
  args,
  cwd,
  extraEnv,
  timeoutMs = GIT_READ_TIMEOUT_MS,
}: {
  args: readonly string[];
  cwd: string;
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}): string {
  const stdout = execFileSync("git", [...CANONICAL_CONFIG, ...args], {
    cwd,
    // Strip every GIT_* variable, THEN add back only what this call explicitly asked for. The stripping is
    // the guarantee (see gitCleanEnv); an operation that genuinely needs one — a scratch GIT_INDEX_FILE, so
    // a snapshot can be staged without touching the caller's index — states it here rather than inheriting
    // it. Inheritance is what the stripping exists to prevent; explicit passing is not.
    env: { ...gitCleanEnv(), ...extraEnv },
    maxBuffer: MAX_GIT_BUFFER,
    killSignal: "SIGKILL",
    timeout: timeoutMs,
  });
  // `args[0]!` is honest: a git invocation always has a subcommand, and the house rule forbids `?? ""`.
  return decodeStrict({ bytes: stdout, label: `git ${args[0]!}` });
}

/**
 * The process environment with every `GIT_*` variable stripped.
 *
 * Git hooks export `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` and friends, and **those override `cwd`**.
 * So a `codex review` invoked from inside a hook — a pre-push gate, say — would silently diff the HOOK's
 * repository rather than the one it was pointed at: a review of entirely the wrong code that looks perfectly
 * healthy, with a plausible verdict and a complete artifact. Found when this repo's own pre-push hook ran the
 * temp-repository tests and every one of them operated on slopweaver instead of its fixture.
 *
 * Stripping them makes `cwd` the ONLY thing that decides which repository is read, which is what every
 * caller already assumes.
 */
function gitCleanEnv(): Record<string, string> {
  return stripGitEnv({ env: process.env });
}

/**
 * Drop every `GIT_*` entry from an environment, matching the key CASE-INSENSITIVELY.
 *
 * Pure and exported so it can be tested directly, which matters more than it looks. The case-insensitivity
 * exists for Windows, where environment lookup ignores case — so a lower-case `git_dir` is honoured by git
 * while a `startsWith("GIT_")` test walks straight past it. That cannot be demonstrated on macOS or Linux,
 * where the variable simply would not be read at all, so an end-to-end test on this machine would pass
 * whether the bug were present or not. Testing the predicate is the only honest way to hold the guarantee.
 *
 * @param env the environment to filter (`process.env` in production)
 * @returns the same environment with every `GIT_*` key removed, in any case
 */
export function stripGitEnv({ env }: { env: NodeJS.ProcessEnv }): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.toUpperCase().startsWith("GIT_") && value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Run a git command, mapping any failure to a plain io-shaped error (never an HTTP-looking one).
 *
 * @param args the argv, never a shell string — there is no shell, so quoting cannot go wrong
 * @param cwd where to run it
 * @param label what to call this step in an error message
 * @param extraEnv env vars to add on top of the stripped git environment
 * @param timeoutMs when the child is killed: two minutes for a read, {@link GIT_TREE_WRITE_TIMEOUT_MS} for a
 *   command that writes a whole working tree
 * @returns the command's stdout
 */
export function runGitChecked({
  label,
  timeoutMs = GIT_READ_TIMEOUT_MS,
  ...call
}: {
  args: readonly string[];
  cwd: string;
  label: string;
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}): string {
  try {
    return git({ ...call, timeoutMs });
  } catch (error: unknown) {
    throw asIoError({ error, label, timeoutMs });
  }
}
