/**
 * Deciding what may be deleted — the pure half of `slopweaver worktree prune`.
 *
 * Every safety rule the owner set lives HERE, as one ordered list of hold conditions over a
 * fact record a caller gathered. Nothing in this file touches git, the filesystem or the clock, so each rule
 * is provable against a literal fixture rather than against a real checkout that has to be staged first.
 *
 * The ordering is the contract, not an implementation detail: a hold wins over every safe class, and the
 * FIRST hold reason is the one a reader sees, so the list runs most-alarming first. A worktree with
 * uncommitted work and a live session reports the live session, because that is the one a human acts on.
 *
 * The classes are deliberately three-plus-one rather than two. `merged` is clean, unreferenced, cold and
 * absorbed into the trunk, so both its tree and its branch go. `pushed` is clean, unreferenced and cold but
 * NOT absorbed, so its tree is recreatable while its branch is not disposable: the tree goes and the branch
 * stays. `gone` is a registration git is still carrying for a directory that no longer exists — it frees no
 * disk at all, and saying so is the point.
 *
 * ## Why `pushed` is applied unattended
 *
 * Gating it behind `--include-pushed`, on the reading that work not in the trunk needs a human, costs the
 * whole mechanism. Measured over the recipe's own first week of that gate, the daily slot removed only
 * `merged` and `interrupted`, so every cold, clean, fully-backed tree accumulated, and free space on this
 * machine fell by roughly 200 GB while six consecutive slots all reported `completed`. The owner's rule,
 * stated in their own terms, is the one this file implements — remove a worktree
 * untouched for over 24 hours that is not a live session's cwd and carries no uncommitted or unpushed work.
 * A `pushed` tree satisfies every clause of it: its commits are on a remote, so nothing here is unbacked.
 * Deleting its BRANCH would not, which is why the branch is kept and only the recreatable tree goes.
 *
 * ## The three widenings, and the witness each one rests on
 *
 * 80 of acme-admin's 90 worktrees were HELD and the run removed none of them. MEASURED
 * by `slopweaver worktree prune --repo ~/dev/acme-admin --json`, the 80 holds break down as
 * 24 detached HEADs, 27 branches with commits on no remote, 12 dirty trees, 12 touched under 24 h, 2
 * interrupted removals whose work is not in the trunk, 2 live-referenced, and the main checkout. Three
 * classes were added against that histogram. **Every one is a class with a witness**, and each holds exactly
 * as before when its witness is absent or unreadable.
 *
 * Read the next section before quoting that as the file's whole doctrine. Those three widenings left the
 * 24-hour rule untouched and turned on nothing but evidence; the fourth, below, is an AGE cut, and it is
 * the owner's own.
 *
 * **`detached` — a detached HEAD a remote still carries.** Held before by "no branch can be checked for
 * merge", which is true and beside the point: the question a removal asks is whether the TREE can be
 * recreated, and `git worktree add --detach <sha>` recreates it from any commit that survives. The
 * witness is a named remote-tracking ref CONTAINING that commit, not merely a `rev-list` count, because
 * the two differ in exactly the case that matters — a commit reachable only from a remote branch GitHub
 * is about to delete. The verdict prints the sha and the ref, so the plan line IS the recreation command.
 *
 * The second of those, an `unpushed` class that bundled a clean branch's local commits and removed its tree,
 * does not exist, by the rule below: unpushed commits hold the tree.
 *
 * **A CLOSED board row is cold whatever the directory's mtime.** This one changes no class at all: it
 * disarms the `touched <n>h ago` rule and nothing else, because a run the board says is finished is done
 * being worked on, whoever touched the directory since. It is deliberately the narrowest of the three and
 * reaches at most the 12 rows above; the aliasing it could cause — a directory basename colliding with an
 * unrelated closed run's slug — is refused in `./pruneScan` by requiring the journal's own branch to match
 * the branch checked out here.
 *
 * ## The fourth widening — an AGE cut, and the only one that is not a witness
 *
 * The owner's ruling, on a page that put 109 held worktrees in front of them, 71 of them holding the only copy
 * of some work: a worktree untouched for over a week is safe to delete, because worktrees are regenerable and
 * the work is tracked on boards and spawned via the supervisor, and the repository ships about 30 pull requests a
 * day. Anything older than a week goes, and changes
 * can be pushed to a remote branch with the board row updated to say they can be pulled down into a fresh
 * worktree.
 *
 * So past `--nuke-after` (default 7d) a hold is RELEASED rather than reported — but only a hold whose whole
 * content is "this tree carries work that exists nowhere else", and only into the `salvaged` class, whose
 * application pushes that work to a remote branch and REFUSES the removal unless the remote confirms it
 * (`./pruneSalvage`, `./pruneApply`). The push is the condition on the release, not a suggestion
 * beside it.
 *
 * **Some rules are waivable and the rest are not**, and the split is per-rule rather than an age test
 * wrapped around the loop, for one reason worth stating: a fact the scan could not READ has not been shown
 * to be over a week old either. The rule is expressed entirely in "since touched", so it cannot reach a tree
 * with no readable timestamp, no readable working tree, no readable merge state. Those four `null` rules,
 * the live-session rule and the main checkout stay absolute at any age.
 *
 * The coldness rule needs no change at all and did not get one: anything past a week is past 24 hours by
 * construction, so it cannot fire on a tree this waiver reaches. Marking it waivable would put the 24-hour
 * rule at risk in exchange for nothing.
 *
 * ## A tree is held only for uncommitted or unpushed work
 *
 * A worktree lying around for parked work, untouched for a few days, is not earning its keep: branches are
 * already pushed to a remote, and nothing in a worktree needs keeping unless it is uncommitted or unpushed.
 * A seat once removed two acme-admin trees by hand after this verb kept them. A clean tree on its own pushed branch
 * goes once it is past the two-hour activity floor (`./pruneColdness.ts`). What still kept a tree with nothing
 * uncommitted or unpushed in it was a gutted checkout whose squash-landed commit no patch id matches in
 * the trunk: {@link headOnOwnRemote} is the second witness that finishes one, its branch KEPT. Every `null`
 * rule, the live reference and the main checkout stand as they were.
 *
 * ## Nothing committed nowhere is destroyed
 *
 * Untracked files, ignored files that are not reproducible build output, stashes tied to the tree and unpushed
 * commits each hold it (`./pruneContext` reads the middle two). An unpushed commit is waivable past the week,
 * because the salvage pushes it to a remote branch before anything is removed. An ignored file and a stash are
 * not, because the salvage carries neither, so they hold at any age.
 */

