/**
 * The acknowledgement ledger's half of the store-backed port (`./storePort.ts`): every acknowledgement the owner made,
 * as `org_health_acknowledgement` rows in the order the database assigned.
 *
 * ## Imported by a marker, before every read and every append
 *
 * An append can come before anything has read the ledger, so the existence of press rows cannot mean "imported". Both
 * a read and an append first make sure the `legacy-v1` marker row is committed: the legacy file is read WHOLE before
 * the import transaction opens — one line that will not read refuses and writes nothing — and the transaction whose
 * marker insert lands writes every press in file order alongside it. A concurrent importer's marker insert waits on
 * that one and lands nothing, so two importers leave one copy of every press. Only then does an append insert its own
 * row, which therefore always follows every imported one.
 *
 * ## Read whole, or refused
 *
 * A row that will not decode refuses the read rather than being skipped: the newest press for an incident may be that
 * very row, so no incident can be called acknowledged, or not, off the rest — exactly as a line of the old file that
 * would not read was.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type AcknowledgementRow, acknowledgementRowOf } from "./acknowledgement.js";
import { type AcknowledgementError, AcknowledgementErrors } from "./acknowledgementErrors.js";
import { type OrgHealthRows, type OrgHealthStoreSeams, withOrgHealthRows } from "./storeSeams.js";

/** A store refusal, restated in the ledger's own union. */
type Refusal = Result<never, AcknowledgementError>;

/**
 * The ledger's store refusal for a failed row operation.
 *
 * @param error the row operation's own refusal
 * @returns the refusal in the ledger's union
 */
function refused({ error }: { error: { readonly doing: string; readonly reason: string } }): Refusal {
  return err(AcknowledgementErrors.storeUnavailable({ doing: error.doing, reason: error.reason }));
}

/**
 * Make sure the legacy ledger is imported, importing it now when it is not.
 *
 * @param home the Slopweaver home
 * @param rows the open connection's row operations
 * @param seams the legacy file read
 * @returns nothing once the marker is committed, or the refusal
 */
async function ensureAcknowledgementsImported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: OrgHealthRows;
  seams: OrgHealthStoreSeams;
}): Promise<Result<void, AcknowledgementError>> {
  const imported = await rows.acknowledgementsImported();
  if (imported.isErr()) {
    return refused({ error: imported.error });
  }
  if (imported.value) {
    return ok(undefined);
  }
  const file = seams.readAcknowledgementsFile({ home });
  if (file.isErr()) {
    // A concurrent importer may have committed since the first check, and then its rows are the journal and the
    // file's damage is no longer this call's business.
    const since = await rows.acknowledgementsImported();
    if (since.isErr()) {
      return refused({ error: since.error });
    }
    if (since.value) {
      return ok(undefined);
    }
    return err(file.error);
  }
  const wrote = await rows.importAcknowledgements({ entries: file.value });
  if (wrote.isErr()) {
    return refused({ error: wrote.error });
  }
  // Whoever won the import, its marker is committed now: read that back rather than trusting this transaction's.
  const after = await rows.acknowledgementsImported();
  if (after.isErr()) {
    return refused({ error: after.error });
  }
  if (!after.value) {
    return err(
      AcknowledgementErrors.storeUnavailable({
        doing: "import the incident acknowledgements",
        reason: "the import committed no marker to read back",
      }),
    );
  }
  return ok(undefined);
}

/**
 * Every press, in recorded order, once the legacy ledger is imported.
 *
 * @param home the Slopweaver home
 * @param rows the open connection's row operations
 * @param seams the legacy file read
 * @returns every press, or the refusal — a row that will not decode included
 */
async function readWhole({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: OrgHealthRows;
  seams: OrgHealthStoreSeams;
}): Promise<Result<readonly AcknowledgementRow[], AcknowledgementError>> {
  const imported = await ensureAcknowledgementsImported({ home, rows, seams });
  if (imported.isErr()) {
    return err(imported.error);
  }
  const documents = await rows.acknowledgementDocuments();
  if (documents.isErr()) {
    return refused({ error: documents.error });
  }
  const decoded = documents.value.map((value) => acknowledgementRowOf({ value }));
  const unreadable = decoded.filter((row) => row === undefined).length;
  if (unreadable > 0) {
    return err(
      AcknowledgementErrors.storedInvalid({
        detail: `${String(unreadable)} row(s) do not decode, so no incident can be called acknowledged, or not, off the rest`,
      }),
    );
  }
  return ok(decoded.filter((row) => row !== undefined));
}

/**
 * Read the whole ledger out of the store.
 *
 * @param home the Slopweaver home
 * @param seams the effects
 * @returns every press in recorded order, or the refusal
 */
export async function readAcknowledgementsWith({
  home,
  seams,
}: {
  home: string;
  seams: OrgHealthStoreSeams;
}): Promise<Result<readonly AcknowledgementRow[], AcknowledgementError>> {
  return withOrgHealthRows({
    body: (rows) => readWhole({ home, rows, seams }),
    home,
    seams,
    unavailable: AcknowledgementErrors.storeUnavailable,
  });
}

/**
 * Record one press. The row is round-tripped through its own parser first, so the ledger never holds a row its reader
 * would refuse.
 *
 * @param home the Slopweaver home
 * @param row the press to record
 * @param seams the effects
 * @returns nothing once committed, or the refusal
 */
export async function appendAcknowledgementWith({
  home,
  row,
  seams,
}: {
  home: string;
  row: AcknowledgementRow;
  seams: OrgHealthStoreSeams;
}): Promise<Result<void, AcknowledgementError>> {
  const document = structuredClone(row);
  if (acknowledgementRowOf({ value: document }) === undefined) {
    return err(AcknowledgementErrors.storedInvalid({ detail: "the press does not read back, so it was not recorded" }));
  }
  return withOrgHealthRows({
    body: async (rows) => {
      const imported = await ensureAcknowledgementsImported({ home, rows, seams });
      if (imported.isErr()) {
        return err(imported.error);
      }
      const inserted = await rows.insertAcknowledgement({ document, id: seams.newId() });
      if (inserted.isErr()) {
        return refused({ error: inserted.error });
      }
      return ok(undefined);
    },
    home,
    seams,
    unavailable: AcknowledgementErrors.storeUnavailable,
  });
}
