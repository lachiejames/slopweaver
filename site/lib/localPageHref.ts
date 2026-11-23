/**
 * Where the console sends a local page's link — `/api/page/<slug>/index.html`, served by this console, never the
 * `file://` address the record carries.
 *
 * A local page is published at `$SLOPWEAVER_HOME/pages/<slug>/index.html` (`src/pages/publish.ts`) and a record
 * names it by its `file://` address. Chrome refuses to follow a `file://` link from an `http://` page — the click
 * does nothing, Command-click does nothing, and the only way in was to copy the address and paste it into a new
 * tab. So a card keeps the `file://` address as the record's own words and
 * links the console's route instead (`../app/api/page/[slug]/[...file]/route.ts`).
 *
 * The slug grammar and its one decode are `src/pages/url.ts`'s, RESTATED because `src/` and `site/` may not import
 * each other; `site/__tests__/unit/localPageHref.test.ts` drives both on the same addresses so they cannot drift.
 * Parsed with `URL`, as `src/` parses it, so dot segments normalise the same way; `fileURLToPath` is left out because
 * a client component imports this module, and a string test stands in for its encoded-separator refusal.
 *
 * Pure: strings in, strings out.
 */

/** Where the console serves local pages from. */
export const LOCAL_PAGE_ROUTE = "/api/page";

/** The file every local page is written as, inside its own slug directory. */
const PAGE_FILENAME = "index.html";

/** What a slug may contain — `src/pages/url.ts`'s `PAGE_SLUG`. It already excludes `.` and `..`. */
const PAGE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** The directory, under the state home, that holds one subdirectory per published local page. */
const PAGES_DIRECTORY = "pages";

/**
 * What `fileURLToPath` refuses on POSIX, or opens as a NUL: an encoded `/`, or a control character. `%5C` is a legal
 * byte. An escape that does not decode as UTF-8 (`%80`) is refused too, by {@link decodes}.
 */
const UNOPENABLE_ANCESTOR = /%2f|%00|%0[1-9a-f]|%1[0-9a-f]/iu;

/**
 * Whether a path decodes as UTF-8, which `fileURLToPath` requires of every segment and throws on otherwise.
 *
 * @returns true when `decodeURIComponent` accepts the whole path
 */
function decodes({ pathname }: { pathname: string }): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

/** The content type each file a page directory holds is served as; anything else is not served. */
export const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["css", "text/css; charset=utf-8"],
  ["gif", "image/gif"],
  ["html", "text/html; charset=utf-8"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["js", "text/javascript; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["mp4", "video/mp4"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["txt", "text/plain; charset=utf-8"],
  ["webm", "video/webm"],
  ["webp", "image/webp"],
]);

/**
 * Whether a string is a page slug this install's own verb would have written.
 *
 * @param slug the candidate directory name
 * @returns true when it is in the slug alphabet
 */
export function isPageSlug({ slug }: { slug: string }): boolean {
  return PAGE_SLUG.test(slug);
}

/** A local page address split into the slug it names and the query and fragment after it. */
interface LocalPageParts {
  readonly slug: string;
  readonly suffix: string;
}

/**
 * The slug and trailing query/fragment of a local page's address, or `undefined` when it is not one.
 *
 * @param url the address a record carries
 * @returns the parts, or `undefined`
 */