import { absentAsNumber } from "#lib/absent.js";

import type { LapTreeFacts } from "./lapTreeProvenance.js";
import { coldnessHold, coldnessWindowMs, renderAge } from "./pruneColdness.js";
import { type LapVerdictEvidence, lapDecision } from "./pruneLapClass.js";
import { snapshotDecision } from "./pruneSnapshotClass.js";
import { headOnOwnRemote, recreatableDetached } from "./pruneWitness.js";

/** The classes `--apply` removes a tree under; `gone` and `hold` are the two whose tree it never removes. */
type RemovingClass = "detached" | "interrupted" | "lap" | "merged" | "pushed" | "salvaged" | "snapshot";

/** What may happen to one worktree. */
export type PruneClass = RemovingClass | "gone" | "hold";

/** Everything the classifier needs about one worktree, gathered by the effectful scan. */
export interface WorktreeFacts {
  /** Absolute path git has registered. */
  readonly path: string;
  /** The branch checked out there, or `null` for a detached HEAD. */
  readonly branch: string | null;
  /** Whether this entry is the repository's own main checkout — never a prune candidate. */
  readonly isMainCheckout: boolean;
  /** Whether the registered directory is absent from disk. */
  readonly missing: boolean;
  /** Newest of the branch's last commit, the directory's mtime and any session event, or `null` if unknown. */
  readonly lastActivityMs: number | null;
  /** Count of `git status --porcelain` lines, or `null` when the working tree could not be read. */
  readonly dirtyCount: number | null;
  /**
   * How many files carry an index bit that hides their edits from {@link dirtyCount} AND differ from their
   * staged blob, or `null` when either read failed. A bit over identical bytes hides nothing and is not
   * counted — `./pruneGit`'s `hiddenEditCount` carries the measurement that made that matter.
   *
   * `--assume-unchanged` and `--skip-worktree` both tell git to stop reporting a tracked file's changes, so
   * `status --porcelain` answers the same thing for a tree holding a week of unsaved work as for a pristine
   * one. Nothing downstream of a zero `dirtyCount` can tell those apart, which is why this is measured here
   * rather than inferred later: a review pass drove a tree whose ONLY edits were hidden all the way through
   * `merged` to `removeTree`, and the bytes existed nowhere else. Read-only — the scan looks, and the
   * capture in `./pruneSalvage` is the only thing that ever clears a bit.
   */
  readonly hiddenFromStatus: number | null;
  /**
   * Whether EVERY dirty entry is a deletion of a tracked file. Meaningless when `dirtyCount` is 0 or null.
   *
   * A worktree whose every file is deleted and nothing else is an interrupted `git worktree remove` — the
   * fix is to finish it, not to investigate it. It is the one shape that escapes the dirty rule, and only
   * when everything else about it is already clear: absorbed into the trunk, unreferenced and cold. See the
   * `interrupted` class. Measured, when a shell cap killed five of them mid-call.
   */
  readonly deletionsOnly: boolean;
  /** Ignored entries no build writes again (`./pruneContext`), or `null` when git could not list them. */
  readonly ignoredWork: readonly string[] | null;
  /** Stashes made from this tree (`./pruneContext`), or `null` when git could not list them. */
  readonly stashes: number | null;
  /** Commits reachable from the branch and from no remote ref, or `null` when it could not be determined. */
  readonly unbackedCommits: number | null;
  /** Whether the branch's work is already in the trunk (a merge or a squash), or `null` when undecidable. */
  readonly mergedIntoTrunk: boolean | null;
  /** The detached HEAD's own commit, or `null` whenever a branch is checked out or the sha was unreadable. */
  readonly headSha: string | null;
  /**
   * A remote-tracking ref that CONTAINS {@link headSha}, or `null` when none does or git could not be asked.
   *
   * Deliberately the containing REF rather than a reachability count: the two agree except on a commit
   * reachable only from a remote branch about to be deleted, which is the one case a reader has to be able
   * to judge for themselves. The plan line names it.
   */
  readonly headOnRemoteRef: string | null;
  /**
   * Whether this worktree's own handover run is CLOSED on the board.
   *
   * True only when the directory's basename is a usable slug, a journal exists for it, its derived phase is
   * `closed`, AND the journal's own branch matches the branch checked out here — see `./pruneScan`. Its
   * single effect is to disarm the coldness rule; every other hold still applies.
   */
  readonly runClosed: boolean;
  /**
   * Whether the branch sits on its OWN remote branch — `refs/remotes/origin/<branch>` exists and the local
   * branch has nothing that ref lacks — or `null` when git could not say. Always `false` for a detached HEAD.
   *
   * Owner: a worktree whose branch is pushed goes even when its run is open or parked, because
   * a run is resumable from its branch. So on a clean tree this narrows the coldness rule to the two-hour
   * floor a branch the trunk carries gets, rather than disarming it as {@link runClosed} does: a seat can work in
   * a tree that is not its cwd, and only the tree's own activity then shows it. Its OWN remote branch,
   * deliberately, never "some remote ref contains it": a
   * worktree cut from the trunk a second ago has a branch `origin/main` already contains, and a session
   * about to start in it.
   */
  readonly branchOnOwnRemote: boolean | null;
  /**
   * Live sessions, cmux workspaces and process cwds at or under this path — any one of them holds the worktree
   * absolutely, at any age.
   */
  readonly liveRefs: readonly string[];
  /**
   * Whether git printed a `locked` line for this worktree. Holds it absolutely, at any age, CLOSED row or not.
   *
   * Required rather than optional: absence at the safety boundary must never read as "unlocked". A lock is the one
   * register git itself honours for "this tree is mine", and the only one a seat working in a tree that is not its
   * cwd can take: the live-reference registers hold by PATH, so a seat standing in another worktree is invisible to
   * them — measured, when a seat's tree was removed four times in under forty minutes while it worked there.
   */
  readonly locked: boolean;
  /**
   * The open pull requests of the owner's whose head is this tree's branch, each `open pull request <repo>#<n>`.
   *
   * Never a {@link liveRefs} entry: a pull request holds the tree only while it is WARM (see
   * `./pruneColdness`'s `openPullRequestHold`), so a cold tree on an open pull request is removed and its pushed branch,
   * which the pull request is open on, recreates it.
   */
  readonly openPullRequests: readonly string[];
  /** Disk footprint in KiB, or `null` when it was not measured. */
  readonly diskKib: number | null;
  /**
   * Whether the path is exactly a one-off Codex snapshot's tree (`./freshSnapshotPath.ts`) — a frozen copy of
   * another tree, which {@link snapshotDecision} judges by age instead of by branch, remote or salvage.
   */
  readonly freshSnapshot: boolean;
  /**
   * A tree carrying a `github lap` provenance marker, or an unmarked one at exactly a lap tree's path, detached or
   * on the `salvage/` branch prune's salvage loop switched it onto, and what its marker says
   * (`./lapTreeProvenance.ts`) — absent for every other tree, which the ordinary rules judge. {@link lapDecision}
   * judges one before any of them.
   */
  readonly lapTree?: LapTreeFacts;
}

