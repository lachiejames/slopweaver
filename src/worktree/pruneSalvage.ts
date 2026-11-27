/**
 * Capturing a worktree's only copy of some work, so the tree that holds it can be removed — the owner's
 * week-old rule.
 *
 * A worktree untouched for over a week is safe to delete, because worktrees are regenerable and the work is
 * tracked on boards and spawned via the supervisor, and the repository ships about 30 pull requests a day. Anything older than a week goes, and changes can be pushed
 * to a remote branch with the board row updated to say they can be pulled down into a fresh worktree.
 *
 * ## The capture is the argument, and that makes this file different from every other class
 *
 * Every other class is safe because something outside the tree already carries its work: the trunk, a remote
 * branch, or a remote ref at the detached sha. Here there is no such ref to lean on. The holds the week-old
 * waiver releases (`./pruneClassify`'s `waivable` rules) are exactly the ones whose content is "this tree
 * holds the only copy": uncommitted tracked changes, an interrupted removal's deletions, commits on no
 * remote, and a detached HEAD no remote carries. So the remote branch this file creates IS the safety, and a removal must not happen
 * unless the remote has confirmed it.
 *
 * ## It never pushes to the branch the tree was on
 *
 * A salvage always mints its own `salvage/…` branch, even for a tree that already had a perfectly good one.
 * The reason is the population: the trees this class reaches are ordinary feature worktrees, and a feature
 * branch a week old is often the head of an open pull request. Committing that stale working tree and pushing
 * it under its own name would move the pull request's head, re-run its CI and drop an unreviewed `salvage:`
 * commit into somebody's review. The owner asked for the work to be kept, not for open reviews to be
 * rewritten, and a fresh branch satisfies the first without touching the second.
 *
 * That is why the push goes through {@link pushAndVerify} rather than a `git push` of its own. Its contract
 * is the one this class needs — *"Success is the remote reporting EXACTLY the commit that was sent, never
 * git's own exit code"* — and it reads the ref back with `ls-remote` after the transport closes. A push
 * whose exit code is 0 and whose ref is absent is the failure mode that would turn this verb into one that
 * deletes uncommitted work, and it is the single thing standing between the two.
 *
 * ## Pure plan, effectful shell
 *
 * {@link planSalvage} decides the branch name and the exact git steps from facts alone, with no git, no
 * clock and no filesystem, so every shape below is provable against a literal fixture — including the one
 * that is awkward to stage for real, a tree whose HEAD sha git cannot report. {@link runSalvage} does
 * nothing but run those steps in order through injected edges and hand the result to the push.
 */
import { basename } from "node:path";

import type { GithubPushEdges } from "../admit/githubPush.js";
import { type LineListLoad } from "../hygiene/scan.js";
import type { PruneVerdict } from "./pruneClassify.js";
import { confirmOnRemote, HOOKS_OFF, withheldIfSecret } from "./salvagePush.js";
import { unrelatedHistoryDecline } from "./salvageTrunkHistory.js";

/** One git invocation in a salvage, with what it is for so a failure can say which step declined. */
interface SalvageStep {
  readonly args: readonly string[];
  /** What this step accomplishes, phrased to complete "could not …". */
  readonly what: string;
}

/** The branch a salvage will push, and the steps that put the work onto it. */
export interface SalvagePlan {
  /**
   * The branch to push, or `null` when there is nothing this plan can push.
   *
   * `null` arises only for a tree whose HEAD sha git could not report, which leaves no commit to create a
   * branch at. It is spelled as a real answer rather than an exception because a plan that invented a branch
   * name from a missing sha would push the wrong thing instead of refusing.
   */
  readonly branch: string | null;
  /** Never empty for a real plan: the branch is minted here, so there are always at least two steps. */
  readonly steps: readonly SalvageStep[];
}

/**
 * The secrets scan a salvage runs over what its push would send, answering why the push must not happen, or
 * `null` when it may. A seam so the capture's own cases stay pure; production is `./salvageScan`'s.
 */
export type SalvageScan = (args: { path: string; url: string; sha: string; target: string }) => string | null;

/** What a salvage attempt did, or why the tree must be kept after all. */
export interface SalvageOutcome {
  /** The branch the work now lives on, or `null` when nothing was pushed. */
  readonly branch: string | null;
  /** Git's or the remote's own words when it declined, or `null` when the remote confirmed the commit. */
  readonly declined: string | null;
}

