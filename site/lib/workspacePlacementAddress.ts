/**
 * A value read whole as an address — a GitHub repository, a routed URL, a Slack permalink, a loopback host, a web URL
 * spelled as written — knowing nothing of workspaces. `./workspacePlacement.ts` says whose an address is.
 */

/** An exact `owner/repo`, optionally a `#<number>` after it — the whole value, never a slug found inside text. */
const SLUG = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?:#\d+)?$/;

/** A clone URL's `.git`, which names the same repository as the bare slug. */
const CLONE_SUFFIX = /\.git$/;

/**
 * The GitHub repository a value names, whoever owns it: an exact `owner/repo` (or `owner/repo#n`) or a
 * `github.com` URL naming one. A field whose whole job is to name a repository and that does not is unreadable,
 * never absent.
 *
 * @param value the field's whole value
 * @returns the `owner/repo` slug, lowercased, or `undefined` when it names no repository
 */
export function repositoryOf({ value }: { value: string }): string | undefined {
  return repositorySlugOf({ value });
}

/**
 * An exact value reduced to `owner/repo`, lowercased, or `undefined` when it is not one.
 *
 * @returns the slug
 */
export function repositorySlugOf({ value }: { value: string }): string | undefined {
  const bare = SLUG.exec(value);
  if (bare !== null) {
    return slugNamed({ slug: `${bare[1]}/${bare[2]}`, whole: !value.includes("#") });
  }
  const routed = routedOf({ value });
  if (routed === undefined || !GITHUB_HOSTS.has(routed.host) || routed.segments.length < 2) {
    return undefined;
  }
  const [owner, repo] = routed.segments;
  const slug = `${owner}/${repo}`;
  // The routed pair must be a name GitHub could give a repository, the same shape an exact slug is held to.
  if (!SLUG.test(slug)) {
    return undefined;
  }
  return slugNamed({ slug, whole: routed.segments.length === 2 });
}

/**
 * A slug lowercased, with a clone address's `.git` dropped — only where the value ENDS at it. GitHub gives no
 * repository a name ending `.git`, so `slopweaver.git/issues` or `slopweaver.git#<number>` is a 404, never the repository.
 *
 * @param whole whether the value is the repository and nothing after it, the one place a clone suffix is written
 * @returns the slug, or `undefined` when a `.git` suffix has more after it
 */
function slugNamed({ slug, whole }: { slug: string; whole: boolean }): string | undefined {
  const lowered = slug.toLowerCase();
  if (CLONE_SUFFIX.test(lowered) && !whole) {
    return undefined;
  }
  const named = lowered.replace(CLONE_SUFFIX, "");
  // What is left must be a name GitHub gives a repository: `acme/.git` strips to nothing, and `.` or `..` is a
  // path step, never a name.
  const [, repo] = named.split("/");
  if (repo === "" || repo === "." || repo === "..") {
    return undefined;
  }
  return named;
}

/** The hosts GitHub serves its repository pages on; `www.` redirects to the bare host. */
export const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** A path segment once decoded: printable ASCII with no slash or backslash, the alphabet a written link keeps. */
const DECODED_SEGMENT = /^[\x21-\x2e\x30-\x5b\x5d-\x7e]+$/;

/**
 * A URL as the server routes it: the host lowercased without the root's trailing dot, and each path segment
 * percent-decoded — `github.com/octo-self/%73lopweaver` IS `slopweaver`. Every address reader goes
 * through this, so no encoding of one address reads as a different one.
 *
 * @returns the host and segments, or `undefined` when the value is no URL, or a segment is empty, will not decode or
 *   decodes to a slash (a path no server routes to a named page)
 */