/** One worktree's verdict. */
export interface PruneVerdict {
  readonly path: string;
  readonly branch: string | null;
  readonly cls: PruneClass;
  /** Why this verdict — the single decisive reason, phrased for a human reading the plan. */
  readonly reason: string;
  /** Whether applying this verdict also deletes the branch. True for `merged` and `interrupted` only. */
  readonly deleteBranch: boolean;
  /**
   * Whether `--apply` drops this KEPT tree's untracked `node_modules` — see {@link depsDroppable}. Only ever
   * true on a `hold`: every other class either removes the whole tree or frees nothing.
   */
  readonly dropsDeps: boolean;
  readonly diskKib: number | null;
  /**
   * The HEAD the scan read, carried by a `snapshot` or `lap` verdict only: its removal refuses any other HEAD, so a
   * commit made onto it since — however it is dated — is never deleted with the tree.
   */
  readonly scannedHead?: string;
  /** What a `lap` verdict's removal re-reads before the tree goes: the marker, or the kept ref that admitted it. */
  readonly lap?: LapVerdictEvidence;
  /**
   * How long untouched the tree must STILL be when `--apply` reaches it, carried by a `merged` or `pushed` verdict
   * whose coldness window applied (`./pruneColdness.ts`'s `coldnessWindowMs`). Absent when no age test applies — a
   * CLOSED row's, or any other class — so the apply asks exactly the question the scan asked, never a new one. The
   * scan can be a whole `--scan-budget` plus `--budget` old by the last tree, and a seat that commits into a tree in
   * that gap made it warm again.
   */
  readonly activityFloorMs?: number;
}