/**
 * The branch name EVERY salvage pushes to, whether or not the tree already had a branch of its own.
 *
 * Exported because the mapping has to be provable rather than trusted. It is namespaced under `salvage/`
 * rather than reusing the run slug on its own, and it carries the sha so that one tree at one commit reads
 * the same way twice.
 *
 * **`attempt` is why this is not just a template, and it exists because the name being unused is NOT
 * something a name can decide.** An earlier version of this function argued that two salvages of the same
 * tree at the same commit collide benignly, because the remote already carries those commits. That was
 * wrong, and a review pass falsified it against a real bare remote: the second salvage commits NEW work
 * first, so the push fast-forwards the existing ref from the shared commit to one nobody has reviewed. If
 * a pull request had been opened off the first salvage branch, its head moves. {@link runSalvage} therefore
 * probes each candidate against both the local repository and the remote and walks `attempt` upward until
 * it finds one that exists in neither, and a name is never assumed free because it looks unlikely.
 *
 * **A salvage never pushes to the tree's OWN branch, and that is the point of this function rather than an
 * implementation detail.** The dirty trees this class reaches sit on ordinary feature branches, and some of
 * those branches are the head of an open pull request. Committing a week-old working tree and pushing it
 * under its own name would move that pull request's head, re-run its CI and put an unreviewed `salvage:`
 * commit in somebody's review, none of which the owner asked for when asking for the work to be kept. The
 * work reaches a remote either way, which is the whole of what the ruling requires.
 *
 * @param path the worktree's absolute path, whose basename is the run slug
 * @param headSha the commit the branch is created at
 * @param attempt 0 for the plain name, then 1, 2, … each appending a suffix to dodge a taken one
 * @returns the branch name
 */
export function salvageBranchName({
  path,
  headSha,
  attempt = 0,
}: {
  path: string;
  headSha: string;
  attempt?: number;
}): string {
  const slug = basename(path).replaceAll(/[^A-Za-z0-9._-]/gu, "-");
  const base = `salvage/${slug}-${headSha.slice(0, 8)}`;
  if (attempt === 0) {
    return base;
  }
  return `${base}-${attempt + 1}`;
}

/** How many names {@link runSalvage} will try before it keeps the tree rather than guess again. */
const SALVAGE_NAME_ATTEMPTS = 8;

/**
 * Decide the branch and the git steps that put one worktree's work onto it — pure.
 *
 * ONE shape, not four. Every salvage creates a branch at the tree's current HEAD and switches onto it, and
 * a dirty tree then has its changes committed there. Branching first is what keeps a detached tree's commit
 * on a ref at all; branching ALWAYS is what keeps the commit off a branch somebody else is using.
 *
 * `branch` is resolved by the caller rather than computed here, because whether a name is free is a
 * question only the local repository and the REMOTE can answer, and this function asks nothing. See
 * {@link runSalvage}, which does the asking, and {@link salvageBranchName}, which carries why.
 *
 * The branch the tree arrived on is deliberately not an input. It is kept by the removal exactly as
 * `pushed` keeps its own, and nothing here writes to it.
 *
 * **A staged version and a working-tree version are TWO pieces of work, and both are captured.** git's index
 * can hold content that no file on disk has — `MM` in porcelain — and `git add -A` overwrites it. Committing
 * only the working tree therefore destroyed the staged version, and once the worktree went so did the last
 * reference to it. A review pass reproduced exactly that against a real repository. So the index is committed
 * FIRST, on its own, and the working tree second: two commits on the salvage branch, neither overwriting the
 * other, and each step is emitted only when it has something to record.
 *
 * @param branch the name {@link runSalvage} proved free, or `null` when it could not find one
 * @param headSha the commit the tree is on now, or `null` when git could not be asked
 * @param staged how many porcelain lines carry an INDEX change, which is committed before anything is staged over it
 * @param unstaged how many carry a working-tree change or are untracked
 * @param path the worktree's absolute path, used only for the commit message
 * @returns the branch to push and the steps to run in the worktree, in order
 */
