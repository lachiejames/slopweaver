/**
 * The Microsoft Graph specification this atlas's compiled surface is built from, pinned by COMMIT and by
 * digest.
 *
 * ## Why a pin rather than "whatever the vendor served this morning"
 *
 * The compiled channel is this atlas's only filled surface, and a surface regenerated from a moving document
 * is a surface nobody reviewed. Microsoft regenerates `msgraph-metadata` continuously, so the pin addresses
 * an immutable COMMIT rather than a branch — a stricter lock than the sibling JumpCloud atlas's, which pins
 * a mutable documentation URL by digest alone and therefore cannot fetch the bytes it reviewed once they
 * move. Here the URL itself can never serve different bytes, and the digest is the second check rather than
 * the only one.
 *
 * Verify every number here with:
 *
 * ```bash
 * curl -fsSL https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/<the `commit` field below>/openapi/v1.0/openapi.yaml | shasum -a 256
 * slopweaver atlas microsoft365 sync --json
 * ```
 *
 * ## What a digest match does and does not prove
 *
 * It proves the specification is byte-for-byte the one that was reviewed. It does NOT prove this tenant can
 * call anything in it: the compiled channel reads a public document and reaches no tenant at all, which is
 * why `model.ts` gives it a visibility scope of its own. Reading a compiled operation as a capability is the
 * single most available mistake with this atlas.
 *
 * ## `beta` is DECLARED, not mapped
 *
 * Graph publishes a second, larger `beta` specification whose contents change without notice. It is not
 * pinned here and no operation from it is compiled, and that is a stated omission carried as a permanent gap
 * (`gaps.ts`'s `beta-surface-not-compiled`) rather than a silence — an atlas that simply omitted it would be
 * answering "Graph has no such endpoint" about a surface Entra's own console uses.
 */

/**
 * One pinned specification: where it came from, what it hashed to, and the census it must still satisfy.
 *
 * @internal
 */
export interface Microsoft365SpecPin {
  /** The immutable commit-addressed document this atlas reads; also the reproduction handle. */
  readonly url: string;
  /** The `msgraph-metadata` commit the URL addresses, so the pin can never serve different bytes. */
  readonly commit: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Every path key in the document. */
  readonly pathCount: number;
  /** Every operation across every path — the whole surface, reads and writes together. */
  readonly operationCount: number;
  /** GET operations, the observational surface this atlas may ever call. */
  readonly getCount: number;
  /** Distinct first path segments, which are this atlas's kinds. */
  readonly rootCount: number;
  /** Component schemas the document declares, which is where a response's field names are resolved from. */
  readonly schemaCount: number;
}

/**
 * The pinned document.
 *
 * MEASURED against the commit named below, by fetching it twice — once from `master` and once
 * from the immutable commit URL — and confirming the two were byte-identical before the numbers were taken.
 */
export const MICROSOFT365_SPEC_PIN: Microsoft365SpecPin = {
  byteLength: 44146442,
  commit: "de1a61e44c3794b8818cf6455b0fb089d0e5e1c9",
  getCount: 9378,
  operationCount: 17777,
  pathCount: 11493,
  rootCount: 70,
  schemaCount: 5127,
  sha256: "6e3a4c9bab98c7c759742769fae115e8c50241674ffc99d834d223ab93c91889",
  url:
    "https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/" +
    "de1a61e44c3794b8818cf6455b0fb089d0e5e1c9/openapi/v1.0/openapi.yaml",
};

/**
 * The census by HTTP method, which a sync asserts exactly.
 *
 * A method census moving means the vendor regenerated the surface, and this atlas would rather REFUSE than
 * absorb the change silently — the whole value of a compiled channel is that a reader can tell what was
 * reviewed from what merely arrived.
 */
export const MICROSOFT365_METHOD_CENSUS = {
  delete: 2337,
  get: 9378,
  patch: 2144,
  post: 3681,
  put: 237,
} as const;

/**
 * The one origin the live Graph channel may ever reach, and nothing else.
 *
 * Recorded here rather than in a client because the client does not exist yet: no Entra application
 * registration is configured, so nothing calls Graph on this installation. It is pinned now so that the
 * commit which lands a client cannot also be the commit that chooses an origin — a configurable base URL is
 * how an admin credential reaches an unreviewed host, and national-cloud endpoints (`graph.microsoft.us`,
 * `microsoftgraph.chinacloudapi.cn`) are exactly that shape.
 */
export const MICROSOFT365_GRAPH_ORIGIN = "https://graph.microsoft.com";

/** The API version the pinned document describes, and the only one this atlas compiles. */
export const MICROSOFT365_GRAPH_VERSION = "v1.0";
