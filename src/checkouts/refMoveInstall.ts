/**
 * Whether a REF MOVE — a `git checkout` of another branch, or a `git merge` — has made this checkout's
 * `node_modules` wrong, and what to say about it. The pure half of `./refMoveInstallCli.ts`, which
 * `lefthook.yml` wires to git's own `post-checkout` and `post-merge` hooks.
 *
 * ## Why the trigger is a CONTENT diff and never the freshness verdict
 *
 * `./freshness.ts`'s `installFreshness` compares mtimes, and a ref move rewrites `package.json`'s mtime
 * whether or not its CONTENT changed. A hook keyed on that verdict would therefore install on every ref
 * move, forever. MEASURED on the main checkout, and it is worse than redundant work — reproduce
 * both halves:
 *
 * ```bash
 * SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE=1 touch yarn.lock package.json   # verdict becomes STALE
 * SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE=1 yarn install --immutable       # "Done", and the verdict is STILL STALE
 * ```
 *
 * Neither `node_modules/.yarn-state.yml` nor `node_modules/.slopweaver-install-verified` moved across that
 * install, because yarn writes nothing when an install changes nothing. So the verdict cannot be the
 * trigger; `dependencyPathsAmong` over the move's own diff can, and it already knows about `.yarn/patches/`
 * and nested workspace manifests.
 *
 * ## What git actually hands these two hooks — all measured, lefthook 2.1.12
 *
 * - `post-checkout` takes three arguments: the previous HEAD, the new HEAD, and `1` for a branch checkout or
 *   `0` for a file checkout. `git checkout -- <file>` passes the all-zero oid for BOTH shas and `0`;
 *   `git checkout -b <new>` passes the same sha twice; `git worktree add` passes the all-zero oid as the
 *   previous HEAD, with the new worktree as the working directory.
 * - `post-merge` takes ONE argument, a squash flag — not a ref. The pre-merge commit is `ORIG_HEAD`, and on
 *   a SQUASH merge `ORIG_HEAD` and `HEAD` are the same commit, because a squash leaves its result in the
 *   INDEX without committing. A post-merge that always diffs `ORIG_HEAD..HEAD` therefore does nothing at all
 *   on every squash merge, which is why {@link RefMoveComparison} has two arms.
 *
 * `git bisect` and `git stash` fire neither hook. `git rebase` fires `post-checkout` exactly ONCE, against
 * the intermediate commit it is about to replay onto — which is why `lefthook.yml` puts `skip: rebase` on
 * that block rather than this module trying to reason about it.
 *
 * Pure: no filesystem, no git, no subprocess.
 */
import { dependencyPathsAmong, INSTALL_FIX_COMMAND } from "./freshness.js";

/** The object id git passes where there is no commit — a file checkout, or a brand-new worktree. */
export const NULL_OID = "0000000000000000000000000000000000000000";

/** Which of the two git hooks is asking. Carried through so every printed line names its own hook. */
export type RefMoveHook = "post-checkout" | "post-merge";

/** The `{3}` value git passes `post-checkout` for a branch checkout, as opposed to `0` for a file checkout. */
const BRANCH_CHECKOUT_FLAG = "1";

/** The `{1}` value git passes `post-merge` when the merge was a squash, whose result sits in the index. */
const SQUASH_MERGE_FLAG = "1";

/** What has to be diffed to see what a ref move brought in. */
export type RefMoveComparison =
  /** Two commits — the ordinary case, `git diff --name-only <from> <to>`. */
  | { readonly against: "commits"; readonly from: string; readonly to: string }
  /** One commit against the INDEX — a squash merge, whose result was never committed. */
  | { readonly against: "index"; readonly from: string };

/** Either what to diff, or the reason there is nothing here to do. */
export type RefMovePlan =
  { readonly act: "skip"; readonly why: string } | { readonly act: "compare"; readonly comparison: RefMoveComparison };

/**
 * What a `post-checkout` invocation should diff, from the three arguments git passed it.
 *
 * @param previousRef git's first argument — the HEAD before the checkout
 * @param newRef git's second argument — the HEAD after it
 * @param branchFlag git's third argument — `1` for a branch checkout, `0` for a file checkout
 * @returns the comparison to take, or the skip and its reason
 */
export function postCheckoutPlan({
  previousRef,
  newRef,
  branchFlag,
}: {
  previousRef: string | undefined;
  newRef: string | undefined;
  branchFlag: string | undefined;
}): RefMovePlan {
  if (previousRef === undefined || newRef === undefined || branchFlag === undefined) {
    return { act: "skip", why: "git passed fewer than three arguments, so the move cannot be identified" };
  }
  if (branchFlag !== BRANCH_CHECKOUT_FLAG) {
    return { act: "skip", why: "a file checkout, which moves no ref" };
  }
  if (previousRef === NULL_OID || newRef === NULL_OID) {
    return {
      act: "skip",
      why: "there is no previous commit to compare against — a new worktree installs through `cmux spawn`",
    };
  }
  if (previousRef === newRef) {
    return { act: "skip", why: "the ref did not move" };
  }
  return { act: "compare", comparison: { against: "commits", from: previousRef, to: newRef } };
}