export function planSalvage({
  branch,
  headSha,
  path,
  staged,
  unstaged,
}: {
  branch: string | null;
  headSha: string | null;
  path: string;
  staged: number;
  unstaged: number;
}): SalvagePlan {
  if (headSha === null || branch === null) {
    return { branch: null, steps: [] };
  }
  const target = branch;
  const steps: SalvageStep[] = [
    { args: [...HOOKS_OFF, "branch", target, headSha], what: "create the salvage branch at the tree's own HEAD" },
    { args: [...HOOKS_OFF, "switch", target], what: "switch the worktree onto the salvage branch" },
  ];
  // `--no-verify` on both commits is belt to {@link HOOKS_OFF}'s braces: a salvage preserves the bytes that
  // are there, and a formatting hook rewriting a week-old tree on its way out would make the captured commit
  // differ from the work being captured, which is the one property this whole class is for.
  if (staged > 0) {
    steps.push({
      args: [...HOOKS_OFF, "commit", "--no-verify", "-m", salvageMessage({ path, which: "the staged index" })],
      what: "commit what was already staged, before anything is staged over it",
    });
  }
  if (unstaged > 0) {
    steps.push({ args: [...HOOKS_OFF, "add", "-A"], what: "stage every remaining change, tracked and untracked" });
    steps.push({
      args: [...HOOKS_OFF, "commit", "--no-verify", "-m", salvageMessage({ path, which: "the working tree" })],
      what: "commit the working tree",
    });
  }
  return { branch: target, steps };
}

/**
 * The commit message a salvage writes.
 *
 * It names WHICH half it carries, because a salvage can leave two commits and a reader landing on the branch
 * needs to know that the earlier one is a staged state rather than an older edit.
 *
 * @param path the worktree's absolute path, whose basename names the run
 * @param which the half being recorded, phrased to follow "captured"
 * @returns the message
 */
function salvageMessage({ path, which }: { path: string; which: string }): string {
  return (
    `salvage: ${basename(path)} (${which}) — captured by \`slopweaver worktree prune\` before its worktree ` +
    "was removed. Pull this branch into a fresh worktree to carry on."
  );
}

/**
 * How many entries a NUL-separated `git` listing holds — pure.
 *
 * **Counting NUL TERMINATORS rather than splitting on them is load-bearing, and so is not reading
 * porcelain.** The reader every caller here goes through (`readGit`, `src/admit/gitTransport.ts`)
 * ends in `.trim()`, and it has to: every other consumer of it wants a bare sha or branch name. That trim
 * eats leading whitespace from the FIRST entry of whatever it is handed — which is why this code no longer
 * parses `git status --porcelain` at all. Porcelain's two columns are position-significant, so a tree whose
 * first entry is a worktree-only edit arrives as `M file` instead of ` M file` and reads as a STAGED change:
 * the capture then plans a commit of an empty index, git exits 1, and the whole salvage declines. Reproduced
 * end to end against real git before this existed. A count of terminators is immune, because losing a
 * leading space from a path does not lose the path, and it survives a newline inside a filename for the
 * same reason `unwatchedPaths` does.
 *
 * @param listing a `-z` listing from `diff --name-only` or `ls-files --others`
 * @returns how many paths it names
 */
export function countNulEntries({ listing }: { listing: string }): number {
  let count = 0;
  for (const char of listing) {
    if (char === "\0") {
      count += 1;
    }
  }
  return count;
}

/**
 * Both halves of what a worktree is carrying, asked as three questions git answers in PATHS.
 *
 * The index side and the working-tree side are not interchangeable, and conflating them is what let a staged
 * version be overwritten: a file staged with one content and then edited to another appears in BOTH
 * `diff --cached` and `diff`, so it counts once on each side and the capture records both — the `MM` case,
 * which a review pass reproduced as real lost work. An untracked file is only ever the working tree's,
 * because the index has never seen it.
 *
 * @param deps the git edges
 * @param path the worktree to ask about
 * @returns how many paths carry an index change, and how many a working-tree change or are untracked
 */
function countTreeWork({ deps, path }: { deps: GithubPushEdges; path: string }): {
  staged: number;
  unstaged: number;
} {
  const read = ({ args }: { args: readonly string[] }): number =>
    countNulEntries({ listing: deps.readGit({ args: [...HOOKS_OFF, ...args], cwd: path }) });
  const staged = read({ args: ["diff", "--cached", "--name-only", "-z"] });
  const tracked = read({ args: ["diff", "--name-only", "-z"] });
  const untracked = read({ args: ["ls-files", "--others", "--exclude-standard", "-z"] });
  return { staged, unstaged: tracked + untracked };
}