/**
 * Whether a tree the plan KEEPS may still give up its installed dependencies.
 *
 * Owner: a kept worktree can drop `node_modules`. MEASURED that day across 61 acme-admin
 * worktrees, whose yarn `nmMode: hardlinks-local` gives each one real files: 4.57 GB a tree on average,
 * 3.95 GB of it `node_modules`. `yarn install` rebuilds it, so it is the one part of a held tree that is
 * regenerable whatever held the rest — uncommitted work, an unreadable merge state, a detached HEAD.
 *
 * What still keeps it is exactly what says somebody is using the tree: the main checkout, a live session or
 * workspace, a `git worktree lock` (the one claim a seat working there from another cwd can make), and a touch
 * inside `--older-than`. A board row or a pushed branch does NOT disarm that here the
 * way it disarms the removal's coldness rule — a removed tree is gone, but a tree stripped of its
 * dependencies under a session about to run in it breaks that session's first `yarn` call, so only the
 * directory's own age is evidence enough. An unreadable timestamp keeps it, like every `null` in this file.
 * An open pull request is not a live reference, so a COLD tree whose branch has one drops its dependencies
 * and a warm one keeps them, by that same age test.
 *
 * @param facts the gathered facts
 * @param nowMs the instant the whole plan is judged against
 * @param olderThanMs how long untouched a tree must be
 * @returns true when `--apply` may remove the tree's untracked `node_modules` directories
 */
