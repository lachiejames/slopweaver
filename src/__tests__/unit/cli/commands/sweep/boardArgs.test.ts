/**
 * `sweep board`'s argv, refused before the board is read: `--help`, a mistyped `--deadline`, and the two flags that
 * only mean something beside `--write`.
 */
import { describe, expect, it } from "vitest";

import { boardArgs } from "../../../../../cli/commands/sweep/boardArgs.js";
import { BOARD_USAGE } from "../../../../../cli/commands/sweep/core.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Parse one argv tail, capturing both output channels. */
function parse({ rest }: { rest: readonly string[] }): {
  result: ReturnType<typeof boardArgs>;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const result = boardArgs({
    deps: {
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    rest,
  });
  return { diagnostics, out, result };
}

describe("boardArgs", () => {
  it("answers help on stdout, reading no flag", () => {
    const { result, out, diagnostics } = parse({ rest: ["--help"] });

    expect(result).toBe(EXIT_OK);
    expect(out).toEqual([BOARD_USAGE]);
    expect(diagnostics).toEqual([]);
  });

  it("defaults the probe budget to 300 seconds", () => {
    expect(parse({ rest: [] }).result).toEqual({ seconds: 300, values: {} });
  });

  it("honours --deadline 0 as unbounded", () => {
    expect(parse({ rest: ["--deadline", "0"] }).result).toEqual({ seconds: 0, values: { deadline: "0" } });
  });

  it("refuses a --deadline that is not a non-negative number", () => {
    const { result, diagnostics } = parse({ rest: ["--deadline", "soon"] });

    expect(result).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual([
      "sweep board: --deadline takes a non-negative number of seconds, where 0 means unbounded",
      BOARD_USAGE,
    ]);
  });

  it("refuses --queue without --write", () => {
    const { result, diagnostics } = parse({ rest: ["--queue"] });

    expect(result).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual([
      "sweep board: --queue needs --write — the card is registered only once both documents are",
      BOARD_USAGE,
    ]);
  });

  it("refuses --settle-ended without --write", () => {
    const { result, diagnostics } = parse({ rest: ["--settle-ended"] });

    expect(result).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual([
      "sweep board: --settle-ended needs --write — the pass publishes the board after its acts",
      BOARD_USAGE,
    ]);
  });

  it("accepts --settle-ended beside --write", () => {
    expect(parse({ rest: ["--write", "--settle-ended"] }).result).toEqual({
      seconds: 300,
      values: { "settle-ended": true, write: true },
    });
  });
});
