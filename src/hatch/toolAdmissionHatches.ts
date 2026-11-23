/**
 * The escape-hatch rows for the `PreToolUse` admission of a tool call — a repeated poll of the same target,
 * a write or a branch switch inside a declared main checkout, and a tool call reaching an owner-protected path.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new tool-admission refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on tool-call admission, in register order. */
export const TOOL_ADMISSION_HATCHES = [
  {
    caught:
      "the same target was polled inside the poll window, and a re-read of unchanged context costs the full context again",
    command: "a repeated read of the same log, pid or task",
    exceptions: [
      "the first read was truncated and you need the rest of the file",
      "an external system the harness cannot notify you about changed in between",
    ],
    id: "poll",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_POLL" },
    lane: "ambient",
    reader: "src/admit/pollGate.ts",
    standing: "ruled",
  },
  {
    caught: "the target is a DECLARED main checkout, which no session may write into from anywhere",
    command: "a write inside a declared main checkout",
    exceptions: [
      "the write is to an ignored scratch path rather than tracked source",
      "the owner asked for this specific main-checkout change in the ask you are executing",
    ],
    id: "main-checkout-write",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_WRITE" },
    lane: "ambient",
    reader: "src/admit/mainCheckoutDirtyGuard.ts",
    standing: "ruled",
  },
  {
    caught: "switching a declared main checkout's branch moves the ground under every other session using it",
    command: "git checkout / switch in a declared main checkout",
    exceptions: [
      "you are the only session on this machine and the switch is being reverted in the same turn",
      "the checkout is being repointed at the branch it was already meant to hold",
    ],
    id: "main-checkout-branch-switch",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_MAIN_CHECKOUT_BRANCH_SWITCH" },
    lane: "ambient",
    reader: "src/admit/mainCheckoutBranchGuard.ts",
    standing: "ruled",
  },
  {
    caught:
      "the path is listed in $SLOPWEAVER_HOME/protected-paths.json — a read-only path is never written, " +
      "a no-access path is never read or written — and that list changes only through the slopweaver protect verb",
    command: "a Read, Edit, Write, Grep, Glob or Bash call reaching a protected path",
    exceptions: [
      "the owner asked, in their own words, for this one read or write of a path they protected, and it is relayed with its anchor",
      "the registry protects a throwaway path a test created, never one of the owner's, and you have checked the path",
    ],
    id: "protected-path",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PROTECTED_PATH" },
    lane: "ambient",
    reader: "src/admit/protectedPathGuardRunner.ts",
    standing: "proposed",
  },
  {
    caught:
      "removing a protected path, or making a no-access path read-only, gives every session access the owner took " +
      "away — adding a path or tightening one needs nobody's leave, loosening one is the owner's call",
    command: "slopweaver protect remove <path>, or a protect add that loosens a no-access path to read-only",
    exceptions: [
      "the owner asked, in their own words, for this one path to be unprotected or loosened, relayed with its anchor",
      "the entry is a throwaway path a test or a witness registered itself, never one of the owner's",
    ],
    id: "protect-remove",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PROTECT_REMOVE" },
    lane: "ambient",
    reader: "src/cli/commands/protect/run.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