export function depsDroppable({
  facts,
  nowMs,
  olderThanMs,
}: {
  facts: WorktreeFacts;
  nowMs: number;
  olderThanMs: number;
}): boolean {
  return (
    !facts.isMainCheckout &&
    !facts.missing &&
    !facts.locked &&
    facts.liveRefs.length === 0 &&
    facts.lastActivityMs !== null &&
    nowMs - facts.lastActivityMs >= olderThanMs
  );
}

/**
 * The ordered hold rules — the safety contract, as data.
 *
 * ORDER IS THE CONTRACT. A hold wins over every safe class, and the FIRST match is the reason a reader sees,
 * so the list runs most-alarming first: a worktree that is both dirty and held by a live session reports the
 * session, because that is the one a human acts on.
 *
 * Every `null` fact holds rather than passes. The scan failing to read a working tree is not evidence the
 * working tree is clean, and treating "unknown" as "safe" is the one way this verb could destroy work.
 */
interface HoldRule {
  /**
   * Whether the week-old waiver may release this hold.
   *
   * TRUE only for a hold whose whole content is "this tree carries work that exists nowhere else" — which is
   * precisely the set the waiver is about, and precisely the set the capture in `./pruneApply` can make
   * false by pushing that work to a remote branch. FALSE everywhere else, and the four `null` rules are the
   * reason the flag is per-rule rather than a single age test wrapped around the loop: a fact that could not
   * be READ has not been shown to be over a week old either, so the waiver must not reach it.
   */
  readonly waivable: boolean;
  /** The reason this rule gives when it fires, or `undefined` when it does not apply. */
  readonly reason: (input: { facts: WorktreeFacts; nowMs: number; olderThanMs: number }) => string | undefined;
}

