/**
 * A Git remote URL's GitHub repository identity — `owner/name` from the path, never the host.
 *
 * In `src/lib/` rather than beside the push verb that read it first, because the admit layer's old-history push
 * guard (`../admit/pushRootGate.ts`) and the checkout tree's repoint plan judge the same URLs, and product code
 * never imports the CLI tree. One parser, so a push the verb calls `owner/name` is the push the guard judges.
 */

/** Repository path from an ordinary URL or Git's SCP-like SSH spelling. */
function remotePath({ url }: { url: string }): string | undefined {
  if (url.includes("://")) {
    try {
      return new URL(url).pathname;
    } catch {
      return undefined;
    }
  }
  const colon = url.indexOf(":");
  return colon < 0 ? undefined : url.slice(colon + 1);
}

/**
 * Recover a non-secret `owner/name` identity from a Git remote URL.
 *
 * The host and any URL userinfo are intentionally discarded. SSH config aliases are common on managed
 * machines, while the repository path is stable across HTTPS, SSH URL and SCP-like spellings.
 *
 * @param url the configured remote URL
 * @returns the repository slug, or undefined when the remote is not shaped like a GitHub repository
 */
export function githubRepoFromRemote({ url }: { url: string }): string | undefined {
  const path = remotePath({ url });
  if (path === undefined) {
    return undefined;
  }
  const segments = path
    .replace(/^\/+/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length !== 2 || segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  return `${segments[0]!}/${segments[1]!}`;
}

/**
 * Whether two `owner/name` coordinates name the same GitHub repository. GitHub resolves both halves without
 * regard to case, so a guard comparing them case-sensitively is passed by a remote spelled in another case.
 *
 * @param left one `owner/name`
 * @param right the other
 * @returns true when they are the same repository
 */
export function sameGithubRepository({ left, right }: { left: string; right: string }): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * The same remote URL pointed at another repository of the same owner: only the final path segment changes, so the
 * scheme, userinfo, host alias, port, `.git` suffix and every other byte survive.
 *
 * @param url the configured remote URL, naming `owner/name`
 * @param newName the repository name it should name instead
 * @returns the rewritten URL, or undefined when the URL names no `owner/name`
 */
export function renameRemoteRepository({ url, newName }: { url: string; newName: string }): string | undefined {
  if (githubRepoFromRemote({ url }) === undefined) {
    return undefined;
  }
  const match = /^(.*[/:][^/:]+\/)([^/]+?)(\.git)?(\/?)$/.exec(url);
  if (match === null) {
    return undefined;
  }
  let gitSuffix = "";
  if (match[3] !== undefined) {
    gitSuffix = match[3];
  }
  return `${match[1]!}${newName}${gitSuffix}${match[4]!}`;
}