/**
 * The first candidate name that exists neither locally nor on the remote.
 *
 * Both halves are load-bearing and the REMOTE half is the one a review pass had to find. `git branch` fails
 * on a name the local repository already has, so a local collision was always safe. A name free locally but
 * present on the remote was not: `git push <remote> <name>:<name>` fast-forwards the ref that is there, so
 * a salvage would have advanced somebody else's branch and the read-back would have called it a success.
 *
 * An unreadable remote answers `null` rather than "free". A probe that could not run has not shown the name
 * is unused, and this whole class exists to avoid writing over work nobody else has a copy of.
 *
 * @param deps the git edges
 * @param path the worktree's absolute path
 * @param headSha the commit the branch would be created at
 * @param remote the remote the push will go to
 * @returns a name nothing holds, or `null` when the probe failed or every candidate was taken
 */
function freeSalvageName({
  deps,
  headSha,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  headSha: string;
  path: string;
  remote: string;
}): string | null {
  for (let attempt = 0; attempt < SALVAGE_NAME_ATTEMPTS; attempt += 1) {
    const candidate = salvageBranchName({ attempt, headSha, path });
    let remoteRefs = "";
    try {
      remoteRefs = deps.readGit({ args: [...HOOKS_OFF, "ls-remote", "--heads", remote, candidate], cwd: path });
    } catch {
      return null;
    }
    if (remoteRefs.trim().length > 0) {
      continue;
    }
    if (localRefExists({ deps, path, ref: candidate })) {
      continue;
    }
    return candidate;
  }
  return null;
}

/**
 * Whether this repository already has a branch of that name.
 *
 * `git rev-parse --verify` exits non-zero for a ref that does not resolve, so a throw here means ABSENT and
 * cannot be told apart from git failing outright. That is acceptable ONLY because this probe is not the
 * safety: a wrong `false` is caught immediately afterwards by `git branch`, which refuses a name the
 * repository already has. The remote probe in {@link freeSalvageName} has no such backstop, which is why it
 * treats its own failure as a refusal instead.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param ref the branch name
 * @returns `true` when the name resolves here
 */
function localRefExists({ deps, path, ref }: { deps: GithubPushEdges; path: string; ref: string }): boolean {
  try {
    deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "--verify", "--quiet", `refs/heads/${ref}`], cwd: path });
    return true;
  } catch {
    return false;
  }
}

/**
 * The paths git has been told to stop looking at — pure.
 *
 * `git ls-files -v` prefixes each path with a status letter, and two of them mean "do not report changes
 * to this file": a LOWERCASE letter is `--assume-unchanged`, and `S` is `--skip-worktree`. Both make a
 * real edit invisible to `status --porcelain`, which is the only thing the capture measures.
 *
 * **The listing is the `-z` one, split on NUL, and that is load-bearing rather than tidy.** Git's default
 * `core.quotePath=true` renders any path outside printable ASCII as a C-quoted string — `é.txt` is emitted
 * as the eight literal characters `"\303\251.txt"` — and a name handed back to `update-index` in that
 * form does not match the index entry, so the bit never clears. A review pass reproduced the whole loss
 * through that one gap: a hidden `é.txt` stayed hidden, the capture measured a tree it could not see, the
 * push verified, and `worktree remove` deleted the only copy. `-z` turns quoting off by construction, and
 * it is the same reason it also survives a newline in a filename.
 *
 * @param listing the raw `ls-files -v -z` output, NUL-separated
 * @returns every path whose changes git would not report, in the order it listed them
 */
export function unwatchedPaths({ listing }: { listing: string }): readonly string[] {
  const out: string[] = [];
  for (const line of listing.split("\0")) {
    const letter = line.slice(0, 1);
    const path = line.slice(2);
    if (path === "") {
      continue;
    }
    const assumeUnchanged = letter >= "a" && letter <= "z";
    if (assumeUnchanged || letter === "S") {
      out.push(path);
    }
  }
  return out;
}

