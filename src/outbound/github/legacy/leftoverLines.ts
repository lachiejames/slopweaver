/**
 * The Codex review leftovers section a reading-order body carried, frozen with the reading-order parser.
 *
 * Leftovers no longer travel in a description: a standing `BROKEN` review past the second pass stays a
 * `codex-loop-incomplete` finding the landing verbs refuse until it is acknowledged with a reason
 * (`../../../codex/landingGate.ts`). These lines exist only so `./parse.ts` can still read, and re-render byte for
 * byte, a body written while the section existed, which is what `github pr update --pull --convert-c3` reads.
 */

/** The heading a reading-order body named its leftovers under. */
export const LEFTOVERS_HEADING = "## Codex review leftovers";

/** One entry a reading-order body named. */
export interface NamedLeftover {
  readonly artifactId: string;
  readonly pass: string;
  readonly propertyId: string;
  readonly description: string;
}

/**
 * One entry's line, exactly as the reading-order renderer wrote it.
 *
 * @param entry the leftover as a body named it
 * @returns the markdown list item
 */
export function leftoverEntryLine({ entry }: { entry: NamedLeftover }): string {
  return `- \`${entry.artifactId}\` \`${entry.pass}/${entry.propertyId}\`: ${entry.description}`;
}

/** `- \`<artifact>\` \`<pass>/<property>\`: <description>` — a `*` bullet too, since markdown treats them alike. */
const ENTRY = /^[-*] `([^`]+)` `([^`/]+)\/([^`]+)`:(.*)$/;

/** Anything that ends the section, read on the untrimmed line. */
const SECTION_END = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:=+|-+|\*{3,}|_{3,})\s*$|<h[1-6][\s>])/i;

/**
 * Every entry a body names under {@link LEFTOVERS_HEADING}; the first such section is the one read.
 *
 * @param body the pull request body, exactly as GitHub holds it
 * @returns the named entries, in body order; empty when the section is absent
 */
export function namedLeftovers({ body }: { body: string }): readonly NamedLeftover[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === LEFTOVERS_HEADING);
  if (start < 0) {
    return [];
  }
  const named: NamedLeftover[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_END.test(line)) {
      break;
    }
    const match = ENTRY.exec(line.trim());
    if (match !== null) {
      named.push({ artifactId: match[1]!, description: match[4]!.trim(), pass: match[2]!, propertyId: match[3]! });
    }
  }
  return named;
}
