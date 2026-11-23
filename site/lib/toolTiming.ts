/**
 * How long one of the voice's tool calls took and what the answer after it cost, in the few words a
 * transcript row carries.
 *
 * A tool call that says "checking" and then takes over 15 seconds to respond reads as lag. So the pause is
 * measured on every row: `ms` runs from the call arriving to its answer
 * going back over the channel — the silence the owner hears — and the tokens are the delegated response's own
 * `usage`, so a screen frame's real cost sits beside its estimate.
 */

/** A response's usage as the row reads it. */
export interface TimingUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

/**
 * The timing words for one row, or `""` when there is nothing measured to say.
 *
 * @param ms the tool's round trip, or `undefined` when it was not timed
 * @param usage the following response's usage, or `undefined` until it lands
 * @returns e.g. `1.8s · 4,210 in / 96 out (64 thinking)`
 */
export function toolTimingWords({ ms, usage }: { ms: number | undefined; usage: TimingUsage | undefined }): string {
  const parts: string[] = [];
  if (ms !== undefined) {
    parts.push(ms < 1000 ? `${String(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
  }
  if (usage !== undefined) {
    let tokens = `${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out`;
    if (usage.reasoningTokens > 0) {
      tokens += ` (${usage.reasoningTokens.toLocaleString("en-US")} thinking)`;
    }
    parts.push(tokens);
  }
  return parts.join(" · ");
}
