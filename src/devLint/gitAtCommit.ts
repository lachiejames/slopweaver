/**
 * Reading this repository AT A BASE COMMIT — the one mechanism every gate that compares a branch against
 * its base shares.
 *
 * It was `coverageRatchet.ts`'s private half until a second reader appeared. The env var is not a coverage
 * fact: it names the commit CI decided this branch should be judged against, and `coverage-ratchet` was
 * simply the first gate to want one. `test-enshittification` is the second, so the resolution, the two
 * defences against ambient repository state, and the buffer ceiling live here and are imported by both
 * rather than reproduced — which is the class `hand-rolled-result` and `decodeDebtList.ts` exist to stop.
 *
 * The NAME of the variable stays `SLOPWEAVER_COVERAGE_BASE_SHA`: renaming it would be a CI change that
 * buys nothing, and `.github/workflows/ci.yml` exports and `--depth=1` fetches it at job level for the
 * `lint` and `build` jobs both.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { safeJsonParse } from "#lib/safeJson.js";
import { gitEnv } from "../lib/gitRepo.js";
import { confirmNewRef, type GithubEventRead } from "./floorBaseConfirmation.js";
import { repoRoot } from "./scanScope.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Where the comparison commit came from, or why there isn't one.
 *
 * Three outcomes, and only one of them passes without comparing:
 *
 *  - `absent` — the all-zeroes SHA CI supplies for a brand-new ref, which has no previous commit to compare
 *    against; that is a scope boundary, and it passes. {@link readFloorBaseClaim} reads it from the environment
 *    alone, so it is only a CLAIM there; {@link resolveFloorBase}, which every gate calls, keeps it only when
 *    `./floorBaseConfirmation.ts` confirms the ref is new, and turns it `invalid` otherwise.
 *  - `invalid` — no base, or one supplied and unusable. It FAILS. A gate that judges a branch against its base
 *    and finds no base has judged nothing, and printing a pass there is how a branch once reached the lap red
 *    on `host-wording` with a seat's local run green. CI and the lap both export the base, so the no-base case
 *    fires only where someone ran the gate by hand without it — exactly the run that must not read as clean.
 *  - `sha` — compare against this.
 *
 * Collapsing `absent` and `invalid` is how a missing or misconfigured variable turns into a permanently skipped
 * check that still prints a clean line. A missing base is `invalid` rather than a fourth kind so that every
 * gate's existing `invalid` branch fails it, with no gate of its own to change.
 */
export type FloorBase =
  | { readonly kind: "absent"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "sha"; readonly sha: string };

/** The env var CI and the lap set to the exact commit this branch is compared against. */
export const FLOOR_BASE_ENV = "SLOPWEAVER_COVERAGE_BASE_SHA";

const ZERO_SHA = "0".repeat(40);

/**
 * Read the comparison commit the environment CLAIMS, judging only its shape. Pure.
 *
 * There is deliberately NO fallback to `origin/main` inside a gate. Measured: a branch cut before `main`
 * raised the floor compares as a lowering it never made, and a stale remote-tracking ref compares clean
 * against the wrong commit. CI supplies the exact SHA (and for a PR, checks out the MERGE commit, which is
 * what makes the comparison correct), and `github lap` exports the base tip it lands on. Anyone else running
 * one of these gates supplies the base themselves, and the no-base reason prints the command that does it.
 *
 * Git accepts an uppercase SHA, so this does too rather than manufacturing a failure out of letter case —
 * but anything else that is SET and unusable is `invalid`. An earlier revision skipped a malformed value,
 * which meant a single mistyped CI variable disabled the whole history half while still printing a
 * reassuring "skipped" line. A short SHA is still `invalid`, because a prefix that is unique today may not be
 * tomorrow; its reason prints the command that expands it.
 *
 * All zeroes reads as `absent` here from the environment alone, which proves nothing about the ref. A gate
 * never calls this: it calls {@link resolveFloorBase}, which checks that claim against HEAD. A caller that only
 * asks whether a value is a usable full SHA (`src/perf/subject.ts`) reads this.
 *
 * @param env the process environment
 * @returns the SHA to compare against, an unconfirmed new-ref claim, or why the base is missing or unusable
 */
