/**
 * The coverage cells one fill writes — one per SDK request kind, on the kind it fills.
 *
 * A fill publishes only when every read answered (`fill/run.ts`), so every cell is a success. What a cell
 * still has to say honestly is the difference between "read, and there were N" and "never called, because
 * there was nothing above it to read under" — an organisation with no teams makes no `scenarios.list` call,
 * and that is a complete read of zero scenarios, not an unread kind.
 */
import { succeededCoverageCell } from "../kit/coverage.js";
import type { MakeReadRequest } from "./client.js";
import { MAKE_FILL_KIND, MAKE_FILL_OPERATIONS, MAKE_READ_OPS } from "./fill/plan.js";
import type { MakeFillObservation } from "./fill/run.js";
import type { MakeAtlasKind, MakeAtlasKindFile } from "./model.js";

type CoverageCell = MakeAtlasKindFile["coverage"][number];

/** The descriptor's one surface — every cell this atlas writes is on it. */
const SURFACE = "make-api-v2";

/** The claim boundary the `api` channel reads under. */
const VISIBILITY = "api-token-scopes-and-team-role";

/** The parent a request is read under, for the sentence a never-called cell carries. */
const READ_UNDER: Readonly<Record<MakeReadRequest["op"], string>> = {
  "blueprints.get": "scenario",
  "connections.list": "team",
  "executions.list": "scenario",
  "folders.list": "team",
  "hooks.list": "team",
  "organizations.list": "token",
  "scenarios.list": "team",
  "teams.list": "organization",
};

/**
 * The `api` cell one request kind earns.
 *
 * @param op the request kind
 * @param fill what the run brought back
 * @returns the cell
 */
function requestCell({ op, fill }: { op: MakeReadRequest["op"]; fill: MakeFillObservation }): CoverageCell {
  const tool = MAKE_FILL_OPERATIONS[op];
  const called = fill.reached.includes(op);
  const reason = called
    ? `${op} (${tool}) answered on every call, each item kept as allowlisted fields only`
    : `${op} (${tool}) was not called: the token sees no ${READ_UNDER[op]} to read it under`;
  const cell = succeededCoverageCell({
    artifacts: [],
    at: fill.filledAtIso,
    reason,
    role: "authoritative",
    scope: op,
    state: "synced",
    surface: SURFACE,
    unblockedBy: null,
    visibilityScope: VISIBILITY,
  });
  return { ...cell, artifacts: [], channel: "api", visibilityScope: VISIBILITY };
}

/**
 * Every cell a kind's file carries this run.
 *
 * @param fill what the run brought back
 * @returns one cell per request kind that fills it
 */
export function kindCells({ kind, fill }: { kind: MakeAtlasKind; fill: MakeFillObservation }): CoverageCell[] {
  return MAKE_READ_OPS.filter((op) => MAKE_FILL_KIND[op] === kind).map((op) => requestCell({ fill, op }));
}
