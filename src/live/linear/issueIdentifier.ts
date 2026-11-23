/**
 * The Linear issue identifier a verification pass filters on: `ABC-123`, split into its team key and number.
 * The pass itself is `./verify.ts`.
 */

/**
 * A Linear issue identifier, WHOLE: a team key and a number, and nothing else.
 *
 * Anchored at both ends rather than split on `-`, because a split accepts a UUID — `abc-123-uuid` yields
 * team `abc` and number `123` — and a filter built from those two would ask the provider about a real ticket
 * that is not the one being cited. A shape this does not recognise becomes an `unverified` citation instead.
 */
const ISSUE_IDENTIFIER = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/u;

/**
 * Split an `ABC-123` identifier into the two halves the issue filter needs.
 *
 * @param identifier the citation's identifier
 * @returns the team key and issue number, or undefined when the identifier is not that shape
 */
export function parseIssueIdentifier({
  identifier,
}: {
  identifier: string;
}): { readonly team: string; readonly number: number } | undefined {
  const match = ISSUE_IDENTIFIER.exec(identifier);
  const team = match?.[1];
  const number = match?.[2];
  if (team === undefined || number === undefined) {
    return undefined;
  }
  return { number: Number(number), team };
}
