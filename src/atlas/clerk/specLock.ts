/**
 * The four Clerk documents this atlas's compiled surface is built from, pinned by COMMIT and by digest.
 *
 * ## Why a pin rather than "whatever the vendor served this morning"
 *
 * The compiled channel is one of this atlas's two filled surfaces, and a surface regenerated from a moving
 * document is a surface nobody reviewed. Clerk re-publishes `clerk/openapi-specs` continuously and ships a
 * new dated Backend API version several times a year, so the pin addresses an immutable COMMIT rather than
 * a branch — the sibling Microsoft 365 atlas's `specLock.ts` arrived at the same shape for the same reason,
 * and the URL itself can never serve different bytes with the commit in it.
 *
 * Verify every number here with:
 *
 * ```bash
 * curl -fsSL "<the url of the bapi entry pinned below>" | shasum -a 256
 * slopweaver atlas clerk sync --json
 * ```
 *
 * ## Which version of each API is pinned, and why the others are a declared gap
 *
 * Clerk versions its Backend and Frontend APIs by date and keeps six of each in the repository at once.
 * This atlas pins the LATEST of each, because the surface map answers "what can be asked today" — and the
 * five older versions of each are a permanent, never-closing gap (`clerk-api-versions-not-compiled`) rather
 * than a silence. An installation pinned to an older version reads a surface this atlas does not map, which
 * is a thing the gap list should say out loud rather than something a reader discovers.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the documents are byte-for-byte the ones that were reviewed. It does NOT prove this
 * installation can call anything in them: the compiled channel reads four public documents and reaches no
 * Clerk account at all, which is why `model.ts` gives it a visibility scope of its own. Reading a compiled
 * operation as a capability is the single most available mistake with this atlas.
 */

/**
 * The commit in `clerk/openapi-specs` every pinned URL addresses.
 *
 * One commit for all four documents, so a regeneration cannot mix versions that were never published
 * together.
 *
 * @internal
 */
export const CLERK_SPEC_COMMIT = "7987d1b776258d5ddd9163e1a03d256b5ac4d64a";

/**
 * Every document this atlas compiles, as a closed union.
 *
 * The names are this atlas's own {@link ../model.js#ClerkApi} values plus `webhooks`, rather than the
 * vendor's file names, because a file name carries a version date that moves with the pin and a document
 * name should not.
 *
 * @internal
 */
export const CLERK_SPEC_DOCUMENTS = ["bapi", "fapi", "platform", "webhooks"] as const;

/** One document this atlas compiles. */
export type ClerkSpecDocument = (typeof CLERK_SPEC_DOCUMENTS)[number];

/**
 * One pinned document: where it came from, what it hashed to, and the census it must still satisfy.
 *
 * @internal
 */
export interface ClerkSpecPin {
  /** Which document this is, in this atlas's own vocabulary. */
  readonly document: ClerkSpecDocument;
  /** The path within `clerk/openapi-specs`, which carries the vendor's own version date. */
  readonly repositoryPath: string;
  /** The immutable commit-addressed document this atlas reads; also the reproduction handle. */
  readonly url: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Every path key in the document. */
  readonly pathCount: number;
  /** Every operation across every path — the whole surface, reads and writes together. */
  readonly operationCount: number;
  /** Component schemas the document declares, which is where a response's field names are resolved from. */
  readonly schemaCount: number;
  /** Events under `x-webhooks`. Non-zero on the webhooks document alone. */
  readonly webhookEventCount: number;
  /**
   * This document's own operations, by HTTP method.
   *
   * Per DOCUMENT rather than only in total, because a total cannot see a row changing side: a reader that
   * lost a GET in one document and gained one in another leaves every total untouched, which is exactly the
   * drift a census exists to catch.
   */
  readonly methodCounts: Readonly<Record<string, number>>;
}

/**
 * The four documents, pinned.
 *
 * MEASURED against commit {@link CLERK_SPEC_COMMIT}. Every number is asserted by
 * `sync.ts`'s census check before a byte is published, and a mismatch is a change in THIS reader rather
 * than in Clerk's documents — the commit is immutable, so their bytes cannot move.
 */
