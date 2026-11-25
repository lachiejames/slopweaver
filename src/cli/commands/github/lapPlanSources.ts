/**
 * The files whose running copy must read the same as the head's before `slopweaver github lap` runs a lane: the
 * register `./lapCore.ts`'s `lapPlan` reads, `ci.yml`, and EVERY module of this verb, this one included. Why the
 * comparison exists, and what it does not cover, is `./lapCore.ts`'s header.
 *
 * The lap-seat gate's modules are listed with the rest. That gate computes no step, but its verdict decides whether
 * a caller may lap at all, so a running CLI holding a stale copy of it could let an off-seat session lap with no
 * plan source differing. The list sits in its own module so it can grow without pushing `./lapCore.ts` over the
 * file-size ratchet, and that module is in the list too.
 */

/** The files the lap's plan and gate are computed from; each must read the same here as at the head the lap tests. */
export const LAP_PLAN_SOURCES: readonly string[] = [
  ".github/workflows/ci.yml",
  ...[
    "lapBatchArgs",
    "lapBatchCore",
    "lapBatchLand",
    "lapBatchPhases",
    "lapBatchRun",
    "lapBatchShell",
    "lapCleanup",
    "lapCleanupDeps",
    "lapCompileLease",
    "lapCore",
    "lapDeps",
    "lapErrors",
    "lapLanes",
    "lapLock",
    "lapLockShape",
    "lapPhases",
    "lapPlanSources",
    "lapPreflightReads",
    "lapProcess",
    "lapReceipts",
    "lapRun",
    "lapSeat",
    "lapSeatRun",
    "lapSeatStore",
    "lapSeatUsage",
    "lapShell",
    "lapSignals",
    "lapStatusPost",
    "lapStatuses",
    "lapStepProcess",
    "lapSteps",
    "lapStore",
    "lapTree",
    "lapUsage",
    "lapVerb",
    "lapVerdict",
  ].map((name) => `src/cli/commands/github/${name}.ts`),
  "src/devLint/ciOffloadCommands.ts",
  "src/testLanes/unitShards.ts",
];
