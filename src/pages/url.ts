/**
 * A LOCAL PAGE'S IDENTITY — the slug inside a `file:///…/pages/<slug>/index.html` address, and the shape a
 * scanner recognises one by in running prose.
 *
 * ## Why identity is the slug and not the last path segment
 *
 * Moving pages off claude.ai URLs silently
 * breaks two lookups that key on the artifact URL shape, and this is the half both of them need. Every
 * local page's address ENDS in the same word, so anything keying on a URL's last segment — which is exactly
 * what `../outbound/briefing/freezeStore.ts`'s store key did — files every page in the world under
 * `index.html` and lets each one overwrite the last one's history. The directory is what differs, so the
 * directory is the identity.
 *
 * ## It is a SHAPE test, never a filesystem test
 *
 * Nothing here touches disk or resolves a home — `fileURLToPath` converts a string and reads nothing. A URL
 * either has the terminal `/pages/<slug>/index.html` shape over a convertible local address or it does not,
 * which keeps every caller pure and means a page on a machine this process cannot see is still identified
 * correctly — the case a supervisor reading another seat's `open-pages.json` actually hits.
 *
 * Pure — no I/O, no clock.
 */

import { fileURLToPath } from "node:url";

/**
 * What a slug may contain: the same alphabet `../outbound/briefing/freezeStore.ts` files a key under.
 *
 * Deliberately identical rather than merely similar. A slug becomes BOTH a directory under the pages tree
 * and a directory under the freeze store, so a slug the freeze store would refuse is one whose page could be
 * written and then never frozen — the split-brain this shared alphabet exists to make unrepresentable.
 */
const PAGE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The file every local page is written as, inside its own slug directory. */
export const PAGE_FILENAME = "index.html";

/** The directory, under the state home, that holds one subdirectory per published local page. */
export const PAGES_DIRECTORY = "pages";

/**
 * A local page address sitting loose in running prose, matched up to but not including sentence punctuation.
 *
 * The trailing-character class is the same subtlety `../outbound/briefing/render.ts`'s `BARE_URL` carries
 * and is here for the same reason: `… /pages/queue/index.html.` is how a composer actually writes one, and
 * a match running to the next space would put the full stop inside the `href` and produce a dead link
 * arrived at by fixing dead links.
 *
 * Anchored on the terminal shape rather than on `file://` alone, so a `file://` URL that is not one of these
 * pages — a screenshot, a log — is not claimed by this pattern.
 *
 * **The ancestor class excludes `:` and `,`, and that is the load-bearing part.** Three Codex review passes
 * walked one class here: a `file:` pattern whose ancestor spans anything non-blank CONSUMES a neighbouring
 * URL, and a match that is later discarded has already eaten its characters. The last spelling was
 * `file:///tmp/run.log,https://example.com/pages/a/index.html`, where the http URL itself supplies the
 * page-shaped suffix, so the whole string matched and the working link was swallowed. No second URL can be
 * reached without a `:`, and no comma-joined neighbour without a `,` — excluding both closes the class rather
 * than the spelling, which is where the walk was stopped.
 *
 * Written as a LITERAL rather than composed from {@link PAGES_DIRECTORY} and {@link PAGE_FILENAME}, even
 * though that repeats their two words: `src/devLint/redosCheck.ts` skips a pattern it cannot read statically,
 * so a `new RegExp` built by interpolation would walk past the ReDoS gate unexamined. The duplication is
 * checked instead by `src/__tests__/unit/pages/url.test.ts`, which asserts this pattern matches an address
 * built from those two constants.
 */
