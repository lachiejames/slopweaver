/**
 * THE one write of the organisation: the whole row, pinned to the revision it read, then read back so what a caller
 * reports is the row the store holds rather than the argv that asked for it. `org set` is its only caller.
 */
import { err, ok, type Result } from "../lib/result.js";
import { connectStore, type StoreClient } from "../store/client.js";

import type { Organisation, OrganisationRecord } from "./core.js";
import { type OrganisationError, OrganisationErrors } from "./errors.js";
import { organisationOf, resolveSelfRepository } from "./read.js";
import { closeAfterAnswer, readStoredOrganisation, readStoredRevision, writeStoredOrganisation } from "./store.js";

/**
 * Write the organisation into the store selected under `home`, and return it as `readOrganisation` will now read it.
 *
 * The self repository is resolved BEFORE any connection, so a write that would leave each read refusing on it
 * anyway says so instead of reporting success.
 *
 * @param home the Slopweaver home the store selection and the declared main checkouts are read under
 * @param record the validated organisation to store
 * @returns the organisation as stored, or the typed refusal — `ORG_WRITE_CONFLICT` when the row moved mid-write
 */
export async function writeOrganisation({
  home,
  record,
}: {
  home: string;
  record: OrganisationRecord;
}): Promise<Result<Organisation, OrganisationError>> {
  const self = resolveSelfRepository({ home });
  if (self.isErr()) {
    return err(self.error);
  }
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err(OrganisationErrors.queryFailed({ cause: opened.error }));
  }
  try {
    return await writeOverClient({ client: opened.value, record, selfRepository: self.value });
  } finally {
    await closeAfterAnswer({ client: opened.value });
  }
}

/**
 * The write over an already-open client: read the stored revision, write pinned to it, read the row back.
 *
 * @param client an open store connection, closed by the caller
 * @param record the validated organisation to store
 * @param selfRepository this build's own `owner/repo`, already resolved
 * @returns the organisation as stored, or the typed refusal
 */
export async function writeOverClient({
  client,
  record,
  selfRepository: self,
}: {
  client: StoreClient;
  record: OrganisationRecord;
  selfRepository: string;
}): Promise<Result<Organisation, OrganisationError>> {
  const revision = await readStoredRevision({ client });
  if (revision.isErr()) {
    return err(revision.error);
  }
  const written = await writeStoredOrganisation({ client, expectedRevision: revision.value, record });
  if (written.isErr()) {
    return err(written.error);
  }
  const stored = await readStoredOrganisation({ client });
  if (stored.isErr()) {
    return err(stored.error);
  }
  return ok(organisationOf({ selfRepository: self, stored: stored.value }));
}
