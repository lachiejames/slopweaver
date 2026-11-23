/**
 * The escape-hatch rows for how a piece of work is DELIVERED — a branch pushed before its public ask is
 * answered, a vulnerability top-up batch held by the merge-release gate, and a stack adoption that registers
 * without replaying.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new delivery-sequence refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the work-delivery sequence, in register order. */
export const DELIVERY_WORKFLOW_HATCHES = [
  {
    caught:
      "this session is the dispatched worker for a PUBLIC ask that has no answer in its thread yet, and a pull request is not an answer — a colleague watching that thread cannot see a branch (measured: two hours and thirty-eight minutes of tooling on C0SYN000006/1789952379.135579 before the first word reached the channel)",
    command: "slopweaver github stack push",
    exceptions: [
      "the pull request IS the answer the ask named, and the thread reply that cites it goes out in the same breath",
      "the ask is not what this branch is about — the work predates it, or the owner interrupted mid-turn to ask for something else",
      "the answer is already written and the door refused it for a reason this branch is the fix for",
    ],
    id: "answer-first",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ANSWER_FIRST" },
    lane: "ambient",
    reader: "src/cli/commands/github/answerFirstGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the merge-release gate holds the next top-up batch until the share of the previous raised batch the row's --release-after-merged names has merged",
    command: "slopweaver vulnerability-fix topup",
    exceptions: [
      "the named board row's standing ruling is the owner's explicit steer with a deliver-by still ahead, and that steer needs this batch raised now — the release is journalled on that row before anything is registered",
    ],
    id: "vulnerability-fix-topup-gate",
    key: { kind: "command", incantation: "slopweaver vulnerability-fix topup ... --steer-row <slug>" },
    lane: "ambient",
    reader: "src/cli/commands/vulnerabilityFix/topupSteer.ts",
    standing: "proposed",
  },
  {
    caught: "replay requires a checked-out branch matching the remote head and exactly one effective tip commit",
    command: "slopweaver github stack adopt",
    exceptions: [
      "only native membership and local enrolment are needed, without rebasing or pushing the branch",
      "the branch has drifted past what a single-commit replay can move, and the chain must stop being invisible to GitHub first",
    ],
    id: "stack-adopt-register-only",
    key: { kind: "command", incantation: "slopweaver github stack adopt --pr <n> --register-only" },
    lane: "ambient",
    reader: "src/cli/commands/github/stackAdoptCore.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