export const CLERK_SPEC_PINS: readonly ClerkSpecPin[] = [
  {
    byteLength: 738_295,
    document: "bapi",
    methodCounts: { delete: 37, get: 78, patch: 29, post: 95, put: 10 },
    operationCount: 249,
    pathCount: 185,
    repositoryPath: "bapi/2026-05-12.yml",
    schemaCount: 167,
    sha256: "75df3a43fcb2d9fc4467a23c717714f5228aa3267b0930ba34612728365fd8f2",
    url: `https://raw.githubusercontent.com/clerk/openapi-specs/${CLERK_SPEC_COMMIT}/bapi/2026-05-12.yml`,
    webhookEventCount: 0,
  },
  {
    byteLength: 557_625,
    document: "fapi",
    methodCounts: { delete: 23, get: 74, patch: 16, post: 85, put: 4 },
    operationCount: 202,
    pathCount: 165,
    repositoryPath: "fapi/2026-05-12.yml",
    schemaCount: 224,
    sha256: "1b16fc8d2886210d8f23175bd3113e7c20c24fdb408347a1219994d413104c57",
    url: `https://raw.githubusercontent.com/clerk/openapi-specs/${CLERK_SPEC_COMMIT}/fapi/2026-05-12.yml`,
    webhookEventCount: 0,
  },
  {
    byteLength: 166_787,
    document: "platform",
    methodCounts: { delete: 10, get: 19, patch: 4, post: 17, put: 1 },
    operationCount: 51,
    pathCount: 32,
    repositoryPath: "platform/beta.yml",
    schemaCount: 72,
    sha256: "15c3f3d17be425f149a8eb7fc6dfadcb748c29cc589e8f6ac9e744e343efa73a",
    url: `https://raw.githubusercontent.com/clerk/openapi-specs/${CLERK_SPEC_COMMIT}/platform/beta.yml`,
    webhookEventCount: 0,
  },
  {
    byteLength: 192_148,
    document: "webhooks",
    methodCounts: {},
    operationCount: 0,
    pathCount: 0,
    repositoryPath: "webhooks/2025-04-15.yml",
    schemaCount: 63,
    sha256: "92f60e4e81612b088aba4e71cbb4dbc8372f3a5d9bf70c3daba17145aa42f93f",
    url: `https://raw.githubusercontent.com/clerk/openapi-specs/${CLERK_SPEC_COMMIT}/webhooks/2025-04-15.yml`,
    webhookEventCount: 45,
  },
];

/**
 * The whole-surface census, across all four documents.
 *
 * Checked ALONGSIDE the per-document numbers rather than instead of them: a reader that gained an operation
 * in one document and lost one in another leaves the total untouched, which is exactly the drift a total
 * cannot see.
 *
 * @internal
 */
export const CLERK_TOTAL_CENSUS = {
  operationCount: 502,
  pathCount: 382,
  schemaCount: 526,
  webhookEventCount: 45,
} as const;

/**
 * Every operation across the four documents, by HTTP method.
 *
 * A method quietly dropped from the walk is the failure a total cannot see and a digest cannot see either
 * — it happened once on the sibling Microsoft 365 atlas, where parameters arriving by `$ref` were skipped
 * and every GET reported as unpageable.
 *
 * @internal
 */
export const CLERK_METHOD_CENSUS: Readonly<Record<string, number>> = {
  delete: 70,
  get: 171,
  patch: 49,
  post: 197,
  put: 15,
};

/**
 * The one pin for one document.
 *
 * @param document which document to look up
 * @returns its pin
 *
 * @internal
 */
export function clerkSpecPinFor({ document }: { document: ClerkSpecDocument }): ClerkSpecPin {
  const found = CLERK_SPEC_PINS.find((pin) => pin.document === document);
  if (found === undefined) {
    // Unreachable while CLERK_SPEC_PINS covers CLERK_SPEC_DOCUMENTS, which `specLock.test.ts` asserts.
    throw new Error(`no Clerk specification pin is declared for the document "${document}"`);
  }
  return found;
}
