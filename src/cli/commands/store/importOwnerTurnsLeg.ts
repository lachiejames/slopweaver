/**
 * `store import-fleet --only owner-turns` — every `owner-turn-*.txt` under the two roots, into `owner_turn`
 * and `owner_turn_location`.
 *
 * The one leg that reads inside `supervisor-scratch/`, and only this one filename shape there: the loss
 * audit found their verbatim words in no backup because that directory is a scratch tier nothing imported.
 * `./importFleetRun.ts`'s header carries the carve-out; `../../../store/schema/ownerTurn.ts` the table shape.
 *
 * The files are read one at a time and folded as they are read, so only DISTINCT bodies stay resident —
 * `../../../store/fleet/ownerTurn.ts`'s `foldOwnerTurns` carries the measurement. The write is one
 * transaction, and every insert is `DO NOTHING`, so a second run over an unchanged home writes zero rows.
 */
import { readFileSync, statSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import type { StoreClient } from "../../../store/client.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { homeRelativePath } from "../../../store/fleet/homeWalk.js";
import {
  foldOwnerTurns,
  OWNER_TURN_FAMILIES,
  type ProjectedOwnerTurn,
  projectOwnerTurnFile,
} from "../../../store/fleet/ownerTurn.js";
import { listOwnerTurnFiles, ownerTurnRoots } from "../../../store/fleet/ownerTurnFiles.js";
import { importOwnerTurns } from "../../../store/fleet/ownerTurnStore.js";

import type { LegOutcome } from "./importFleetCore.js";

/**
 * Every owner-turn file under the home, projected one at a time; a file that will not project is pushed
 * onto `refused` and skipped, never cleaned.
 *
 * @param home the state home
 * @param refused where each refusal is recorded, named with its file
 * @param tally how many files projected, counted as they are yielded
 * @returns a generator of projected files, in family then walk order
 */
function* projectedFiles({
  home,
  refused,
  tally,
}: {
  home: string;
  refused: FleetImportError[];
  tally: { projected: number };
}): Generator<ProjectedOwnerTurn> {
  const roots = ownerTurnRoots({ home });
  for (const family of OWNER_TURN_FAMILIES) {
    const listing = listOwnerTurnFiles({ root: roots[family] });
    for (const unreadable of listing.unreadable) {
      refused.push(
        FleetImportErrors.unstorableTurnFile({
          path: unreadable.locator,
          reason: `the directory would not read: ${unreadable.why}`,
        }),
      );
    }
    for (const path of listing.files) {
      let bytes: Buffer;
      let fileModifiedAt: Date;
      try {
        bytes = readFileSync(path);
        fileModifiedAt = statSync(path).mtime;
      } catch (cause) {
        refused.push(FleetImportErrors.unstorableTurnFile({ path, reason: errorMessage({ error: cause }) }));
        continue;
      }
      const projected = projectOwnerTurnFile({ bytes, fileModifiedAt, relativePath: homeRelativePath({ home, path }) });
      if (projected.isErr()) {
        refused.push(projected.error);
        continue;
      }
      tally.projected += 1;
      yield projected.value;
    }
  }
}

/**
 * Project every owner-turn file and, unless this is a dry run, write the rows.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home the state home whose two roots are read
 * @returns what this leg did — `written` is new bodies plus new locations, so a re-run over an unchanged home
 *   reports zero
 */
export async function runOwnerTurnsLeg({
  client,
  home,
}: {
  client: StoreClient | undefined;
  home: string;
}): Promise<LegOutcome> {
  const refused: FleetImportError[] = [];
  const tally = { projected: 0 };
  const folded = foldOwnerTurns({ projected: projectedFiles({ home, refused, tally }) });
  const outcome = {
    absentSource: undefined,
    leg: "owner-turns" as const,
    projected: tally.projected,
    unreadableLines: 0,
  };
  if (client === undefined) {
    return { ...outcome, refused, written: 0 };
  }
  const written = await importOwnerTurns({ bodies: folded.bodies, client, locations: folded.locations });
  if (written.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: written.error.message }));
    return { ...outcome, refused, written: 0 };
  }
  return { ...outcome, refused, written: written.value.bodies + written.value.locations };
}
