import { describe, expect, it } from "vitest";
import { bareVerdictLines } from "../../../devLint/bareDoorVerdict.js";

const PATH = "src/cli/commands/github/example.ts";

describe("bareVerdictLines", () => {
  it("finds the verdict interpolated alone, the shape 23 sites had", () => {
    expect(
      bareVerdictLines({ content: "deps.writeDiagnostic(`refused by door: ${through.decision.status}`);", path: PATH }),
    ).toEqual([1]);
  });

  it("finds the read whatever wraps it: a cast, an assertion, parentheses, a bracket, a comment", () => {
    const content = [
      "const a = `${(decision as DoorDecision).status}`;",
      "const b = `${decision!.status}`;",
      "const c = `${(decision).status}`;",
      "const d = `${decision?.['status']}`;",
      "const e = `${decision /* note */.status}`;",
      "const f = `${routed.decision.status.toUpperCase()}`;",
      'const g = `${(decision)[("status")]}`;',
    ].join("\n");
    expect(bareVerdictLines({ content, path: PATH })).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("finds an interpolation split across lines, on the line of the read", () => {
    const content = ["const a = `refused by door: ${", "  decision.status", "}`;"].join("\n");
    expect(bareVerdictLines({ content, path: PATH })).toEqual([2]);
  });

  it("finds the verdict concatenated with a plus", () => {
    expect(bareVerdictLines({ content: 'const a = "refused by door: " + decision.status;', path: PATH })).toEqual([1]);
  });

  it("reads comment-shaped text inside a template as the template it is", () => {
    expect(bareVerdictLines({ content: "write(`/* refused by door: ${decision.status} */`);", path: PATH })).toEqual([
      1,
    ]);
  });

  it("passes a verdict compared rather than printed, a sibling field, and a comment naming the shape", () => {
    const content = [
      'if (decision.status === "pass") { out({ line: `${count}` }); }',
      "const a = `${decision.statusNote}`;",
      "// never `${decision.status}` here",
      "/* nor `${decision.status}` here */",
      "const b = `${other.status}`;",
    ].join("\n");
    expect(bareVerdictLines({ content, path: PATH })).toEqual([]);
  });

  it("passes the stated blind spot, a verdict handed on through a name", () => {
    const content = ["const status = decision.status;", "write(`refused by door: ${status}`);"].join("\n");
    expect(bareVerdictLines({ content, path: PATH })).toEqual([]);
  });
});
