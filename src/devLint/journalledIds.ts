/**
 * THE OUTBOUND ROWS OF THE ESCAPE-HATCH REGISTER — the one home of the criterion, as data. The gate that reads
 * it back is `./escapeHatch.ts`.
 */

/**
 * Every register row that belongs in the journalled lane — the OUTBOUND rows, and
 * nothing else. A row added to an outbound surface afterwards joins this set by the same criterion, which is
 * how `answer-image-observations` is here without a second ruling, and how `digest-before-topup` is: what it
 * waives is a Slack post into a team channel, so the audience is a person and the criterion is met.
 *
 * Spelled here rather than derived from the reader path, because "outbound" is a judgement about who the
 * audience is (a person, not a file) and no path prefix computes it: `admit/skillLoadGate.ts` is outbound
 * and `admit/pollGate.ts` is not, and they are siblings. Pinning the set is what makes a row that quietly
 * changes lane a gate failure rather than a diff nobody read.
 *
 * **This set is the criterion's one home, so canon points at it rather than restating a count.**
 * `.claude/rules/error-handling.md` said "the 19 outbound rows" while this set held 24 — a number that went
 * stale the first time a row joined and misled every reader in between.
 */
export const JOURNALLED_IDS: ReadonlySet<string> = new Set([
  "answer-image-observations",
  "animated-gif",
  "answer-quality",
  "asker-tag",
  "bare-refs",
  "channel-steered-draft",
  "core-deliverable",
  "datadog-citation",
  "declined-atlas",
  "digest-before-topup",
  "door-demo",
  "earns-its-place",
  "high-stakes-second-post",
  "high-stakes-undefended",
  "invalid-datadog-console-host",
  "invented-visual",
  "local-page-path",
  "markdown-first",
  "pr-evidence-loss",
  "public-drip",
  "real-artifact",
  "redundant-quote",
  "repeat-send",
  "retired-linear-team",
  "repeat-thread-reply",
  "responder-allow-open",
  "skill-load",
  "slack-duplicate-send",
  "stale-cards",
  "stale-snapshot",
  "truncated-send",
  "uncited-controls",
  "unmeasured-figures",
  "unproven-render",
  "unshown-graphs",
  "unread-image",
  "untagged-bump",
  "voice-briefing",
  "voice-profile",
  "voice-rules",
  "wall",
  "withhold-reply",
]);
