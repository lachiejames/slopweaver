/**
 * Which other branch names a branch CONTINUES, read from git's own reflogs. Pure.
 *
 * Every pass record and fallback receipt names the branch it was taken on, and every reader that judges a branch
 * (`ledgerForBranch`, `./ledger.ts`, and the filters beside it) matches that name exactly. So a branch that took
 * its plan and reviews under one name and opened its pull request under another — `git checkout -b <new>` from the
 * old branch, or `git branch -m <old> <new>` — reads as a branch nothing ever ran on, and the landing floor can only
 * be acknowledged past. This module says which recorded names are the SAME line of work as the branch being judged,
 * so `./branchContinuityView.ts` can show the readers that evidence under the name they ask about.
 *
 * ## What counts as a continuation, and nothing else does
 *
 * - **A rename**: the new branch's own reflog carries `Branch: renamed refs/heads/<old> to refs/heads/<new>`. A
 *   rename moves the ref for every checkout of the repository, so it applies in all of them.
 * - **A branch cut from the checked-out one**: the new branch's reflog opens `branch: Created from HEAD`, and one
 *   checkout's HEAD reflog says `checkout: moving from <old> to <new>` at the SAME commit and the same second. That
 *   applies only in the checkout whose HEAD moved, because only there was `<old>` the work being carried on. When
 *   more than one checkout's HEAD moved onto it in that second, none is a cut.
 *
 * An ordinary checkout of a branch that already existed is neither, and a branch created from any start point but
 * HEAD is neither. A branch a remote marks as its default is never a predecessor: work cut from the shared base is
 * new work, and a pass taken there for other work must not stand as the new branch's plan. Each continuation is
 * followed transitively.
 *
 * ## Every link is proven, or nothing is carried
 *
 * A record counts for a branch it was not made on only through one of the two links above, and only when it was
 * made BEFORE the link and AFTER the predecessor's previous continuation. The upper bound is what stops work done
 * on a later, re-created branch of the old name from feeding the new one. The lower bound is what stops two
 * branches cut from one sharing its evidence: the earlier cut takes the evidence before it, the later cut takes
 * only what came after the earlier one, and two cuts inside one second, which the reflog cannot order, take nothing.
 * A repository whose remotes name no default branch carries nothing at all. An expired or absent reflog, a checkout git no longer lists and a clone at
 * another path all prove nothing, so their evidence stays on the name it was recorded under — which is exactly
 * what every reader did before this module existed.
 */

import { err, ok, type Result } from "#lib/result.js";

/** `git reflog show --all --date=unix` with this format prints the selector, the commit and the subject, NUL-separated. */
export const REFLOG_FORMAT = "%gD%x00%H%x00%gs";

/** Why the reflog could not be read into continuations. */
export interface BranchContinuityError {
  readonly code: "REFLOG_LINE_UNREADABLE" | "REFLOG_UNREADABLE" | "REMOTES_UNREADABLE" | "WORKTREES_UNREADABLE";
  readonly message: string;
}

/** The factories every {@link BranchContinuityError} is built through. */
export const BranchContinuityErrors = {
  reflogLineUnreadable: ({ line }: { line: string }): BranchContinuityError => ({
    code: "REFLOG_LINE_UNREADABLE",
    message: `a reflog line is not <selector>@{<epoch>} NUL <commit> NUL <subject>: ${JSON.stringify(line)}`,
  }),
  reflogUnreadable: ({ cause }: { cause: string }): BranchContinuityError => ({
    code: "REFLOG_UNREADABLE",
    message: `the repository's reflogs could not be read: ${cause}`,
  }),
  remotesUnreadable: ({ cause }: { cause: string }): BranchContinuityError => ({
    code: "REMOTES_UNREADABLE",
    message: `the repository's remote default branches could not be read: ${cause}`,
  }),
  worktreesUnreadable: ({ cause }: { cause: string }): BranchContinuityError => ({
    code: "WORKTREES_UNREADABLE",
    message: `the repository's worktree records could not be read: ${cause}`,
  }),
} as const;