const HOLD_RULES: readonly HoldRule[] = [
  { reason: ({ facts }) => (facts.isMainCheckout ? "the repository's own main checkout" : undefined), waivable: false },
  {
    reason: ({ facts }) => (facts.liveRefs.length > 0 ? `referenced by ${facts.liveRefs.join(", ")}` : undefined),
    waivable: false,
  },
  {
    reason: ({ facts }) =>
      facts.dirtyCount === null && !facts.missing ? "its working tree could not be read" : undefined,
    waivable: false,
  },
  // Not knowing WHETHER a tree is dirty is the same fact as not being able to read it, so it holds the same
  // way and never waives.
  {
    reason: ({ facts }) =>
      facts.hiddenFromStatus === null && !facts.missing
        ? "which files it hides from status could not be read"
        : undefined,
    waivable: false,
  },
  {
    reason: ({ facts }) =>
      facts.ignoredWork === null && !facts.missing ? "its ignored files could not be listed" : undefined,
    waivable: false,
  },
  {
    reason: ({ facts }) => (facts.stashes === null && !facts.missing ? "its stashes could not be listed" : undefined),
    waivable: false,
  },
  // Neither of the next two is waivable: the salvage commits with `add -A`, which stages no ignored file, and
  // pushes a branch, which carries no stash. So no age makes either of them committed somewhere.
  {
    reason: ({ facts }) =>
      facts.ignoredWork !== null && facts.ignoredWork.length > 0
        ? `${String(facts.ignoredWork.length)} ignored file(s) no build writes again, such as ${facts.ignoredWork[0]!}`
        : undefined,
    waivable: false,
  },
  {
    reason: ({ facts }) =>
      facts.stashes !== null && facts.stashes > 0 ? `${String(facts.stashes)} stash(es) made from it` : undefined,
    waivable: false,
  },
  // A hidden file's edits are reported by no porcelain, so a tree carrying one has a `dirtyCount` that means
  // nothing. WAIVABLE, and that is safe rather than convenient: the waiver leads only into `salvaged`, whose
  // capture CLEARS every one of these bits before it measures anything and DECLINES the whole removal if a
  // bit will not clear. Holding it unwaivably instead would keep a week-old tree forever over an index
  // optimisation. Reproduced as a real deletion of real bytes before this rule existed.
  {
    reason: ({ facts }) =>
      facts.hiddenFromStatus !== null && facts.hiddenFromStatus > 0
        ? `${String(facts.hiddenFromStatus)} file(s) hidden from status by --assume-unchanged or --skip-worktree carry edits status does not report`
        : undefined,
    waivable: true,
  },
  {
    reason: ({ facts }) =>
      absentAsNumber({ value: facts.dirtyCount, whenAbsent: 0 }) > 0 && !facts.deletionsOnly
        ? `${String(facts.dirtyCount)} uncommitted change(s)`
        : undefined,
    waivable: true,
  },
  // An all-deletions tree is only excused when everything else clears it too. If any later rule holds it, it
  // is held with the ordinary wording plus what it looks like, never quietly finished. Its work is either in
  // the trunk or on its own pushed branch (owner): every deleted byte is in HEAD, and HEAD is on a
  // remote, so the removal loses only the intent to delete. Before that word such a tree waited a week and then
  // salvaged — pushing a `salvage/*` branch whose only content was deletions.
  {
    reason: ({ facts }) =>
      absentAsNumber({ value: facts.dirtyCount, whenAbsent: 0 }) > 0 &&
      facts.mergedIntoTrunk !== true &&
      !headOnOwnRemote({ facts })
        ? `${String(facts.dirtyCount)} deleted file(s), and its work is neither in the trunk nor on its own remote branch — investigate before removing`
        : undefined,
    waivable: true,
  },
  // A detached HEAD is held unless a remote still carries its commit, in which case the tree is
  // recreatable with `git worktree add --detach <sha>` and the `detached` class takes it. The witness
  // being absent — no containing ref, or git could not be asked at all — lands here exactly as before,
  // and past a week the capture MAKES the missing witness by pushing a branch at that sha.
  {
    reason: ({ facts }) =>
      facts.branch === null && !facts.missing && !recreatableDetached({ facts })
        ? "a detached HEAD origin does not carry, so nothing could recreate this tree"
        : undefined,
    waivable: true,
  },
  // Both of the next two rules are statements about a BRANCH — what a remote carries of it, and whether the
  // trunk has absorbed it — so neither can be asked of a detached tree, which has none. They excluded
  // `recreatableDetached` for exactly that reason while the rule above held every OTHER detached tree
  // outright and made the question moot. The week-old waiver ends that: a detached tree past the week is
  // waived by the rule above and reaches these, where a `null` it could never have answered would hold it
  // forever. The exclusion is therefore widened to what it always meant — a tree with no branch.
  {
    reason: ({ facts }) =>
      facts.branch !== null && facts.unbackedCommits === null && !facts.missing && facts.dirtyCount === 0
        ? "its commits could not be checked against the remotes"
        : undefined,
    waivable: false,
  },
  // WAIVABLE: past the week the salvage pushes these commits to a fresh remote branch and confirms them there
  // before the tree goes. An absorbed branch never reaches this, because the scan counts it as 0 unbacked.
  {
    reason: ({ facts }) =>
      facts.branch !== null && !facts.missing && facts.unbackedCommits !== null && facts.unbackedCommits > 0
        ? `${String(facts.unbackedCommits)} commit(s) origin does not carry`
        : undefined,
    waivable: true,
  },
  {
    reason: ({ facts }) =>
      facts.lastActivityMs === null && !facts.missing ? "no activity timestamp could be read" : undefined,
    waivable: false,
  },
  // The coldness rule, and the ONLY rule a closed board row, a pushed branch or an open pull request touches.
  // A run the board reports finished is done being worked on whatever last touched its directory — which is
  // routinely this machine's own indexing or a sibling session's `du`, neither of which is somebody working
  // there. A clean tree on its own pushed branch is resumable from that branch whatever its run's state
  // (owner), so it, like a branch the trunk carries, is cold after a two-hour floor rather than the day — a
  // floor, not nothing, because a seat working there from another cwd is invisible two rules up. An open pull
  // request holds a warm tree for the whole `--older-than` over all of these: {@link coldnessHold}.
  { reason: coldnessHold, waivable: false },
  {
    reason: ({ facts }) =>
      facts.branch !== null && facts.mergedIntoTrunk === null && !facts.missing
        ? "its merge state against the trunk could not be determined"
        : undefined,
    waivable: false,
  },
  // LAST, so every rule number cited elsewhere stays put; unwaivable, so the week-old waiver releasing every rule
  // above still ends here. `git worktree remove` refuses a locked tree without `-f -f` too, but only AFTER the apply
  // has renamed its `node_modules` aside (`./reclaimTrash.ts`), so git's refusal is a backstop and this is the rule.
  { reason: ({ facts }) => (facts.locked ? "locked by `git worktree lock`" : undefined), waivable: false },
];

