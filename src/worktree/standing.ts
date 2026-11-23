/**
 * WHERE AM I STANDING — the one-command answer a spawned child needs before it writes anything.
 *
 * Filed from the incident in `child-must-not-touch-the-main-checkout`: a child given its own
 * worktree did all its work in the shared main checkout instead, renamed that checkout's long-lived branch
 * to its feature name, and committed on top. Every check it ran locally passed, because from inside a
 * session there is nothing that LOOKS different about the wrong directory — the mistake was invisible until
 * a parent read the pull request's diffstat and asked why a one-file change rendered an entire branch.
 *
 * The guards in `src/admit/` are the fence; this is the sign. A fence that only ever speaks by refusing
 * teaches a session what it may not do one attempt at a time, and the child in the incident had already done
 * the damage by the time it hit one. `slopweaver worktree here` is the cheap, explicit check a child runs
 * FIRST, and its refusal names the typed way to ask (`slopweaver handover ask`) rather than leaving a
 * blocked child to improvise — an untyped stop is the failure AGENTS.md rule 6 exists for.
 *
 * Pure by construction: the caller does every git read and passes the facts in, so the decision that governs
 * whether a child writes is testable against literal inputs rather than against whatever repository the test
 * happens to run in.
 */

import { absentAs } from "#lib/absent.js";

/** Where a caller is standing, in the only three kinds that change what it should do next. */
type Standing = "linked-worktree" | "main-checkout" | "outside-repository";

/** The facts a caller reads from git and the profile before {@link classifyStanding} decides. */
export interface StandingFacts {
  /** The directory the caller is standing in. */
  readonly cwd: string;
  /** The main checkout of the repository `cwd` belongs to, or `undefined` when `cwd` is not in one. */
  readonly mainCheckoutRoot: string | undefined;
  /** Whether `cwd` is that main checkout itself rather than a linked worktree of it. */
  readonly isMainWorktree: boolean;
  /** Whether `profile.json` declares that main checkout as one this install keeps current. */
  readonly declared: boolean;
  /** The branch checked out where the caller stands, or `undefined` for a detached HEAD. */
  readonly branch: string | undefined;
}

/** What a caller is standing in, and whether writing there is its own business. */
export interface StandingReport {
  /** Which of the three kinds of place this is. */
  readonly standing: Standing;
  /** Whether a write here belongs to this session alone. */
  readonly writable: boolean;
  /** The facts the verdict was reached from. */
  readonly facts: StandingFacts;
}

/**
 * Classify where a caller is standing.
 *
 * A LINKED worktree is the only writable answer, and it is writable whether or not the profile declares its
 * repository — a linked worktree belongs to the session holding it either way. A main checkout is refused
 * whether or not it is declared, because "every other worktree reads this" is a property of the checkout,
 * not of the profile; the declaration only sharpens the message. Outside a repository is refused too: a
 * child that cannot tell which repository it is in has no business writing in one.
 *
 * @param facts what the caller read from git and the profile
 * @returns the standing and whether writing here is this session's own business
 */
export function classifyStanding({ facts }: { facts: StandingFacts }): StandingReport {
  const outsideRepository = facts.mainCheckoutRoot === undefined;
  const isMain = facts.isMainWorktree;
  let standing: Standing;
  if (outsideRepository) {
    standing = "outside-repository";
  } else if (isMain) {
    standing = "main-checkout";
  } else {
    standing = "linked-worktree";
  }
  return { facts, standing, writable: standing === "linked-worktree" };
}

/**
 * The ref shown in brackets beside where the caller stands. A detached HEAD has no branch checked out, so
 * the bracket names that state where the branch would be.
 */
function standingRef({ branch }: { branch: string | undefined }): string {
  if (branch === undefined) {
    return "(detached)";
  }
  return branch;
}

/**
 * The human-readable lines `worktree here` prints, verdict first.
 *
 * The refusal names three next steps in the order a blocked child should try them — get a worktree, or ask
 * — because "you may not write here" without a route is the untyped stop rule 6 bans.
 *
 * @param report the classified standing
 * @returns the lines to print, in order
 */
export function renderStanding({ report }: { report: StandingReport }): readonly string[] {
  const { branch, cwd, declared, mainCheckoutRoot } = report.facts;
  const ref = standingRef({ branch });
  if (report.standing === "linked-worktree") {
    return [
      `own worktree: ${cwd} [${ref}]`,
      `  main checkout: ${absentAs({ value: mainCheckoutRoot, whenAbsent: "(unknown)" })}${declared ? " (declared)" : ""} — do not write there`,
      "  this worktree is yours: write, commit and push here",
    ];
  }
  if (report.standing === "main-checkout") {
    return [
      `MAIN CHECKOUT: ${cwd} [${ref}]${declared ? " (declared)" : ""}`,
      "  every other worktree and session reads this checkout — nothing you write here is yours alone",
      "  get your own: slopweaver cmux spawn <slug>, or slopweaver worktree create <slug>",
      '  blocked on something only the owner can settle: slopweaver handover ask <slug> --question "<question>"',
    ];
  }
  return [
    `NOT IN A REPOSITORY: ${cwd}`,
    "  nothing here is a checkout this install knows — do not write until you know which repository you are in",
    '  blocked on something only the owner can settle: slopweaver handover ask <slug> --question "<question>"',
  ];
}