/**
 * One reflog entry.
 *
 * @internal the element {@link parseReflog} returns, which every caller reads without naming it.
 */
export interface ReflogEntry {
  /** The reflog it belongs to, without its `@{…}`: `refs/heads/<name>`, `HEAD`, `worktrees/<id>/HEAD`, … */
  readonly selector: string;
  readonly epochSeconds: number;
  readonly sha: string;
  readonly subject: string;
}

/**
 * One proven continuation: `to` carries on the work recorded under `from`.
 *
 * @internal the element {@link branchContinuations} returns, which every caller reads without naming it.
 */
export interface BranchContinuation {
  readonly from: string;
  readonly to: string;
  readonly epochSeconds: number;
  /** The checkout it happened in, or `undefined` for a rename, which applies in every checkout. */
  readonly root: string | undefined;
}

/** Evidence recorded under `branch`, in `root`, inside the window, counts for the branch being judged. */
export interface CarryWindow {
  readonly branch: string;
  /** `undefined` means every checkout of the repository. */
  readonly root: string | undefined;
  /** Exclusive: the predecessor's previous continuation, or `undefined` when it had none. */
  readonly afterEpochSeconds: number | undefined;
  /** Inclusive: the moment of the continuation. */
  readonly throughEpochSeconds: number;
}

/** Everything a reader needs to show evidence recorded under a predecessor's name as the judged branch's. */
export interface BranchContinuity {
  readonly target: string;
  /** Every checkout of the repository git lists, the scope a rename's window covers. */
  readonly roots: ReadonlySet<string>;
  readonly windows: readonly CarryWindow[];
}

const SELECTOR = /^(.+)@\{(\d+)\}$/u;
const BRANCH_REF = "refs/heads/";
const CREATED_FROM_HEAD = "branch: Created from HEAD";
const RENAMED_PREFIX = "Branch: renamed refs/heads/";
const MOVED_PREFIX = "checkout: moving from ";
const REMOTE_HEAD = "/HEAD";

/** `git for-each-ref refs/remotes` with this format prints each ref and, for a symbolic one, what it points at. */
export const REMOTE_HEADS_FORMAT = "%(refname)%00%(symref)";

/**
 * Parse `git reflog show --all --date=unix --format=` {@link REFLOG_FORMAT} output.
 *
 * @param text the command's whole stdout
 * @returns every entry, or the first line that does not have the format's shape
 */
export function parseReflog({ text }: { text: string }): Result<readonly ReflogEntry[], BranchContinuityError> {
  const entries: ReflogEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [selectorText, sha, subject, ...rest] = line.split("\u0000");
    const selector = SELECTOR.exec(selectorText!);
    if (selector === null || sha === undefined || subject === undefined || rest.length > 0) {
      return err(BranchContinuityErrors.reflogLineUnreadable({ line }));
    }
    entries.push({ epochSeconds: Number(selector[2]), selector: selector[1]!, sha, subject });
  }
  return ok(entries);
}

/**
 * The text between a known prefix and a known suffix, when the subject is exactly that shape.
 *
 * @param subject the reflog subject
 * @param prefix what it must open with
 * @param suffix what it must end with
 * @returns the non-empty middle, or `undefined`
 */
function between({ subject, prefix, suffix }: { subject: string; prefix: string; suffix: string }): string | undefined {
  const fits = subject.length > prefix.length + suffix.length && subject.startsWith(prefix) && subject.endsWith(suffix);
  return fits ? subject.slice(prefix.length, subject.length - suffix.length) : undefined;
}

/**
 * The continuations one branch's own reflog entry proves.
 *
 * @param entry an entry of `refs/heads/<to>`
 * @param to the branch the entry belongs to
 * @param moves every HEAD entry of a known checkout that records a checkout move
 * @param rootOfHead which checkout each HEAD reflog selector belongs to
 * @returns the rename or the cut it proves, if any
 */