/**
 * The two "stop looking at this file" bits, cleared ONE COMMAND EACH.
 *
 * MEASURED against real git, and the reason this is a list rather than one argv. Passing both to a single
 * `update-index` clears `--assume-unchanged` and silently leaves `--skip-worktree` SET, exiting 0 — so the
 * capture read a tree it still could not see, pushed the file's OLD bytes, verified that push happily, and
 * the caller removed the worktree. Reproduce it:
 *
 * ```bash
 * d=$(mktemp -d) && git init -q "$d" && cd "$d" && printf 'BASE\n' > f.txt && git add -A &&
 *   git -c user.email=a@b.c -c user.name=t commit -qm base && git update-index --skip-worktree f.txt &&
 *   git update-index --no-assume-unchanged --no-skip-worktree -- f.txt; git ls-files -v   # still S
 * ```
 */
const UNHIDE_FLAGS: readonly string[] = ["--no-assume-unchanged", "--no-skip-worktree"];

/**
 * Clear every "stop looking at this file" bit, so the capture can SEE the whole tree.
 *
 * A review pass reproduced the loss this exists to stop: a tracked file marked `--assume-unchanged` and then
 * edited is reported by no `status --porcelain`, so the capture plans nothing for it, the push verifies, and
 * `git worktree remove` deletes the only copy of those bytes. The bit is a local index optimisation rather
 * than content, and the worktree is about to be deleted, so clearing it costs nothing and is what makes the
 * measurement honest. Cleared BEFORE the status read, for the obvious reason.
 *
 * **A failure to clear is fatal to the salvage, and that is the point.** An earlier draft swallowed it on the
 * argument that the visible work still gets captured — but the files whose bits did not clear are exactly the
 * ones whose edits `status --porcelain` will not report, so proceeding measures a tree this code knows it
 * cannot see and then deletes it. The doctrine `docs/worktree-prune/classes.md` already states for the scan governs
 * here too: a read that failed is not evidence the tree is clean. Keeping a tree costs a directory the owner
 * can prune again next pass; the other branch costs the work.
 *
 * A throw is not caught here either, for the same reason — `readTreeNow` turns it into the same decline.
 *
 * @param deps the git edges
 * @param path the worktree to clear them in
 * @returns every path whose bit would NOT clear, empty when the whole tree is visible
 */
function unhideTree({ deps, path }: { deps: GithubPushEdges; path: string }): readonly string[] {
  const readHidden = (): readonly string[] =>
    unwatchedPaths({ listing: deps.readGit({ args: [...HOOKS_OFF, "ls-files", "-v", "-z"], cwd: path }) });
  const hidden = readHidden();
  if (hidden.length === 0) {
    return [];
  }
  for (const flag of UNHIDE_FLAGS) {
    const cleared = deps.writeGit({ args: [...HOOKS_OFF, "update-index", flag, "--", ...hidden], cwd: path });
    if (!cleared.isOk()) {
      return hidden;
    }
  }
  // RE-READ rather than believe the exit status. A zero exit is what the combined-flag bug returned while
  // leaving the tree exactly as hidden as it found it, so the only trustworthy answer is git's own second
  // opinion: whatever is still listed here is still invisible, and the caller declines on it.
  return readHidden();
}

/**
 * What a worktree looks like RIGHT NOW, read at apply time rather than taken from the scan.
 *
 * A tree with a bit that would not clear is not measured AT ALL: the work counts are not even asked for and
 * `stillHidden` rides out alone, because a count taken over files git is still ignoring is a number that
 * reads exactly like a clean tree while being false, and the only safe thing to do with it is not to have it.
 *
 * @param deps the git edges
 * @param path the worktree to read
 * @returns the HEAD sha, both halves of the porcelain count and any path the read
 *   could not see, or `null`
 *   when git could not be asked at all
 */
function readTreeNow({ deps, path }: { deps: GithubPushEdges; path: string }): {
  readonly headSha: string;
  readonly staged: number;
  readonly stillHidden: readonly string[];
  readonly unstaged: number;
} | null {
  try {
    const stillHidden = unhideTree({ deps, path });
    if (stillHidden.length > 0) {
      return { headSha: "", staged: 0, stillHidden, unstaged: 0 };
    }
    const headSha = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "HEAD"], cwd: path }).trim();
    return { headSha, stillHidden, ...countTreeWork({ deps, path }) };
  } catch {
    return null;
  }
}

