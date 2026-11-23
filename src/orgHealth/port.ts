/**
 * The one door every reader and writer of the organisation-health lane's state goes through: the incident snapshot,
 * the sightings memory, and the acknowledgement ledger.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` lives in the local store, and the home is deletable. {@link orgHealthPort} answers the store-backed port (`./storePort.ts`): the `org_health_incident`,
 * `org_health_sighting` and `org_health_acknowledgement` rows are the authority, the legacy files under
 * `$SLOPWEAVER_HOME/org-health/` are imported from once (`./importFiles.ts`), and nothing is projected back to a file.
 * A store that cannot be reached is `STORE_UNAVAILABLE`, never a file read.
 *
 * ## A read is a generation
 *
 * {@link OrgHealthPort.beginRead} commits the under-way marker and answers the revision it committed at, and
 * {@link OrgHealthPort.finishRead} publishes against exactly that revision. A read a newer one started after can no
 * longer publish, whatever happened to the lock in between — the lock (`./readLock.ts`) only keeps two reads from
 * walking the channel at once; the generation is what keeps an older one from landing last. A measured outcome
 * publishes the snapshot and the sightings in ONE transaction, so no reader sees one without the other.
 *
 * ## Injection
 *
 * Every consumer takes this port as a REQUIRED value, and only a composition root calls {@link orgHealthPort} — so a
 * unit test that forgot its seam fails to compile rather than reaching an ambient store. A test passes the in-memory
 * port `src/__tests__/orgHealthStoreFixture.ts` builds: a seam, not a mock (`.claude/rules/testing.md`).
 */
import type { Result } from "#lib/result.js";

import type { AcknowledgementRow } from "./acknowledgement.js";
import type { AcknowledgementError } from "./acknowledgementErrors.js";
import type { OrgHealthError } from "./errors.js";
import type { IncidentSightings } from "./sightings.js";
import { storeOrgHealthPort } from "./storePort.js";
import { productionOrgHealthStoreSeams } from "./storeRows.js";
import type { IncidentSnapshot, MeasuredIncidentSnapshot, UnmeasurableIncidentSnapshot } from "./types.js";

/** The generation one read holds: opaque outside the port, which a caller only ever hands back. */
export interface IncidentReadGeneration {
  readonly revision: number;
}

/** How a read ended: measured, with the memory it leaves, or unmeasurable naming why. */
export type IncidentReadOutcome =
  | {
      readonly state: "measured";
      readonly snapshot: MeasuredIncidentSnapshot;
      readonly sightings: IncidentSightings;
    }
  | {
      readonly state: "unmeasurable";
      readonly snapshot: UnmeasurableIncidentSnapshot;
    };

/** The lane's state operations, as one value a caller threads. */
export interface OrgHealthPort {
  /** The snapshot the last read published: `null` when none ever was, else the row, imported once from the file. */
  readonly readSnapshot: (request: {
    readonly home: string;
  }) => Promise<Result<IncidentSnapshot | null, OrgHealthError>>;
  /**
   * Commit an `unmeasurable` marker over whatever the snapshot holds, and answer the generation it committed at. A
   * read must not open a connection until this succeeds; a refused lock calls it too, so the holder's generation ends.
   */
  readonly beginRead: (request: {
    readonly home: string;
    readonly marker: UnmeasurableIncidentSnapshot;
  }) => Promise<Result<IncidentReadGeneration, OrgHealthError>>;
  /** What the last complete read remembered, `undefined` with no memory — a memory to SEED — imported once. */
  readonly readSightings: (request: {
    readonly home: string;
  }) => Promise<Result<IncidentSightings | undefined, OrgHealthError>>;
  /** Publish a read's outcome against its generation; `REVISION_CONFLICT` when a newer read moved it, never retried. */
  readonly finishRead: (request: {
    readonly home: string;
    readonly generation: IncidentReadGeneration;
    readonly outcome: IncidentReadOutcome;
  }) => Promise<Result<void, OrgHealthError>>;
  /** Every press, in the order recorded, or a refusal when any one of them will not decode. */
  readonly readAcknowledgements: (request: {
    readonly home: string;
  }) => Promise<Result<readonly AcknowledgementRow[], AcknowledgementError>>;
  /** Record one press, after the legacy ledger's import, so a press never strands the file it would follow. */
  readonly appendAcknowledgement: (request: {
    readonly home: string;
    readonly row: AcknowledgementRow;
  }) => Promise<Result<void, AcknowledgementError>>;
}

/**
 * The port this install's organisation-health state is reached through: the store. Called only at a composition root.
 *
 * @returns the port every production reader and writer uses
 */
export function orgHealthPort(): OrgHealthPort {
  return storeOrgHealthPort({ seams: productionOrgHealthStoreSeams() });
}
