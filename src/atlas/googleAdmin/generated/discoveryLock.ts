/**
 * The Google artifacts this atlas's surface registry was generated from, pinned so a regeneration that
 * quietly read something else fails instead of publishing.
 *
 * ## Why a URL and a digest, and no committed copy
 *
 * Nightfall's `specLock.ts` and Datadog's `sdkLock.ts` are the siblings and the reasoning is the same: the
 * generated table is the reviewed boundary, and the artifact it came from is pinned rather than vendored,
 * so a reviewer diffs 336 rows instead of 1.4MB of somebody else's JSON. Fetch the documents to one
 * directory and run `yarn tsx tools/generateGoogleAdminSurfaces.ts --verify --spec-dir <dir>` to check the
 * pin.
 *
 * ## These are Google's own machine-readable documents, served to anyone, and that is how they were found
 *
 * Every Google API publishes a Discovery document, and the Discovery Service itself publishes the index of
 * them at `https://www.googleapis.com/discovery/v1/apis`. The eleven below were selected from that index
 * by the criterion in `apiSelection.ts`. The generator fetches both the index and the documents, so
 * reproducing the whole pin is one command:
 *
 * ```bash
 * yarn tsx tools/generateGoogleAdminSurfaces.ts --fetch /tmp/google-admin-specs
 * ```
 *
 * A digest mismatch means Google re-published, which is a thing to READ rather than a thing to fix:
 * regenerate, and the diff over the committed table is the change to the Admin console's surface. The
 * `revision` on each pin is Google's own date stamp for that document, so a mismatch says WHICH day moved.
 */

/**
 * One pinned discovery document.
 * @internal
 */
export interface GoogleAdminDiscoveryPin {
  /** The product API it describes, in this atlas's own vocabulary. */
  readonly api: string;
  /** The document's own `baseUrl`, which every path in it is relative to. */
  readonly baseUrl: string;
  /** Byte length, so a truncated fetch fails on the cheaper check first. */
  readonly byteLength: number;
  /** The document's `<name>.<version>` key, which is also its {@link ../surfaceNaming.js#GoogleAdminDocument}. */
  readonly document: string;
  /** How many methods this document declares — the per-document half of the census. */
  readonly methods: number;
  /** Google's own `revision` date stamp for the document, `YYYYMMDD`. */
  readonly revision: string;
  /** SHA-256 of the document's bytes, exactly as served. */
  readonly sha256: string;
  /** The document's own `title`. */
  readonly title: string;
  /** The Discovery Service URL it is served from. */
  readonly url: string;
}

/**
 * Every document, as fetched when the lock was cut.
 *
 * The counts are asserted by the generator on every run, not merely recorded: an extraction that lost a
 * method to a resource nesting it did not descend would otherwise emit a smaller table that still looked
 * complete. Three of the eleven are VERSIONS of one Admin SDK document family — `directory_v1`,
 * `reports_v1` and `datatransfer_v1` share a title and a base URL and administer three unrelated console
 * areas, which is why the pin is keyed on `<name>.<version>` rather than on the title.
 */
