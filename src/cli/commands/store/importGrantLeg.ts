/**
 * `store import-fleet --only grants` — the ONE-TIME import of a legacy `grants/journal.jsonl` into `grant_row`,
 * which is the journal from then on (`src/grants/port.ts`). Nothing reads the file once it has been imported,
 * so it may be removed.
 *
 * Every insert is `DO NOTHING` on any unique index, then the rows are READ BACK and each line's entry compared
 * with the row the store holds for it. The row is the authority and is never overwritten, so a line that
 * disagrees — a second grant under a stored id, a performance of a grant already performed differently — is a
 * `GRANT_IMPORT_DIVERGED` refusal and the leg exits non-zero, rather than a quiet keep of one side. A second run
 * over an unchanged home writes zero rows and diverges on none — the convergence proof.
 */
import { existsSync } from "node:fs";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { StoreClient } from "../../../store/client.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { grantImportDivergences, type ProjectedGrantLine, projectGrantLine } from "../../../store/fleet/grantRow.js";
import { importGrantRows, readStoredGrantRows } from "../../../store/fleet/store.js";

import type { LegOutcome } from "./importFleetCore.js";

/**
 * Project the legacy grant journal and, unless this is a dry run, write the rows and compare them with what
 * the store then holds.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home the state home whose `grants/journal.jsonl` is read
 * @returns what this leg did; every diverging line is a refusal
 */
export async function runGrantLeg({
  client,
  home,
}: {
  client: StoreClient | undefined;
  home: string;
}): Promise<LegOutcome> {
  const path = stateHomePaths({ home }).grantJournalJsonl;
  const outcome = { absentSource: undefined, leg: "grants" as const, unreadableLines: 0 };
  if (!existsSync(path)) {
    return { ...outcome, absentSource: path, projected: 0, refused: [], written: 0 };
  }
  const refused: FleetImportError[] = [];
  const projected: ProjectedGrantLine[] = [];
  readJsonlLines({
    onLine: ({ line, index }) => {
      if (line.trim().length === 0) {
        return;
      }
      const lineNumber = index + 1;
      const row = projectGrantLine({ line, lineNumber, path });
      if (row.isErr()) {
        refused.push(row.error);
        return;
      }
      projected.push({ lineNumber, row: row.value });
    },
    path,
  });
  if (client === undefined) {
    return { ...outcome, projected: projected.length, refused, written: 0 };
  }
  const written = await importGrantRows({ client, rows: projected.map(({ row }) => row) });
  if (written.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path, reason: written.error.message }));
    return { ...outcome, projected: projected.length, refused, written: 0 };
  }
  const stored = await readStoredGrantRows({ client });
  if (stored.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path, reason: `read-back failed: ${stored.error.message}` }));
  } else {
    refused.push(...grantImportDivergences({ path, projected, stored: stored.value }));
  }
  return { ...outcome, projected: projected.length, refused, written: written.value };
}
