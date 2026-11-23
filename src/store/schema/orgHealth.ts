/**
 * The organisation-health lane's state in the store: the incident snapshot `org-health read` publishes, the sightings
 * memory a read dates inferred phases by, and the acknowledgement ledger `org-health ack` appends to.
 * Home-into-the-store part 7: these rows are the authority, and
 * `$SLOPWEAVER_HOME/org-health/{incidents.json,sightings.json,acknowledgements.jsonl}` are read once, as an import,
 * and never again. `src/orgHealth/storePort.ts` is the only reader and writer.
 *
 * ## Why the snapshot and the sightings are one row each, not one row per incident
 *
 * Each is ONE judgement over a whole read: `src/orgHealth/read.ts` builds both from the same complete walk, and
 * `src/orgHealth/sightings.ts` replaces the memory with exactly the incidents that read saw. Splitting either by
 * incident would scatter one judgement across rows no consumer reads apart — the reasoning `./planRegister.ts` gives
 * for its own singleton. A SQL-null `document` is a row whose import found no file: no snapshot was ever written, or
 * no memory exists, which `sightings.ts` treats as a memory to SEED rather than an empty one.
 *
 * The snapshot's `revision` is the read GENERATION: a read starts by compare-and-setting the under-way marker and
 * publishes only against the revision that marker committed at, so a read a newer one superseded can never land.
 *
 * ## Why the acknowledgement ledger carries a marker row
 *
 * An append can happen before anything has read the ledger, so "some acknowledgement rows exist" cannot mean "the
 * legacy file was imported". The `legacy-v1` marker row can: it commits in the same transaction as every imported
 * press, and the CHECK below keeps it the only row of its kind. `position` is the file order the ledger's readers
 * fold in, assigned by the database so two racing presses each take their own.
 *
 * ## Why the documents' shapes are not CHECKed
 *
 * `jsonb` is not validation, and every read decodes each document with the lane's own codec
 * (`src/orgHealth/snapshot.ts`, `src/orgHealth/acknowledgement.ts`). A CHECK naming fields would make every new
 * field a migration.
 */
import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** The only primary-key value `org_health_incident` accepts, spelled once so a reader and the CHECK agree. */
export const ORG_HEALTH_INCIDENT_ID = "snapshot";

/** The only primary-key value `org_health_sighting` accepts. */
export const ORG_HEALTH_SIGHTING_ID = "sightings";

/** The acknowledgement ledger's import marker: one row, committed with every press the legacy file held. */
export const ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID = "legacy-v1";

/** The two kinds of acknowledgement row, spelled once for the CHECK and the port. */
export const ORG_HEALTH_ACKNOWLEDGEMENT_KINDS = ["legacy-import", "acknowledgement"] as const;

/** The incident snapshot: one row, its revision the read generation a publication pins to. */
export const orgHealthIncidentTable = pgTable(
  "org_health_incident",
  {
    id: text("id").primaryKey(),
    /** `unknown` on purpose: every read decodes it. Null when the import found no snapshot to carry over. */
    document: jsonb("document").$type<unknown>(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("org_health_incident_is_singleton", sql.raw(`id = '${ORG_HEALTH_INCIDENT_ID}'`)),
    check("org_health_incident_revision_positive", sql`revision > 0`),
    check("org_health_incident_is_object", sql`document IS NULL OR jsonb_typeof(document) = 'object'`),
    ...storeTablePolicies({ botRead: sql`false`, table: "org_health_incident" }),
  ],
);

/** The sightings memory: one row, replaced whole by every complete read in the snapshot's own transaction. */
export const orgHealthSightingTable = pgTable(
  "org_health_sighting",
  {
    id: text("id").primaryKey(),
    /** The versioned sightings document; null when no memory exists, which a read SEEDS rather than empties. */
    document: jsonb("document").$type<unknown>(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("org_health_sighting_is_singleton", sql.raw(`id = '${ORG_HEALTH_SIGHTING_ID}'`)),
    check("org_health_sighting_revision_positive", sql`revision > 0`),
    check("org_health_sighting_is_object", sql`document IS NULL OR jsonb_typeof(document) = 'object'`),
    ...storeTablePolicies({ botRead: sql`false`, table: "org_health_sighting" }),
  ],
);

/** One acknowledgement press, or the legacy-import marker, in the order the database assigned. */
export const orgHealthAcknowledgementTable = pgTable(
  "org_health_acknowledgement",
  {
    id: text("id").primaryKey(),
    position: bigint("position", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    kind: text("kind").notNull(),
    /** `unknown` on purpose: every read decodes it. Null on the marker row alone. */
    document: jsonb("document").$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check(
      "org_health_acknowledgement_kind",
      sql.raw(`kind IN (${ORG_HEALTH_ACKNOWLEDGEMENT_KINDS.map((kind) => `'${kind}'`).join(", ")})`),
    ),
    check(
      "org_health_acknowledgement_marker_shape",
      sql.raw(
        `(id = '${ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID}' AND kind = 'legacy-import' AND document IS NULL) OR ` +
          `(id <> '${ORG_HEALTH_ACKNOWLEDGEMENT_MARKER_ID}' AND kind = 'acknowledgement' AND document IS NOT NULL ` +
          `AND jsonb_typeof(document) = 'object')`,
      ),
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "org_health_acknowledgement" }),
  ],
);

/** The snapshot row as the database returns it. */
export type OrgHealthIncidentRow = typeof orgHealthIncidentTable.$inferSelect;

/** The sightings row as the database returns it. */
export type OrgHealthSightingRow = typeof orgHealthSightingTable.$inferSelect;

/** An acknowledgement row as the database returns it. */
export type OrgHealthAcknowledgementRow = typeof orgHealthAcknowledgementTable.$inferSelect;
