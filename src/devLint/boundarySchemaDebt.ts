/**
 * The `boundary-schema` gate's DEBT — every hand-written client that fetched and read JSON with no
 * `defineBoundary` when the gate landed.
 *
 * Measured by the gate itself (`yarn tsx src/devLint/boundarySchema.entry.ts` against an empty list). Converting
 * one is not a text edit: its strict schema has to be READ against the live endpoint, because the key set a
 * provider actually sends is only known from an answer — the first strict read of `/api/oauth/usage` named
 * twenty-eight keys nobody had declared. A stale entry fails the gate: delete it when its client is converted.
 * Never add one — a new client declares its boundary. Every recorded client is converted, so the list is empty.
 */
import type { BoundaryDebt } from "./boundarySchema.js";

/** Today's recorded clients, in path order: none, since every one declares its boundary. */
export const BOUNDARY_SCHEMA_DEBT: readonly BoundaryDebt[] = [];
