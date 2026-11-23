/**
 * The shape a GitHub owner and repo must have before `./bareRefs.ts`'s `resolveBareRef` interpolates them into
 * `https://github.com/<owner>/<repo>/issues/<n>`, with the refusal sentence for a reference it leaves unlinked. A context's repo is built
 * by a dozen callers, several from a checkout's `origin` URL, and the link is spliced AFTER a Linear form's
 * raw-HTML check has run, so `origin` pointing at `github.com/o/r)<!--` made `#1` open a comment that swallowed
 * the AI-prompt fold. Checking at the one link builder covers every caller.
 */

/** The same characters this module's text patterns accept for an owner: no `)`, `<`, `/` or whitespace. */
const GITHUB_OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** A repo may also start with `.`, `_` or `-`, as an organisation's `.github` repository does. */
const GITHUB_REPO = /^[A-Za-z0-9._-]+$/u;

/**
 * Whether an owner and repo are safe to interpolate into a GitHub issue URL — the one path segment each, with
 * nothing that could close the markdown link they are written into.
 *
 * @returns true when both are GitHub-shaped
 */
export function isGithubRepoRef({ owner, repo }: { owner: string; repo: string }): boolean {
  return GITHUB_OWNER.test(owner) && GITHUB_REPO.test(repo);
}

/**
 * The sentence a refusal carries for a GitHub reference that did not resolve and was not refused by magnitude:
 * its one repo to resolve against is malformed, or there is no single repo at all.
 *
 * @param raw the reference exactly as the author wrote it
 * @param named the reference as it would render, `#N` or `owner/repo#N`
 * @param sole the single repo a bare `#N` would resolve against, absent when there is none or the reference
 *   names its own repo
 * @returns the refusal sentence
 */
export function githubRefRefusal({
  named,
  raw,
  sole,
}: {
  named: string;
  raw: string;
  sole: { owner: string; repo: string } | undefined;
}): string {
  if (sole !== undefined && !isGithubRepoRef(sole)) {
    return (
      `${JSON.stringify(raw)} would resolve against ${JSON.stringify(`${sole.owner}/${sole.repo}`)}, which is ` +
      "not a GitHub owner/repo (letters, digits, ., - and _), so no link is built from it — write the full " +
      "github.com link, or fix the checkout's origin remote."
    );
  }
  return (
    `${JSON.stringify(raw)} is a bare reference (renders as ${named}) with no single repo to resolve ` +
    'it against — write it as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same ' +
    "text, which names the repo every bare reference beside it means."
  );
}
