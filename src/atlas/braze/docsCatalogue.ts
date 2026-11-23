/**
 * Reading Braze's own endpoint reference into operation rows — pure over the bytes, so every rule below is
 * settled by a fixture rather than by a network call.
 *
 * ## Braze publishes no OpenAPI document, and this is what it publishes instead
 *
 * Every endpoint page server-renders a block that is machine-readable on purpose:
 *
 * ```html
 * <div class="api_type"><div class="method get ">get</div> <p>/campaigns/data_series</p></div>
 * ```
 *
 * That is the vendor declaring the method and the address, in the page a human reads, and it is the same
 * shape the Airtable atlas found when Airtable turned out to server-render its OpenAPI document into every
 * reference page. MEASURED: 146 of 146 operation pages carry the block and every one parsed, so
 * the extractor is not doing best-effort scraping — a page that stops carrying it is a REFUSAL, not a
 * silently dropped operation.
 *
 * **A page the sitemap declares is not always a page Braze serves.** MEASURED: the sitemap
 * declared 147 operation-shaped URLs, and one of them — `user_data/get_users_track_status` — answers a 308 to its family index, which carries no block because it is not an operation page.
 * The other 146 still carry the block. Reproduce:
 * `curl -sSIL https://www.braze.com/docs/api/endpoints/user_data/get_users_track_status | grep -iE '^(HTTP|location)'`.
 * So `specSource.ts` asks {@link isBrazeOperationPage} where a fetch SETTLED before reading it: a page that
 * redirects off the operation tree is reported as unserved, and only a page served at an operation address
 * without the block is the template change this refusal names.
 *
 * ## Which pages are operation pages is decided by the sitemap, not by guessing
 *
 * `/docs/sitemap.xml` is the enumeration. An operation page is one under `/docs/api/endpoints/` whose last
 * segment begins with an HTTP method and an underscore — Braze's own file-naming convention, e.g.
 * `get_campaign_analytics`. The 21 remaining pages under that tree are family index pages and are not
 * operations; counting them would inflate the census by a seventh.
 *
 * ## `lastmod` is the cache key, which is why the sitemap is parsed at all rather than a URL list hard-coded
 *
 * Every URL in the sitemap carries one, so a page is re-fetched only when Braze republishes it. That makes a
 * refresh cheap without pinning the atlas to bytes that have since moved, and it is the honest freshness
 * signal: the atlas can say when the vendor last changed a page rather than when this machine last looked.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { brazeDispositionFor } from "./dispositions.js";
import { BrazeAtlasErrors, brazeAtlasErrorLines } from "./errors.js";
import type { BrazeDisposition, BrazeKind, BrazeParameter } from "./model.js";
import { BRAZE_DISPOSITIONS, BRAZE_KINDS, brazeParameterSchema } from "./model.js";
import { brazeOperationProviderId, brazePathDefect } from "./pathKey.js";
import { BRAZE_SITEMAP_URL } from "./specLock.js";

/** The one host Braze publishes its documentation from — the sitemap's own. */
const BRAZE_DOCS_ORIGIN = new URL(BRAZE_SITEMAP_URL).origin;

/** One page the sitemap declares, with the instant Braze last changed it. */
export interface BrazeSitemapEntry {
  readonly url: string;
  readonly lastModified: string;
}

/** The prefix every endpoint page shares. */
const ENDPOINTS_PREFIX = "/docs/api/endpoints/";

/** Braze's own file-naming convention for an operation page: `<method>_<slug>`. */
const OPERATION_SLUG = /\/(?:get|post|put|patch|delete)_[^/]+$/;

/**
 * Every URL the sitemap declares, with its `lastmod`.
 *
 * @param xml the sitemap document, as UTF-8
 * @returns one entry per `<url>` carrying both a location and a modification instant
 */
