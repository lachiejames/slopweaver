/**
 * The `--ask <channel>/<messageTs>` argument, read the one way every verb that takes it reads it — `turn
 * freeze`, `turn dispatch --sweep`, and the two detective verbs that land a wave in a turn's record set.
 */

/**
 * Split a `--ask <channel>/<messageTs>` argument.
 *
 * @param ask the argument as typed
 * @returns the ask identity's two halves, or `undefined` when the shape is wrong
 */
export function parseAskArgument({ ask }: { ask: string }): { channel: string; messageTs: string } | undefined {
  const slash = ask.indexOf("/");
  if (slash <= 0 || slash === ask.length - 1) {
    return undefined;
  }
  return { channel: ask.slice(0, slash), messageTs: ask.slice(slash + 1) };
}
