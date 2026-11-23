/**
 * Whether a STANDING session is still running the code and the prose that `main` currently carries — pure.
 *
 * ## The failure this exists to make impossible
 *
 * Measured: fixes landed on the plugin every day while a standing session was not running the latest. The Slack
 * loop was running a worktree pinned two days back and the recipe scheduler one pinned **74 commits behind**
 * `origin/main`, while fourteen pull requests landed over those two days. Every worker a standing session dispatches inherits that session's own worktree bin, so each of those
 * fixes changed nothing at all in the channel: the day's public failures all ran the old binary. Nothing
 * reported it, because the gauge the supervisor had (`session depth`) measures how EXPENSIVE a session is and
 * says nothing whatever about which commit it is on.
 *
 * ## A standing session has TWO trees, and they drift independently
 *
 * This is the discovery that makes a single "which worktree is it in" answer wrong. Measured on a
 * freshly-respawned loop:
 *
 * - its **bin** — the CLI its own commands and every worker it dispatches run — resolved to that day's own
 *   worktree, one commit behind;
 * - its **plugin-dir** — the skill prose the session is actually FOLLOWING, from its `claude --plugin-dir`
 *   argv — still pointed at a two-day-old worktree, sixty-three behind.
 *
 * A current CLI following two-day-old instructions is not a current session, so both roles are measured and a
 * session is graded on the WORSE of them ({@link worstStandingGrade}). Reporting one alone would have called
 * that loop fresh.
 *
 * ## `behind` is not the signal — `behind` over a SENSITIVE path is
 *
 * A count on its own trains a reader to skim it: this fleet's worktrees are routinely a few commits behind
 * and it means nothing. What matters is whether the commits a standing session is missing changed the code
 * that session RUNS. So {@link STANDING_SENSITIVE_PATHS} names those areas, and a drift touching one of them
 * grades `stale` — an alert-class fact — while any other drift grades `behind`, which is reported and not
 * shouted about. Same shape, and the same reasoning, as `cmux/baseFreshness.ts`'s overlap rule, whose
 * {@link pathsOverlap} is reused here rather than re-derived.
 *
 * Pure: every count and path a caller could only get by running git is passed in already-read. The effectful
 * half is `./inspect.ts`.
 */
import { pathsOverlap } from "../../cmux/baseFreshness.js";
import { LOOP_CHAIN_PATHS } from "../../lib/loopChainPaths.js";

/**
 * This domain's own name for {@link LOOP_CHAIN_PATHS} — the areas whose change makes a standing session
 * STALE rather than merely behind. Kept as a separate export (rather than every call site here naming the
 * shared constant directly) because "standing sensitive" is what a reader of this file's grading logic is
 * looking for; the shared module carries the reasoning behind the actual path list.
 */
export const STANDING_SENSITIVE_PATHS: readonly string[] = LOOP_CHAIN_PATHS;

/**
 * How current one tree is.
 *
 * `unmeasured` is its own grade rather than a missing value, because the two are acted on differently: a tree
 * whose drift could not be read is a tree that might be 74 commits behind, and silently reporting it as
 * `current` is the swallow-and-report-green shape this repository keeps paying for.
 */
export type StandingFreshnessGrade = "current" | "behind" | "stale" | "unmeasured";

/** Weakest first — a session's grade is the worst its trees carry, so the order is load-bearing. */
const GRADE_ORDER: readonly StandingFreshnessGrade[] = ["current", "behind", "unmeasured", "stale"];

/** Which of a standing session's two trees a reading is about. */
export type StandingTreeRole = "bin" | "plugin-dir";

/** One tree as git reported it, before any judgement is applied. */
export interface StandingTreeReading {
  /** The absolute path of the worktree. */
  readonly path: string;
  /** Its HEAD commit, or `undefined` when the read failed. */
  readonly head: string | undefined;
  /** Commits `origin/main` carries that it does not, or `undefined` when the count could not be taken. */
  readonly behind: number | undefined;
  /** The paths those commits changed. Empty is a legitimate answer; unreadable is `behind: undefined`. */
  readonly changedPaths: readonly string[];
}

/** One tree, graded. */
export interface StandingTreeFreshness {
  readonly role: StandingTreeRole;
  readonly path: string;
  readonly head: string | undefined;
  readonly behind: number | undefined;
  /** The sensitive paths the missing commits touched — the whole reason a grade is `stale` and not `behind`. */
  readonly touched: readonly string[];
  readonly grade: StandingFreshnessGrade;
}

/**
 * Grade one tree's reading against the paths that session actually runs.
 *
 * The path list is a PARAMETER rather than the module constant, because the three standing sessions do not
 * share one. {@link STANDING_SENSITIVE_PATHS} is the loop chain's, and the supervisor's is a different set
 * (`./supervisor.ts`'s `SUPERVISOR_CHAIN_PATHS`) — grading a supervisor against the loop's list was tried
 * while building this and produced a check that could not fire: the very commit that started this finding,
 * `session close-done` under `src/cli/commands/session/`, is on neither the loop's list nor near it, so a
 * main checkout missing it would have graded `behind` and alerted nobody.
 *
 * @param reading what git reported for this tree
 * @param role which of the session's two trees this is
 * @param sensitivePaths the prefixes whose change makes THIS session stale, defaulting to the loop chain's
 * @returns the graded tree, carrying the sensitive paths that drove the grade
 */