export function readBrazeSitemap({ xml }: { xml: string }): readonly BrazeSitemapEntry[] {
  const entries: BrazeSitemapEntry[] = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    // `!`: the pattern requires group 1, so a match always carries it.
    const body = block[1]!;
    const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1]?.trim();
    const mod = /<lastmod>([^<]+)<\/lastmod>/.exec(body)?.[1]?.trim();
    if (loc !== undefined && loc !== "" && mod !== undefined && mod !== "") {
      entries.push({ lastModified: mod, url: loc });
    }
  }
  return entries;
}

/**
 * Whether one address is an endpoint OPERATION page by Braze's own naming: under `/docs/api/endpoints/`, its
 * last segment an HTTP method and an underscore.
 *
 * The one classifier both the sitemap census and the redirect check in `specSource.ts` read, so the two can
 * never disagree about what an operation page is.
 *
 * @param url the address to judge — a sitemap location, or where a fetch of one settled
 * @returns true when the address names an operation page
 */
export function isBrazeOperationPage({ url }: { url: string }): boolean {
  // The ORIGIN is judged too: a redirect that leaves Braze's docs host settled on a page Braze does not
  // publish, whatever its path looks like.
  const parsed = URL.parse(url);
  if (parsed === null || parsed.origin !== BRAZE_DOCS_ORIGIN) {
    return false;
  }
  // Judged DECODED, so `%67et_x` is the operation `get_x` it names — one SEGMENT at a
  // time, because an encoded `%2F` is part of its segment rather than a separator, and decoding the whole path
  // would invent a segment the server never served. A path that will not decode names no page at all.
  let segments: string[];
  try {
    segments = parsed.pathname
      .replace(/\/$/, "")
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return false;
  }
  if (segments.some((segment) => segment.includes("/"))) {
    return false;
  }
  const path = segments.join("/");
  return path.startsWith(ENDPOINTS_PREFIX) && OPERATION_SLUG.test(path);
}

/**
 * The sitemap entries that are endpoint OPERATION pages.
 *
 * @param entries every entry the sitemap declares
 * @returns only the operation pages, in sitemap order
 */
export function brazeOperationPages({
  entries,
}: {
  entries: readonly BrazeSitemapEntry[];
}): readonly BrazeSitemapEntry[] {
  return entries.filter(({ url }) => isBrazeOperationPage({ url }));
}

/**
 * The documentation family one operation page belongs to — Braze's own first segment under
 * `/docs/api/endpoints/`.
 *
 * @param url the page's address
 * @returns the family name, or `null` when the URL is not under the endpoints tree
 */
export function brazeFamilyOf({ url }: { url: string }): string | null {
  const path = pathOf({ url });
  if (!path.startsWith(ENDPOINTS_PREFIX)) {
    return null;
  }
  const rest = path.slice(ENDPOINTS_PREFIX.length);
  const family = rest.split("/")[0];
  return family === undefined || family === "" ? null : family;
}

/**
 * One operation row, as a schema.
 *
 * It exists for exactly one caller: the row cache in `specSource.ts` reads rows back off disk, and disk is a
 * parse boundary like any other. Asserting the shape there instead would be the `no-unsafe-type-assertion`
 * defect the house rules ban, and it would let a cache written by an older build flow into a published
 * generation unchecked.
 */
