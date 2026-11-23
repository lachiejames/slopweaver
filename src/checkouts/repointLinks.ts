/**
 * The historical-link half of a repository re-cut: every `https://github.com/<owner>/<name>/(pull|issues|commit)/…`
 * link in a text, and what it becomes once the old history lives at `<owner>/<archive-name>`.
 *
 * Why a link moves at all: the fresh repository keeps `<owner>/<name>` and its numbers restart at 1, so after the
 * switch `…/<name>/pull/<n>` would name a DIFFERENT pull request. The archive carries the old numbers, so the old link
 * is rewritten to the archive's name rather than left to a GitHub redirect that no longer exists.
 *
 * Only those three routes move. A repository home link, an API URL, a branch or tree link, bare `owner/name` text
 * and a link already naming the archive stay as they are: each either still means the same thing after the switch or
 * is not a numbered object. The coordinate is matched case-insensitively, as GitHub resolves it; the route, query and
 * fragment after it are kept byte for byte. Pure — a caller reads the text and writes nothing from here.
 */

/** One distinct link and how many times it occurs. */
export interface LinkReplacement {
  readonly from: string;
  readonly to: string;
  readonly occurrences: number;
}

/** Escape a literal for use inside a regular expression. */
function escaped({ literal }: { literal: string }): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every historical link to `repository` in `text`, each with the archive link it becomes, in first-seen order.
 *
 * @param text the file's text
 * @param repository `owner/name` of the repository being re-cut
 * @param archiveName the name the old history moves to, under the same owner
 * @returns one entry per distinct link, empty when the text names none
 */
export function historicalLinkReplacements({
  text,
  repository,
  archiveName,
}: {
  text: string;
  repository: string;
  archiveName: string;
}): readonly LinkReplacement[] {
  const [owner] = repository.split("/");
  // The boundary after the name is a `/` and then the route: `name-other/pull` and `names/pull` never match.
  const pattern = new RegExp(
    `https://github\\.com/(${escaped({ literal: repository })})/(?:pull|issues|commit)/[^\\s"'<>\\)\\]\`]*`,
    "gi",
  );
  const counts = new Map<string, number>();
  for (const match of text.matchAll(pattern)) {
    const link = match[0];
    counts.set(link, (counts.get(link) === undefined ? 0 : counts.get(link)!) + 1);
  }
  const prefixLength = "https://github.com/".length + repository.length;
  return [...counts.entries()].map(([from, occurrences]) => ({
    from,
    occurrences,
    to: `https://github.com/${owner!}/${archiveName}${from.slice(prefixLength)}`,
  }));
}

/**
 * Apply replacements to a text — the half a later apply step runs, kept beside the finder so the two can never
 * disagree about what a link is.
 *
 * @param text the file's text, exactly as planned
 * @param replacements what {@link historicalLinkReplacements} returned for that text
 * @returns the rewritten text
 */
export function applyLinkReplacements({
  text,
  replacements,
}: {
  text: string;
  replacements: readonly LinkReplacement[];
}): string {
  let out = text;
  for (const { from, to } of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}
