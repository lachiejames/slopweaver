/**
 * How a walk of a console that publishes NO SITEMAP builds its denominator, and the limit that carries.
 *
 * ## Why this is kit-owned
 *
 * The GitHub atlas reached this design first and a second atlas reached it independently, which is the
 * third time a shape has regenerated through ordinary careful work in `src/atlas/` — the same argument
 * `kit/projection.ts` and `kit/withheld.ts` record about the storage-boundary walk, and the same one the
 * hand-rolled-`Result` gate exists for. The clone ratchet flagged the pair, and the answer to a flagged pair
 * is to extract the shared half rather than to rebaseline the count.
 *
 * What is shared is exactly two decisions: turning a rendered href into a comparable path, and choosing the
 * next round from what the last one rendered. What is NOT shared, and must stay with each atlas, is which
 * paths that atlas is commissioned to visit — GitHub admits a settings prefix, while a console with an origin
 * to itself can admit everything except a credential page. That judgement is the `admits` function each caller
 * passes in.
 *
 * ## The limit this design carries, stated once rather than in each atlas
 *
 * A crawl cannot prove its own completeness: it finds what it finds, and "we visited everything we found" is
 * a claim about the crawler rather than about the platform. A frontier can prove "every link the console
 * rendered to me was attempted" and can never prove "every admin page is in this list" — a page reachable
 * only by direct URL, gated behind a plan, or shown to an owner and not to a member never appears in it. An
 * atlas built on this MUST say so through a permanently open gap rather than let a coverage fraction imply
 * otherwise.
 */

/**
 * Re-encode a DECODED query component, escaping only what would change the query's structure.
 *
 * `URLSearchParams` hands back decoded text, so `?q=a%26b` reads as `a&b`; joined raw, that is two parameters
 * where the page had one. Everything else stays readable, so a path with `/` or `:` in a value compares equal
 * to how it was written rather than to a fully escaped form nobody renders.
 */
function encodeQueryComponent({ text }: { text: string }): string {
  return text.replaceAll(/[%&=#+ ]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Canonicalise a link into a same-origin path: query sorted, fragment removed, and its structural characters
 * re-encoded so a decoded `&`, `=`, `#`, `+` or space cannot change which parameters it carries.
 *
 * A fragment is a position on a page rather than a different page, and two links differing only by query
 * order are the same destination. Both would otherwise inflate the frontier with duplicates the walk would
 * then dutifully visit twice.
 *
 * @param href the raw href as rendered
 * @param origin the web origin every admitted path must belong to
 * @returns the canonical path, or `null` when the href is off-origin or unparseable
 */
export function canonicaliseSameOriginHref({ href, origin }: { href: string; origin: string }): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(href, origin);
    base = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin) {
    return null;
  }
  // Sorted by key only, and `toSorted` is stable, so a repeated key keeps the order it was rendered in — the
  // order of repeated values can change what a page shows, so two orders stay two destinations.
  const params = [...parsed.searchParams.entries()].toSorted(([left], [right]) => left.localeCompare(right));
  const query = params
    .map(([key, value]) => `${encodeQueryComponent({ text: key })}=${encodeQueryComponent({ text: value })}`)
    .join("&");
  return query.length > 0 ? `${parsed.pathname}?${query}` : parsed.pathname;
}

/**
 * The next round's frontier: admitted paths the console rendered that have not been visited yet.
 *
 * @param rendered every same-origin link the landed pages of the previous round rendered
 * @param visited every path already attempted
 * @param origin the web origin, used to reject off-origin links
 * @param admits the caller's own judgement about which paths its atlas is commissioned to visit
 * @returns the paths to visit next, sorted and de-duplicated
 */
export function expandRenderedFrontier({
  rendered,
  visited,
  origin,
  admits,
}: {
  rendered: readonly string[];
  visited: ReadonlySet<string>;
  origin: string;
  admits: (input: { path: string }) => boolean;
}): readonly string[] {
  const next = new Set<string>();
  for (const href of rendered) {
    const path = canonicaliseSameOriginHref({ href, origin });
    if (path === null || visited.has(path) || !admits({ path })) {
      continue;
    }
    next.add(path);
  }
  return [...next].toSorted();
}
