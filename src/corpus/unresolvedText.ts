/**
 * The ONE test for "these words read as unresolved work", and the only reason it is its own leaf module.
 *
 * Two callers need the same answer from opposite ends of the pipeline. `../silver/opportunity` asks it of a
 * whole record while building silver, and `./corpusStore`'s `derive` projection asks it at PARSE time, so it
 * can record the answer and then drop the `text` it was derived from (43.8% of bronze's bytes, measured
 * over 43,380 records across all six sources).
 *
 * A copy in each place is the drift this repository has been bitten by before: the markers were tightened
 * once already — PR4.8 replaced bare `includes` substrings with word boundaries after the old list matched
 * `open` inside `reopened`/`opening`/`opens` and flagged 750 records as blockers on the dogfood corpus — and
 * a second copy would have kept the loose behaviour on one path while the other tightened. One list, two
 * importers, no way for them to disagree.
 *
 * Pure, and deliberately dependency-free so the corpus layer can import it without reaching into silver.
 */

/**
 * Word-boundary markers for "this reads like open work". PR4.8 tightened these from bare `includes`
 * substrings: the old list matched `open` anywhere, so `reopened`/`opening`/`opens` flagged 750 records as
 * blockers on the dogfood corpus. Each is now a whole-word (or whole-phrase) match, and the too-generic
 * bare `open` is gone.
 */
const UNRESOLVED_MARKERS: readonly RegExp[] = [
  /\bblocked\b/,
  /\bblocker\b/,
  /\bblocking\b/,
  /\btodo\b/,
  /\bbacklog\b/,
  /\bin progress\b/,
  /\bwip\b/,
  /\bwaiting on\b/,
  /\bneeds review\b/,
  /\bnot started\b/,
];

/**
 * Whether a title and body together read as unresolved/open work. Pure.
 *
 * Takes the two parts rather than a record so the parse-time caller can ask BEFORE it has assembled one, and
 * so neither caller has to agree on a record shape with the other.
 *
 * @param title the record's title, when it has one
 * @param text the record's body
 * @returns true when any whole-word marker fires across the joined, lowercased pair
 */
export function readsUnresolvedText({ title, text }: { title?: string | undefined; text: string }): boolean {
  const haystack = [title, text]
    .filter((part) => part !== undefined)
    .join(" ")
    .toLowerCase();
  return UNRESOLVED_MARKERS.some((marker) => marker.test(haystack));
}
