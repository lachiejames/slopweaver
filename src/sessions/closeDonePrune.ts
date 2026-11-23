/**
 * Reclaiming the worktree of a seat `session close-done` has just closed — the pure decision.
 *
 * ## Why the sweep does it at all, when an hourly row already exists
 *
 * The hourly `worktree-prune` row is the backstop, not the mechanism. Each firing runs under a
 * fifteen-minute budget, and a `git worktree remove` costs a minute in slopweaver and several in acme-admin —
 * so a fleet that closes thirty seats in an afternoon hands it a backlog it clears over hours. Reclaiming at
 * the moment of closing is the only place the cost is one tree. It is also the moment the evidence is best:
 * the run is done on disk and the workspace is gone from cmux, which is exactly what the hourly row's age
 * threshold is a PROXY for.
 *
 * ## The age rule is waived, and it is the only one
 *
 * A tree closed seconds ago is zero hours old, so `--older-than 24h` would hold every seat this path exists
 * for. `classifyWorktree` already takes the threshold as a parameter, so the waiver is `olderThanMs: 0` and
 * not a second classifier — `nowMs - lastActivityMs < 0` is false for any real stamp. Waiving it is sound
 * precisely because the direct evidence the proxy stands in for is in hand here and is not in the hourly row.
 *
 * Every other hold survives untouched, and the one that matters most is an UNREADABLE fact. A session that
 * closed with commits nothing could be checked against the remotes is the single most likely way this path
 * could destroy work, and `worktree/pruneClassify.ts`'s `HOLD_RULES` is what stops it: a `null` unbacked
 * count, a `null` dirty count, a `null` activity stamp and an undecidable merge state each keep their
 * worktree exactly as they do in the hourly row. Every `null` fact holds, and so does a POSITIVE unbacked count,
 * an untracked file, an ignored file no build writes again and a stash made from the tree (owner).
 *
 * ## Three classes, not six
 *
 * `merged`, `pushed` and `detached` are acted on here. The criterion is RECREATABILITY, not how much of the
 * work a remote already carries, which is why the set is the one it is:
 *
 * - `merged` deletes the branch, and the trunk is what recreates the tree.
 * - `pushed` keeps the branch, and a remote carries every commit on it.
 * - `detached` is only ever reached once `recreatableDetached` passes, so a remote ref carries the sha by
 *   construction and the verdict prints the `git worktree add --detach <sha>` that rebuilds it.
 *
 * `interrupted` forces a removal git is refusing, and a gutted tree was not produced by the close that just
 * happened — the hourly row, which has the whole picture and prints an audit, is where that belongs. `gone`
 * frees no disk at all.
 *
 * Pure: facts in, a verdict out. The reads, the removal and the live-workspace refresh are
 * `../cli/commands/session/closeDone.ts`.
 */
import { isUnderWorktrees } from "../worktree/location.js";
import { classifyWorktree, type PruneVerdict, type WorktreeFacts } from "../worktree/pruneClassify.js";

/**
 * The eligibility age this path judges against.
 *
 * Zero, and named rather than inlined so the one waiver this module makes is a thing a reader can find. The
 * command-line `--older-than` refuses `0` (`worktree/pruneOptions.ts`) because a caller typing it would be
 * making every worktree on the machine eligible; here the population is one tree whose seat just closed.
 */
const SEAT_OLDER_THAN_MS = 0;

/**
 * The week-old waiver, passed through unchanged rather than disabled — the owner's `--nuke-after`.
 *
 * A seat closes at the END of the run that made the tree, so the tree is minutes old and this can never
 * fire; passing the real value rather than something that pretends the rule does not exist keeps the two
 * callers of {@link classifyWorktree} describing the same world. If a seat ever DOES close over a
 * week-cold tree, the classifier answers `salvaged`, which {@link SEAT_PRUNE_CLASSES} declines — the
 * capture belongs to the hourly row, which has the budget and the door for a push.
 */
const SEAT_NUKE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The classes a seat close removes. `interrupted` and `gone` are the hourly row's, for the header's reasons. */
const SEAT_PRUNE_CLASSES: ReadonlySet<PruneVerdict["cls"]> = new Set<PruneVerdict["cls"]>([
  "detached",
  "merged",
  "pushed",
]);

/** What should happen to the worktree of one just-closed seat. */
export type SeatPruneDecision =
  /** Safe to reclaim — the verdict carries the class, the reason and whether the branch goes too. */
  | { readonly kind: "remove"; readonly verdict: PruneVerdict }
  /** Left where it is, and the decisive reason a reader acts on. */
  | { readonly kind: "keep"; readonly path: string; readonly reason: string };

/**
 * Whether the worktree of a seat that has just closed may be reclaimed.
 *
 * @param facts everything the scan gathered about that one worktree, live references included
 * @param nowMs the instant the whole sweep is judged against, read once by the caller
 * @returns the removal to carry out, or the reason it is being kept
 */
export function decideSeatPrune({
  facts,
  nowMs,
}: {
  readonly facts: WorktreeFacts;
  readonly nowMs: number;
}): SeatPruneDecision {
  const verdict = classifyWorktree({
    facts,
    nowMs,
    nukeAfterMs: SEAT_NUKE_AFTER_MS,
    olderThanMs: SEAT_OLDER_THAN_MS,
  });
  if (SEAT_PRUNE_CLASSES.has(verdict.cls)) {
    return { kind: "remove", verdict };
  }
  if (verdict.cls === "hold") {
    return { kind: "keep", path: verdict.path, reason: verdict.reason };
  }
  return {
    kind: "keep",
    path: verdict.path,
    reason: `${verdict.reason} — left to the daily \`worktree prune\`, which has the whole picture`,
  };
}

/**
 * Which declared main checkout a worktree path belongs to.
 *
 * Answers `undefined` for a path under no declared checkout, and that answer is load-bearing: a session can
 * be spawned anywhere, and removing a directory this install has not declared as a worktree home would be
 * this sweep deleting something outside its own remit. `docs/main-checkouts/declarations-and-freshness.md` is the register.
 *
 * @param path the closed seat's own directory
 * @param mainCheckouts every declared main checkout, from the profile
 * @returns the checkout whose worktrees hold this path, or `undefined` when none does
 */
export function repoOwningWorktree({
  path,
  mainCheckouts,
}: {
  readonly path: string;
  readonly mainCheckouts: readonly string[];
}): string | undefined {
  return mainCheckouts.find((checkout) => isUnderWorktrees({ checkout, path }));
}

/** What one seat's reclaim did, for the line the sweep prints and the count it folds. */
export interface SeatPruneOutcome {
  /** The row the seat belonged to, as the sweep names it. */
  readonly name: string;
  readonly path: string;
  /** Whether the tree was actually removed. False for a keep AND for a removal git declined. */
  readonly removed: boolean;
  /** The decisive sentence — why it went, or why it stayed. */
  readonly reason: string;
}

/**
 * One seat's reclaim as the line a reader sees.
 *
 * @param outcome what happened to that seat's worktree
 * @param dryRun whether the sweep only reported what it would do
 * @returns the line to print
 */
export function renderSeatPrune({
  outcome,
  dryRun,
}: {
  readonly outcome: SeatPruneOutcome;
  readonly dryRun: boolean;
}): string {
  const verb = dryRun ? "would reclaim" : "reclaimed";
  if (outcome.removed) {
    return `${verb} ${outcome.path} — ${outcome.reason}`;
  }
  return `kept ${outcome.path} — ${outcome.reason}`;
}
