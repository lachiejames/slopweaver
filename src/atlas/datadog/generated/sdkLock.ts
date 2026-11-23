/**
 * What this atlas's registry is generated from, pinned by version, digest and census.
 *
 * ## Two authorities were considered. MEASURED, they are one.
 *
 * The obvious design — and the one an adversarial planning pass recommended — is to treat Datadog's
 * published OpenAPI as the row authority and the installed client as an independent parity check, emitting
 * `spec-only` and `sdk-only` sets the way a two-surface atlas emits a disagreement. That was measured
 * against the OpenAPI documents at the client's own release tag, and the answer is a **zero
 * diff**: 1,735 operations on each side, no operation the specification declares that the client cannot
 * reach, and none the client reaches that the specification does not declare. They are not two authorities.
 * The client is GENERATED from those documents, so pinning both as rivals would be ceremony that reads like
 * corroboration.
 *
 * So the row authority is the installed SDK — the artifact that would actually issue the request, resolved
 * offline from `node_modules`, reproducible on any checkout with this lockfile — and the specification is
 * pinned for exactly the two ANNOTATIONS the compiled client drops or degrades:
 *
 * - `x-unstable`, which the client DOES carry (552 `unstableOperations[...]` guards, matching the
 *   specification's 552 exactly), so it is read from the client and the specification only confirms it;
 * - `deprecated`, which the client does NOT carry structurally. The specification marks 85 operations
 *   deprecated; the client's declarations mention deprecation in prose 73 times, and prose is not a flag.
 *   That is the one thing the specification is pinned FOR.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the artifact is byte-for-byte the one that was reviewed. It does NOT prove the SDK covers
 * Datadog's whole API — and conflating the two is the mistake this comment exists to prevent.
 * `/api/v1/logs-analytics/list` and `/api/v1/logs-analytics/aggregate` are the unified event API behind
 * every explorer, they are absent from BOTH pinned documents, and `src/datadog/rawRequest.ts` exists
 * precisely to reach them. So the registry has a NAMED shortfall rather than a silent one: the atlas's own
 * coverage records that its API surface is bounded by what the client declares.
 *
 * This is also why the registry being closed and `rawRequest.ts` existing are not in conflict. The registry
 * bounds what the ATLAS may call while publishing a generation. `datadog raw` is an investigation verb with
 * its own read-only enforcement, its own explicit POST allowlist, and no generation to publish into. The
 * descriptor claims that ATLAS ACQUISITION is closed, never that every Datadog verb in this repository is.
 *
 * ## Reproduce every number here
 *
 * ```bash
 * yarn tsx tools/generateDatadogSurfaces.ts --verify              # SDK pin and census
 * yarn tsx tools/generateDatadogSurfaces.ts --verify --spec-dir D # plus the specification pin and parity
 * ```
 *
 * where `D` holds `v1.yaml` and `v2.yaml` fetched from the URLs below.
 */

/**
 * One pinned SDK package: what it hashed to, and the census it must still satisfy.
 * @internal
 */
export interface DatadogSdkPackagePin {
  /** How many `apis/*.js` modules the package ships. */
  readonly apiModules: number;
  /**
   * SHA-256 over every `apis/*.js` module in sorted name order, each module's NAME then its bytes.
   *
   * The name is hashed as well as the content so a renamed module moves the digest — a rename that
   * preserved every byte would otherwise be invisible, and a renamed API class is exactly the change that
   * silently repoints a surface name.
   */
  readonly sha256: string;
}

/**
 * One pinned OpenAPI document: where it came from, what it hashed to, and what it must still declare.
 * @internal
 */
export interface DatadogSpecPin {
  readonly url: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/**
 * The pinned artifacts.
 *
 * MEASURED against the resolution in this repository's `yarn.lock`. The operation census is the
 * count of `.getServer("...")` call sites across every `apis/*.js` module, which is the one place each
 * operation names itself; the generator asserts its own extraction against it, and that assertion is not
 * decoration — an earlier extraction over the same tree returned 1,734 because a regex with a lookahead
 * lost one operation, and the census is what caught it.
 */
export const DATADOG_SDK_PIN = {
  /** The `@datadog/datadog-api-client` version this registry was generated from. */
  version: "1.62.0",
  packages: {
    v1: { apiModules: 31, sha256: "7708e18dba920c23ad7b7bec79684a3815e3c097fb8c3774dcef19832cea084f" },
    v2: { apiModules: 140, sha256: "63b7f805ce995320aec86863c1ad8dc10e67918c9dde2fdf0091430c35a063cb" },
  } satisfies Readonly<Record<"v1" | "v2", DatadogSdkPackagePin>>,
  /** Every operation the client declares, by HTTP method. */
  census: {
    total: 1735,
    DELETE: 247,
    GET: 748,
    PATCH: 179,
    POST: 451,
    PUT: 110,
  },
  /** Operations the client guards behind `unstableOperations`, matching the specification's `x-unstable`. */
  unstableOperations: 552,
} as const;

/**
 * The OpenAPI documents at the client's own release tag, pinned for the `deprecated` flag and for parity.
 *
 * An immutable tag URL rather than `latest`, for the reason `jumpcloud/generated/specLock.ts` gives: a table
 * regenerated from whatever the vendor served this morning is a table nobody reviewed.
 */
export const DATADOG_SPEC_PINS = {
  v1: {
    byteLength: 1664152,
    sha256: "01f39df284c1a29d1f55f28d6ddf8192c037bb342aae9c447e01ee8e78ac2018",
    url: "https://raw.githubusercontent.com/DataDog/datadog-api-client-typescript/v1.62.0/.generator/schemas/v1/openapi.yaml",
  },
  v2: {
    byteLength: 7603770,
    sha256: "cdf34b5cfaa7d06f585fbca627a5f5f4be09b7d77b2118ef4a700e3e592b559e",
    url: "https://raw.githubusercontent.com/DataDog/datadog-api-client-typescript/v1.62.0/.generator/schemas/v2/openapi.yaml",
  },
} as const satisfies Readonly<Record<"v1" | "v2", DatadogSpecPin>>;

/**
 * What the two pinned artifacts said about each other when they were pinned.
 *
 * The zero diff is the measurement this file's header rests on, and it is kept as a number the generator
 * re-checks rather than as prose: if a later SDK bump ever produces a non-zero `specOnly` or `sdkOnly`, that
 * is a real finding about Datadog's surface and the generator must stop rather than absorb it.
 */
export const DATADOG_SPEC_PARITY = {
  /** Operations both the specification and the client declare. */
  matching: 1735,
  /** Declared by the specification, unreachable through the client. */
  specOnly: 0,
  /** Reachable through the client, undeclared by the specification. */
  sdkOnly: 0,
  /** Operations the specification marks `deprecated` — the one annotation the client does not carry. */
  deprecated: 85,
} as const;
