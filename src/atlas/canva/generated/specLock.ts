/**
 * The vendor artifact this atlas's surface registry was generated from, pinned so a regeneration that
 * quietly read something else fails instead of publishing.
 *
 * ## Why a URL and a digest, and no committed copy
 *
 * Nightfall's `specLock.ts` is the sibling and the reasoning is the same: the generated table is the
 * reviewed boundary, and the artifact it came from is pinned rather than vendored, so a reviewer diffs 59
 * rows instead of 452KB of somebody else's YAML. Fetch the document to a directory and run
 * `yarn tsx tools/generateCanvaSurfaces.ts --verify --spec-dir <dir>` to check the pin.
 *
 * ## One document, and the vendor serves it from its own developer site
 *
 * Unlike Nightfall's six, Canva publishes a single OpenAPI description covering the whole Connect API, from
 * its own domain rather than a documentation host. It needs no credential and no account:
 *
 * ```bash
 * curl -sSL https://www.canva.dev/sources/connect/api/latest/api.yml | shasum -a 256
 * ```
 *
 * A digest mismatch means the vendor re-published, which is a thing to READ rather than a thing to fix:
 * regenerate, and the diff over the committed table is the change to the platform's surface. The `latest`
 * in that URL is the vendor's own word, so the document moves under it — which is exactly why the digest
 * is pinned and the version below is recorded from the document's own `info.version` rather than assumed.
 */

/**
 * The one pinned published document.
 * @internal
 */
export interface CanvaSpecPin {
  /** Byte length, so a truncated fetch fails on the cheaper check first. */
  readonly byteLength: number;
  /** How many operations the document declares — the whole census, since there is one document. */
  readonly operations: number;
  /** The document's own single `servers[0].url`. */
  readonly server: string;
  /** SHA-256 of the document's bytes, exactly as served. */
  readonly sha256: string;
  /** The document's own `info.title`. */
  readonly title: string;
  /** The URL the vendor serves it from. */
  readonly url: string;
  /** The document's own `info.version` — Canva versions its API by date. */
  readonly version: string;
}

/**
 * The Canva Connect API description, as last fetched.
 * @internal
 */
export const CANVA_SPEC_PIN: CanvaSpecPin = {
  byteLength: 462777,
  operations: 59,
  server: "https://api.canva.com/rest",
  sha256: "20db741488ba85720f01aa1395c093e7b5bdff77f39782e7b189d2c5591a38e5",
  title: "Canva Connect API",
  url: "https://www.canva.dev/sources/connect/api/latest/api.yml",
  version: "2024-06-18",
};

/**
 * How many operations the whole published surface holds.
 *
 * Equal to the pin's own count by construction — written out separately so the generated table can be
 * checked against a single number without importing the table, which is what `--verify` does with no
 * vendor bytes and no network.
 */
export const CANVA_OPERATION_CENSUS = 59;

/**
 * How many operations take each effect, measured on the pinned generation.
 *
 * A census per effect rather than only a total, because the total cannot move when a row silently changes
 * side — and changing side is exactly what a mis-edited verdict does. The two `read` POSTs are the reason
 * the census is worth asserting at all: `effects.ts` carries which they are and why.
 */
export const CANVA_EFFECT_CENSUS = {
  mutating: 19,
  read: 36,
  "side-effecting": 4,
} as const;

/**
 * How many operations the vendor's own prose marks at each stability, measured on the same generation.
 *
 * A third of this platform's published surface is a preview whose breaking changes will not produce a new
 * API version, and a public integration using one cannot pass Canva's review. That is a fact about the
 * platform rather than about this atlas, so it is pinned as a number a regeneration has to match.
 */
export const CANVA_STABILITY_CENSUS = {
  deprecated: 1,
  preview: 20,
  stable: 38,
} as const;

/**
 * How many operations require the caller to BE something, measured on the same generation.
 *
 * `eligibility.ts` carries why this is not derivable from any machine-readable field, and why the nine here
 * do not match the seven operations carrying the vendor's own `x-required-capabilities` extension.
 */
export const CANVA_ENTITLEMENT_CENSUS = {
  "enterprise-organization": 7,
  none: 50,
  "premium-plan": 2,
} as const;

/**
 * How many OAuth scopes the document declares, and how many its operations between them actually name.
 *
 * The GRANT surface is strictly wider than the CALL surface, and this pair is what makes that checkable
 * rather than a sentence. `gaps.ts` raises the difference by name.
 */
export const CANVA_SCOPE_CENSUS = { declared: 18, named: 16 } as const;
