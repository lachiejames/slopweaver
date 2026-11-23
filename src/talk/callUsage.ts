/**
 * A plan call's token cost, as its call file records it. The owner asks what a call costs per turn as it
 * ages. The delegated Codex thread is ephemeral, so the app-server's `thread/tokenUsage/updated` is the only record,
 * and the page writes each one as a `usage` line: that turn's tokens (`last`), the thread's running total (`total`)
 * and the model's context window, `null` when the app-server did not know it.
 */
import { z } from "zod";

/** A token count: a non-negative safe integer. */
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * One turn's tokens, or a thread's running total, as the app-server's `TokenUsageBreakdown` reports them.
 * `cacheWriteInputTokens` is optional there, and an absent one stays absent rather than read as zero.
 */
const tokenBreakdown = z.object({
  cacheWriteInputTokens: tokenCount.optional(),
  cachedInputTokens: tokenCount,
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningOutputTokens: tokenCount,
  totalTokens: tokenCount,
});

/** A `usage` line's own fields; `callRecord.ts` adds the instant and write id every line carries. */
export const CALL_USAGE_FIELDS = {
  contextWindow: tokenCount.nullable(),
  kind: z.literal("usage"),
  last: tokenBreakdown,
  total: tokenBreakdown,
  turnId: z.string().min(1).max(200),
};

/** The shape of one folded usage, for its type. */
const callUsage = z.object(CALL_USAGE_FIELDS).omit({ kind: true }).extend({ atIso: z.string() });

/** The delegated plan thread's tokens after one of its turns, as the call recorded them. */
export type CallUsage = z.infer<typeof callUsage>;

/**
 * Fold one usage line in: the latest line per turn wins at the turn's first position, so a turn the app-server
 * reported more than once, or a batch written twice, is one row. Lines are compared by their own instant, as every
 * other fold in `callRecord.ts` is, because a `keepalive` post can land before a batch still in flight.
 *
 * @param usages the call's usage so far, updated in place
 * @param entry the usage line, already parsed
 */
export function foldUsage({ usages, entry }: { usages: CallUsage[]; entry: CallUsage }): void {
  const { atIso, contextWindow, last, total, turnId } = entry;
  const next: CallUsage = { atIso, contextWindow, last, total, turnId };
  const index = usages.findIndex((usage) => usage.turnId === turnId);
  if (index === -1) {
    usages.push(next);
  } else if (Date.parse(atIso) >= Date.parse(usages[index]!.atIso)) {
    usages[index] = next;
  }
}
