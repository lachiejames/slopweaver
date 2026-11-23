/**
 * The authored section of the state-home classification: every top-level directory the fleet wrote, that nothing
 * can rebuild and no other row owns — the rows `store import-fleet --only authored` reads — plus the `talk/attachments`
 * and `talk/threads` local-only carve-outs that sit directly after `talk`, where the deepest-row rule finds them.
 *
 * Spread into `HOME_DIRECTORY_CLASSIFICATION` (`./authoredDirectories.ts`) after the top-level files; a new authored
 * directory goes here, and a new state directory with no row is never backed up.
 */
import type { HomeDirectoryClassification } from "./authoredDirectories.js";
import { exact } from "./homeClassificationRow.js";

/** The authored directory rows, in name order, with the family-prefix rows and the two `talk/` carve-outs in place. */
export const AUTHORED_DIRECTORY_ROWS: readonly HomeDirectoryClassification[] = [
  exact({
    because: "claude.ai artifact sources the retired artifact store no longer serves",
    directoryClass: "authored",
    name: "artifact-migration",
  }),
  exact({ because: "draft pages written before a publish", directoryClass: "authored", name: "artifact-drafts" }),
  exact({
    because: "session-authored HTML deliverables and their stills",
    directoryClass: "authored",
    name: "artifacts",
  }),
  exact({
    because: "a proof run's captured output, not re-takeable after the fact",
    directoryClass: "authored",
    name: "briefing-shape-proof",
  }),
  exact({ because: "each live turn's brief as the turn wrote it", directoryClass: "authored", name: "briefs" }),
  exact({ because: "Claude Code's auto-memory, from ~/.claude", directoryClass: "authored", name: "claude-memory" }),
  exact({
    because: "calendar write intents awaiting the owner's approval",
    directoryClass: "authored",
    name: "calendar",
  }),
  exact({
    because: "the text of every relay one session typed into another",
    directoryClass: "authored",
    name: "cmux-relays",
  }),
  exact({ because: "design notes and their working data", directoryClass: "authored", name: "design" }),
  exact({ because: "detective wave reports", directoryClass: "authored", name: "detective" }),
  exact({ because: "dogfood captures of real threads", directoryClass: "authored", name: "dogfood" }),
  exact({
    because: "settings backups taken before a change, the only copy of the prior bytes",
    directoryClass: "authored",
    name: "dotfile-backups",
  }),
  exact({ because: "drafts of posts and risk acceptances", directoryClass: "authored", name: "drafts" }),
  exact({ because: "answer-quality cases and samples", directoryClass: "authored", name: "eval" }),
  exact({ because: "fixture handoffs waiting to be frozen", directoryClass: "authored", name: "fixtures-pending" }),
  exact({ because: "the footprint assignment register", directoryClass: "authored", name: "footprint" }),
  exact({
    because: "the steps only the owner's hands can take, and what was pushed about them",
    directoryClass: "authored",
    name: "hand-steps",
  }),
  exact({
    because: "the proof behind settled board rows; backfill-proof.* is the board before a backfill, its only copy",
    directoryClass: "authored",
    name: "handover-evidence",
  }),
  exact({ because: "handover fragments written beside a page", directoryClass: "authored", name: "handover-notes" }),
  exact({
    because: "the board itself; board_row splits the front-matter into columns, so only these bytes restore a doc",
    directoryClass: "authored",
    name: "handovers",
  }),
  {
    because: "a copy of the board from before a rewrite; deleted docs exist nowhere else",
    directoryClass: "authored",
    name: "handovers-backup-",
    prefix: true,
  },
  exact({ because: "instrument findings from a code-quality lens", directoryClass: "authored", name: "instruments" }),
  exact({
    because: "the judgement profile, owner directives and mining brief",
    directoryClass: "authored",
    name: "judgement",
  }),
  exact({ because: "rearm scripts a loop session wrote", directoryClass: "authored", name: "loop-state" }),
  {
    because: "memory files removed from the index; the only copy of what was pruned",
    directoryClass: "authored",
    name: "memory-deindexed-",
    prefix: true,
  },
  exact({ because: "morning reports and self-improvement passes", directoryClass: "authored", name: "morning" }),
  exact({ because: "the onboarding eval's report register", directoryClass: "authored", name: "onboard-eval" }),
  exact({ because: "pull-request forms a session composed", directoryClass: "authored", name: "pr-forms" }),
  exact({ because: "proof scripts a session wrote to settle a claim", directoryClass: "authored", name: "probes" }),
  exact({
    because: "the owner's profile context and the harvest behind it",
    directoryClass: "authored",
    name: "profile",
  }),
  exact({ because: "prompt texts a session wrote", directoryClass: "authored", name: "prompts" }),
  exact({
    because: "proposals and the memory-hygiene proposal register",
    directoryClass: "authored",
    name: "proposals",
  }),
  exact({ because: "Slack drafts queued for the owner's send", directoryClass: "authored", name: "queue" }),
  exact({
    because: "registers of owner discussions and recurring-failure anchors",
    directoryClass: "authored",
    name: "registers",
  }),
  exact({ because: "answers rescued from a failed turn", directoryClass: "authored", name: "rescued" }),
  exact({ because: "resume proofs and their screenshots", directoryClass: "authored", name: "resume" }),
  exact({ because: "run notes and lessons written mid-run", directoryClass: "authored", name: "run-notes" }),
  exact({
    because: "every run's journal; run_event stores payloads as jsonb, which does not keep a line's bytes",
    directoryClass: "authored",
    name: "runs",
  }),
  exact({
    because: "captures deliberately rescued out of a scratch tree",
    directoryClass: "authored",
    name: "scratch-rescue",
  }),
  exact({
    because: "grants, intake marks, the supervisor chain and session notes",
    directoryClass: "authored",
    name: "sessions",
  }),
  exact({ because: "screenshots taken as evidence", directoryClass: "authored", name: "shots" }),
  exact({ because: "saved corpus slices", directoryClass: "authored", name: "slices" }),
  exact({
    because: "the console voice's turns and relays — the owner's words",
    directoryClass: "authored",
    name: "talk",
  }),
  exact({
    because:
      "copies of files the owner attached in the Messenger, for file_read; the original is the owner's, so never backed up",
    directoryClass: "scratch",
    name: "talk/attachments",
  }),
  exact({
    because:
      "each call's Codex thread journal: noisy, verbose, and kept on this Mac only — the owner's ruling keeps their words and the record in the backup, call threads out",
    directoryClass: "scratch",
    name: "talk/threads",
  }),
  exact({ because: "team-readiness notes", directoryClass: "authored", name: "teamready" }),
  exact({ because: "transcripts the owner handed over", directoryClass: "authored", name: "transcripts" }),
  exact({ because: "what each Vanta atlas sync changed", directoryClass: "authored", name: "vanta" }),
  exact({
    because: "provider state captured before a delete, not re-fetchable after it",
    directoryClass: "authored",
    name: "vanta-group-snapshots",
  }),
  exact({ because: "visual-evidence captures and records", directoryClass: "authored", name: "visual-evidence" }),
  exact({
    because: "git bundles of unmerged work salvaged from pruned worktrees",
    directoryClass: "authored",
    name: "worktree-bundles",
  }),
];
