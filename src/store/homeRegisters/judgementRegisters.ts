/**
 * The judgement home registers: the landing journals, the Codex supersessions, the knowledge domains and the
 * owner-judgement journals — each imported once into its own table and still measured while it is on disk.
 *
 * Spread third into `HOME_REGISTERS` (`../homeRegisters.ts`); a new row of this category goes here.
 */
import type { HomeRegister } from "../homeRegisters.js";

/** The judgement registers, in the order `HOME_REGISTERS` reports them. */
export const JUDGEMENT_REGISTERS: readonly HomeRegister[] = [
  {
    // The table is the authority; the file is imported once (`src/store/registerImport.ts`) and never read
    // again, still measured because it is still on disk.
    kind: "landing presses",
    measure: "walk",
    pathKey: "landingPressesJsonl",
    relativePath: "landing-presses.jsonl",
    shape: "jsonl",
    table: "landing_press",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "landing reads",
    measure: "walk",
    pathKey: "landingReadsJson",
    relativePath: "landing-reads.json",
    shape: "file",
    table: "landing_read_cursor",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "codex supersessions",
    measure: "walk",
    pathKey: "codexSupersessionsJsonl",
    relativePath: "codex-supersessions.jsonl",
    shape: "jsonl",
    table: "codex_supersession",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The table is the authority; the file is imported once (`src/knowledge/domainPort.ts`) and never read again,
    // still measured because an install that predates the store holds it.
    kind: "knowledge domains",
    measure: "walk",
    pathKey: "knowledgeDomainsJson",
    relativePath: "knowledge/domains.json",
    shape: "file",
    table: "knowledge_domain",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // One file, two tables: the register names `owner_directive`, and `owner_correction` is its child
    // (`./homeShare.ts`). Imported once and never read again, still measured because it is still on disk.
    kind: "owner directives and corrections",
    measure: "walk",
    pathKey: "ownerDirectivesJson",
    relativePath: "judgement/owner-directives.json",
    shape: "file",
    table: "owner_directive",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // One journal, three tables: the register names `standing_ask`, and its coverage and events are its children
    // (`./homeShare.ts`). Imported once, its bytes witnessed, still measured because it is still on disk.
    kind: "standing asks",
    measure: "walk",
    pathKey: "standingAsksJsonl",
    relativePath: "judgement/standing-asks.jsonl",
    shape: "jsonl",
    table: "standing_ask",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // One journal, one table of its exact lines (`src/profile/steerMeasurementRows.ts`). Imported once, its bytes
    // witnessed, still measured because it is still on disk.
    kind: "steer measurements",
    measure: "walk",
    pathKey: "steerKindsJsonl",
    relativePath: "judgement/steer-kinds.jsonl",
    shape: "jsonl",
    table: "steer_measurement",
    tier: "durable",
    unmirroredBecause: undefined,
  },
];