function continuationsFrom({
  entry,
  to,
  moves,
  rootOfHead,
}: {
  entry: ReflogEntry;
  to: string;
  moves: readonly ReflogEntry[];
  rootOfHead: ReadonlyMap<string, string>;
}): readonly BranchContinuation[] {
  const renamedFrom = between({ prefix: RENAMED_PREFIX, subject: entry.subject, suffix: ` to ${BRANCH_REF}${to}` });
  if (renamedFrom !== undefined) {
    return [{ epochSeconds: entry.epochSeconds, from: renamedFrom, root: undefined, to }];
  }
  if (entry.subject !== CREATED_FROM_HEAD) {
    return [];
  }
  const cuts = moves
    .filter((move) => move.sha === entry.sha && move.epochSeconds === entry.epochSeconds)
    .flatMap((move) => {
      const from = between({ prefix: MOVED_PREFIX, subject: move.subject, suffix: ` to ${to}` });
      return from === undefined
        ? []
        : [{ epochSeconds: entry.epochSeconds, from, root: rootOfHead.get(move.selector), to }];
    });
  // The creation entry does not say which checkout made the branch, so when more than one HEAD moved onto it in
  // that second at that commit, none can be shown to be the cut: none is.
  return cuts.length === 1 ? cuts : [];
}

/**
 * Every continuation the reflogs prove.
 *
 * @param entries every reflog entry
 * @param rootOfHead which checkout each HEAD reflog selector belongs to; a HEAD reflog missing from it proves nothing
 * @returns the continuations, in reflog order
 */
export function branchContinuations({
  entries,
  rootOfHead,
}: {
  entries: readonly ReflogEntry[];
  rootOfHead: ReadonlyMap<string, string>;
}): readonly BranchContinuation[] {
  const moves = entries.filter((entry) => rootOfHead.has(entry.selector) && entry.subject.startsWith(MOVED_PREFIX));
  return entries
    .filter((entry) => entry.selector.startsWith(BRANCH_REF))
    .flatMap((entry) => continuationsFrom({ entry, moves, rootOfHead, to: entry.selector.slice(BRANCH_REF.length) }));
}

/**
 * Whether two scopes overlap: `undefined` is every checkout, a path is one.
 *
 * @param left one scope
 * @param right the other
 * @returns true when some checkout is in both
 */
function overlaps({ left, right }: { left: string | undefined; right: string | undefined }): boolean {
  return left === undefined || right === undefined || left === right;
}

/**
 * The narrower of two overlapping scopes.
 *
 * @param left one scope
 * @param right the other
 * @returns the path when either names one, else every checkout
 */
function narrower({ left, right }: { left: string | undefined; right: string | undefined }): string | undefined {
  if (left !== undefined) {
    return left;
  }
  return right;
}

/**
 * When `branch` last continued into something else before `beforeEpochSeconds`, in a scope overlapping `root`.
 *
 * Any overlapping continuation counts, which only ever narrows a window: the safe direction.
 *
 * @param continuations every proven continuation
 * @param branch the predecessor
 * @param root the window's scope
 * @param beforeEpochSeconds the continuation the window ends at
 * @returns the latest earlier continuation's instant, or `undefined` when there was none
 */
function previousContinuation({
  continuations,
  branch,
  root,
  beforeEpochSeconds,
}: {
  continuations: readonly BranchContinuation[];
  branch: string;
  root: string | undefined;
  beforeEpochSeconds: number;
}): number | undefined {
  const earlier = continuations
    .filter((one) => one.from === branch && one.epochSeconds < beforeEpochSeconds)
    .filter((one) => overlaps({ left: one.root, right: root }))
    .map((one) => one.epochSeconds);
  return earlier.length === 0 ? undefined : Math.max(...earlier);
}

/**
 * Whether another continuation left the same predecessor in the same second, in an overlapping scope.
 *
 * The reflog's grain is one second, so two branches cut from one inside a second cannot be ordered, and neither can
 * be shown to own the evidence before them. Neither link carries anything: the safe direction.
 *
 * @param continuations every proven continuation
 * @param link the continuation being followed
 * @returns true when the link cannot be told apart from a sibling
 */