export const brazeDocsOperationRowSchema = z
  .object({
    disposition: z.enum(BRAZE_DISPOSITIONS),
    dispositionReason: z.string().min(1),
    dispositionRuleId: z.string().min(1),
    kind: z.enum(BRAZE_KINDS),
    lastModified: z.string().min(1),
    method: z.string().min(1),
    parameters: z.array(brazeParameterSchema),
    pathDefect: z.string().min(1).nullable(),
    pathShape: z.string().min(1),
    providerId: z.string().min(1),
    rateLimit: z.string().min(1).nullable(),
    responseFields: z.array(z.string().min(1)),
    title: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

/** One operation, as Braze's reference declares it. */
export interface BrazeDocsOperationRow {
  readonly disposition: BrazeDisposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
  /** The documentation family, which is also this row's kind. */
  readonly kind: BrazeKind;
  readonly lastModified: string;
  readonly method: string;
  readonly parameters: readonly BrazeParameter[];
  /** What is wrong with the published address, or `null` when nothing is. */
  readonly pathDefect: string | null;
  /** The path exactly as the page's own block renders it, defect included. */
  readonly pathShape: string;
  readonly providerId: string;
  readonly rateLimit: string | null;
  readonly responseFields: readonly string[];
  readonly title: string;
  readonly url: string;
}

/**
 * Read one endpoint page into an operation row.
 *
 * @param html the page, as UTF-8
 * @param url the address it was fetched from
 * @param lastModified the instant the sitemap says Braze last changed it
 * @param kind the documentation family this page sits in
 * @returns the row, or why the page could not be read as an operation
 */
export function readBrazeOperationPage({
  html,
  url,
  lastModified,
  kind,
}: {
  html: string;
  url: string;
  lastModified: string;
  kind: BrazeKind;
}): Result<BrazeDocsOperationRow> {
  const text = readableMarkup({ html });
  const declaration = DECLARATION.exec(text);
  if (declaration === null) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.pageUndeclared({ url }) }));
  }
  // `!`: DECLARATION requires both groups, so a match always carries them.
  const method = declaration[1]!.toUpperCase();
  const pathShape = declaration[2]!.trim();
  if (method === "" || pathShape === "") {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.declarationEmpty({ url }) }));
  }
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(text)?.[1];
  const title = heading === undefined ? url : stripTags({ html: heading }) || url;
  const verdict = brazeDispositionFor({ method, path: pathShape });
  return ok({
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    dispositionRuleId: verdict.ruleId,
    kind,
    lastModified,
    method,
    parameters: readParameters({ text }),
    pathDefect: brazePathDefect({ form: "declaration", path: pathShape }),
    pathShape,
    providerId: brazeOperationProviderId({ method, path: pathShape }),
    rateLimit: readRateLimit({ text }),
    responseFields: readResponseFields({ text }),
    title,
    url,
  });
}

/**
 * The path component of an absolute documentation URL, its query and fragment dropped — a redirect's target
 * may carry either, and `?next=/get_x` must not read as an operation slug.
 */
function pathOf({ url }: { url: string }): string {
  const withoutScheme = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  return withoutScheme === "" ? "/" : withoutScheme;
}

/**
 * The block Braze server-renders to declare an endpoint's method and address.
 *
 * Hoisted to a constant because {@link readableMarkup} tests for it before deciding which form of the
 * document to read, and a second copy of this pattern is exactly how the two would drift apart.
 */
const DECLARATION = /<div class="api_type">\s*<div class="method\s+(\w+)\s*">\s*\w+\s*<\/div>\s*<p>([^<]+)<\/p>/;

/**
 * Which form of the document every extraction below reads.
 *
 * Braze's pages carry their own markup TWICE: once as real body markup, and once entity-encoded inside a
 * `<head>` meta attribute for the social-preview text. Decoding the whole document unconditionally merges the
 * two, and the encoded copy comes FIRST — so an extraction anchored on the earliest match reads the preview
 * rather than the page. Both copies agree on today's pages, which is why this was invisible until a fixture
 * deliberately made them differ; it is a real fragility either way, since nothing makes Braze keep them in
 * step.
 *
 * MEASURED: all 146 operation pages carry the declaration in their RAW body markup, so the raw
 * form is what is read. The decoded fallback stays for a page that only ever carried the encoded copy, and
 * the choice is made ONCE so every extraction reads the same text as the declaration did.
 */
