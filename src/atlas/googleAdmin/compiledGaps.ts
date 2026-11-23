/**
 * The gaps one kind carries in the Google Admin atlas's compiled generation, and the predicate behind the
 * `readonly-scope-grants-a-write` gap. Pure over the committed registry and its arguments — `sync.ts` builds
 * each kind file around {@link compiledGaps}.
 */
import type { GoogleAdminFillObservation } from "./adminApi/observation.js";
import { googleAdminUnmappedConsoleApis } from "./apiSelection.js";
import type { GoogleAdminWalkObservation } from "./consoleRoute.js";
import {
  googleAdminAdjacentApiGap,
  googleAdminNoConsoleSessionGap,
  googleAdminNoScopeGap,
  googleAdminObservedInventoryGap,
  googleAdminReadonlyScopeWriteGap,
  googleAdminUndeclaredScopeGap,
} from "./gaps.js";
import { GOOGLE_ADMIN_SURFACES } from "./generated/surfaces.js";
import { filledFor } from "./liveCoverage.js";
import type { GoogleAdminAtlasGap, GoogleAdminAtlasKind } from "./model.js";
import type { GoogleAdminSurfaceRow } from "./surfaceRow.js";

/**
 * Whether a row is a write that Google gated behind a `.readonly` scope and nothing else.
 *
 * The predicate behind the `readonly-scope-grants-a-write` gap, and the reason it is a function rather
 * than a list: the day Google fixes one of these, the gap disappears on the next regeneration instead of
 * standing as a claim nobody re-checked.
 *
 * @param row the registry row to test
 * @returns true when it changes state and every scope it declares is a readonly one
 */
export function isReadonlyScopedWrite({ row }: { row: GoogleAdminSurfaceRow }): boolean {
  return (
    row.disposition === "excluded" &&
    row.exclusionReason === "mutating" &&
    row.scopes.length > 0 &&
    row.scopes.every((scope) => scope.endsWith(".readonly"))
  );
}

/**
 * Every gap one kind carries in the compiled generation.
 *
 * @param kind the kind to build gaps for
 * @param at this run's ISO timestamp
 * @returns the gaps, sorted by id so a re-run writes identical bytes
 */
export function compiledGaps({
  kind,
  at,
  observation,
  fill,
}: {
  kind: GoogleAdminAtlasKind;
  at: string;
  observation: GoogleAdminWalkObservation | null;
  fill: GoogleAdminFillObservation | null;
}): readonly GoogleAdminAtlasGap[] {
  const rows = GOOGLE_ADMIN_SURFACES.filter((row) => row.kind === kind);
  // `no-admin-scope` says this kind has never been READ, so a fill that reached it closes the gap by
  // making it false rather than by suppressing it. A kind the fill could not reach still carries it, which
  // is what keeps a partial grant honest about the part it did not cover.
  const gaps: GoogleAdminAtlasGap[] = filledFor({ fill, kind }).length > 0 ? [] : [googleAdminNoScopeGap({ at, kind })];
  if (kind === "page") {
    gaps.push(googleAdminAdjacentApiGap({ apis: googleAdminUnmappedConsoleApis(), at }));
    if (observation === null) {
      gaps.push(googleAdminNoConsoleSessionGap({ at }));
    } else {
      gaps.push(
        googleAdminObservedInventoryGap({
          at,
          observed: observation.observedRoutes.length,
          opened: observation.pages.filter((page) => page.reached).length,
        }),
      );
    }
  }
  const scopeless = rows.filter((row) => row.scopes.length === 0).map((row) => row.id);
  if (scopeless.length > 0) {
    gaps.push(googleAdminUndeclaredScopeGap({ at, kind, operations: scopeless.toSorted() }));
  }
  const readonlyWrites = rows.filter((row) => isReadonlyScopedWrite({ row }));
  const firstScope = readonlyWrites[0]?.scopes[0];
  if (readonlyWrites.length > 0 && firstScope !== undefined) {
    gaps.push(
      googleAdminReadonlyScopeWriteGap({
        at,
        kind,
        operations: readonlyWrites.map((row) => row.id).toSorted(),
        scope: firstScope,
      }),
    );
  }
  return gaps.toSorted((left, right) => left.id.localeCompare(right.id));
}