function localPageParts({ url }: { url: string }): LocalPageParts | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "file:" || (parsed.host !== "" && parsed.host !== "localhost")) {
    return undefined;
  }
  if (UNOPENABLE_ANCESTOR.test(parsed.pathname) || !decodes({ pathname: parsed.pathname })) {
    return undefined;
  }
  // Every segment is compared decoded, as `fileURLToPath` resolves it: `%70ages` is the pages directory too.
  // `decodes` above has already proved the whole path decodes, so no segment can throw here.
  const segments = parsed.pathname.split("/").map((segment) => decodeURIComponent(segment));
  const filename = segments.at(-1);
  const slug = segments.at(-2);
  const parent = segments.at(-3);
  if (filename !== PAGE_FILENAME || slug === undefined || parent !== PAGES_DIRECTORY) {
    return undefined;
  }
  if (!isPageSlug({ slug })) {
    return undefined;
  }
  // Read off the address as written: `URL` drops an empty `?`, and a `file:` path cannot hold a raw `?` or `#`.
  const query = url.search(/[?#]/u);
  if (query === -1) {
    return { slug, suffix: "" };
  }
  return { slug, suffix: url.slice(query) };
}

/**
 * The slug a local page's `file://` address names, or `undefined` when the address is not one.
 *
 * @param url the address a record carries
 * @returns the slug, or `undefined`
 */
export function localPageSlugOf({ url }: { url: string }): string | undefined {
  return localPageParts({ url })?.slug;
}

/**
 * The hostnames this console serves its own page route on — the IPv6 loopback as `URL` writes it included, which
 * `./citationDisplay.ts` already reads as this machine.
 */
const CONSOLE_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The slug of the published briefing an address names, in either spelling a card carries: a local page's `file://`
 * address ({@link localPageSlugOf}), or this console's own route to one, `http(s)://localhost[:port]/api/page/<slug>/index.html`
 * (or `127.0.0.1`, `[::1]`, a fully qualified `localhost.`). MEASURED: four `open_card` calls on cards naming their briefing only in the
 * second spelling came back with no page at all, so the voice read none of it. Kept apart from
 * {@link localPageSlugOf}, which must agree with `src/pages/url.ts` and decides what a chip draws as a page.
 *
 * @param url the address a card carries
 * @returns the slug, or `undefined` when the address names no briefing of this install
 */
export function briefingSlugOf({ url }: { url: string }): string | undefined {
  const local = localPageSlugOf({ url });
  if (local !== undefined) {
    return local;
  }
  // The console's own route written relative — `/api/page/<slug>/index.html`, what {@link localPageRoute} builds for a
  // `page:<slug>` identity — is read as this console's; a protocol-relative `//host/…` is another host's.
  const relative = url.startsWith("/") && !url.startsWith("//");
  const absolute = relative ? `http://localhost${url}` : url;
  if (!URL.canParse(absolute)) {
    return undefined;
  }
  const parsed = new URL(absolute);
  // A fully qualified `localhost.` is the same console (`./citationDisplay.ts`), so its one trailing dot is read past
  // — otherwise a chip spelled through it kept its absolute, port-bearing address.
  const host = parsed.hostname.replace(/\.$/u, "");
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !CONSOLE_HOSTS.has(host)) {
    return undefined;
  }
  // Every segment decoded, as the route resolves it (`orb%2Dnotes` names `orb-notes`, and
  // `index%2Ehtml` is the page too); a bad escape names no page.
  if (!decodes({ pathname: parsed.pathname })) {
    return undefined;
  }
  const segments = parsed.pathname.split("/").map((segment) => decodeURIComponent(segment));
  const [empty, api, page, slug, filename, ...rest] = segments;
  // A path too short to hold the slug has no `filename` either, so the check below refuses it.
  if (empty !== "" || api !== "api" || page !== "page" || filename !== PAGE_FILENAME || rest.length > 0) {
    return undefined;
  }
  if (!isPageSlug({ slug })) {
    return undefined;
  }
  return slug;
}

/**
 * The address a console link follows: a local page's `file://` address becomes the console's own route to it, and
 * every other address is followed as written.
 *
 * @param url the address a record carries
 * @returns `/api/page/<slug>/index.html` for a local page, its query and fragment kept, else `url` unchanged
 */
export function consoleHref({ url }: { url: string }): string {
  const parts = localPageParts({ url });
  if (parts === undefined) {
    return url;
  }
  return `${localPageRoute({ slug: parts.slug })}${parts.suffix}`;
}

/**
 * The console's own route to one published page — the address a `page:<slug>` identity is drawn and followed by.
 *
 * @param slug the page's directory name
 * @returns `/api/page/<slug>/index.html`
 */
export function localPageRoute({ slug }: { slug: string }): string {
  return `${LOCAL_PAGE_ROUTE}/${slug}/${PAGE_FILENAME}`;
}

/** One file the page route may serve: its path under the page's directory, and what to serve it as. */
export interface PageFile {
  /** The path's segments under `pages/<slug>/`, each in the slug alphabet. */
  readonly segments: readonly string[];
  readonly contentType: string;
}

/**
 * Which file `/api/page/<slug>/<file…>` names, or `undefined` when it names none this route serves.
 *
 * Every segment must be in the slug alphabet, so no `..`, no separator and no escape can step out of the page's
 * own directory; the route still checks the resolved path sits inside it. A file whose extension has no content
 * type here is refused rather than served as an unknown type.
 *
 * @param slug the page's directory name, as the route received it
 * @param file the path under that directory, as the route received it
 * @returns the file to serve, or `undefined`
 */
export function pageFileOf({ slug, file }: { slug: string; file: readonly string[] }): PageFile | undefined {
  if (!isPageSlug({ slug }) || file.length === 0) {
    return undefined;
  }
  if (!file.every((segment) => PAGE_SLUG.test(segment))) {
    return undefined;
  }
  const last = file.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const dot = last.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const contentType = CONTENT_TYPES.get(last.slice(dot + 1).toLowerCase());
  if (contentType === undefined) {
    return undefined;
  }
  return { contentType, segments: file };
}
