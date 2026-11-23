/**
 * The three Google API discovery documents this atlas's compiled surface is built from, pinned by REVISION
 * and by digest — as a witness, not as a gate.
 *
 * ## Why this pin behaves differently from the Microsoft 365 atlas's, and it is not a weakened gate
 *
 * `microsoft365/specLock.ts` addresses an immutable git COMMIT, so a digest mismatch there can only be a
 * truncated or intercepted download and refusing is the only correct answer. Google publishes no such
 * artefact: `generativelanguage.googleapis.com/$discovery/rest?version=<v>` is a LIVE endpoint that
 * regenerates as the API moves, and its own `revision` field advanced on the day this atlas was built. A
 * refuse-on-mismatch rule against a moving document is not a stricter atlas — it is an atlas that stops
 * compiling within the week and then reports a platform it can no longer see.
 *
 * So the numbers below are the CENSUS THAT WAS REVIEWED, and a run that reads different ones publishes what
 * it read and raises `spec-revision-moved` carrying the exact deltas. That is the same instinct the pin
 * serves elsewhere — a reader can always tell what was reviewed from what merely arrived — expressed as a
 * visible, dated disagreement rather than as a refusal.
 *
 * ## The digest is over the CANONICAL document, because Google's byte order is not stable
 *
 * MEASURED: two fetches of the `v1` document seconds apart returned 245,003 bytes each and two
 * different SHA-256 digests — same content, different object key order, which is what a server serialising a
 * map does. So a digest over the served bytes matches nothing, ever, and `specSource.ts` hashes the document
 * with its keys recursively sorted instead. Every `sha256` and `byteLength` below is of that canonical form,
 * and the canonical digest DOES reproduce across fetches, which is the property that makes it a pin at all.
 *
 * ```bash
 * # the raw digests differ between these two lines; the canonical ones do not
 * for i in 1 2; do curl -fsSL 'https://generativelanguage.googleapis.com/$discovery/rest?version=v1' | shasum -a 256; done
 * slopweaver atlas gemini-ai-studio sync --json
 * ```
 *
 * ## What refuses, as opposed to what merely records
 *
 * A strict parse of the document's own envelope, in `specRead.ts`: `kind` must be
 * `discovery#restDescription`, `name` must be `generativelanguage`, `version` must be the version that was
 * asked for, `revision` must be eight digits, and `rootUrl` must be exactly
 * {@link GEMINI_AI_STUDIO_API_ORIGIN}. A corrupted or substituted body fails that parse and publishes
 * nothing. The census below never refuses — it records, as `spec-revision-moved`.
 */

/**
 * One pinned discovery document: which version it describes, what it hashed to when it was reviewed, and the
 * census it carried then.
 *
 * @internal
 */
export interface GeminiAiStudioSpecPin {
  /** The published version segment — `v1`, `v1beta` or `v1alpha`. */
  readonly version: string;
  /** Google's own `revision` field on the document reviewed, an eight-digit date. */
  readonly revision: string;
  /** The digest of the CANONICAL document — key-sorted. Never of Google's own byte order; see the header. */
  readonly sha256: string;
  /** The canonical document's length in bytes, which is smaller than the served form's. */
  readonly byteLength: number;
  /** Every operation across every resource in the document. */
  readonly operationCount: number;
  /** Distinct first resource segments, which are this atlas's kinds. */
  readonly rootCount: number;
  /** Schemas the document declares, which is where a response's field names are resolved from. */
  readonly schemaCount: number;
  /** Operations by lower-cased HTTP method. */
  readonly methodCounts: Readonly<Record<string, number>>;
}

/**
 * The one origin this atlas may ever read, and nothing else.
 *
 * A constant rather than a parameter for the same reason `microsoft365/specSource.ts` gives: nothing takes a
 * host, so there is no argument that reaches an unreviewed origin. It is also the value the document's own
 * `rootUrl` is checked against, which is what makes a substituted body detectable without a digest gate.
 */
export const GEMINI_AI_STUDIO_API_ORIGIN = "https://generativelanguage.googleapis.com";

/**
 * The address one version's discovery document is published at.
 *
 * @param version the published version segment
 * @returns the absolute URL
 */
export function geminiAiStudioDiscoveryUrl({ version }: { version: string }): string {
  return `${GEMINI_AI_STUDIO_API_ORIGIN}/$discovery/rest?version=${version}`;
}

