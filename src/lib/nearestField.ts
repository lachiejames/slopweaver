/**
 * The declared field a refused key most likely meant — one finder for both directions a schema is crossed.
 *
 * An outbound form uses it to tell a porter where refused content belongs (`src/outbound/strictForm.ts`); an
 * inbound boundary uses it to say a provider RENAMED a field rather than dropping one and inventing another
 * (`./boundary.ts`). The question is the same either way: is this unknown key a slip for a known one.
 */

/**
 * How far a key may be from a field name and still be called a probable typo.
 *
 * A fixed distance would mis-serve both ends: 2 is most of a short name, and nothing for a long one. Scaling by
 * length keeps the claim proportionate — `citations` reaches `citationUrl`, while `impact` reaches nothing among
 * the digest's fields, which is the honest answer because it is not a typo of any of them. It is a field from a
 * different schema, and inventing a nearest match for it would send a porter to the wrong place.
 */
function typoBudget({ key }: { key: string }): number {
  return Math.max(2, Math.floor(key.length / 3));
}

/**
 * Case-insensitive Levenshtein distance. No regex, so nothing here can backtrack.
 *
 * Case is folded before comparing because `RootCause` for `rootCause` is a capitalisation slip rather than a
 * different word, and charging it two edits would push it past its own budget.
 */
function editDistance({ left, right }: { left: string; right: string }): number {
  const from = left.toLowerCase();
  const to = right.toLowerCase();
  let previous = Array.from({ length: to.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= from.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= to.length; column += 1) {
      const substitution = previous[column - 1]! + (from[row - 1] === to[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[to.length]!;
}

/**
 * The valid field a rejected key most likely meant, or nothing when honestly nothing is close.
 *
 * Returning `undefined` is a real answer rather than a failure to find one. A suggestion that is merely the
 * least-bad of nine unrelated names would be worse than none: it reads as authoritative and points somewhere
 * wrong. Containment is checked after distance so that a long field which simply CONTAINS the key still
 * matches — `citation` reaches `citationUrl` even where the edit distance does not.
 *
 * @param key the rejected key
 * @param known every field the schema declares
 * @returns the nearest field name, or undefined when none is close enough to claim
 */
export function nearestField({ key, known }: { key: string; known: readonly string[] }): string | undefined {
  const ranked = known
    .map((candidate) => ({ candidate, distance: editDistance({ left: key, right: candidate }) }))
    .toSorted((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  const best = ranked[0];
  if (best !== undefined && best.distance <= typoBudget({ key })) {
    return best.candidate;
  }
  const folded = key.toLowerCase();
  return known.find(
    (candidate) => candidate.toLowerCase().includes(folded) || folded.includes(candidate.toLowerCase()),
  );
}