export const LOCAL_PAGE_URL_IN_TEXT = /file:\/\/\/[^\s<>"':,]*\/pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/index\.html/g;

/**
 * Whether one address is a local page's, by the same shape {@link localPageSlug} reads an identity out of.
 *
 * Exported so the predicates that decide whether prose may LINK an address — `../briefing/yourList.ts`,
 * `../outbound/briefing/render.ts`, `../briefing/bareRef.ts` — all ask one question rather than each
 * carrying its own spelling of it. Five independent `startsWith("http")` tests is how a local page ends up
 * a first-class subject in one place and inert text in the next.
 *
 * @param url the address to judge
 * @returns whether it names a local page this install's own verb would have written
 */
export function isLocalPageUrl({ url }: { url: string }): boolean {
  return localPageSlug({ url }) !== undefined;
}

/**
 * The slug a local page address names, or undefined when the address is not one.
 *
 * Undefined rather than a refusal for every non-match, because every caller here is asking "is this one of
 * mine, and if so which" about an address it did not choose — an http artifact URL, a GitHub link, a bare
 * word. A malformed `file://` URL is simply not one of these pages, which is the same answer.
 *
 * The slug segment is decoded ONCE and then validated, so an address smuggling a separator through an escape
 * (`%2F`, `%2e%2e`) fails the alphabet rather than resolving to a directory outside the pages tree.
 *
 * @param url the address to read
 * @returns the page's slug, or undefined when the address does not name a local page
 */
export function localPageSlug({ url }: { url: string }): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "file:" || (parsed.host !== "" && parsed.host !== "localhost")) {
    return undefined;
  }
  if (!isConvertibleToPath({ url: parsed })) {
    return undefined;
  }
  const segments = parsed.pathname.split("/");
  const filename = segments[segments.length - 1];
  const slugSegment = segments[segments.length - 2];
  const parent = segments[segments.length - 3];
  if (filename !== PAGE_FILENAME || slugSegment === undefined || parent !== PAGES_DIRECTORY) {
    return undefined;
  }
  return decodedSlug({ segment: slugSegment });
}

/**
 * Whether the address converts to a filesystem path at all — asked of Node rather than decided here.
 *
 * The slug is checked against its own alphabet below, but every ANCESTOR segment is somebody's home
 * directory and cannot be, so something has to say whether the rest of the path is usable. Two Codex review
 * passes made the case for asking rather than testing: the first found `file:///tmp/%00/pages/alpha/index.html`
 * read as a genuine page, and after a control-character check closed that one the second found
 * `file:///tmp/a%2Fb/pages/alpha/index.html`. Both are the SAME defect — an ancestor segment nothing
 * validates — and enumerating its spellings is a race the next spelling wins.
 *
 * So the check is TWO questions, and it takes both because neither covers the other — MEASURED here rather
 * than assumed, after a first attempt claimed one did:
 *
 * - **does it convert to a path at all?** `fileURLToPath` throws `ERR_INVALID_FILE_URL_PATH` on an encoded
 *   separator, which is the general form of the second counterexample and of every further spelling of an
 *   ancestor segment that cannot exist.
 * - **does that path contain a control character?** It does NOT throw on `%00` — the first counterexample was
 *   demonstrated with `readFileSync`, not with this function — so a NUL survives the conversion and is
 *   rejected only when somebody finally opens the file. That is the check this keeps of its own.
 *
 * `fileURLToPath` is a pure string conversion and reads no filesystem, so this module stays as pure as its
 * header claims.
 *
 * @param url the parsed address
 * @returns whether it names a path this machine could open
 */
function isConvertibleToPath({ url }: { url: URL }): boolean {
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch {
    return false;
  }
  // Indexed rather than spread or iterated: a control character is a single UTF-16 unit by definition, so
  // reading units finds every one of them and never has to reason about splitting a surrogate pair.
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) <= CONTROL_CHARACTER_MAX) {
      return false;
    }
  }
  return true;
}

/**
 * The highest code point that is a C0 control character — NUL through unit separator.
 *
 * A bound compared numerically rather than a character class, deliberately: a regex for this range has to
 * carry the control bytes themselves, either literally (which a copy, a patch or an editor can silently
 * change) or as escapes a careless rewrite turns back into literals. Neither survives handling; a number does.
 */
const CONTROL_CHARACTER_MAX = 0x1f;

