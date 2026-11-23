/**
 * The core home registers: the board, the run journals, the knowledge register and the three single-file
 * registers every installation holds first (identity, profile, plans) — each a durable, walked, mirrored row.
 *
 * Spread first into `HOME_REGISTERS` (`../homeRegisters.ts`); a new row of this category goes here.
 */
import type { HomeRegister } from "../homeRegisters.js";

/** The core durable registers, in the order `HOME_REGISTERS` reports them. */
export const CORE_REGISTERS: readonly HomeRegister[] = [
  {
    kind: "handover board",
    measure: "walk",
    pathKey: "handovers",
    relativePath: "handovers",
    shape: "directory",
    table: "board_row",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "run journals",
    measure: "walk",
    pathKey: "runs",
    relativePath: "runs",
    shape: "directory",
    table: "run",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "knowledge register",
    measure: "walk",
    pathKey: "knowledgeLessonsJsonl",
    relativePath: "knowledge/lessons.jsonl",
    shape: "jsonl",
    table: "memories",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The store row is the authority (`src/silver/identityRoster.ts`); a retired `identity.json` is what the row
    // is imported from once and is never written, still measured while an install that predates the store holds it.
    kind: "identity roster",
    measure: "walk",
    pathKey: "identityJson",
    relativePath: "identity.json",
    rowFilter: { column: "id", value: "identity-roster" },
    shape: "file",
    table: "singleton_register",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "owner profile",
    measure: "walk",
    pathKey: "profileJson",
    relativePath: "profile.json",
    shape: "file",
    table: "owner_profile",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The store row is the register's authority; `plans.json` is a one-way projection of it kept for
    // checkouts that predate the store (`src/plans/store.ts`), still measured because it is still on disk.
    kind: "plan register",
    measure: "walk",
    pathKey: "plansJson",
    relativePath: "plans.json",
    shape: "file",
    table: "plan_register",
    tier: "durable",
    unmirroredBecause: undefined,
  },
];
