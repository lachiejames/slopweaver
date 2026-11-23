/**
 * Which response fields a future entity sync must withhold, named by PATH rather than by bare name.
 *
 * ## Naming by path is forced by this platform, exactly as it was on Figma and for the opposite reason
 *
 * The Figma atlas names its one sensitive field by kind because `key` there is the public, stable
 * identifier of almost everything. Here the trap is `url`: MEASURED on the pinned document, **101 response
 * properties are called `url`**, and every one of them is the resource's own public self-link — a workspace
 * url, a project url, a database url. A rule matching credential-shaped NAMES would withhold the single
 * most useful field on the whole surface. `key` is the same story on a smaller scale: on an environment
 * variable it is the variable's NAME.
 *
 * So the list below is short, exact, and each entry names a path.
 *
 * ## The read surface is already almost secret-free, and that is a finding worth recording
 *
 * MEASURED across all 115 operations: `connectionString` appears in six responses and **not one of them is
 * a GET** — every occurrence is a create or a rotate, so a connection string is minted once and never
 * re-readable. `secretAccessKey` appears once, on `POST /v1/buckets/{bucketId}/keys`, and likewise never on
 * a read. And `GET /v1/environment-variables` returns each variable's `key` and a `valueKid` — a key id —
 * and **never the value**.
 *
 * The consequence is worth stating plainly because it is unusual: an atlas of this platform's READ surface
 * can hold every workspace, project, database, connection, bucket, service token and environment variable
 * an account holds, and hold no secret at all except the one field below.
 *
 * ## The one exception, and it is already on its way out
 *
 * `directConnection.pass` is the direct-connection password, and it appears on six GETs — the connection
 * listings and the database listings that nest them. The document marks the whole `directConnection` object
 * `deprecated: true` with the description _"Deprecated: use `endpoints.direct` instead"_, and
 * `endpoints.direct` is host and port only. So Prisma is removing the password from its own read surface,
 * and this atlas withholds it in the meantime.
 *
 * ## Personal data is withheld as well, and it is not the same rule
 *
 * `data.user.email` on `GET /v1/me` and `email` on the three integration listings are not credentials; they
 * are people. `GET /v1/me` is `probe-only` and stored nowhere at all (`dispositions.ts`), so the rule below
 * bites on the integration listings, where an integration's contact address would otherwise land in a file
 * whose every other row is a platform resource.
 *
 * ## Nothing enforces this today, and saying so is the point
 *
 * This installation holds no Prisma credential, so no entity sync exists to withhold anything from. The
 * list is here because the decision is knowable NOW from the document, and a policy written when the first
 * token arrives is a policy written under time pressure against a live response. `kit/withheld.ts` is the
 * mechanism it will be handed to.
 */

/** One field a sync must not store, and why. */
export interface PrismaWithheldField {
  /** The reason, in a reader's words, printed beside the withheld marker. */
  readonly because: string;
  /** The field path inside the response body, `[]` marking an array hop, as the document declares it. */
  readonly path: string;
  /** Every operation whose response carries it, sorted. */
  readonly operations: readonly string[];
}

/**
 * Every field this atlas will withhold from a stored entity, sorted by path.
 *
 * Two, and both were computed from the document rather than guessed at — the reproduction is in this file's
 * header and in `tools/generatePrismaDataPlatformSurfaces.ts`, which refuses if a THIRD credential-shaped
 * field appears on a GET response without this list moving.
 * @internal
 */
export const PRISMA_WITHHELD_FIELDS: readonly PrismaWithheldField[] = [
  {
    because:
      "the direct-connection password. The one credential value anywhere on this platform's read surface," +
      " and the document already marks its whole `directConnection` parent deprecated in favour of" +
      " `endpoints.direct`, which is host and port only",
    operations: [
      "GET /v1/connections",
      "GET /v1/connections/{id}",
      "GET /v1/databases",
      "GET /v1/databases/{databaseId}",
      "GET /v1/databases/{databaseId}/connections",
      "GET /v1/projects/{projectId}/databases",
    ],
    path: "data[].directConnection.pass",
  },
  {
    because:
      "a person's email address. An integration's contact is personal data, and this atlas holds platform" +
      " resources; the person is already in the corpus's own directory, which is the store better suited" +
      " to holding one",
    operations: ["GET /v1/integrations", "GET /v1/integrations/{id}", "GET /v1/workspaces/{workspaceId}/integrations"],
    path: "data[].email",
  },
];

/**
 * Whether a stored field path must be withheld.
 *
 * @param path the field path inside the response body
 * @returns the withholding rule, or `null` when the field may be stored
 */
export function prismaWithheldFieldFor({ path }: { path: string }): PrismaWithheldField | null {
  const withheld = PRISMA_WITHHELD_FIELDS.find((field) => field.path === path);
  if (withheld === undefined) {
    return null;
  }
  return withheld;
}
