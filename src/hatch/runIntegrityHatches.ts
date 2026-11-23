/**
 * The escape-hatch rows for the integrity of an orchestration run — a start on a finished run, an unreviewed
 * landing, a structural `doneWhen` probe, and a hook-gated command while a run is open.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new run-integrity refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on an orchestration run's integrity, in register order. */
export const RUN_INTEGRITY_HATCHES = [
  {
    caught: "this run already ran to completion, and a second lap over a settled run rewrites a finished record",
    command: "slopweaver handover start on a finished run",
    exceptions: ["the first lap ended in an error that left the work genuinely undone"],
    id: "rerun",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_RERUN" },
    lane: "ambient",
    reader: "src/handover/boardRefusal.ts",
    standing: "ruled",
  },
  {
    caught:
      "the branch has not been through the Codex pairing floor — a plan before the work, a review of the diff " +
      "(AGENTS.md rule 9) — or its pass records could not be read completely",
    command: "slopweaver codex status --check",
    exceptions: [
      "the change is a one-line revert of a commit that is already known bad",
      "the pass records are unreadable for a reason that has nothing to do with this branch",
    ],
    id: "unreviewed",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREVIEWED" },
    lane: "ambient",
    reader: "src/cli/commands/codex/statusRun.ts",
    standing: "ruled",
  },
  {
    caught:
      "the probe is structural rather than behavioural, and a structural probe passes on a symbol that does nothing",
    command: "registering a doneWhen probe",
    exceptions: ["the deliverable genuinely IS a declaration — a register row, a type, a manifest entry"],
    id: "structural-probe",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_STRUCTURAL_PROBE" },
    lane: "ambient",
    reader: "src/handover/behaviouralProbe.ts",
    standing: "ruled",
  },
  {
    caught: "the run gate holds a session whose open run has not been resumed",
    command: "any hook-gated command while a run is open",
    exceptions: ["you are debugging the run gate itself and no real run is in flight"],
    id: "no-run-gate",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_NO_RUN_GATE" },
    lane: "ambient",
    reader: "src/handover/hookGate.ts",
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
