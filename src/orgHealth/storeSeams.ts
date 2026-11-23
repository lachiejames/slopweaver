/**
 * The seams the store-backed organisation-health port runs over: the row operations one open connection offers, the
 * legacy file reads its one-time imports consult, and the one helper that opens, uses and always closes a connection.
 *
 * Production's are `./storeRows.ts`; a unit test's are the in-memory rows `src/__tests__/orgHealthStoreFixture.ts`
 * builds over the same legacy reads. A store step's only failure is `STORE_UNAVAILABLE`, typed so: no seam can make a
 * failed statement read as anything else.
 */
import { err, type Result } from "#lib/result.js";

import type { AcknowledgementError } from "./acknowledgementErrors.js";
import type { OrgHealthError, OrgHealthStoreUnavailableError } from "./errors.js";
import type { FileAcknowledgement } from "./importFiles.js";
import type { IncidentSightings } from "./sightings.js";
import type { IncidentSnapshot, MeasuredIncidentSnapshot } from "./types.js";

/** The two singleton documents: the snapshot, and the sightings memory. */
export type OrgHealthDocumentName = "incident" | "sightings";

/** A singleton row as stored: its document — `null` when its import found none — and its revision. */
export interface StoredOrgHealthDocument {
  readonly document: unknown;
  readonly revision: number;
}

/** A refusal of the store's own, the only way a row operation fails. */
type Unavailable = OrgHealthStoreUnavailableError;

/** The row operations one open connection offers, and the handle that closes it. */
export interface OrgHealthRows {
  /** One singleton row, or undefined when the store holds none. */
  readonly readDocument: (request: {
    readonly name: OrgHealthDocumentName;
  }) => Promise<Result<StoredOrgHealthDocument | undefined, Unavailable>>;
  /** Insert at revision 1 unless a row exists: 1 when this insert landed, undefined when another row already had. */
  readonly insertDocument: (request: {
    readonly name: OrgHealthDocumentName;
    readonly document: unknown;
  }) => Promise<Result<number | undefined, Unavailable>>;
  /** Replace the snapshot iff it is still at `expectedRevision`: the new revision, or undefined when it was not. */
  readonly replaceIncident: (request: {
    readonly document: IncidentSnapshot;
    readonly expectedRevision: number;
  }) => Promise<Result<number | undefined, Unavailable>>;
  /**
   * In ONE transaction, replace the snapshot iff it is still at `expectedRevision` and replace the sightings with it:
   * the snapshot's new revision, or undefined when it had moved, in which case neither changed.
   */
  readonly publishMeasured: (request: {
    readonly snapshot: MeasuredIncidentSnapshot;
    readonly sightings: unknown;
    readonly expectedRevision: number;
  }) => Promise<Result<number | undefined, Unavailable>>;
  /** Whether the acknowledgement ledger's legacy-import marker is committed. */
  readonly acknowledgementsImported: () => Promise<Result<boolean, Unavailable>>;
  /** In ONE transaction, insert the marker and, iff that insert landed, every legacy press in file order. */
  readonly importAcknowledgements: (request: {
    readonly entries: readonly FileAcknowledgement[];
  }) => Promise<Result<undefined, Unavailable>>;
  /** Every acknowledgement row's stored document, in the order the database assigned. */
  readonly acknowledgementDocuments: () => Promise<Result<readonly unknown[], Unavailable>>;
  /** Insert one press under its own id. */
  readonly insertAcknowledgement: (request: {
    readonly id: string;
    readonly document: unknown;
  }) => Promise<Result<undefined, Unavailable>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed lane performs, injected so the orchestration is testable without a database. */
export interface OrgHealthStoreSeams {
  /** Open the store for one home, refusing with `STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<OrgHealthRows, Unavailable>>;
  /** The legacy `incidents.json`: undefined when absent, the refusal when present and damaged. */
  readonly readSnapshotFile: (request: {
    readonly home: string;
  }) => Result<IncidentSnapshot | undefined, OrgHealthError>;
  /** The legacy `sightings.json`: undefined when absent, the refusal when present and damaged. */
  readonly readSightingsFile: (request: {
    readonly home: string;
  }) => Result<IncidentSightings | undefined, OrgHealthError>;
  /** The legacy `acknowledgements.jsonl`, whole, or the refusal. */
  readonly readAcknowledgementsFile: (request: {
    readonly home: string;
  }) => Result<readonly FileAcknowledgement[], AcknowledgementError>;
  /** A fresh id for a new press. */
  readonly newId: () => string;
}

/**
 * The message of a thrown cause, never anything else about it.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed word when it carries none
 */
export function causeReason({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : "unknown failure";
}

/**
 * Run one operation over a connection this function opens and always closes. A seam that rejects rather than
 * answering a Result is still a step that did not finish, so it is the same refusal, in the caller's own union.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams where the connection comes from
 * @param unavailable how the caller's union words a store refusal
 * @param body what to do with the connection
 * @returns whatever the body answered, or the connection refusal
 */
export async function withOrgHealthRows<T, E>({
  body,
  home,
  seams,
  unavailable,
}: {
  body: (rows: OrgHealthRows) => Promise<Result<T, E>>;
  home: string;
  seams: OrgHealthStoreSeams;
  unavailable: (args: { doing: string; reason: string }) => E;
}): Promise<Result<T, E>> {
  let rows: Result<OrgHealthRows, Unavailable>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ doing: "be opened", reason: causeReason({ cause }) }));
  }
  if (rows.isErr()) {
    return err(unavailable({ doing: rows.error.doing, reason: rows.error.reason }));
  }
  let answer: Result<T, E>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ doing: "finish the operation", reason: causeReason({ cause }) }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(unavailable({ doing: "close its connection", reason: causeReason({ cause }) }));
  }
  return answer;
}
