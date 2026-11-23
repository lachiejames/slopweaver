/**
 * The `memory gate` shell: its advertised flags, its parser and the two exit codes it can reach without
 * reading anything.
 *
 * Deliberately NOT exercised here: the run that walks corpora. `runMemoryGate` discovers them from the real
 * `homedir()`, so a test that called it would read the operator's own memories and write the operator's debt list — the
 * exact class `testing.md` § "Never write to the ambient `$SLOPWEAVER_HOME`" exists to stop. What that path
 * actually decides is pure and lives in `memory/gateBaseline.ts`, tested against injected findings there.
 */
import { describe, expect, it } from "vitest";

import {
  MEMORY_GATE_FLAG_NAMES,
  parseMemoryGateArgs,
  runMemoryGate,
} from "../../../../../cli/commands/memory/gateRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";

/** `[node, cli, memory, gate, ...]` — the offset the verb slices from. */
function argvFor({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "cli", "memory", "gate", ...rest];
}

describe("the advertised flags", () => {
  it("are exactly the three the usage line names", () => {
    expect(MEMORY_GATE_FLAG_NAMES).toEqual(["--accept", "--install", "--json"]);
  });
});

describe("parseMemoryGateArgs", () => {
  it("reads every flag as a boolean", () => {
    expect(unwrap(parseMemoryGateArgs({ rest: ["--install", "--accept", "--json"] })).values).toEqual({
      accept: true,
      install: true,
      json: true,
    });
  });

  it("leaves an unset flag out rather than defaulting it to false", () => {
    expect(unwrap(parseMemoryGateArgs({ rest: [] })).values).toEqual({});
  });

  it("refuses a flag it does not advertise", () => {
    const parsed = parseMemoryGateArgs({ rest: ["--repair"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--repair");
  });
});

describe("runMemoryGate", () => {
  it("answers --help with the usage line and exit 0, reading no corpus", async () => {
    expect(await runMemoryGate(argvFor({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("answers -h the same way", async () => {
    expect(await runMemoryGate(argvFor({ rest: ["-h"] }))).toBe(EXIT_OK);
  });

  it("refuses an unknown flag BEFORE it discovers anything", async () => {
    expect(await runMemoryGate(argvFor({ rest: ["--repair"] }))).toBe(EXIT_USAGE);
  });

  it("prefers --help over a bad flag on the same line", async () => {
    expect(await runMemoryGate(argvFor({ rest: ["--repair", "--help"] }))).toBe(EXIT_OK);
  });
});
