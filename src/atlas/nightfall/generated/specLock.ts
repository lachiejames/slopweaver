/**
 * The vendor artifacts this atlas's surface registry was generated from, pinned so a regeneration that
 * quietly read something else fails instead of publishing.
 *
 * ## Why a URL and a digest, and no committed copy
 *
 * The Datadog atlas's `sdkLock.ts` is the sibling and the reasoning is the same: the generated table is the
 * reviewed boundary, and the artifact it came from is pinned rather than vendored, so a reviewer diffs 56
 * rows instead of 367KB of somebody else's YAML. Fetch the documents to the same directory and run
 * `yarn tsx tools/generateNightfallSurfaces.ts --verify --spec-dir <dir>` to check the pin.
 *
 * ## These are the vendor's own documents, served to any browser, and that is how they were found
 *
 * They are not published from a repository — `github.com/nightfallai` holds four language SDKs and no
 * OpenAPI. The documents are what the vendor's own API-reference pages render from, and the URLs below are
 * the ones those pages load. Reproduce the discovery:
 *
 * ```bash
 * curl -sSL https://help.nightfall.ai/developer-api/nightfall_apis/dlp \
 *   | grep -ohE 'openapi\.gitbook\.com/o/[^/]+/spec/[A-Za-z0-9_.-]+'
 * ```
 *
 * A digest mismatch means the vendor re-published, which is a thing to READ rather than a thing to fix:
 * regenerate, and the diff over the committed table is the change to the platform's surface.
 */

/**
 * One pinned published document.
 * @internal
 */
export interface NightfallSpecPin {
  /** The document's own file name, which is also its {@link ../surfaceNaming.js#NightfallSpecDocument}. */
  readonly document: string;
  /** The URL the vendor's own API-reference page loads it from. */
  readonly url: string;
  /** SHA-256 of the document's bytes, exactly as served. */
  readonly sha256: string;
  /** Byte length, so a truncated fetch fails on the cheaper check first. */
  readonly byteLength: number;
  /** The document's own `info.title`. */
  readonly title: string;
  /** The document's own single `servers[0].url`. */
  readonly server: string;
  /** How many operations this document declares — the per-document half of the census. */
  readonly operations: number;
}

/** Where every pinned document is served from. */
const SPEC_ORIGIN = "https://openapi.gitbook.com/o/-Mg3xZhQfe7dJYwKq3wL/spec";

/**
 * Every document, as fetched.
 *
 * The counts are asserted by the generator on every run, not merely recorded: an extraction that lost an
 * operation to a malformed path key would otherwise emit a smaller table that still looked complete. That
 * exact failure is what the Datadog census caught (1,734 where 1,735 were declared), which is why this one
 * exists before it has ever fired.
 */
export const NIGHTFALL_SPEC_PINS: readonly NightfallSpecPin[] = [
  {
    byteLength: 79335,
    document: "activitydlp",
    operations: 9,
    server: "https://api.nightfall.ai/dlp/v1",
    sha256: "c6fa4af50e4244f0fa429f3a44466df944f71c8c0e73a2275ac19b6b10b8f6ee",
    title: "Nightfall Workflow DLP API",
    url: `${SPEC_ORIGIN}/activitydlp.yaml`,
  },
  {
    byteLength: 77260,
    document: "activitylogexfil",
    operations: 6,
    server: "https://api.nightfall.ai/exfiltration/v1",
    sha256: "6c1f6df232d23342cb820ca380aef1b8405da8ba206e3cc78418f90f64f07b05",
    title: "Nightfall Workflow Exfiltration API",
    url: `${SPEC_ORIGIN}/activitylogexfil.yaml`,
  },
  {
    byteLength: 71499,
    document: "ai-governance",
    operations: 14,
    server: "https://api.nightfall.ai/ai-governance/v1",
    sha256: "59efdd7262865c17ad9d4b1decb456cd2a620dbf4fe3b97411025ddafb46f348",
    title: "Nightfall AI Governance API",
    url: `${SPEC_ORIGIN}/ai-governance.yaml`,
  },
  {
    byteLength: 44573,
    document: "apps",
    operations: 16,
    server: "https://api.nightfall.ai/apps/v1",
    sha256: "0ff8062298a20a623d918bc0cf8ce6bc80304ed17576255aabf91180c73b46bb",
    title: "Nightfall Workflow Applications API",
    url: `${SPEC_ORIGIN}/apps.yaml`,
  },
  {
    byteLength: 36848,
    document: "oldapis",
    operations: 5,
    server: "https://api.nightfall.ai",
    sha256: "ebb91c8c1fb8518f9d38e226e5e8a1b8f4bcb8b9adc93d81d5b4ac41959861ab",
    title: "Nightfall API",
    url: `${SPEC_ORIGIN}/oldapis.yaml`,
  },
  {
    byteLength: 57918,
    document: "postureupdate",
    operations: 6,
    server: "https://api.nightfall.ai/posture/v1",
    sha256: "18e0b33946df51528fd2d8a9151b5dfa69b7d6c77f48683fa1c9b23820890d00",
    title: "Nightfall Workflow Posture API",
    url: `${SPEC_ORIGIN}/postureupdate.yaml`,
  },
];

/**
 * How many operations the whole published surface holds.
 *
 * The sum of the per-document counts, written out so the generated table can be checked against a single
 * number without importing the table.
 */
export const NIGHTFALL_OPERATION_CENSUS = 56;

/**
 * How many operations the atlas takes each disposition on, measured on the stored generation.
 *
 * A census per disposition rather than only a total, because the total cannot move when a row silently
 * changes side — and changing side is exactly what a mis-edited rule does. `probe-only` is zero because
 * Nightfall publishes no credential-validation endpoint; `dispositions.ts` says why that is a fact about
 * the vendor rather than an unused concept.
 */
export const NIGHTFALL_DISPOSITION_CENSUS = {
  entity: 21,
  excluded: 18,
  "probe-only": 0,
  "shape-index": 17,
} as const;
