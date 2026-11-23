/**
 * The last check every URL a bare reference resolves to passes before anything splices it into a link. The
 * URL comes from a context — a checkout's `origin`, a derived Linear slug, a compliance-control table — and is
 * spliced AFTER a form's raw-HTML check has run, so a `)` or `<` in it would close the markdown link (or a
 * Slack `<url|label>`) and write whatever follows as live markup. It was found one branch at a time (a repo, then
 * a control URL), which is why it is one predicate at `./bareRefs.ts`'s
 * `resolveBareRef` exit rather than a check per branch.
 */

/**
 * Whitespace (every line ending included, since `\s` under `u` covers U+2028 and U+2029), and every character
 * that can end a markdown link destination or a Slack link, or open markup inside one.
 */
const LINK_BREAKING = /[\s<>()[\]\\`|"]/u;

/** The two schemes a reference may link to. */
const WEB_SCHEME = /^https?:\/\//u;

/**
 * Whether a resolved URL can be written inside `[label](url)` or `<url|label>` without stepping out of it.
 *
 * @returns true for an http(s) URL carrying no link-breaking character
 */
export function isInertLinkUrl({ url }: { url: string }): boolean {
  return WEB_SCHEME.test(url) && !LINK_BREAKING.test(url) && URL.canParse(url);
}
