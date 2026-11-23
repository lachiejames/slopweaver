/**
 * The session a process's argv names, for the Fleet page's live machine reading (`./liveMachine.ts`): the second way
 * a session root is found when Claude Code's own registry misses it. Pure.
 */

/** A Claude Code session id as Claude Code mints it, judged whole. */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The flag a session id travels on. */
const SESSION_ID_FLAG = "--session-id";

/**
 * The session an argv names: exactly one `--session-id` token, valued or not, whose value is a whole UUID.
 *
 * @returns the session id, or `undefined`
 */
export function argvSessionIdOf({ argv }: { argv: string }): string | undefined {
  const tokens = argv.split(/\s+/u);
  const at = tokens.flatMap((token, index) =>
    token === SESSION_ID_FLAG || token.startsWith(`${SESSION_ID_FLAG}=`) ? [index] : [],
  );
  const index = at.at(0);
  if (at.length !== 1 || index === undefined) {
    return undefined;
  }
  const token = tokens.at(index);
  if (token === undefined) {
    return undefined;
  }
  let value: string | undefined = token.slice(SESSION_ID_FLAG.length + 1);
  if (token === SESSION_ID_FLAG) {
    value = tokens.at(index + 1);
  }
  if (value === undefined || !SESSION_UUID.test(value)) {
    return undefined;
  }
  return value;
}
