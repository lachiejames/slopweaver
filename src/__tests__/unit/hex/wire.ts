/**
 * Wire bodies in the shape each Hex endpoint's strict boundary admits, carrying the declared-but-unread keys a
 * real answer sends, so a test can prove they are VALIDATED at the read and DROPPED by the projection.
 *
 * Shared by the reads, schemas and atlas entity-sync tests, because each builds the same project row and a
 * second copy is how a fixture drifts from the boundary it is meant to satisfy.
 *
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

/**
 * One project row, as `GET /v1/projects` and `GET /v1/projects/{id}` return it.
 *
 * @param id the project id
 * @returns the wire row
 */
export function projectWire({ id }: { id: string }): Record<string, unknown> {
  return {
    analytics: { appViews: { allTime: 4 }, lastViewedAt: null, publishedResultsUpdatedAt: null },
    archivedAt: null,
    categories: [{ description: null, name: "Ops" }],
    createdAt: "2026-01-01T00:00:00Z",
    creator: { email: "a@example.invalid" },
    description: null,
    id,
    lastEditedAt: "2026-09-01T00:00:00Z",
    lastPublishedAt: null,
    owner: { email: "a@example.invalid" },
    reviews: { required: false },
    schedules: [{ cadence: "DAILY", daily: { hour: 3 }, enabled: true }],
    sharing: { workspace: { access: "CAN_VIEW" } },
    status: null,
    title: `project ${id}`,
    trashedAt: null,
    type: "PROJECT",
  };
}

/**
 * One cursor page envelope.
 *
 * @param values the rows
 * @param after the cursor a caller should carry forward, or `null` on the last page
 * @returns the wire envelope
 */
export function pageWire({ values, after }: { values: readonly unknown[]; after: string | null }): unknown {
  return { pagination: { after, before: null }, values };
}

/**
 * One full-arm data connection, carrying the credential-adjacent keys the projection must drop.
 *
 * @param id the connection id
 * @returns the wire row
 */
export function connectionWire({ id }: { id: string }): Record<string, unknown> {
  return {
    allowWritebackCells: false,
    connectViaSsh: false,
    connectionDetails: {
      postgres: { database: "billing", hostname: "db.example.invalid", port: 5432, username: "reader" },
    },
    description: "the warehouse",
    id,
    includeMagic: true,
    name: "Billing",
    schemaRefreshAccess: "ADMINS",
    sensitivity: { configured: false },
    sharing: { workspace: { access: "CAN_QUERY" } },
    type: "postgres",
  };
}
