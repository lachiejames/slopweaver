/**
 * The three JumpCloud specifications this atlas's registry is generated from, pinned by digest.
 *
 * ## Why a lock rather than a runtime fetch
 *
 * The registry is the read-only boundary: a caller names a SURFACE and the request is looked up, so no
 * caller can supply an origin, method or path. That property is only worth as much as the table behind it,
 * and a table regenerated from whatever the vendor served this morning is a table nobody reviewed. So the
 * generator refuses to emit when a digest or a census moves, and a human looks at the diff.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the specification is byte-for-byte the one that was reviewed. It does NOT prove the generated
 * projections are complete over it, and conflating the two is the mistake this comment exists to prevent:
 * measured, nine of the selected operations declare an EMPTY (`{}`) success schema — seven of
 * them on admitted `applemdms` rows — and `/insights/directory/v1/events` declares an open
 * `additionalProperties: true` array. A digest lock blesses none of those. Each needs a separately pinned,
 * reviewed authority for its field contract, or the operation is not projectable and must say so.
 *
 * Verify every number here with:
 *
 * ```bash
 * curl -fsSL https://docs.jumpcloud.com/api/1.0/index.yaml | shasum -a 256
 * curl -fsSL https://docs.jumpcloud.com/api/2.0/index.yaml | shasum -a 256
 * curl -fsSL https://docs.jumpcloud.com/api/insights/directory/1.0/index.yaml | shasum -a 256
 * ```
 */

/**
 * One pinned specification: where it came from, what it hashed to, and the census it must still satisfy.
 * @internal
 */
export interface JumpcloudSpecPin {
  /** The document this atlas reads; also the reproduction handle. */
  readonly url: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Every path key in the document. */
  readonly pathCount: number;
  /** GET operations, the observational surface this atlas is built from. */
  readonly getCount: number;
}

/**
 * The pinned set.
 *
 * MEASURED three times independently, with identical results.
 */
export const JUMPCLOUD_SPEC_PINS = {
  insights: {
    byteLength: 272944,
    getCount: 2,
    pathCount: 7,
    sha256: "fa21b67f8beda2b98e33bba0b588a80b244c2bba898c6095544df3ef8b889a7d",
    url: "https://docs.jumpcloud.com/api/insights/directory/1.0/index.yaml",
  },
  v1: {
    byteLength: 368080,
    getCount: 21,
    pathCount: 81,
    sha256: "2d6f66e5f6ce56623458168a31246bb698b3659be3987f2fa1f003e75acfe274",
    url: "https://docs.jumpcloud.com/api/1.0/index.yaml",
  },
  v2: {
    byteLength: 2940657,
    getCount: 464,
    pathCount: 715,
    sha256: "bf2427024231a244996063904117f2c4775ee67e8344562ce65739575fd8a9c3",
    url: "https://docs.jumpcloud.com/api/2.0/index.yaml",
  },
} as const satisfies Readonly<Record<string, JumpcloudSpecPin>>;

/**
 * The two origins this atlas may ever reach, and nothing else.
 *
 * `console.jumpcloud.com` serves the Directory API (v1 and v2); `api.jumpcloud.com` serves Directory
 * Insights. No EU or India regional host, no CDN, no object-storage host and no caller-supplied base URL is
 * admitted — a configurable origin is how an admin credential reaches an unreviewed host.
 */
export const JUMPCLOUD_ORIGINS = {
  directory: "https://console.jumpcloud.com",
  insights: "https://api.jumpcloud.com",
} as const;

/**
 * Operations whose success schema the pinned specifications do not actually describe.
 *
 * Recorded here rather than discovered during a sync: an empty or open schema cannot produce a closed
 * projection, so the generator REFUSES these rather than emitting a projection that would admit whatever
 * the provider sent. Seven are admitted `applemdms` reads; two are already excluded as secret-bearing; one
 * is the v1 reactivation operation that is excluded as non-observational; and `/events` is the open one.
 *
 * @see JUMPCLOUD_SPEC_PINS for why a digest match does not settle this.
 */
export const JUMPCLOUD_UNPROJECTABLE_PATHS: readonly string[] = [
  "/applemdms/ade_tokens",
  "/applemdms/ade_tokens/{objectId}",
  "/applemdms/{deviceManagerObjectId}/abm_devices",
  "/applemdms/{deviceManagerObjectId}/devices/{deviceObjectId}/getrecoverylockconfig",
  "/applemdms/{deviceManagerObjectId}/devices/{deviceObjectId}/lockstate",
  "/applemdms/{deviceManagerObjectId}/validate-service-discovery-url",
  "/applemdms/{deviceObjectId}/background_tasks",
  "/insights/directory/v1/events",
];