/** What the ordered hold rules said about one worktree. */
interface HoldOutcome {
  /** The decisive hold reason, or `undefined` when nothing holds this worktree. */
  readonly held: string | undefined;
  /**
   * The reasons the week-old waiver released, in rule order, empty for every ordinary tree.
   *
   * NON-EMPTY IS THE WHOLE SAFETY OF THIS FILE'S NEWEST CLASS. A tree only reaches an ordinary class when
   * this is empty; anything the waiver touched is `salvaged` instead, whose application pushes the work to
   * a remote before it removes anything. Collapsing this to a boolean, or dropping it and letting a waived
   * tree fall through to {@link branchDecision}, is the exact bug that would delete uncommitted work.
   */
  readonly waived: readonly string[];
}

/**
 * Run the ordered hold rules, applying the week-old waiver to the ones it reaches.
 *
 * @param facts the gathered facts
 * @param nowMs the clock the caller read once, so a whole plan is judged against one instant
 * @param olderThanMs how cold a worktree must be before it is eligible
 * @param nukeAfterMs how old a worktree must be before a waivable hold is released by a capture
 * @returns the decisive hold, and every reason the waiver released
 */
function holdReason({
  facts,
  nowMs,
  nukeAfterMs,
  olderThanMs,
}: {
  facts: WorktreeFacts;
  nowMs: number;
  nukeAfterMs: number;
  olderThanMs: number;
}): HoldOutcome {
  const input = { facts, nowMs, olderThanMs };
  const lastActivityMs = facts.lastActivityMs;
  const pastTheWaiver = lastActivityMs !== null && nowMs - lastActivityMs >= nukeAfterMs;
  const waived: string[] = [];
  for (const rule of HOLD_RULES) {
    const reason = rule.reason(input);
    if (reason === undefined) {
      continue;
    }
    if (rule.waivable && pastTheWaiver) {
      waived.push(reason);
      continue;
    }
    return { held: reason, waived };
  }
  return { held: undefined, waived };
}

/**
 * The verdict for a tree the week-old waiver released — the one class whose application writes to a remote.
 *
 * @param ageMs how long since the tree was last touched, which the caller has already proven is past the waiver
 * @param waived every hold the waiver released, in rule order
 * @returns the `salvaged` decision, whose branch is always KEPT because it is where the work now lives
 */
function salvageDecision({ ageMs, waived }: { ageMs: number; waived: readonly string[] }): ClassDecision {
  return {
    cls: "salvaged",
    deleteBranch: false,
    reason:
      `${waived.join("; ")} — untouched ${renderAge({ ms: ageMs })}, so the work is pushed to a remote ` +
      "branch and recorded before the tree goes",
  };
}

/** What a class decision is, before a path, a branch and a disk figure are stapled onto it. */
type ClassDecision = Pick<PruneVerdict, "cls" | "deleteBranch" | "reason">;

/**
 * The verdict for a tree whose SHAPE decides it, before any branch question is asked — or `undefined` when
 * the tree is an ordinary branch-backed checkout and the branch rules below are what decide it.
 */
