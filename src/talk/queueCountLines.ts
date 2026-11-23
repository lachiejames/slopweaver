/**
 * The Queue-count lines both Talk prompts carry (`./sessionConfig.ts`): a number of Queue cards, items or asks is
 * said only off the matching labelled `action_items.shown` field read in the same turn, never counted from a list
 * or remembered. The pull request fact rule (`./prFactLines.ts`) sits directly after it in both prompts.
 */

/** The voice's lines: a count is the thinking model's `action_items.shown` read, or unread. */
export const QUEUE_COUNT_VOICE_LINES: readonly string[] = [
  "Never state a number of Queue cards, items or asks from memory or from a list you counted. Hand the",
  "question to the thinking model and speak only the matching labelled action_items.shown count it returns;",
  "if that field is unread, say the count is unread.",
];

/** The thinking model's bullet: which field is the receipt for a count. */
export const QUEUE_COUNT_BACKEND_LINES: readonly string[] = [
  "- Before stating any number of Queue cards, items or asks, call action_items in this turn and use only the",
  "  matching labelled field under shown. Never count detail rows or reuse an earlier number; if that field is",
  "  unread, say so instead of giving a total.",
];
