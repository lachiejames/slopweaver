/**
 * The two addresses this atlas reads, and the census the reader produced when it was reviewed.
 *
 * ## Why nothing here is pinned by DIGEST, unlike its Microsoft 365 sibling
 *
 * That atlas pins an immutable `msgraph-metadata` commit, so a hash mismatch can only be a corrupted download
 * and refusing is right. Braze publishes neither a versioned specification nor an immutable address: its
 * reference is a live documentation site and its collection is a live Postman document. MEASURED from the
 * sitemap's own `lastmod` values: 289 of 1,352 pages had changed that month and 309 the month
 * before. A digest gate over bytes that legitimately move weekly would refuse to publish within days of
 * landing, so this atlas takes `kit/pinnedSpec.ts`'s posture instead — {@link BRAZE_CENSUS} is RECORDED as
 * drift, never enforced.
 *
 * ## What IS enforced is the READER, and that is the check a moving document cannot weaken
 *
 * {@link BRAZE_READER_FLOOR} carries assertions that stay true however much Braze edits its prose, because
 * each is about this build's ability to read rather than about what the vendor wrote. Every operation page
 * the sitemap declares must yield the `api_type` block Braze renders into it, and the two optional
 * extractions must find SOMETHING across the run — a parameter table that silently stops matching would
 * otherwise show up as 146 operations that take no arguments, which reads as an answer and is not one. That
 * exact failure is what `microsoft365/sync.ts` records happening during its own construction.
 *
 * ## The collection address is undocumented, deliberately
 *
 * Braze links a Postman documenter web page; the JSON behind it comes from `documenter.gw.postman.com`, which
 * Postman does not document. `docs/atlas-intent/02-both-surfaces.md` is the ruling that makes it usable: reach is judged by
 * whether a call returns, never by whether a vendor wrote it down.
 */

/** Where the reference's enumeration lives. Every operation page is discovered through this one document. */
export const BRAZE_SITEMAP_URL = "https://www.braze.com/docs/sitemap.xml";

/**
 * Where the official Postman collection's JSON lives.
 *
 * The documenter VIEW Braze links from `/docs/api/postman_collection/` is
 * `https://documenter.getpostman.com/view/4689407/SVYrsdsG`; this is the document behind it.
 */
export const BRAZE_COLLECTION_URL =
  "https://documenter.gw.postman.com/api/collections/4689407/SVYrsdsG?segregateAuth=true&versionTag=latest";

/**
 * The census this reader produced against the live sources when it was last measured.
 *
 * Reproduce with `slopweaver atlas braze sync --json`. Every number that moves is reported as drift on the
 * run's own output and in a `published-census-moved` gap; none of them refuses a publish.
 */
export const BRAZE_CENSUS = {
  /** Distinct operations across BOTH published channels. */
  allOperations: 150,
  /** Operations the collection describes and the reference does not. */
  collectionOnlyOperations: 4,
  /** Distinct method-and-path pairs in the collection, after duplicates are collapsed. */
  collectionOperations: 97,
  /** Requests in the collection, before duplicates are collapsed. */
  collectionRequests: 101,
  /** Operations both channels describe. */
  corroboratedOperations: 93,
  /** Documentation families the reference declares under `/docs/api/endpoints/`. */
  documentedFamilies: 15,
  /** Operation pages the sitemap declares. */
  documentedOperations: 146,
  /** Operations the reference describes and the collection does not. */
  docsOnlyOperations: 53,
  /** Operations this atlas will never call, because they change something. */
  excludedOperations: 81,
  /** Operations safe to read once a credential exists. */
  reachableOperations: 50,
  /** Operations enumerated and declared, never stored whole. */
  voluminousOperations: 19,
} as const;

/**
 * What this build must still be able to READ, whatever Braze has edited.
 *
 * `minPagesWithParameters` and `minPagesWithResponseFields` are floors rather than the measured 97 and 119,
 * because those two genuinely move with Braze's editing and a floor is the honest form of "this extraction
 * still works at all". `everyOperationPageParses` is not a floor: it is exact, and `sync.ts` refuses on it.
 */
export const BRAZE_READER_FLOOR = {
  /** Pages that must yield a request-parameter table, or the table extraction has silently broken. */
  minPagesWithParameters: 40,
  /** Pages that must yield response field names, or the example-response extraction has silently broken. */
  minPagesWithResponseFields: 40,
  /** Operation pages the sitemap must still declare, or the sitemap or its filter has broken. */
  minOperationPages: 100,
  /** Requests the collection must still declare, or the collection reader has broken. */
  minCollectionRequests: 60,
} as const;
