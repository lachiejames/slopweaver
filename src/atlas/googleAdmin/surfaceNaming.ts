/**
 * How a Google Admin operation is named, grouped and paged — the judgements the generator applies to
 * Google's own discovery documents, kept out of the generated table so they are reviewable on their own.
 *
 * Every function here is total over the eleven pinned documents and THROWS on anything it cannot decide.
 * That is deliberate: a generator that guessed a kind would publish a plausible taxonomy nobody could
 * check, and the failure mode of an atlas is not a crash — it is a confident wrong answer about where a
 * platform keeps something.
 *
 * ## The vendor's own `id` is NOT unique across documents, and that is a measurement rather than a caution
 *
 * MEASURED while building this atlas: across the eleven pinned documents there are 336 methods
 * and only **335 distinct `id` values**. `admin.channels.stop` is declared TWICE — once in
 * `admin.directory_v1` and once in `admin.reports_v1` — with different declared scopes each time, because
 * each Admin SDK version carries its own copy of the shared push-channel verb. Keying on the vendor's id
 * alone silently folds the two into one and loses a scope set. So the provider key is
 * `<document>:<id>`, and {@link googleAdminProviderId} is the only place that is spelled. Reproduce it:
 *
 * ```bash
 * grep -o '"providerId":"[^"]*"' src/atlas/googleAdmin/generated/surfaces.ts | sort -u | wc -l
 * ```
 */

/** Google's own discovery documents this atlas is compiled from, by `<name>.<version>`. */
export const GOOGLE_ADMIN_DOCUMENTS = [
  "admin.datatransfer_v1",
  "admin.directory_v1",
  "admin.reports_v1",
  "alertcenter.v1beta1",
  "chromemanagement.v1",
  "chromepolicy.v1",
  "cloudidentity.v1",
  "groupsmigration.v1",
  "groupssettings.v1",
  "licensing.v1",
  "vault.v1",
] as const;

/** One of Google's published discovery documents. */
export type GoogleAdminDocument = (typeof GOOGLE_ADMIN_DOCUMENTS)[number];

/**
 * The product areas the documents describe, named for the Admin console surface each administers rather
 * than for the host it is served from.
 *
 * `directory`, `reports` and `datatransfer` are three VERSIONS of one Admin SDK document family and are
 * named separately because they administer three unrelated console areas — the directory, the audit and
 * usage reports, and the data-transfer tool. Naming them all `admin` would put two thirds of this atlas
 * behind one word.
 */
export const GOOGLE_ADMIN_APIS = [
  "alertcenter",
  "chrome-management",
  "chrome-policy",
  "cloud-identity",
  "datatransfer",
  "directory",
  "groups-migration",
  "groups-settings",
  "licensing",
  "reports",
  "vault",
] as const;

/** One of the product APIs the Admin console is built on. */
export type GoogleAdminApi = (typeof GOOGLE_ADMIN_APIS)[number];

/**
 * How an operation returns more than one page.
 *
 * - `page-token` — it declares a `pageToken` parameter and its declared response carries `nextPageToken`.
 *   Google's own API Improvement Proposals make this the only listing shape, and every listing method in
 *   these eleven documents uses exactly this pair.
 * - `none` — a single-shot read or a write.
 */
export const GOOGLE_ADMIN_PAGINGS = ["page-token", "none"] as const;

/** How an operation pages. */
export type GoogleAdminPaging = (typeof GOOGLE_ADMIN_PAGINGS)[number];

/** Which product API one document describes. */
const API_BY_DOCUMENT: Readonly<Record<GoogleAdminDocument, GoogleAdminApi>> = {
  "admin.datatransfer_v1": "datatransfer",
  "admin.directory_v1": "directory",
  "admin.reports_v1": "reports",
  "alertcenter.v1beta1": "alertcenter",
  "chromemanagement.v1": "chrome-management",
  "chromepolicy.v1": "chrome-policy",
  "cloudidentity.v1": "cloud-identity",
  "groupsmigration.v1": "groups-migration",
  "groupssettings.v1": "groups-settings",
  "licensing.v1": "licensing",
  "vault.v1": "vault",
};

/**
 * Which product API a document describes.
 *
 * @param document the document's own `<name>.<version>` key
 * @returns the product API it describes
 * @internal
 */