/**
 * Put one worktree's work on a remote branch, and confirm the remote has it.
 *
 * The tree is re-read HERE rather than trusted from the scan, for the reason `./pruneApply`'s header gives
 * about the `detached` class and which applies with more force to this one: the scan can be a whole
 * `--scan-budget` plus `--budget` old by the time a removal runs, and a salvage that captured the state
 * the scan saw would push a stale commit and then delete the newer one. Everything the plan needs is three
 * cheap reads, so there is no reason to carry the older answer.
 *
 * @param verdict the `salvaged` verdict being applied
 * @param remote the remote to push to
 * @param deps the git edges, shared with `github push` so the read-back is the same one
 * @param denylist the private denylist's load outcome: its strings are applied to a decline before it is printed,
 *   and an unreadable one declines before anything is captured
 * @param scan the secrets scan over what the push would send — `./salvageScan`'s — answering why not, or `null`
 * @param home the state home whose push-root register the salvage push is judged against
 * @returns the branch the work is on, or why the tree must be kept
 */
export function runSalvage({
  deps,
  denylist,
  home,
  scan,
  remote,
  verdict,
}: {
  deps: GithubPushEdges;
  denylist: LineListLoad;
  home: string;
  scan: SalvageScan;
  remote: string;
  verdict: PruneVerdict;
}): SalvageOutcome {
  // Without the denylist no decline can be checked before it is printed, so nothing is captured.
  if (denylist.kind === "unreadable") {
    return {
      branch: null,
      declined: withheldIfSecret({
        denylist: [],
        text: `the private denylist at ${denylist.path} could not be read (${denylist.reason}), so nothing a salvage prints or pushes could be checked — nothing was captured`,
      }),
    };
  }
  const outcome = salvageOnce({ deps, home, remote, scan, verdict });
  if (outcome.declined === null) {
    return outcome;
  }
  const words = denylist.kind === "loaded" ? denylist.lines : [];
  return { ...outcome, declined: withheldIfSecret({ denylist: words, text: outcome.declined }) };
}

/**
 * {@link runSalvage}'s body, before its decline is made printable.
 *
 * @param deps the git edges
 * @param scan the secrets scan
 * @param remote the remote to push to
 * @param verdict the `salvaged` verdict being applied
 * @param home the state home whose push-root register the salvage push is judged against
 * @returns the branch the work is on, or why the tree must be kept
 */
function salvageOnce({
  deps,
  home,
  scan,
  remote,
  verdict,
}: {
  deps: GithubPushEdges;
  home: string;
  scan: SalvageScan;
  remote: string;
  verdict: PruneVerdict;
}): SalvageOutcome {
  const now = readTreeNow({ deps, path: verdict.path });
  if (now === null) {
    return { branch: null, declined: "its working tree could not be read at apply time, so nothing was captured" };
  }
  if (now.stillHidden.length > 0) {
    return {
      branch: null,
      declined: `git would not stop ignoring ${now.stillHidden.length} file(s) — ${now.stillHidden.join(", ")} — so an edit to one of them would not be reported, captured, or recoverable`,
    };
  }
  // An IGNORED file is not asked about here: one no build writes again already holds the tree at classify
  // time (owner), and `changedSinceScan` rechecks it, so what reaches a salvage is build output.
  if (now.headSha === "") {
    return { branch: null, declined: "its HEAD sha could not be read, so there is nothing to push" };
  }
  const unrelated = unrelatedHistoryDecline({ deps, headSha: now.headSha, path: verdict.path, remote });
  if (unrelated !== null) {
    return { branch: null, declined: unrelated };
  }
  const free = freeSalvageName({ deps, headSha: now.headSha, path: verdict.path, remote });
  if (free === null) {
    return {
      branch: null,
      declined: `every candidate branch name up to ${SALVAGE_NAME_ATTEMPTS} was already taken locally or on ${remote}`,
    };
  }
  const plan = planSalvage({
    branch: free,
    headSha: now.headSha,
    path: verdict.path,
    staged: now.staged,
    unstaged: now.unstaged,
  });
  const target = plan.branch;
  if (target === null) {
    return { branch: null, declined: "its HEAD sha could not be read, so there is nothing to push" };
  }
  for (const step of plan.steps) {
    const ran = deps.writeGit({ args: step.args, cwd: verdict.path });
    if (!ran.isOk()) {
      return { branch: null, declined: `could not ${step.what} — ${ran.error}` };
    }
  }
  return confirmOnRemote({ deps, home, path: verdict.path, remote, scan, target });
}