export function routedOf({ value }: { value: string }): { host: string; segments: readonly string[] } | undefined {
  const url = urlOf({ value });
  if (url === undefined) {
    return undefined;
  }
  // The pathname opens with `/`, and a trailing `/` is the same page; an empty segment anywhere else is a path the
  // server routes as written — `/archives//C123` is no `/archives/C123` — so it names no page.
  const parts = url.pathname.split("/").slice(1);
  if (parts.at(-1) === "") {
    parts.pop();
  }
  const segments: string[] = [];
  for (const part of parts) {
    if (part === "") {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    // An encoded slash stays inside ONE segment on the server — `slopweaver%2Fpull%2F1` is a 404, never a path —
    // so a segment that decodes to one routes to no named page. The decoded segment is held to the
    // alphabet a written one is — printable ASCII, no slash or backslash — so no encoding reintroduces a character
    // the literal spelling refuses.
    if (!DECODED_SEGMENT.test(decoded)) {
      return undefined;
    }
    segments.push(decoded);
  }
  return { host: routedHost({ url }), segments };
}

/**
 * A URL's host name as DNS resolves it: lowercased, without the root's trailing dot (`localhost.` IS `localhost`).
 *
 * @returns the host name, with no port
 */
export function hostNameOf({ url }: { url: URL }): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * A URL's host as a named service is reached on it: its {@link hostNameOf} with any port it names, because another
 * port is another server — `github.com:444` is not GitHub.
 *
 * @returns the host, and `:port` when the URL names one other than its scheme's default
 */
function routedHost({ url }: { url: URL }): string {
  const host = hostNameOf({ url });
  if (url.port === "") {
    return host;
  }
  return `${host}:${url.port}`;
}

/**
 * A Slack permalink's conversation segment, read after `archives`: a channel (`C`), private channel (`G`) or DM (`D`)
 * id. Any other segment routes to no conversation, so `/archives/0` is no permalink.
 */
const SLACK_CONVERSATION = /^[CDG][A-Z0-9]+$/;

/** A Slack permalink's optional message segment: `p` then the message timestamp's digits. */
const SLACK_MESSAGE = /^p\d+$/;

/**
 * A Slack permalink's conversation path — a permalink only, as `site/content/console/index.mdx` says: any other link
 * on the host (a canvas, a malformed path) names no conversation, so it is no address. Measured over the
 * board's Slack links (`slopweaver handover list --json`): all but one were `/archives/` permalinks, the one other a
 * canvas.
 *
 * @returns the `host/archives/…` path, or `undefined` when the routed URL is no permalink
 */
export function slackPermalinkPath({
  routed,
}: {
  routed: { host: string; segments: readonly string[] };
}): string | undefined {
  const archives = routed.segments.at(0);
  const conversation = routed.segments.at(1);
  const message = routed.segments.at(2);
  const messageRead = message === undefined || SLACK_MESSAGE.test(message);
  if (archives !== "archives" || conversation === undefined || !SLACK_CONVERSATION.test(conversation)) {
    return undefined;
  }
  if (!messageRead || routed.segments.length > 3) {
    return undefined;
  }
  return `${routed.host}/${routed.segments.join("/")}`;
}

/** The hosts a URL to this installation's own console and dev servers is served on. */
const INSTALLATION_HOSTS: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/** An IPv4 loopback address: the whole `127.0.0.0/8` block routes to this machine, not only `127.0.0.1`. */
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Whether a URL's host is this machine: `localhost` (with or without the root's trailing dot), the IPv6 loopback,
 * or any IPv4 loopback address. Every spelling reaches the same console, so none may read as a different address
 * — nor may a queue link on one open a different ask (`./queueLink.ts`).
 *
 * @returns true when the host is a loopback name or address
 */
export function isLoopbackUrl({ url }: { url: URL }): boolean {
  // Any port on this machine is this machine: the console and its dev servers each take their own.
  const host = hostNameOf({ url });
  return INSTALLATION_HOSTS.has(host) || IPV4_LOOPBACK.test(host);
}

/**
 * A web address as a recorder writes one — every address this module reads is a page on `http:` or `https:` — in
 * printable ASCII with no backslash: the scheme, `//`, the host, then the path. The groups are the host and path as
 * WRITTEN, so {@link urlOf} can hold the parser's reading to them. The path opens on `/` and the rest on `?` or `#`,
 * so no two runs can trade characters and a near-miss fails in linear time (CodeQL js/polynomial-redos, alert 123).
 */
const LITERAL_WEB_URL = /^https?:\/\/([^/?#\\\s]+)((?:\/[^?#\\\s]*)?)(?:[?#][^\\\s]*)?$/i;

/** A host, port included, without DNS's trailing root dot: `127.0.0.1.:3000` is `127.0.0.1:3000`. */
function rootless({ host }: { host: string }): string {
  return host.replace(/\.(?=(?::\d*)?$)/, "");
}

/** Printable ASCII: a character outside it is one the URL parser maps or encodes, never one it keeps. */
const PRINTABLE_ASCII = /^[\x21-\x7e]*$/;

/**
 * A value parsed as an absolute web URL, or `undefined` when it is not one. Only `http:` and `https:` route to a
 * page: `ftp://github.com/octo-self/slopweaver` names no repository, whatever its host. And only a
 * value spelled as one: the parser REPAIRS — `https:/github.com`, a tab in the host, whitespace around it,
 * `github。com` mapped to `github.com`, a `..` segment resolved, a user or default port dropped — so
 * the host and path it reads must be the ones written, or the value is prose that only resembles a link. The host is
 * compared without case, because a host HAS no case (RFC 3986 § 3.2.2): `GITHUB.COM` is the same host, not a repair.
 * And with or without DNS's trailing root dot, which the parser keeps on a name but drops from an IPv4 address, so
 * `127.0.0.1.` is the address written, not a repair.
 *
 * @returns the URL
 */
export function urlOf({ value }: { value: string }): URL | undefined {
  const written = LITERAL_WEB_URL.exec(value);
  if (written === null || !PRINTABLE_ASCII.test(value) || !URL.canParse(value)) {
    return undefined;
  }
  // Both groups always take part in a match: the host is one or more characters, the path zero or more.
  const host = written.at(1)!;
  const path = written.at(2)!;
  const url = new URL(value);
  const pathKept = url.pathname === path || (path === "" && url.pathname === "/");
  if (rootless({ host: url.host }) !== rootless({ host: host.toLowerCase() }) || !pathKept) {
    return undefined;
  }
  return url;
}

/**
 * Whether a value is an absolute `http:` or `https:` URL — the shape a reader demands of a link field that places a
 * row, so one on another scheme is refused as unreadable rather than read and then silently named nothing.
 *
 * @returns `true` when the value is a web URL
 */
export function isWebUrl({ value }: { value: string }): boolean {
  return urlOf({ value }) !== undefined;
}
