/**
 * The fleet read's one diagnostic sentence for a response with no `search` connection, split from
 * `./reviewState.ts` because it is a self-contained explanation rather than part of the parse.
 */

import { isRecord } from "../../lib/parsers.js";

/**
 * One word for what a value IS, where `typeof` alone would mislead.
 *
 * `typeof null` and `typeof []` are both `"object"`, so a message built straight off `typeof` reads "the
 * response was object, not an object" — self-contradictory in exactly the sentence whose whole job is to be
 * legible to the next session.
 *
 * @param value the value to describe
 * @returns `null`, `array`, or the `typeof` word
 */
function describeValue({ value }: { value: unknown }): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}

/**
 * What a response carried in place of the `search` connection, in the words a reader can act on.
 *
 * Four genuinely different things reach the fleet parser and one sentence used to describe all four: the
 * transport answered something that is not an object at all, it answered an object with no `search` key,
 * GitHub NULLED the field, or `search` came back as a scalar. They have opposite remedies — a nulled field
 * is GitHub declining to compute a query this expensive and is answered by a smaller page (the fleet
 * parser's caller halves one), while a missing key is a query or transport fault no page size will fix —
 * and the failing run's single diagnostic line is the whole record a later session gets.
 *
 * MEASURED: `slopweaver github landing --repo acme/acme-admin --author octocat
 * --json` failed once in twenty-two consecutive runs with the old sentence, and an instrumented re-run of
 * the same command fourteen more times did not reproduce it — so which of the four it was is not knowable
 * from what shipped. Reproduce by looping that command and reading stderr.
 *
 * @param data the raw GraphQL response, as the transport handed it over
 * @returns the clause naming what stood where the connection should have been
 */
export function missingSearchClause({ data }: { data: unknown }): string {
  if (!isRecord(data)) {
    return `the response was ${describeValue({ value: data })}, not an object`;
  }
  if (!("search" in data)) {
    return `the response object carries no \`search\` key at all (keys: ${Object.keys(data).join(", ")})`;
  }
  const search = data["search"];
  if (search === null) {
    return "GitHub answered `search: null`, which is how it declines a query it could not complete";
  }
  return `\`search\` came back as ${describeValue({ value: search })}, not a connection`;
}