/**
 * One path segment decoded and checked against the slug alphabet.
 *
 * @param segment the raw path segment, still percent-encoded
 * @returns the slug, or undefined when it does not decode or does not fit the alphabet
 */
function decodedSlug({ segment }: { segment: string }): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return PAGE_SLUG.test(decoded) ? decoded : undefined;
}

/**
 * Check a slug a caller supplied, before anything is written under it.
 *
 * Refused rather than sanitised, exactly as the freeze store refuses its own key: a slug becomes a directory
 * name, so quietly rewriting one would put a page somewhere its own republish cannot find it.
 *
 * @param slug the slug as the caller wrote it
 * @returns whether it may be used as a page's directory
 */
export function isValidPageSlug({ slug }: { slug: string }): boolean {
  return PAGE_SLUG.test(slug);
}

/**
 * The path the console serves a local page under, restated from `site/lib/localPageHref.ts`'s `LOCAL_PAGE_ROUTE`
 * because neither tree can import the other.
 */
const CONSOLE_PAGE_ROUTE = "/api/page";

/**
 * The path on the console one local page is served at — the one spelling of it, which the console address and the
 * desktop app's deep link (`../desktop/deepLink.ts`) both build on.
 *
 * @param slug the page's slug, already checked by {@link isValidPageSlug}
 * @returns `/api/page/<slug>/index.html`, the slug percent-encoded
 */
export function consolePagePath({ slug }: { slug: string }): string {
  return `${CONSOLE_PAGE_ROUTE}/${encodeURIComponent(slug)}/${PAGE_FILENAME}`;
}

/**
 * The console address one local page is served at, which Chrome opens where it will not open the `file://` one.
 *
 * @param consoleBase the console's origin with no trailing slash (`../hand/consoleLink.ts`'s `consoleBaseFrom`)
 * @param slug the page's slug, already checked by {@link isValidPageSlug}
 * @returns `<consoleBase>/api/page/<slug>/index.html`
 */
export function consolePageUrl({ consoleBase, slug }: { consoleBase: string; slug: string }): string {
  return `${consoleBase}${consolePagePath({ slug })}`;
}

/** The console's in-app viewer, restated from `site/lib/inAppView.ts`'s `VIEW_PATH` for the same reason. */
const CONSOLE_VIEW_ROUTE = "/view";

/**
 * The console address that opens one local page inside the desktop app's viewer, under a bar whose first control
 * goes back to the Queue — the address a card or a note gives the owner for a page: any HTML mentioned in a draft or card cites it,
 * so it opens in the viewer.
 *
 * @param consoleBase the console's origin with no trailing slash (`../hand/consoleLink.ts`'s `consoleBaseFrom`)
 * @param slug the page's slug, already checked by {@link isValidPageSlug}
 * @returns `<consoleBase>/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html&back=%2Fqueue`
 */
export function consoleViewerUrl({ consoleBase, slug }: { consoleBase: string; slug: string }): string {
  const src = `${CONSOLE_PAGE_ROUTE}/${encodeURIComponent(slug)}/${PAGE_FILENAME}`;
  return `${consoleBase}${CONSOLE_VIEW_ROUTE}?src=${encodeURIComponent(src)}&back=${encodeURIComponent("/queue")}`;
}

/**
 * The ledger identity a ruling about one local page is recorded under.
 *
 * `page:<slug>` mirrors the `artifact:<id>` convention the lock-in ledger observably already uses
 * (`../briefing/openArtifacts.ts` carries that measurement). There is deliberately no SHORT form beside it:
 * the eight-character artifact alias exists because a UUID is unreadable and the real ledger was measured
 * carrying both, and no such convention exists or has been measured for a slug, which is already the
 * human-readable name.
 *
 * @param slug the page's own slug
 * @returns the key a `session-start lock-in --item` would name
 */
export function pageIdentity({ slug }: { slug: string }): string {
  return `page:${slug}`;
}