export function readFloorBaseClaim({ env }: { env: NodeJS.ProcessEnv }): FloorBase {
  const supplied = env[FLOOR_BASE_ENV];
  if (supplied === undefined) {
    return {
      kind: "invalid",
      reason:
        `no ${FLOOR_BASE_ENV} in the environment, so nothing was compared — run \`git fetch origin main\`, ` +
        `then re-run with \`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` in front of the command`,
    };
  }
  const raw = supplied.trim();
  if (raw.length === 0) {
    return { kind: "invalid", reason: `${FLOOR_BASE_ENV} is set but empty — give it the base commit's full SHA` };
  }
  if (raw.toLowerCase() === ZERO_SHA) {
    return { kind: "absent", reason: `${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit` };
  }
  if (/^[0-9a-fA-F]{4,39}$/.test(raw)) {
    return {
      kind: "invalid",
      reason:
        `${FLOOR_BASE_ENV} is not a full 40-character commit SHA: ${raw} — expand it with ` +
        `\`export ${FLOOR_BASE_ENV}=$(git rev-parse ${raw})\``,
    };
  }
  if (!/^[0-9a-fA-F]{40}$/.test(raw)) {
    return {
      kind: "invalid",
      reason: `${FLOOR_BASE_ENV} is not a full 40-character commit SHA: ${raw}`,
    };
  }
  return { kind: "sha", sha: raw.toLowerCase() };
}

/**
 * The git invocation every read here goes through.
 *
 * Two defences against ambient repository state redirecting a verification gate, which is the hazard
 * `gitRepo.ts` was written for:
 *
 *  - `gitEnv()` strips `GIT_DIR`/`GIT_WORK_TREE`/…, which a git hook exports and which OVERRIDE `-C`.
 *  - `--no-replace-objects` ignores `refs/replace`. `git show` honours replacement refs by default, so a
 *    single `git replace HEAD <other>` makes `HEAD:coverage-baseline.json` transparently read a different
 *    commit's file — the gate would then verify an object that is not what is committed. Found by a review
 *    pass and defended because it costs a flag, NOT because the threat model changed: a committer who can
 *    do that can also edit this gate, and nothing here pretends otherwise.
 */
function gitArgs({ root, args }: { root: string; args: readonly string[] }): readonly string[] {
  return ["--no-replace-objects", "-C", root, ...args];
}

/**
 * Run a git command for its exit status alone.
 *
 * @param args the git arguments, after the ones every read here carries
 * @param root the repository to run in
 * @returns whether git exited zero
 */
export function gitSucceeds({ root, args }: { root: string; args: readonly string[] }): boolean {
  try {
    execFileSync("git", [...gitArgs({ args, root })], {
      env: gitEnv(),
      stdio: "ignore",
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * What one `git grep -q` said: a match, no match, or a failure that says nothing about the subject.
 *
 * {@link gitSucceeds} cannot carry this, because it folds a fatal error, a kill and a timeout into "no
 * match" — and a gate that reads "the symbol is gone" off a git that never searched passes on a read it
 * never made.
 */
export type GrepOutcome = "error" | "match" | "none";

/**
 * Classify how a `git grep -q` ended. Pure. Git exits 0 on a match and 1 on none; every other end — a
 * fatal 128, a kill, a timeout, a spawn that never started — is `error`.
 *
 * @param end the child's exit status, and the spawn or timeout error `spawnSync` reports
 * @returns the outcome a caller can branch on without mistaking a failure for an absence
 */
export function grepOutcome({ end }: { end: { status: number | null; error: Error | undefined } }): GrepOutcome {
  if (end.error !== undefined) return "error";
  if (end.status === 0) return "match";
  if (end.status === 1) return "none";
  return "error";
}

/**
 * Run a `git grep -q` and report whether it matched, did not, or failed.
 *
 * @param args the grep arguments, `grep` included, after the ones every read here carries
 * @param root the repository to run in
 * @returns the classified outcome
 */
export function gitGrep({ root, args }: { root: string; args: readonly string[] }): GrepOutcome {
  const result = spawnSync("git", [...gitArgs({ args, root })], {
    env: gitEnv(),
    stdio: "ignore",
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
  return grepOutcome({ end: { error: result.error, status: result.status } });
}

/**
 * Whether one commit is an ancestor of another: `yes`, `no`, or `error` when git could not answer. The same
 * three-way split {@link grepOutcome} draws, for the same reason: `merge-base --is-ancestor` exits 1 for "not an
 * ancestor" and 128 for "could not tell", and {@link gitSucceeds} would read both as no.
 *
 * @param root the repository to run in
 * @param ancestor the commit that may be the ancestor
 * @param descendant the commit it may be an ancestor of
 * @returns the classified answer
 */
export function gitAncestry({
  root,
  ancestor,
  descendant,
}: {
  root: string;
  ancestor: string;
  descendant: string;
}): "yes" | "no" | "error" {
  const result = spawnSync("git", [...gitArgs({ args: ["merge-base", "--is-ancestor", ancestor, descendant], root })], {
    env: gitEnv(),
    stdio: "ignore",
    killSignal: "SIGKILL",
    timeout: GIT_READ_TIMEOUT_MS,
  });
  const outcome = grepOutcome({ end: { error: result.error, status: result.status } });
  if (outcome === "match") {
    return "yes";
  }
  return outcome === "none" ? "no" : "error";
}

/**
 * The buffer for a `git show` of a file at a commit.
 *
 * `execFileSync` defaults to 1 MiB and throws on overflow, which this function would report as "could not be
 * read" — a false failure, and one that disagreed with the working-tree path, where `readFileSync` has no
 * such ceiling. The two reads must agree on what is readable so that the PARSER decides what is valid, not
 * the transport.
 *
 * This is a resource limit, not a correctness boundary, and it is deliberately finite. A review pass then
 * objected that a file larger than THIS value also fails — true, and true of any number chosen here, since
 * every implementation buffers somewhere (`readFileSync` included). That regress is not a defect to chase:
 * the real subjects are a few hundred bytes to a few tens of kilobytes, and reaching 64 MiB takes ~67
 * million characters of deliberate padding. Raising the ceiling from 1 MiB was worth doing because 1 MiB is
 * small enough to meet by accident and the two read paths disagreed; chasing it further is not.
 */
const GIT_SHOW_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** The one bounded text read every helper below shares: git's whole stdout, or `undefined` if git refused. */
function gitText({ root, args }: { root: string; args: readonly string[] }): string | undefined {
  try {
    return execFileSync("git", [...gitArgs({ args, root })], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: GIT_SHOW_MAX_BUFFER_BYTES,
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
  } catch {
    return undefined;
  }
}

/**
 * Read a blob at a commit.
 *
 * @param root the repository to run in
 * @param spec a `<commit>:<path>` revision spec
 * @returns the blob's text, or `undefined` if git refused
 */
export function gitShow({ root, spec }: { root: string; spec: string }): string | undefined {
  return gitText({ args: ["show", spec], root });
}

/**
 * Run a git command that reports one record per line.
 *
 * The empty-line filter is what separates "git reported nothing" from "git failed": both would otherwise
 * arrive as a falsy value, and a caller treating a failure as an empty result is a gate that passes when
 * its own input could not be read.
 *
 * @param args the git arguments, after the ones every read here carries
 * @param root the repository to run in
 * @returns one entry per non-empty output line, or `undefined` if git refused
 */
export function gitLines({ root, args }: { root: string; args: readonly string[] }): readonly string[] | undefined {
  const out = gitText({ args, root });
  if (out === undefined) {
    return undefined;
  }
  return out.split("\n").filter((line) => line.length > 0);
}

/**
 * Read a NUL-separated git stream into its fields.
 *
 * `-z` is not a formatting preference. Without it `git diff --name-status` renders a path containing any
 * byte outside printable ASCII through `core.quotePath`, which defaults to ON: a modified
 * `src/__tests__/unit/café.test.ts` arrives as `"src/__tests__/unit/caf\303\251.test.ts"`, quotes and all.
 * A consumer matching on a path prefix then silently drops that file — for a verification gate, a file
 * dropped is a weakening that passes. `-z` emits the path raw, and separates records with NUL, so a
 * newline inside a filename cannot split one record into two either. A counterexample over a real `--depth=1` clone
 * proves it.
 *
 * @param args the git arguments, after the ones every read here carries
 * @param root the repository to run in
 * @returns one entry per non-empty NUL-separated field, or `undefined` if git refused
 */
export function gitNulFields({ root, args }: { root: string; args: readonly string[] }): readonly string[] | undefined {
  const out = gitText({ args, root });
  if (out === undefined) {
    return undefined;
  }
  return out.split("\0").filter((field) => field.length > 0);
}

/** What the runner's GitHub event says, or why there is none to read. Only an Actions runner sets both names. */
function readGithubEvent({ env }: { env: NodeJS.ProcessEnv }): GithubEventRead {
  const name = env["GITHUB_EVENT_NAME"];
  const path = env["GITHUB_EVENT_PATH"];
  if (name === undefined || path === undefined) {
    return { kind: "missing", why: "no GitHub event is in the environment" };
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "missing", why: `the GitHub event file could not be read (${detail})` };
  }
  try {
    return { kind: "read", name, payload: safeJsonParse({ label: path, text }) };
  } catch {
    return { kind: "missing", why: "the GitHub event file is not JSON" };
  }
}

/**
 * Resolve the comparison commit for a gate: {@link readFloorBaseClaim}, with its all-zeroes claim checked against
 * HEAD. All zeroes stays `absent` only when `./floorBaseConfirmation.ts` confirms the ref is new — HEAD is a root
 * commit, or the runner's push event created this ref at HEAD — and is `invalid` otherwise, so every gate's
 * existing `invalid` branch fails it. The check lives in the one entry point every gate already calls, so no gate
 * can read the base without it. Reads local git and the runner's event file; never the network.
 *
 * @param env the process environment, carrying the base and, on a runner, the GitHub event
 * @param root the repository whose HEAD the claim is checked against; unset, this checkout's, found only when
 *   the base is all zeroes
 * @returns the SHA to compare against, a confirmed new ref, or why the base is missing, unusable or unconfirmed
 */
export function resolveFloorBase({ env, root }: { env: NodeJS.ProcessEnv; root?: string }): FloorBase {
  const base = readFloorBaseClaim({ env });
  if (base.kind !== "absent") {
    return base;
  }
  if (root === undefined) {
    return confirmAtHead({ claim: base.reason, env, root: repoRoot() });
  }
  return confirmAtHead({ claim: base.reason, env, root });
}

/** Keep an all-zeroes claim `absent` only when HEAD in `root` confirms the ref is new; `invalid` otherwise. */
function confirmAtHead({ claim, env, root }: { claim: string; env: NodeJS.ProcessEnv; root: string }): FloorBase {
  // HEAD is resolved ONCE and its object read by that SHA, so both arms judge the same commit: two separate
  // `HEAD` reads would let a ref moving between them pair one commit's parentless object with another's SHA.
  const headSha = gitText({ args: ["rev-parse", "--verify", "HEAD^{commit}"], root })?.trim();
  const headCommit = headSha === undefined ? undefined : gitText({ args: ["cat-file", "commit", headSha], root });
  const confirmation = confirmNewRef({ event: readGithubEvent({ env }), headCommit, headSha });
  if (confirmation.kind === "confirmed") {
    return { kind: "absent", reason: `${claim} (${confirmation.evidence})` };
  }
  return {
    kind: "invalid",
    reason:
      `${FLOOR_BASE_ENV} is all zeroes, but nothing confirms this ref is new: ${confirmation.why} — only a root ` +
      `commit or the push that created the ref may skip the comparison; re-run with ` +
      `\`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` in front of the command`,
  };
}

/**
 * Run a gate that judges this branch against the base commit CI and the lap export: find the repository, resolve
 * the base, prove the commit is in this checkout, then hand both to `judge`. Each state it cannot get past is
 * printed as a FACT on the gate's own channel, never as a verdict about anyone's code: no checkout, no base, or a
 * base that is unusable or missing from the checkout exits 1, the no-base line naming the command that supplies
 * one. Only an all-zeroes base exits 0 without judging: CI supplies it for a brand-new ref, which has no previous
 * commit, and {@link resolveFloorBase} keeps it only when HEAD confirms the ref is new.
 * CI exports and fetches the base (`git fetch --no-tags --depth=1 origin "$SLOPWEAVER_COVERAGE_BASE_SHA"`).
 *
 * @param gate the gate's id, which prefixes every fact line
 * @param judge the half that has a base commit, already present in the checkout, in hand
 * @returns the process exit code
 */
export function runAgainstFloorBase({
  gate,
  judge,
}: {
  gate: string;
  judge: (base: { readonly root: string; readonly sha: string }) => number;
}): number {
  const fact = ({ line }: { line: string }): void => {
    // devlint: not-a-refusal -- this is the FACT channel itself; a rule catching something goes through lintGateRefusal
    process.stderr.write(`${gate}: ${line}\n`);
  };
  let root: string;
  try {
    root = repoRoot();
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ, so the gate has no subject to judge
    fact({ line: "not a git checkout (git ls-files failed)" });
    return 1;
  }
  const base = resolveFloorBase({ env: process.env, root });
  if (base.kind === "absent") {
    // devlint: not-a-refusal -- a brand-new ref has no previous commit, so there is nothing to compare against
    fact({ line: `${base.reason} — no comparison made` });
    return 0;
  }
  if (base.kind === "invalid") {
    // devlint: not-a-refusal -- the base is missing or unusable, so the gate never SAW its subject
    fact({ line: base.reason });
    return 1;
  }
  if (!gitSucceeds({ args: ["cat-file", "-e", `${base.sha}^{commit}`], root })) {
    // devlint: not-a-refusal -- the named base commit is not in this checkout, so the gate never SAW its subject
    fact({
      line: `${FLOOR_BASE_ENV} names ${base.sha}, which is not in this checkout — run \`git fetch origin ${base.sha}\``,
    });
    return 1;
  }
  return judge({ root, sha: base.sha });
}
