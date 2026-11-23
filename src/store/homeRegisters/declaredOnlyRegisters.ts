/**
 * The declared-only home registers: the trees too large to walk inside a page's budget, named and classified
 * with no size or count taken (`measure: "declared-only"`).
 *
 * Spread last into `HOME_REGISTERS` (`../homeRegisters.ts`); a new row of this category goes here.
 */
import type { HomeRegister } from "../homeRegisters.js";

/** The declared-only registers, in the order `HOME_REGISTERS` reports them. */
export const DECLARED_ONLY_REGISTERS: readonly HomeRegister[] = [
  {
    kind: "owner turns",
    measure: "declared-only",
    pathKey: undefined,
    relativePath: "supervisor-scratch/*/owner-turn-*.txt + handovers/archive/owner-turn-*.txt",
    shape: "directory",
    table: "owner_turn",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "supervisor scratch",
    measure: "declared-only",
    pathKey: undefined,
    relativePath: "supervisor-scratch",
    shape: "directory",
    table: undefined,
    tier: "scratch",
    unmirroredBecause:
      "the scratch tier, less its owner-turn-*.txt files (the `owner turns` register): no import leg " +
      "reads the rest and none should, and `home reclaim` cannot reach it",
  },
  {
    kind: "codex passes",
    measure: "declared-only",
    pathKey: undefined,
    relativePath: "orchestration",
    shape: "directory",
    table: "codex_pass",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "authored working state",
    measure: "declared-only",
    pathKey: undefined,
    relativePath:
      "briefs, artifacts, judgement, profile, registers, morning, … (src/store/fleet/authoredDirectories.ts)",
    shape: "directory",
    table: "authored_file",
    tier: "durable",
    unmirroredBecause: undefined,
  },
];
