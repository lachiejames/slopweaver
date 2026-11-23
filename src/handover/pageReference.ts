/**
 * Which page a reference or a piece of displayed text names — the exact-spelling reader the uncarded-page rule
 * (`./pageDelivery.ts`) and the daily sweep card (`../sweep/uncarded.ts`) both judge by.
 *
 * A page is recognised by three spellings and nothing looser: `page:<slug>`, a `file:` URL whose path is
 * `<home>/pages/<slug>/index.html` under THIS home, and the console route `/api/page/<slug>/…` (plain or
 * percent-encoded, as the in-app viewer's `src=` carries it). Name similarity is the fuzzy matching this repository
 * forbids, and a prose mention of a slug is not a reference.
 *
 * Pure: no filesystem, no clock.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pagePath } from "../pages/publish.js";
import { isValidPageSlug, LOCAL_PAGE_URL_IN_TEXT, localPageSlug } from "../pages/url.js";

/**
 * `page:<slug>`, the ledger identity spelling. A slug's own alphabet, so a sentence's full stop is trimmed after; a
 * token running on past it (`page:foo/bar`, `page:foo%2Fbar`) names no page, so only the end, whitespace or closing
 * punctuation may follow, and a question mark only where it ends the sentence (`page:foo?x` is a query) — a
 * positive delimiter set, never a list of continuations.
 */
const PAGE_IDENTITY_IN_TEXT = /\bpage:([A-Za-z0-9][A-Za-z0-9._-]*)(?=$|[\s)\]}>"'`,;!*|]|\?(?:$|\s))/g;

/**
 * The console route standing as its own token — `/api/page/<slug>/` — never one inside another address's path or
 * query (`github.com/…/api/page/p/`, `?return_to=/api/page/p/`), which names no page.
 */