function readableMarkup({ html }: { html: string }): string {
  if (DECLARATION.test(html)) {
    return html;
  }
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Everything but the tags, whitespace-collapsed.
 *
 * A single `replace(/<[^>]+>/g, "")` is the obvious spelling and is wrong, which CodeQL caught on this
 * function's first version as `js/incomplete-multi-character-sanitization` (alert 39, high). One pass over a
 * regex cannot strip nested or unterminated markup: `<a title="<b>">` leaves `">` behind, and an unclosed
 * `<td` swallows nothing at all. The usual patch is to loop the replace until it stops changing, which is
 * quadratic on adversarial input and still guesses.
 *
 * So this walks the string once instead, tracking how deep inside a tag it is. Linear, no backtracking, and
 * no regex to be incomplete. Two details are deliberate: `>` outside a tag is kept, because Braze's prose
 * genuinely contains comparisons and dropping them would silently corrupt an extracted description; and the
 * depth counter rather than a boolean means a `<` inside an attribute value cannot end the tag early.
 */
function stripTags({ html }: { html: string }): string {
  const kept: string[] = [];
  let depth = 0;
  for (const character of html) {
    if (character === "<") {
      depth += 1;
      continue;
    }
    if (character === ">") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      kept.push(character);
      continue;
    }
    if (depth === 0) {
      kept.push(character);
    }
  }
  return kept.join("").replace(/\s+/g, " ").trim();
}

/**
 * The request parameters the page's own table declares.
 *
 * Braze labels the table with `aria-label="Request parameters"` and gives it four columns — parameter,
 * required, data type, description. MEASURED: 97 of 146 pages carry one, and the other 49 declare
 * no parameters at all rather than declaring them somewhere this reader cannot see. An empty list is
 * therefore a fact about the page, and `sync.ts` does not raise a gap for one.
 */
function readParameters({ text }: { text: string }): readonly BrazeParameter[] {
  const table = /<table[^>]*aria-label="Request parameters"[^>]*>([\s\S]*?)<\/table>/.exec(text);
  if (table === null) {
    return [];
  }
  const parameters: BrazeParameter[] = [];
  const seen = new Set<string>();
  // `!`: the table pattern requires group 1, so a match always carries it.
  for (const row of table[1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) => stripTags({ html: cell[1]! }));
    const [name, requirement, declaredType] = cells;
    // A header row carries `<th>` and no `<td>` at all, so an absent first cell is an ordinary shape here
    // rather than a parse failure — it is skipped, not defaulted.
    if (name === undefined || name === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    parameters.push({
      name,
      required: requirement?.toLowerCase().startsWith("required") === true,
      type: declaredType === undefined || declaredType === "" ? null : declaredType,
    });
  }
  return parameters;
}

/** How much of a rate-limit section a row keeps, so one long page cannot dominate a kind file. */
const RATE_LIMIT_CHARS = 220;

/**
 * The rate limit the page states, verbatim and truncated.
 *
 * MEASURED: only 25 of 146 pages carry a `rate-limit` heading, so this is genuinely absent far
 * more often than it is present — which is itself a documented fact worth holding rather than a parse failure.
 */
function readRateLimit({ text }: { text: string }): string | null {
  const section = /id="rate-limit"[\s\S]*?<\/h[23]>([\s\S]*?)(?:<h[23][\s>]|$)/.exec(text);
  if (section === null) {
    return null;
  }
  // `!`: the section pattern requires group 1, so a match always carries it.
  const prose = stripTags({ html: section[1]! });
  return prose === "" ? null : prose.slice(0, RATE_LIMIT_CHARS);
}

/**
 * The property names the page's example responses carry.
 *
 * Braze publishes no schema component to resolve, so its example response bodies are where an endpoint's
 * shape is stated. Only NAMES are kept — the values in an example are Braze's own illustrations and are not
 * this workspace's data, but keeping them would still be storing a payload this atlas has no use for.
 */
function readResponseFields({ text }: { text: string }): readonly string[] {
  const section = /id="responses?"[\s\S]*?<\/h[23]>([\s\S]*?)(?:<h2[\s>]|$)/.exec(text);
  if (section === null) {
    return [];
  }
  const fields = new Set<string>();
  // `!`: both patterns require group 1, so a match always carries it.
  for (const block of section[1]!.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)) {
    for (const field of stripTags({ html: block[1]! }).matchAll(/"([A-Za-z0-9_]+)"\s*:/g)) {
      const name = field[1];
      if (name !== undefined) {
        fields.add(name);
      }
    }
  }
  return [...fields].toSorted();
}