export const GOOGLE_ADMIN_DISCOVERY_PINS: readonly GoogleAdminDiscoveryPin[] = [
  {
    api: "datatransfer",
    baseUrl: "https://admin.googleapis.com/",
    byteLength: 15933,
    document: "admin.datatransfer_v1",
    methods: 5,
    revision: "20260902",
    sha256: "eb51145b91e2eaf4be3312afb5bb681df5feade8168cd932a50e63dc4434bf88",
    title: "Admin SDK API",
    url: "https://admin.googleapis.com/$discovery/rest?version=datatransfer_v1",
  },
  {
    api: "directory",
    baseUrl: "https://admin.googleapis.com/",
    byteLength: 386772,
    document: "admin.directory_v1",
    methods: 128,
    revision: "20260902",
    sha256: "982232891ed73af9609ae694b660bc46e7534fa0c88e3e9c2d20c3658a5141dd",
    title: "Admin SDK API",
    url: "https://admin.googleapis.com/$discovery/rest?version=directory_v1",
  },
  {
    api: "reports",
    baseUrl: "https://admin.googleapis.com/",
    byteLength: 94956,
    document: "admin.reports_v1",
    methods: 6,
    revision: "20260902",
    sha256: "0efb93aa3090ee0b7476a779cf4e9d1aea51d948fe96d8f98846d095f655bfad",
    title: "Admin SDK API",
    url: "https://admin.googleapis.com/$discovery/rest?version=reports_v1",
  },
  {
    api: "alertcenter",
    baseUrl: "https://alertcenter.googleapis.com/",
    byteLength: 99628,
    document: "alertcenter.v1beta1",
    methods: 11,
    revision: "20260831",
    sha256: "fe6640eb575248ceea2540a0b18f9b31df83dd9f910b4a98e4f70870f7b91ac7",
    title: "Google Workspace Alert Center API",
    url: "https://alertcenter.googleapis.com/$discovery/rest?version=v1beta1",
  },
  {
    api: "chrome-management",
    baseUrl: "https://chromemanagement.googleapis.com/",
    byteLength: 372159,
    document: "chromemanagement.v1",
    methods: 58,
    revision: "20260903",
    sha256: "108beee1257e1a2a3b331014e988524c012ab135b224eb4a687bfdc7ff51277f",
    title: "Chrome Management API",
    url: "https://chromemanagement.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "chrome-policy",
    baseUrl: "https://chromepolicy.googleapis.com/",
    byteLength: 81855,
    document: "chromepolicy.v1",
    methods: 14,
    revision: "20260826",
    sha256: "8e4ca7d686218491b262ee3d6598897c0acd0ebd9a69458693b08c798c130499",
    title: "Chrome Policy API",
    url: "https://chromepolicy.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "cloud-identity",
    baseUrl: "https://cloudidentity.googleapis.com/",
    byteLength: 235494,
    document: "cloudidentity.v1",
    methods: 70,
    revision: "20260902",
    sha256: "3bf181b7940c4971d2e998e17431b3a8209465cfe5e4bd72340ab61d6740819c",
    title: "Cloud Identity API",
    url: "https://cloudidentity.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "groups-migration",
    baseUrl: "https://groupsmigration.googleapis.com/",
    byteLength: 5042,
    document: "groupsmigration.v1",
    methods: 1,
    revision: "20260831",
    sha256: "648cbfc7d179eaead5af2637fbe3881e4bd92df08f397398863f61e6532ec54d",
    title: "Groups Migration API",
    url: "https://groupsmigration.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "groups-settings",
    baseUrl: "https://www.googleapis.com/groups/v1/groups/",
    byteLength: 28402,
    document: "groupssettings.v1",
    methods: 3,
    revision: "20220614",
    sha256: "5e71066133343f3404c5c4c32348bc3c22ded2626a659a0e702ea189c4efbf1c",
    title: "Groups Settings API",
    url: "https://groupssettings.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "licensing",
    baseUrl: "https://licensing.googleapis.com/",
    byteLength: 20725,
    document: "licensing.v1",
    methods: 7,
    revision: "20260831",
    sha256: "65b61f8ad67f87e7bd1b0493ef33f93be348d0ebd60516b0837d648c7c1eed52",
    title: "Enterprise License Manager API",
    url: "https://licensing.googleapis.com/$discovery/rest?version=v1",
  },
  {
    api: "vault",
    baseUrl: "https://vault.googleapis.com/",
    byteLength: 110660,
    document: "vault.v1",
    methods: 33,
    revision: "20260827",
    sha256: "30637f2c36ebab34c548623b7f890435ac5d95ba72d361cea535891e4dae4bf4",
    title: "Google Vault API",
    url: "https://vault.googleapis.com/$discovery/rest?version=v1",
  },
];

/**
 * How many methods the whole selected surface holds.
 *
 * The sum of the per-document counts, written out so the generated table can be checked against a single
 * number without importing the table.
 */
export const GOOGLE_ADMIN_METHOD_CENSUS = 336;

/**
 * How many DISTINCT method ids those 336 methods carry.
 *
 * One fewer than the census, and the difference is the whole reason the provider key carries the document:
 * `admin.channels.stop` is declared once in `admin.directory_v1` and once in `admin.reports_v1`, with a
 * different scope set each time. `surfaceNaming.ts`'s header carries the measurement.
 */
export const GOOGLE_ADMIN_DISTINCT_METHOD_IDS = 335;

/**
 * How many of the 336 declare no OAuth scope at all.
 *
 * A finding rather than a curiosity: an operation Google publishes with an empty `scopes` array cannot
 * tell an OAuth caller what to ask for, so it is unreachable through its own declared contract.
 * `gaps.ts` raises `undeclared-scope` for every kind that holds one.
 */
export const GOOGLE_ADMIN_SCOPELESS_CENSUS = 19;

/**
 * How many methods the atlas takes each disposition on, measured on the pinned generation.
 *
 * A census per disposition rather than only a total, because the total cannot move when a row silently
 * changes side — and changing side is exactly what a mis-edited rule does. `probe-only` is zero because
 * Google publishes no credential-validation method in any of these eleven documents; a caller learns
 * whether its grant works by making a real request and reading the 401 or 403.
 */
export const GOOGLE_ADMIN_DISPOSITION_CENSUS = {
  entity: 128,
  excluded: 180,
  "probe-only": 0,
  "shape-index": 28,
} as const;

/**
 * How many of the 180 excluded methods each refusal accounts for.
 *
 * The two `egressing` rows are the media uploads — `chromepolicy.media.upload` and
 * `groupsmigration.archive.insert` — and the three `side-effecting` rows are the `watch` methods that
 * register a push channel. Everything else changes the account.
 */
export const GOOGLE_ADMIN_EXCLUSION_CENSUS = {
  egressing: 2,
  mutating: 175,
  "side-effecting": 3,
} as const;
