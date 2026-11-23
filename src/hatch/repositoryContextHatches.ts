/**
 * The escape-hatch rows for acting in the right REPOSITORY CONTEXT — a dirty tree under a stack adoption, a
 * pull request that is not this session's, a description replaced or stripped of evidence, and a CLI run
 * from another checkout.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new repository-context refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the repository context a verb acts in, in register order. */
export const REPOSITORY_CONTEXT_HATCHES = [
  {
    caught: "the working tree is dirty, and adopting a stack over uncommitted work loses it",
    command: "slopweaver github stack adopt",
    exceptions: ["the dirt is entirely in ignored scratch files you can name"],
    id: "dirty-tree",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_DIRTY_TREE" },
    lane: "ambient",
    reader: "src/cli/commands/github/stackAdoptCore.ts",
    standing: "ruled",
  },
  {
    caught: "the pull request was not opened by this account, so editing it would overwrite somebody else's words",
    command: "slopweaver github pr update",
    exceptions: [
      "the PR is the bot's own, opened under a different token in an earlier session",
      "it is a dependency-bump BOT's pull request whose template can never satisfy this repository's own pr-format gate, and `github bump-drive` is recomposing the description from the typed bump form",
    ],
    id: "foreign-pr",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FOREIGN_PR" },
    lane: "ambient",
    reader: "src/cli/commands/github/updateCore.ts",
    standing: "ruled",
  },
  {
    caught:
      "the edit would REPLACE a pull-request body wholesale rather than amend it, discarding sections you did not write",
    command: "slopweaver github pr update --form",
    exceptions: ["you are re-composing the whole body from a form and have read the live one first"],
    id: "pr-replace",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PR_REPLACE" },
    lane: "ambient",
    reader: "src/cli/commands/github/updateCore.ts",
    standing: "ruled",
  },
  {
    caught:
      "the new description drops a screenshot or a CI run link that a settled ask of the owner's named this pull request for, and SLOPWEAVER_ALLOW_PR_REPLACE does not release it",
    command: "slopweaver github pr update",
    exceptions: [
      "the owner superseded or withdrew that evidence requirement, and the new description records the newer word",
      "the old screenshot or run URL is dead or wrong, and the new description carries the same evidence at its corrected URL",
    ],
    id: "pr-evidence-loss",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/commands/github/settledEvidenceGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the CLI being invoked is not the one this checkout ships, so a worktree proof would silently exercise another tree",
    command: "bin/slopweaver dev",
    exceptions: ["you are deliberately exercising the installed CLI against this worktree's fixtures"],
    id: "foreign-cli",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FOREIGN_CLI" },
    lane: "ambient",
    reader: "bin/slopweaver",
    standing: "ruled",
  },
  {
    caught:
      "the push targets a repository whose history was re-cut, and a commit it would send does not descend from that repository's one recorded root, so it would publish the history the re-cut left behind",
    command: "git push / slopweaver github <push|stack push|stack submit>",
    exceptions: [
      "a deliberate restore of the old history into a repository the owner named for it, with the destination checked first",
      "the push-root register itself is corrupt, and the push goes to a repository you have confirmed was never re-cut",
    ],
    id: "old-history-push",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH" },
    lane: "ambient",
    reader: "src/admit/pushRootGate.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
