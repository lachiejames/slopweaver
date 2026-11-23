/**
 * The integrations a board row may declare it needs, derived from the `connection` each manifest carries rather than
 * kept as a table beside the board (`src/handover/integrationNeeds.ts` reads it).
 *
 * A module of its own because the corpus source lists are about ingesting integrations, and most integrations here
 * ingest nothing: Drive, Outlook, Datadog, Vanta, Hex and Trelica are held on as surely as Slack.
 */
import type { IntegrationManifest } from "./manifest.js";

/** One integration a row may need: its `needs=` value, and the connection its manifest declares. */
export interface IntegrationNeedRow {
  /** The `needs=` value a row declares — the manifest's id. */
  readonly integration: string;
  /** Alternative credential sets: connected when every file of any ONE set is stored. */
  readonly credentialSets: NonNullable<IntegrationManifest["connection"]>["credentialSets"];
  /** The command printed beside a held row as the way back. */
  readonly connectWith: string;
}

/**
 * Every integration a row may declare it needs, in connection ordinal order, frozen.
 *
 * Takes the manifests rather than reading the registry, so a test can add a fixture integration and watch it appear;
 * production passes `registeredIntegrations()`.
 *
 * @param manifests the integrations to derive from, in any order
 * @returns one row per manifest declaring a `connection`, ordered by that connection's ordinal
 */
export function integrationNeedRowsOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): readonly IntegrationNeedRow[] {
  const rows = manifests
    .flatMap((manifest) =>
      manifest.connection === undefined ? [] : [{ connection: manifest.connection, id: manifest.id }],
    )
    .toSorted((left, right) => left.connection.ordinal - right.connection.ordinal)
    .map(({ connection, id }): IntegrationNeedRow => ({
      connectWith: connection.connectWith,
      credentialSets: connection.credentialSets,
      integration: id,
    }));
  Object.freeze(rows);
  return rows;
}