const CONSOLE_ROUTE_IN_TEXT = /(?<![^\s("'`<[])\/api\/page\/([A-Za-z0-9][A-Za-z0-9._-]*)\//g;

/**
 * An address standing as its own token — a web or app URL, or the in-app viewer's relative `/view?…` — each read by
 * {@link pageSlugFromReference}, the one strict reader, so a page inside an unrelated address's query is never read.
 */
const ADDRESS_IN_TEXT = /(?<![^\s("'`<[])(?:https?:\/\/|slopweaver:\/\/|\/view\?)[^\s"'`<>()[\]]+/g;

/** The console route as a whole reference, anchored: `/api/page/<slug>/…`. */
const CONSOLE_ROUTE_REFERENCE = /^\/api\/page\/([A-Za-z0-9][A-Za-z0-9._-]*)\//;

/**
 * A `page:` slug captured out of prose, with a sentence's trailing full stops removed, or undefined when none is left
 * valid. STATED RESIDUE: the slug alphabet allows a trailing dot, so `page:p.` ending a sentence reads as `p` even when
 * the writer meant a page named `p.` — no text can tell the two apart, and a slug ending in a dot is out of scope.
 */
function trimmedSlug({ captured }: { captured: string }): string | undefined {
  return validSlug({ slug: captured.replace(/\.+$/, "") });
}

/** The slug when the page alphabet admits it, else undefined. */
function validSlug({ slug }: { slug: string }): string | undefined {
  return isValidPageSlug({ slug }) ? slug : undefined;
}

/** The slug a `file:` URL names, only when its path is that page's own file under THIS home. */
function slugOfFileUrl({ home, url }: { home: string; url: string }): string | undefined {
  const slug = localPageSlug({ url });
  if (slug === undefined) {
    return undefined;
  }
  return resolve(fileURLToPath(url)) === resolve(pagePath({ home, slug })) ? slug : undefined;
}

/**
 * The page one whole reference names — a settlement witness, an artifact pointer, a hand step's address.
 *
 * @param home the state home a `file:` page must live under
 * @param reference the value as written
 * @returns the page's slug, or undefined when the reference is not exactly one of the three spellings
 */
export function pageSlugFromReference({ home, reference }: { home: string; reference: string }): string | undefined {
  const value = reference.trim();
  if (value.startsWith("page:")) {
    const slug = value.slice("page:".length);
    return isValidPageSlug({ slug }) ? slug : undefined;
  }
  if (value.startsWith("file:")) {
    return slugOfFileUrl({ home, url: value });
  }
  if (!URL.canParse(value)) {
    return routedSlug({ pathname: value });
  }
  const parsed = new URL(value);
  const web = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!web && parsed.protocol !== "slopweaver:") {
    return undefined;
  }
  const routed = web ? routedSlug({ pathname: parsed.pathname }) : undefined;
  if (routed !== undefined) {
    return routed;
  }
  // The in-app viewer (`/view?src=%2Fapi%2Fpage%2F<slug>%2F…`) and the desktop deep link (`slopweaver://open?path=…`)
  // carry the page in ONE named parameter — so a viewer URL as a settle witness names its page and does not skip
  // the gate; and any other address's query (`?return_to=%2Fapi%2Fpage%2F…` on a pull request) names no page.
  const viewed = viewedReference({ parsed, web });
  return viewed === undefined ? undefined : pageSlugFromReference({ home, reference: viewed });
}

/**
 * The document a viewer address frames — the in-app viewer's `src`, or the console path a desktop deep link opens,
 * made absolute so it is read as the console address it is.
 *
 * @param parsed the address, already parsed
 * @param web whether it is an http(s) address rather than the app's own scheme
 * @returns the framed reference, or undefined when the address is no viewer
 */
function viewedReference({ parsed, web }: { parsed: URL; web: boolean }): string | undefined {
  if (web) {
    const src = parsed.pathname.endsWith("/view") ? parsed.searchParams.get("src") : null;
    if (src === null) {
      return undefined;
    }
    return src;
  }
  const path = parsed.hostname === "open" ? parsed.searchParams.get("path") : null;
  if (path === null || !path.startsWith("/")) {
    return undefined;
  }
  return new URL(path, "http://console.invalid").href;
}

/** The slug of an anchored console route, `/api/page/<slug>/…`, or undefined. */
function routedSlug({ pathname }: { pathname: string }): string | undefined {
  const routed = CONSOLE_ROUTE_REFERENCE.exec(pathname);
  if (routed === null) {
    return undefined;
  }
  const slug = routed[1]!;
  return isValidPageSlug({ slug }) ? slug : undefined;
}

/** The page an address token in prose names, its sentence punctuation trimmed; a relative viewer path made absolute. */
function slugOfAddressToken({ home, matched }: { home: string; matched: string }): string | undefined {
  const token = matched.replace(/[.,;:!?]+$/, "");
  const reference = token.startsWith("/view?") ? new URL(token, "http://console.invalid").href : token;
  return pageSlugFromReference({ home, reference });
}

/**
 * Every page a piece of text names by an exact reference, deduplicated, in first-seen order.
 *
 * @param home the state home a `file:` page must live under
 * @param text displayed text — a question, an option, a hand step's sentence
 * @returns the slugs it names
 */
export function pageSlugsNamedIn({ home, text }: { home: string; text: string }): readonly string[] {
  const candidates = [
    ...[...text.matchAll(PAGE_IDENTITY_IN_TEXT)].map((match) => trimmedSlug({ captured: match[1]! })),
    ...[...text.matchAll(LOCAL_PAGE_URL_IN_TEXT)].map((match) => slugOfFileUrl({ home, url: match[0] })),
    // A route closes on its own `/`, so no sentence stop can end it: `/api/page/p./` names `p.`, never `p`.
    ...[...text.matchAll(CONSOLE_ROUTE_IN_TEXT)].map((match) => validSlug({ slug: match[1]! })),
    ...[...text.matchAll(ADDRESS_IN_TEXT)].map((match) => slugOfAddressToken({ home, matched: match[0] })),
  ];
  return [...new Set(candidates.filter((slug): slug is string => slug !== undefined))];
}

/**
 * Every string a value carries, however deeply nested — the text a card or a note DRAWS from a record.
 *
 * Walked rather than serialised: a `JSON.stringify` substring test would match a slug inside escaped quoting or a
 * key name, while every leaf here is a value some surface displays, and each is then read by
 * {@link pageSlugsNamedIn}'s exact spellings.
 *
 * @param value one record — an event, a hand step, an option list
 * @returns its string leaves
 */
export function stringLeaves({ value }: { value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => stringLeaves({ value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((item: unknown) => stringLeaves({ value: item }));
  }
  return [];
}