/**
 * The three documents that were reviewed.
 *
 * MEASURED by fetching each of the three published versions TWICE and confirming the canonical
 * digests reproduced before the numbers were taken. All three carried `revision: 20260904`.
 *
 * Two findings from that measurement are worth carrying here, because neither is visible in any one
 * document:
 *
 * - `v1beta` and `v1alpha` declare exactly the SAME 85 operations, with the same paths, methods, response
 *   schemas, query parameters and response fields. They differ only in how many schemas each catalogues
 *   (221 against 225). So the compiled channel produced ZERO version disagreements on this revision, and
 *   that is a measurement rather than an untested code path.
 * - FOUR operations exist in `v1` and in NEITHER pre-release version: `operations.list`, `operations.delete`,
 *   `media.download` and `tunedModels.operations.cancel`. A reader who knows only `v1beta` — which is what
 *   most Gemini documentation shows — would conclude the API offers no way to list a long-running operation.
 *   It does, on the stable version. That is the unknown unknown compiling all three exists to surface.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_SPEC_PINS = [
  {
    byteLength: 180220,
    methodCounts: { delete: 6, get: 22, patch: 3, post: 21 },
    operationCount: 52,
    revision: "20260904",
    rootCount: 11,
    schemaCount: 138,
    sha256: "598784516a090a36d00967a61497ce38c6e38dd64e54c29c2de763462298e282",
    version: "v1",
  },
  {
    byteLength: 278448,
    methodCounts: { delete: 10, get: 32, patch: 6, post: 37 },
    operationCount: 85,
    revision: "20260904",
    rootCount: 12,
    schemaCount: 225,
    sha256: "3fbc15e8bcaacb3f13425ace6bfbfb0059301e693c4f88db73202ca3cbec2b36",
    version: "v1alpha",
  },
  {
    byteLength: 275938,
    methodCounts: { delete: 10, get: 32, patch: 6, post: 37 },
    operationCount: 85,
    revision: "20260904",
    rootCount: 12,
    schemaCount: 221,
    sha256: "836bf6eaceb61900c88221187f7e0f5cae4d1af4e4b51a1c4a5a0a7db43ede1d",
    version: "v1beta",
  },
] as const satisfies readonly GeminiAiStudioSpecPin[];

/**
 * Every version this build compiles: the closed union a pin lookup is keyed on, derived from the rows above.
 *
 * @internal
 */
export type GeminiAiStudioSpecVersion = (typeof GEMINI_AI_STUDIO_SPEC_PINS)[number]["version"];

/**
 * Every version this atlas compiles, in the order it reads them.
 *
 * @returns the version segments
 */
export function geminiAiStudioSpecVersions(): readonly GeminiAiStudioSpecVersion[] {
  return GEMINI_AI_STUDIO_SPEC_PINS.map((pin) => pin.version);
}

/**
 * Is this decoded string a version this build compiles? The guard a caller holding a runtime string runs
 * BEFORE {@link geminiAiStudioSpecPin}, refusing an unpinned version rather than looking it up.
 *
 * @param value a version segment read from outside the type system
 * @returns whether a reviewed pin exists for it
 */
export function isGeminiAiStudioSpecVersion(value: string): value is GeminiAiStudioSpecVersion {
  return GEMINI_AI_STUDIO_SPEC_PINS.some((pin) => pin.version === value);
}

/**
 * The pin for one version.
 *
 * @param version a compiled version, narrowed by {@link isGeminiAiStudioSpecVersion} when read at run time
 * @returns its reviewed pin
 */
export function geminiAiStudioSpecPin({ version }: { version: GeminiAiStudioSpecVersion }): GeminiAiStudioSpecPin {
  // `version` is a member of the union derived from these very rows, so exactly one row carries it.
  return GEMINI_AI_STUDIO_SPEC_PINS.find((pin) => pin.version === version)!;
}

/**
 * Every operation across the three reviewed documents, which is what a sync's own total is compared against.
 *
 * 222 rather than the 85 a reader who knows only `v1beta` would expect: the same operation published at
 * three versions is three declarations, and this atlas folds them into one entity carrying all three
 * versions rather than dropping two of them.
 */
export const GEMINI_AI_STUDIO_REVIEWED_OPERATION_TOTAL = GEMINI_AI_STUDIO_SPEC_PINS.reduce(
  (total, pin) => total + pin.operationCount,
  0,
);
