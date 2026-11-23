/*
 * The pure fixtures the `handover wake` test files share: the frozen clock and the instants around it, the
 * journal line a fake spawn appends, the record one fake run fills, and a green open head. Nothing here touches
 * disk; `harness.ts` beside it owns the home. They moved here when `wakeRun.test.ts` was split by behaviour.
 */
import type { RunEvent } from "../../../../../../handover/ledger.js";
import type { ChecksWakeObservation } from "../../../../../../handover/parkWake.js";

export const NOW = new Date("2026-10-15T03:13:00.000Z");
export const PAST = "2026-10-15T03:00:00Z";
export const FUTURE = "2026-10-15T04:00:00Z";
export const AFTER = "2026-10-15T03:14:00.000Z";
/** Five minutes past {@link NOW}: inside `--retry`'s window. */
export const RETRY_AFTER = "2026-10-15T03:18:00.000Z";

/**
 * One line the fake spawn journals: its own dispatch, or what another session wrote meanwhile.
 *
 * @returns the run-journal event, stamped {@link AFTER}
 */
export function spawnLine({ kind, slug }: { kind: "dispatched" | "abandoned" | "started"; slug: string }): RunEvent {
  if (kind === "dispatched") {
    return { atIso: AFTER, by: "cmux spawn", kind, target: "workspace:9" };
  }
  if (kind === "started") {
    return { atIso: AFTER, branch: slug, docHash: "h", kind };
  }
  return { atIso: AFTER, kind, why: "cancelled" };
}

/** What one fake run recorded. */
export interface Recorded {
  readonly spawned: string[];
  /** Each `handover finish` asked, by slug, ` --dry-run` appended on a dry run. */
  readonly finished: string[];
  /** The directory each `handover finish` was asked to run in, in ask order. */
  readonly finishCwds: string[];
  /** The park each `handover finish` was bound to (`--parked-at`), in ask order. */
  readonly finishParks: string[];
  /** The `--probed-repo` and `--probed-tree` each `handover finish` carried, space-joined, in ask order. */
  readonly finishRepos: string[];
  /** Each finish child's lessons break-glass, `<slug> <allowNoLessons>`, in ask order. */
  readonly finishLessons: string[];
  /** Each `<repo>#<number>` whose head the reconcile read, in read order. */
  readonly headReads: string[];
  /** Each `<dir>@<oid>` the wake asked whether a checkout holds a merge, in ask order. */
  readonly mergeChecks: string[];
  /** Each question pass readiness ask, `<slug> --dry-run <allowNoLessons>`, in ask order. */
  readonly readied: string[];
  readonly out: string[];
  readonly diagnostics: string[];
  /** One entry per attempt id minted, so the nth reads `n-<n>`. */
  readonly nonces: number[];
  readonly slept: number[];
}

/**
 * A fresh record.
 *
 * @returns a record with every list empty
 */
export function record(): Recorded {
  return {
    diagnostics: [],
    finishCwds: [],
    finishLessons: [],
    finishParks: [],
    finishRepos: [],
    finished: [],
    headReads: [],
    mergeChecks: [],
    nonces: [],
    out: [],
    readied: [],
    slept: [],
    spawned: [],
  };
}

/**
 * A green, open head: what a seat that enqueued sees, and parks on again.
 *
 * @returns the checks observation for one passing unit run on that head
 */
export function green({
  headSha = "abc",
  runId = "101",
}: { headSha?: string; runId?: string } = {}): ChecksWakeObservation {
  return {
    checks: {
      baseRef: "main",
      checks: [{ conclusion: "SUCCESS", kind: "check-run", name: "unit", runId, state: "passed", url: undefined }],
      headSha,
      mergeable: "MERGEABLE",
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    prState: "OPEN",
  };
}
