/**
 * The usage lines of `talk glossary`, `origin`, `knowledge`, `history`, `recent`, `find-card`, `slack-after`,
 * `slack-send-outcome`, `slack-open` and `slack-channel` — a leaf importing
 * nothing, so the `talk` manifest can quote them without loading a parser (`.claude/rules/area-cli.md`).
 */

/** The usage `talk find-card` prints. */
export const TALK_FIND_CARD_USAGE = "usage: slopweaver talk find-card <words>... [--home <dir>] [--json]";

/** The usage `talk glossary` prints. */
export const TALK_GLOSSARY_USAGE = "usage: slopweaver talk glossary [--term <words>] [--json]";

/** The usage `talk origin` prints. */
export const TALK_ORIGIN_USAGE =
  "usage: slopweaver talk origin --slug <board-slug> [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk knowledge` prints. */
export const TALK_KNOWLEDGE_USAGE =
  "usage: slopweaver talk knowledge --query <words> [--limit <n>] [--max-bytes <n>] [--json]";

/** The usage `talk history` prints. */
export const TALK_HISTORY_USAGE =
  "usage: slopweaver talk history --phrase <words> [--hours <n>] [--max-bytes <n>] [--home <dir>] [--now <iso>] [--json]";

/** The usage `talk recall` prints. */
export const TALK_RECALL_USAGE = [
  "usage: slopweaver talk recall --words <words> [--days <n>] [--source calls|steers|rulings|knowledge] [--max-bytes <n>] [--home <dir>] [--now <iso>] [--json]",
  "       slopweaver talk recall --open <pointer> [--from <n>] [--max-bytes <n>] [--home <dir>] [--json]",
].join("\n");

/** The usage `talk slack-after` prints. */
export const TALK_SLACK_AFTER_USAGE =
  "usage: slopweaver talk slack-after --url <slack-message-link> [--max-bytes <n>] [--home <dir>] [--json]";

/** The usage `talk slack-send-outcome` prints. */
export const TALK_SLACK_SEND_OUTCOME_USAGE =
  "usage: slopweaver talk slack-send-outcome --url <slack-message-link> --since <iso> [--home <dir>] [--json]";

/** The usage `talk meeting-due` prints. */
export const TALK_MEETING_DUE_USAGE = "usage: slopweaver talk meeting-due [--now <iso>] [--home <dir>] [--json]";

/** The usage `talk steer-risk` prints. */
export const TALK_STEER_RISK_USAGE = "usage: slopweaver talk steer-risk [--home <dir>] [--json]";

/** The usage `talk slack-open` prints. */
export const TALK_SLACK_OPEN_USAGE =
  "usage: slopweaver talk slack-open --url <slack-message-link> [--max-bytes <n>] [--home <dir>] [--json]";

/** The usage `talk slack-channel` prints. */
export const TALK_SLACK_CHANNEL_USAGE =
  "usage: slopweaver talk slack-channel --channel <#name|slack-link|id> [--max-bytes <n>] [--home <dir>] [--json]";

/** The usage `talk capabilities` prints. */
export const TALK_CAPABILITIES_USAGE = "usage: slopweaver talk capabilities [<noun> [<verb>]] [--json]";

/** The usage `talk recent` prints. */
export const TALK_RECENT_USAGE =
  "usage: slopweaver talk recent [--hours <n>] [--dir <dir>] [--home <dir>] [--now <iso>] [--json]";
