/**
 * The shape a Linear workspace URL key must have before anything interpolates it into
 * `https://linear.app/<slug>/issue/<KEY>`, and the one function that does interpolate it, with its refusal
 * sentence beside it. Its own dependency-free module because two seams ask it: the disk read
 * (`../../cli/linearReferenceFacts.ts`), so malformed state never propagates to the console, and the link builder
 * (`./bareRefs.ts`'s `resolveBareRef`), so a context built anywhere else cannot bypass it. One predicate, so the two
 * checks cannot drift.
 */

/**
 * Letters, digits, `-` and `_`, starting with a letter or digit. No `.`, `/`, `%`, whitespace or bracket, so the
 * slug can never step out of its one path segment or break the markdown link it is written into.
 */
const LINEAR_WORKSPACE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

/**
 * Whether a workspace slug is safe to interpolate into a Linear issue URL. `structures.json` is written by
 * `derive` but read back as any string, so the shape is checked rather than trusted.
 *
 * @returns true when the slug is a Linear-shaped URL key
 */
export function isLinearWorkspaceSlug({ slug }: { slug: string }): boolean {
  return LINEAR_WORKSPACE_SLUG.test(slug);
}

/**
 * The issue URL a Linear key links to, built only from a known and Linear-shaped workspace slug.
 *
 * @param key a Linear issue key the caller already confirmed against a known team, such as `ENG-12`
 * @param slug the connected workspace's URL key, absent when no single one is known
 * @returns the URL, or undefined when the slug is absent or malformed
 */
export function linearIssueUrl({ key, slug }: { key: string; slug: string | undefined }): string | undefined {
  if (slug === undefined || !isLinearWorkspaceSlug({ slug })) {
    return undefined;
  }
  return `https://linear.app/${slug}/issue/${key}`;
}

/**
 * The sentence a refusal carries for a Linear key that {@link linearIssueUrl} could not link, naming which of
 * its two reasons applied.
 *
 * @param raw the reference exactly as the author wrote it
 * @param slug the workspace slug that was weighed, absent when none is known
 * @returns the refusal sentence
 */
export function linearKeyRefusal({ raw, slug }: { raw: string; slug: string | undefined }): string {
  if (slug !== undefined && !isLinearWorkspaceSlug({ slug })) {
    return (
      `${JSON.stringify(raw)} is a Linear reference, but the workspace slug ${JSON.stringify(slug)} is ` +
      "not a Linear URL key (letters, digits, - and _), so no link is built from it — link it directly, or " +
      "re-run `slopweaver derive` so the directory records the real slug."
    );
  }
  return (
    `${JSON.stringify(raw)} is a Linear reference with no workspace to link it into — link it ` +
    "directly, or supply the connected workspace's slug so this door can build the URL."
  );
}