function shapeDecision({ facts }: { facts: WorktreeFacts }): ClassDecision | undefined {
  if (facts.missing) {
    return {
      cls: "gone",
      deleteBranch: false,
      reason: "registered by git but absent from disk — the record goes, no disk is freed",
    };
  }
  if (facts.deletionsOnly && absentAsNumber({ value: facts.dirtyCount, whenAbsent: 0 }) > 0) {
    // The hold rule above let this through on one of two witnesses. Only the trunk makes the branch disposable;
    // a pushed branch is KEPT, as for `pushed`, and is what recreates the tree.
    if (facts.mergedIntoTrunk === true) {
      return {
        cls: "interrupted",
        deleteBranch: true,
        reason: `${facts.dirtyCount} deleted file(s) and nothing else — an interrupted removal of work that is in the trunk`,
      };
    }
    return {
      cls: "interrupted",
      deleteBranch: false,
      reason:
        `${facts.dirtyCount} deleted file(s) and nothing else, on a branch its own remote carries whole — ` +
        "finished, and the branch KEPT",
    };
  }
  // Reachable only once every hold cleared, which for a detached tree REQUIRES `recreatableDetached`.
  if (facts.branch === null) {
    return {
      cls: "detached",
      deleteBranch: false,
      reason:
        `a detached HEAD carried by ${String(facts.headOnRemoteRef)} — recreate with ` +
        `\`git worktree add --detach ${String(facts.headSha)}\``,
    };
  }
  return undefined;
}

/** The verdict for a branch-backed tree: how much of its work the trunk and the remotes already carry. */
function branchDecision({ facts }: { facts: WorktreeFacts }): ClassDecision {
  if (facts.mergedIntoTrunk === true) {
    return { cls: "merged", deleteBranch: true, reason: "merged into the trunk, clean, unreferenced and cold" };
  }
  return {
    cls: "pushed",
    deleteBranch: false,
    reason: "clean and fully pushed but not merged — the tree is recreatable, the branch is kept",
  };
}

/**
 * Classify one worktree against the safety rules.
 *
 * @param facts everything gathered about the worktree
 * @param nowMs the instant the whole plan is judged against
 * @param olderThanMs the eligibility age in milliseconds
 * @param nukeAfterMs the age past which a hold over unbacked work is released by capturing that work
 * @param includeUnmarkedLap true only on the explicit `--include-unmarked-lap` run, which may take an unmarked lap tree
 * @returns the verdict, including the reason a reader sees on the plan line
 */
export function classifyWorktree({
  facts,
  includeUnmarkedLap,
  nowMs,
  nukeAfterMs,
  olderThanMs,
}: {
  facts: WorktreeFacts;
  includeUnmarkedLap?: boolean;
  nowMs: number;
  nukeAfterMs: number;
  olderThanMs: number;
}): PruneVerdict {
  const base = { branch: facts.branch, diskKib: facts.diskKib, dropsDeps: false, path: facts.path };
  const lap = lapDecision({ facts, includeUnmarkedLap: includeUnmarkedLap === true });
  if (lap !== undefined) {
    return { ...base, ...lap };
  }
  const snapshot = snapshotDecision({ facts, nowMs });
  if (snapshot !== undefined) {
    return { ...base, ...snapshot };
  }
  const outcome = holdReason({ facts, nowMs, nukeAfterMs, olderThanMs });
  if (outcome.held !== undefined) {
    const dropsDeps = depsDroppable({ facts, nowMs, olderThanMs });
    return { ...base, cls: "hold", deleteBranch: false, dropsDeps, reason: outcome.held };
  }
  // A waived tree NEVER falls through to the ordinary classes below. It carries work that only this machine
  // has — that is what every waivable rule says — so its removal has to push that work first, and `salvaged`
  // is the only class whose application does. The `null` check narrows a type the waiver already guarantees:
  // no waivable rule can fire without an activity timestamp, because the waiver is computed from one.
  const lastActivityMs = facts.lastActivityMs;
  if (outcome.waived.length > 0 && lastActivityMs !== null) {
    return { ...base, ...salvageDecision({ ageMs: nowMs - lastActivityMs, waived: outcome.waived }) };
  }
  const shape = shapeDecision({ facts });
  if (shape !== undefined) {
    return { ...base, ...shape };
  }
  const decision = { ...base, ...branchDecision({ facts }) };
  const activityFloorMs = coldnessWindowMs({ facts, olderThanMs });
  if (activityFloorMs === null) {
    return decision;
  }
  return { ...decision, activityFloorMs };
}
