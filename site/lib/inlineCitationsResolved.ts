/**
 * A match turned into the reference it names and the span it covers, or a later alternative found inside it — split
 * out of `./inlineCitations.ts`, whose sentence walk calls these.
 */

import { ALTERNATIVE_TAGS, ALTERNATIVES } from "./inlineCitationsPatterns";
import { referenceOf } from "./inlineCitationsReferenceOf";
import type { InlineSegment, Resolvable } from "./inlineCitationsReferences";

/** A reference found, and how much of the text it spans. */
interface Found {
  readonly segment: InlineSegment;
  readonly length: number;
}

/**
 * The reference one match names, with its span; `"words"` when the whole match stays as written; `undefined`
 * when it names none.
 *
 * @param match a match over one or more of {@link ALTERNATIVES}
 * @param lookups what a bare reference resolves against
 * @returns the reference and its length, `"words"`, or `undefined`
 */
export function resolved({
  match,
  lookups,
}: {
  match: RegExpExecArray;
  lookups: Resolvable;
}): Found | "words" | undefined {
  const segment = referenceOf({ groups: { ...match.groups }, lookups, written: match[0] });
  if (segment === undefined || segment === "words") {
    return segment;
  }
  const bare = match.groups?.["xUrl"] !== undefined || match.groups?.["fUrl"] !== undefined;
  if (bare && segment.kind === "cite") {
    // A bare address spans only itself: the punctuation `referenceOf` trimmed off its end stays the sentence's.
    return { length: segment.url.length, segment };
  }
  return { length: match[0].length, segment };
}

/**
 * The first alternative AFTER the one that matched and failed that resolves at the same place — so `EEEE-840 5`,
 * read first as a repository called `EEEE-840` and a number, still links its key.
 *
 * @param at where the failed match began
 * @param groups the failed match's named groups, which say which alternative it was
 * @param lookups what a bare reference resolves against
 * @returns the reference and its length, or `undefined` when no later alternative resolves there
 */
export function laterAlternative({
  text,
  at,
  groups,
  lookups,
}: {
  text: string;
  at: number;
  groups: Readonly<Record<string, string | undefined>>;
  lookups: Resolvable;
}): Found | undefined {
  const failed = ALTERNATIVE_TAGS.findIndex((tag) => groups[tag] !== undefined);
  for (const source of ALTERNATIVES.slice(failed + 1)) {
    const sticky = new RegExp(source, "uy");
    sticky.lastIndex = at;
    const match = sticky.exec(text);
    if (match === null) {
      continue;
    }
    const found = resolved({ lookups, match });
    if (found !== undefined && found !== "words") {
      return found;
    }
  }
  return undefined;
}
