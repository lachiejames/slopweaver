/**
 * The authored leg's retention step: before the home is projected, the store gives up what the classification now
 * keeps local-only and every tool answer an earlier import stored inside a call file
 * (`../../../store/fleet/authoredRetentionStore.ts`). Run first, so an unrelated refusal later in the leg — an
 * unreadable denylist, one refused file — never keeps those rows in tonight's dump.
 *
 * A dry run opens no connection (`./importFleetCore.ts`), so it reconciles nothing and says so.
 */
import type { StoreClient } from "../../../store/client.js";
import {
  type AuthoredRetentionCounts,
  reconcileAuthoredRetention,
} from "../../../store/fleet/authoredRetentionStore.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";

/**
 * The note line one reconciliation's counts read as.
 *
 * @param counts what the reconciliation changed
 * @returns one line naming every count
 */
export function retentionNote({ counts }: { counts: AuthoredRetentionCounts }): string {
  return (
    `retention: ${String(counts.scratchLocationsDeleted)} local-only location(s) removed from the store ` +
    `(${String(counts.absentRowsDeleted)} absent row(s) with them), ${String(counts.callVersionsRewritten)} call ` +
    `version(s) rewritten without tool answers, ${String(counts.orphanBodiesDeleted)} unreferenced body(ies) deleted`
  );
}

/**
 * Reconcile the store's authored rows, or on a dry run say none were.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home names the leg in a failure
 * @param refused where a failure is recorded
 * @returns the rows the rewrites inserted, and the note lines
 */
export async function runAuthoredRetention({
  client,
  home,
  refused,
}: {
  client: StoreClient | undefined;
  home: string;
  refused: FleetImportError[];
}): Promise<{ readonly written: number; readonly notes: readonly string[] }> {
  if (client === undefined) {
    return { notes: ["retention: not reconciled — a dry run opens no store connection"], written: 0 };
  }
  const counts = await reconcileAuthoredRetention({ client });
  if (counts.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: counts.error.message }));
    return { notes: [], written: 0 };
  }
  return { notes: [retentionNote({ counts: counts.value })], written: counts.value.rowsInserted };
}