export function googleAdminApiFor({ document }: { document: GoogleAdminDocument }): GoogleAdminApi {
  return API_BY_DOCUMENT[document];
}

/**
 * Resource paths whose mechanical name would say nothing, and the kind they are filed under instead.
 *
 * Exactly one entry, and it is here rather than in a branch because the next one should be equally
 * visible. `alertcenter` hangs its two account-wide settings methods off a resource literally named
 * `v1beta1` — an artefact of how that document was generated, not a resource anybody named. Filed
 * mechanically it would produce the kind `alertcenter-v1beta1`, which tells a reader nothing at all.
 */
const KIND_OVERRIDES: readonly { readonly api: GoogleAdminApi; readonly path: string; readonly kind: string }[] = [
  { api: "alertcenter", kind: "alertcenter-settings", path: "v1beta1" },
];

/**
 * Kebab-case one identifier, splitting `camelCase` as well as punctuation.
 *
 * @param word the identifier to convert
 * @returns the kebab-cased form, with no leading or trailing separator
 */
function kebab({ word }: { word: string }): string {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The atlas kind one operation contributes to, from its API and the resource path that declares it.
 *
 * The path is the discovery document's own nesting of `resources`, and every segment that declares no
 * methods of its own is DROPPED — those are pure namespacing rather than resources. `chromemanagement`
 * is why: everything it publishes hangs under a method-less `customers`, so keeping it would prefix
 * seventeen kinds with a word that distinguishes none of them. A segment that declares even one method
 * is kept, because then it is a resource a reader can address.
 *
 * @param api which product API declared the operation
 * @param path the discovery document's own resource path, outermost first
 * @param declaresMethods answers whether the resource at one prefix of `path` declares methods of its own
 * @returns the kind name
 * @internal
 */
export function googleAdminKindFor({
  api,
  path,
  declaresMethods,
}: {
  api: GoogleAdminApi;
  path: readonly string[];
  declaresMethods: (input: { prefix: readonly string[] }) => boolean;
}): string {
  const override = KIND_OVERRIDES.find((rule) => rule.api === api && path.join("/") === rule.path);
  if (override !== undefined) {
    return override.kind;
  }
  const kept = path.filter((_segment, index) => declaresMethods({ prefix: path.slice(0, index + 1) }));
  if (kept.length === 0) {
    throw new Error(`googleAdminKindFor: ${api} path ${path.join("/")} keeps no segment — add a KIND_OVERRIDES rule`);
  }
  return [kebab({ word: api }), ...kept.map((segment) => kebab({ word: segment }))].join("-");
}

/**
 * The registry-unique name a caller uses instead of a URL.
 *
 * Google declares an `id` on every method, so this is the vendor's own name kebab-cased rather than one
 * invented here — and it is prefixed with the document, because the id alone collides (see this file's
 * header).
 *
 * @param document the document that declared it
 * @param id the vendor's own method `id`
 * @returns a kebab-cased name, unique across the registry (asserted by the generator)
 */
export function googleAdminOperationName({ document, id }: { document: GoogleAdminDocument; id: string }): string {
  return `${kebab({ word: document })}-${kebab({ word: id })}`;
}

/**
 * The provider key a channel is matched on, byte-exactly.
 *
 * The document is in it because Google's own method ids collide across documents — see this file's header
 * for the measurement.
 *
 * @param document the document that declared it
 * @param id the vendor's own method `id`
 * @returns `<document>:<id>`
 */
export function googleAdminProviderId({ document, id }: { document: GoogleAdminDocument; id: string }): string {
  return `${document}:${id}`;
}

/**
 * How an operation pages, read from what it declares rather than from its shape.
 *
 * @param parameters every parameter name the method declares
 * @param responseFields every top-level field name its declared response schema carries
 * @returns `page-token` when it declares both halves of the cursor pair, `none` otherwise
 * @internal
 */
export function googleAdminPagingFor({
  parameters,
  responseFields,
}: {
  parameters: readonly string[];
  responseFields: readonly string[];
}): GoogleAdminPaging {
  const asksForACursor = parameters.includes("pageToken");
  const returnsACursor = responseFields.includes("nextPageToken");
  if (asksForACursor && returnsACursor) {
    return "page-token";
  }
  return "none";
}
