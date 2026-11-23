/**
 * The typed failures of the Braze atlas — reading its Postman collection (`collection.ts`), its reference
 * pages (`docsCatalogue.ts`), fetching either (`specSource.ts`), refusing a family this build has no kind
 * for (`sync.ts`), and reporting before anything was published (`report.ts`).
 *
 * One union for the directory per `.claude/rules/error-handling.md`: its failures form no second cluster
 * worth a file. A variant carrying `reasons` keeps one line per problem, and {@link brazeAtlasErrorLines}
 * is how a caller prints them without re-composing the joined `message`.
 *
 * Braze's reference needs no credential, so no variant can carry one; a fetched address is Braze's own
 * public documentation or collection URL, which the refusal has always printed.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import { BRAZE_SITEMAP_URL } from "./specLock.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** Every way reading, fetching or reporting the Braze atlas can fail. */
export type BrazeAtlasError =
  | Listed<"COLLECTION_NOT_JSON">
  | Plain<"COLLECTION_NOT_OBJECT">
  | Plain<"COLLECTION_WITHOUT_ITEMS">
  | Plain<"COLLECTION_WITHOUT_REQUESTS">
  | (Listed<"PAGE_UNDECLARED"> & { readonly url: string })
  | (Plain<"DECLARATION_EMPTY"> & { readonly url: string })
  | Listed<"NOTHING_PUBLISHED">
  | (Listed<"SITEMAP_EMPTY"> & { readonly characters: number })
  | (Listed<"FETCH_REFUSED"> & { readonly label: string; readonly status: number; readonly url: string })
  | (Plain<"FETCH_FAILED"> & { readonly label: string })
  | (Listed<"FAMILIES_UNKNOWN"> & { readonly unknownFamilies: readonly string[] });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BrazeAtlasErrors = {
  collectionNotJson: ({ cause }: { cause: unknown }): BrazeAtlasError =>
    listed({
      code: "COLLECTION_NOT_JSON",
      reasons: ["the Braze Postman collection is not valid JSON", errorMessage({ error: cause })],
    }),
  collectionNotObject: (): BrazeAtlasError => ({
    code: "COLLECTION_NOT_OBJECT",
    message: "the Braze Postman collection is not a JSON object",
  }),
  collectionWithoutItems: (): BrazeAtlasError => ({
    code: "COLLECTION_WITHOUT_ITEMS",
    message: "the Braze Postman collection declares no `item` array, so it carries no requests to read",
  }),
  collectionWithoutRequests: (): BrazeAtlasError => ({
    code: "COLLECTION_WITHOUT_REQUESTS",
    message: "the Braze Postman collection declares no readable request at all, so nothing was published",
  }),
  declarationEmpty: ({ url }: { url: string }): BrazeAtlasError => ({
    code: "DECLARATION_EMPTY",
    message: `${url} declares an empty method or address in its api_type block`,
    url,
  }),
  familiesUnknown: ({ unknownFamilies }: { unknownFamilies: readonly string[] }): BrazeAtlasError => ({
    ...listed({
      code: "FAMILIES_UNKNOWN",
      reasons: [
        `Braze's reference declares ${String(unknownFamilies.length)} documentation family/families this build has no kind for: ${unknownFamilies.join(", ")}`,
        "nothing was published — a new family is Braze adding a product area, which is exactly the unknown unknown this atlas exists to surface. Add it to BRAZE_KINDS and to atlasHome.ts, then run again",
      ],
    }),
    unknownFamilies,
  }),
  fetchFailed: ({ label, cause }: { label: string; cause: unknown }): BrazeAtlasError => ({
    code: "FETCH_FAILED",
    label,
    message: `fetching ${label} failed: ${errorMessage({ error: cause })}`,
  }),
  fetchRefused: ({ label, status, url }: { label: string; status: number; url: string }): BrazeAtlasError => ({
    ...listed({
      code: "FETCH_REFUSED",
      reasons: [`fetching ${label} returned HTTP ${String(status)}`, `the address is ${url}`],
    }),
    label,
    status,
    url,
  }),
  nothingPublished: (): BrazeAtlasError =>
    listed({
      code: "NOTHING_PUBLISHED",
      reasons: [
        "no generation has been published, so there is nothing to compare",
        "run: slopweaver atlas braze sync — it needs no credential",
      ],
    }),
  pageUndeclared: ({ url }: { url: string }): BrazeAtlasError => ({
    ...listed({
      code: "PAGE_UNDECLARED",
      reasons: [
        `${url} carries no <div class="api_type"> block, so this build cannot read the method and address Braze declares for it`,
        "every operation page Braze served at its own address carried one when this reader was measured (146 of 146, on two separate measurements), and a page redirected off the operation tree is reported as unserved before this check — so a page served as an operation without one is a change in Braze's own template rather than an operation to drop silently",
      ],
    }),
    url,
  }),
  sitemapEmpty: ({ characters }: { characters: number }): BrazeAtlasError => ({
    ...listed({
      code: "SITEMAP_EMPTY",
      reasons: [
        "the Braze documentation sitemap declared no operation pages at all",
        `an operation page is one under /docs/api/endpoints/ whose last segment begins with an HTTP method and an underscore; ${BRAZE_SITEMAP_URL} returned ${String(characters)} characters`,
      ],
    }),
    characters,
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the atlas returned them before it had a
 * type: a list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function brazeAtlasErrorLines({ error }: { error: BrazeAtlasError }): readonly string[] {
  if (
    error.code === "COLLECTION_NOT_JSON" ||
    error.code === "PAGE_UNDECLARED" ||
    error.code === "NOTHING_PUBLISHED" ||
    error.code === "SITEMAP_EMPTY" ||
    error.code === "FETCH_REFUSED" ||
    error.code === "FAMILIES_UNKNOWN"
  ) {
    return error.reasons;
  }
  return [error.message];
}