export function gradeStandingTree({
  reading,
  role,
  sensitivePaths = STANDING_SENSITIVE_PATHS,
}: {
  readonly reading: StandingTreeReading;
  readonly role: StandingTreeRole;
  readonly sensitivePaths?: readonly string[];
}): StandingTreeFreshness {
  const base = { behind: reading.behind, head: reading.head, path: reading.path, role };
  if (reading.behind === undefined) {
    return { ...base, grade: "unmeasured", touched: [] };
  }
  if (reading.behind === 0) {
    return { ...base, grade: "current", touched: [] };
  }
  const touched = [
    ...new Set(
      reading.changedPaths.filter((changed) =>
        sensitivePaths.some((sensitive) => pathsOverlap({ changed, docPath: sensitive })),
      ),
    ),
  ];
  return { ...base, grade: touched.length > 0 ? "stale" : "behind", touched };
}

/**
 * The worst of several grades — how a session with two trees gets one answer.
 *
 * @param grades every grade to fold; an empty list is `unmeasured`, since nothing was measured
 * @returns the strongest grade present
 */
export function worstStandingGrade({
  grades,
}: {
  readonly grades: readonly StandingFreshnessGrade[];
}): StandingFreshnessGrade {
  return grades.reduce<StandingFreshnessGrade>(
    (worst, grade) => (GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(worst) ? grade : worst),
    grades.length === 0 ? "unmeasured" : "current",
  );
}

/** One standing session's freshness: both trees, and the one grade a caller acts on. */
export interface StandingSessionFreshness {
  /** Which standing session — `loop` or `scheduler`. */
  readonly session: string;
  readonly trees: readonly StandingTreeFreshness[];
  readonly grade: StandingFreshnessGrade;
}

/**
 * Fold one session's graded trees into its own answer.
 *
 * @param session which standing session this is
 * @param trees its graded trees, in the order a reader should see them
 * @returns the session's freshness
 */
export function standingSessionFreshness({
  session,
  trees,
}: {
  readonly session: string;
  readonly trees: readonly StandingTreeFreshness[];
}): StandingSessionFreshness {
  return { grade: worstStandingGrade({ grades: trees.map((tree) => tree.grade) }), session, trees };
}

/** How many sensitive paths a line names before it stops listing and starts counting. */
const MAX_TOUCHED_LISTED = 4;

/** A tree's HEAD as a line prints it: `head` is `undefined` exactly when git would not report one. */
function shownHead({ tree }: { readonly tree: StandingTreeFreshness }): string {
  const { head } = tree;
  if (head == null) {
    return "unreadable";
  }
  return head;
}

/**
 * One tree as the line a human reads.
 *
 * Rule 7 shapes this: the outcome is the grade and it comes first, the evidence is the paths and it is capped
 * — a `stale` tree 74 commits behind touched dozens of sensitive files, and printing all of them turns the
 * one line that matters into a wall nobody reads.
 *
 * @param tree the graded tree
 * @returns the line
 */
export function standingTreeLine({ tree }: { readonly tree: StandingTreeFreshness }): string {
  const head = shownHead({ tree });
  if (tree.grade === "unmeasured") {
    return `  ${tree.role}: UNMEASURED — ${tree.path} (HEAD ${head}); treat as possibly stale, not as current`;
  }
  const behind = `${String(tree.behind ?? 0)} behind origin/main`;
  if (tree.grade === "current") {
    return `  ${tree.role}: current — ${head} at ${tree.path}`;
  }
  const listed = tree.touched.slice(0, MAX_TOUCHED_LISTED).join(", ");
  const more =
    tree.touched.length > MAX_TOUCHED_LISTED ? ` +${String(tree.touched.length - MAX_TOUCHED_LISTED)} more` : "";
  if (tree.grade === "behind") {
    return `  ${tree.role}: behind — ${head}, ${behind}, none of it under a path this session runs`;
  }
  return `  ${tree.role}: STALE — ${head}, ${behind}, touching ${listed}${more}`;
}

/**
 * One standing session's freshness as the lines a human reads — the grade, then a line per tree.
 *
 * @param freshness the folded session freshness
 * @returns the lines, outcome first
 */
export function standingSessionLines({
  freshness,
}: {
  readonly freshness: StandingSessionFreshness;
}): readonly string[] {
  return [
    `${freshness.session} freshness: ${freshness.grade.toUpperCase()}`,
    ...freshness.trees.map((tree) => standingTreeLine({ tree })),
  ];
}

/**
 * Whether a grade is the alert-class one a supervisor must be woken for.
 *
 * @param grade the folded grade
 * @returns true only for `stale`
 */
export function standingGradeIsAlerting({ grade }: { readonly grade: StandingFreshnessGrade }): boolean {
  return grade === "stale";
}
