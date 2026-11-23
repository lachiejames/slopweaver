import { describe, expect, it } from "vitest";
import { emitLines, usage } from "../../../../../../cli/commands/slack/writeOutput.js";
import { EXIT_USAGE } from "../../../../../../cli/exitCodes.js";

describe("writeOutput", () => {
  it("exits with the usage code and prints each line in order", () => {
    const lines: string[] = [];

    emitLines({ lines: ["one", "two"], out: (line) => lines.push(line) });

    expect(usage({ errors: [] })).toBe(EXIT_USAGE);
    expect(lines).toEqual(["one", "two"]);
  });
});
