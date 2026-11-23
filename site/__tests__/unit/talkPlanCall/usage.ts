/**
 * One turn's token usage as the app-server reports it, and the notification line that carries it: shared by the
 * `PlanCall` tests that read usage (`turns.test.ts`) and the ones that roll a nearly full thread over
 * (`contextRollover.test.ts`).
 */

/** A turn's usage on a 272,000-token window, well short of any rollover share. */
export const TURN_USAGE = {
  last: {
    cachedInputTokens: 30_000,
    inputTokens: 41_200,
    outputTokens: 310,
    reasoningOutputTokens: 120,
    totalTokens: 41_510,
  },
  modelContextWindow: 272_000,
  total: {
    cachedInputTokens: 90_000,
    inputTokens: 118_400,
    outputTokens: 1_020,
    reasoningOutputTokens: 400,
    totalTokens: 119_420,
  },
};

/**
 * A `thread/tokenUsage/updated` notification line, as the app-server writes it.
 *
 * @param tokenUsage the usage it reports, malformed on purpose in some tests
 * @returns the line, newline-terminated
 */
export const usageLine = ({
  threadId,
  turnId,
  tokenUsage,
}: {
  threadId: string;
  turnId: string;
  tokenUsage: unknown;
}): string => `${JSON.stringify({ method: "thread/tokenUsage/updated", params: { threadId, tokenUsage, turnId } })}\n`;

/**
 * {@link TURN_USAGE} with its last request's input set, for a thread filled to a given point.
 *
 * @param inputTokens the last request's input, which is the thread's context as it stands
 * @returns the usage
 */
export const usageAt = ({ inputTokens }: { inputTokens: number }): typeof TURN_USAGE => ({
  ...TURN_USAGE,
  last: { ...TURN_USAGE.last, inputTokens },
});