function ambiguous({
  continuations,
  link,
}: {
  continuations: readonly BranchContinuation[];
  link: BranchContinuation;
}): boolean {
  return continuations.some(
    (one) =>
      one.from === link.from &&
      one.to !== link.to &&
      one.epochSeconds === link.epochSeconds &&
      overlaps({ left: one.root, right: link.root }),
  );
}

/**
 * Parse `git for-each-ref --format=` {@link REMOTE_HEADS_FORMAT} `refs/remotes` output into the branch names the
 * remotes mark as their default.
 *
 * @param text the command's whole stdout
 * @returns every name a remote HEAD's target could be a branch of, whichever namespace it points into
 */
export function defaultBranches({ text }: { text: string }): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const [refname, symref] = line.split("\u0000");
    if (refname === undefined || symref === undefined || !refname.endsWith(REMOTE_HEAD)) {
      continue;
    }
    // `refs/<namespace>/<a>/<b>` could name branch `<a>/<b>` or `<b>`, and a HEAD may point into ANOTHER remote's
    // namespace, so every trailing run of segments is taken as a default: excluding too much is the safe direction.
    const segments = symref.split("/").slice(2);
    for (let start = 0; start < segments.length; start += 1) {
      names.add(segments.slice(start).join("/"));
    }
  }
  names.delete("");
  return names;
}

/** One branch whose predecessors are still to be found, within a scope and up to an instant. */
interface Pending {
  readonly branch: string;
  readonly root: string | undefined;
  readonly throughEpochSeconds: number;
}

/**
 * The links that may carry evidence into one pending branch.
 *
 * @param continuations every proven continuation
 * @param into the branch whose predecessors are being found
 * @param target the branch being judged, never its own predecessor
 * @param bases the repository's default branches, never a predecessor
 * @returns the continuations to follow
 */
function linksInto({
  continuations,
  into,
  target,
  bases,
}: {
  continuations: readonly BranchContinuation[];
  into: Pending;
  target: string;
  bases: ReadonlySet<string>;
}): readonly BranchContinuation[] {
  return continuations.filter(
    (one) =>
      one.to === into.branch &&
      one.from !== target &&
      !bases.has(one.from) &&
      one.epochSeconds <= into.throughEpochSeconds &&
      overlaps({ left: one.root, right: into.root }) &&
      !ambiguous({ continuations, link: one }),
  );
}

/**
 * Every window of evidence that counts for `target`, followed transitively through its predecessors.
 *
 * A default branch is never a predecessor. A branch cut from it is new work on the shared base, and a pass taken on
 * the base, for other work, would otherwise stand as the new branch's plan. With no default branch known, no link
 * can be shown not to start on one, so nothing is carried at all.
 *
 * @param target the branch being judged; its own evidence needs no window and never gets one
 * @param continuations every proven continuation
 * @param bases the repository's default branches ({@link defaultBranches})
 * @returns the windows, one per predecessor link
 */
export function carryWindows({
  target,
  continuations,
  bases,
}: {
  target: string;
  continuations: readonly BranchContinuation[];
  bases: ReadonlySet<string>;
}): readonly CarryWindow[] {
  const windows: CarryWindow[] = [];
  if (bases.size === 0) {
    return windows;
  }
  const seen = new Set<string>();
  const pending: Pending[] = [{ branch: target, root: undefined, throughEpochSeconds: Number.POSITIVE_INFINITY }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const into = next;
    for (const link of linksInto({ bases, continuations, into, target })) {
      const root = narrower({ left: link.root, right: into.root });
      const key = [link.from, String(root), String(link.epochSeconds)].join("\u0000");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const afterEpochSeconds = previousContinuation({
        beforeEpochSeconds: link.epochSeconds,
        branch: link.from,
        continuations,
        root,
      });
      windows.push({ afterEpochSeconds, branch: link.from, root, throughEpochSeconds: link.epochSeconds });
      pending.push({ branch: link.from, root, throughEpochSeconds: link.epochSeconds });
    }
  }
  return windows;
}