/**
 * What a `post-merge` invocation should diff, from git's squash flag and the two refs a merge leaves behind.
 *
 * A squash merge is the arm that is easy to lose: it fires this hook, it leaves `ORIG_HEAD` and `HEAD` on
 * the same commit, and its whole result is staged rather than committed. The INDEX is compared rather than
 * the working tree deliberately — unrelated unstaged edits to `package.json` would otherwise trigger an
 * `--immutable` install that fails, reddening a merge that had nothing to do with them.
 *
 * @param squashFlag git's only argument — `1` when the merge was a squash
 * @param origHead the pre-merge commit, or undefined when `ORIG_HEAD` could not be read
 * @param head the commit HEAD points at now, or undefined when it could not be read
 * @returns the comparison to take, or the skip and its reason
 */
export function postMergePlan({
  squashFlag,
  origHead,
  head,
}: {
  squashFlag: string | undefined;
  origHead: string | undefined;
  head: string | undefined;
}): RefMovePlan {
  if (origHead === undefined) {
    return { act: "skip", why: "ORIG_HEAD is unreadable, so what the merge brought in cannot be diffed" };
  }
  if (squashFlag === SQUASH_MERGE_FLAG) {
    return { act: "compare", comparison: { against: "index", from: origHead } };
  }
  if (head === undefined) {
    return { act: "skip", why: "HEAD is unreadable, so what the merge brought in cannot be diffed" };
  }
  return { act: "compare", comparison: { against: "commits", from: origHead, to: head } };
}

/** Whether a ref move requires an install, and the sentence that says why either way. */
export interface RefMoveInstallDecision {
  readonly install: boolean;
  readonly why: string;
}

/**
 * Decide whether the paths a ref move changed mean `node_modules` no longer matches the lockfile.
 *
 * @param changedPaths the repo-relative paths the move brought in
 * @returns whether to install, and why
 */
export function refMoveInstallDecision({ changedPaths }: { changedPaths: readonly string[] }): RefMoveInstallDecision {
  const dependencyPaths = dependencyPathsAmong({ changedPaths });
  if (dependencyPaths.length === 0) {
    return {
      install: false,
      why: `the move changed ${String(changedPaths.length)} file(s), none of them dependency-defining`,
    };
  }
  return { install: true, why: `the move changed ${dependencyPaths.join(", ")}` };
}

/** What one hook invocation ended up doing, ready to render as its single line. */
export type RefMoveOutcome =
  /** Nothing to look at: not a ref move, or nothing this hook owns. */
  | { readonly did: "skipped"; readonly why: string }
  /** Looked, and the tree already matches: no install was needed. */
  | { readonly did: "current"; readonly why: string }
  /** Installed, and the tree is now correct. */
  | { readonly did: "installed"; readonly why: string; readonly detail: string }
  /** Tried and failed — the tree is NOT correct and a human has to look. */
  | { readonly did: "failed"; readonly why: string; readonly detail: string };

/** Every run of whitespace containing a line break, which is the only thing that can split one line in two. */
const LINE_BREAK_RUN = /\s*[\r\n]+\s*/gu;

/**
 * Flatten anything that reached the renderer into a single line.
 *
 * The `detail` on a failed outcome is text something else authored — a thrown `Error`'s message, which
 * `execFileSync` builds as `Command failed: …\n` plus the child's stderr, or a filesystem error from the
 * exec-inode walk. One embedded newline turns the hook's single honest line into two, which is exactly the
 * unreadable shape the one-line rule exists to prevent, so the collapse happens HERE rather than at each
 * site that produces a detail: a site added later cannot forget a rule the one renderer enforces.
 */
function oneLine({ text }: { text: string }): string {
  return text.trim().replace(LINE_BREAK_RUN, " · ");
}

/**
 * Render one hook invocation as the ONE line it always prints.
 *
 * A hook nobody can see is a hook nobody trusts, so every path through this feature ends here — including
 * both kinds of doing nothing, which are rendered differently because "I did not look" and "I looked and it
 * was fine" are not the same claim.
 *
 * @param hook which git hook is reporting
 * @param outcome what it did
 * @returns the line to print, guaranteed to carry no line break
 */
export function renderRefMoveOutcome({ hook, outcome }: { hook: RefMoveHook; outcome: RefMoveOutcome }): string {
  if (outcome.did === "skipped") {
    return oneLine({ text: `${hook}: node_modules not checked — ${outcome.why}` });
  }
  if (outcome.did === "current") {
    return oneLine({ text: `${hook}: node_modules current — ${outcome.why}` });
  }
  if (outcome.did === "installed") {
    return oneLine({ text: `${hook}: ran \`${INSTALL_FIX_COMMAND}\` — ${outcome.why}; ${outcome.detail}` });
  }
  return oneLine({ text: `${hook}: \`${INSTALL_FIX_COMMAND}\` FAILED — ${outcome.why}; ${outcome.detail}` });
}
