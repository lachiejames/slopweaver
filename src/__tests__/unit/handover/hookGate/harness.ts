/*
 * What the hook-gate test files share: two session ids, the writer another session recorded, an `OpenRun` builder
 * whose defaults are the one shape that blocks, and the Stop payload and empty environment the `stopGateDecision`
 * files pass. They moved here when the hook gate's tests were split by behaviour.
 */
import type { ProbeTally } from "../../../../handover/gateReport.js";
import type { OpenRun } from "../../../../handover/hookGate.js";
import type { RunWriter } from "../../../../handover/runOwner.js";

export const MINE = "session-mine";
export const THEIRS = "session-theirs";

/** The writer another session recorded, with the detail a refusal would have to name. */
export const OTHER_WRITER: RunWriter = {
  atIso: "2026-08-06T01:00:00.000Z",
  pid: 4242,
  sessionId: THEIRS,
  worktree: "/wt/other",
};

/** Two failing probes out of three — enough for `anythingChecked` to be true. */
const FAILING: ProbeTally = { failed: 2, notEvaluated: 0, passed: 1 };

/**
 * One run on disk. Defaults to the only shape that blocks, so each test relaxes exactly one thing.
 *
 * @returns the open run, every field the test did not name at its blocking default
 */
export function run(over: Partial<OpenRun> = {}): OpenRun {
  return {
    branch: "feat/a",
    branchResolves: true,
    claim: undefined,
    docClaim: "one",
    head: "aaaaaaaaaaaa",
    journalAmbiguous: false,
    ownership: { kind: "unowned" },
    phase: "open",
    previous: undefined,
    progress: { kind: "first-look" },
    reapable: false,
    settled: undefined,
    slug: "a-doc",
    tally: FAILING,
    writerLiveness: undefined,
    ...over,
  };
}

export const STOP = { hook_event_name: "Stop", stop_hook_active: false };
export const NO_ENV: NodeJS.ProcessEnv = {};
