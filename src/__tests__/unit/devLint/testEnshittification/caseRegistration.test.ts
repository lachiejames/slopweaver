import { describe, expect, it } from "vitest";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { bindingsOf } from "../../../../devLint/testAssertionCounts.js";
import { isCaseCall, registersOnLoad } from "../../../../devLint/testCaseRegistration.js";

/** For every suite or case call in a source, in source order, whether it registers when the file loads. */
function verdicts({ content }: { content: string }): readonly boolean[] {
  return withSourceFile({
    fileName: "t.test.ts",
    text: content,
    use: (source): readonly boolean[] => {
      const bindings = bindingsOf({ source });
      const found: boolean[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node) && isCaseCall({ bindings, node }))
          found.push(registersOnLoad({ bindings, node }));
        forEachChild({ node, visit });
      };
      forEachChild({ node: source, visit });
      return found;
    },
  });
}

const CASE = 'it("c", () => {\n  expect(1).toBe(1);\n});';

describe("registersOnLoad", () => {
  it("registers a case at the top and one inside a bare describe", () => {
    expect(verdicts({ content: `describe("s", () => {\n  ${CASE}\n});` })).toEqual([true, true]);
  });

  it("registers a case beside a const of literals, names and functions", () => {
    const content = `const T = [{ a: 1, b: -2, f: () => 1 }, "x", OTHER] as const;\n${CASE}`;
    expect(verdicts({ content })).toEqual([true]);
  });

  it("refuses a case beside an initialiser that assigns, though it calls nothing", () => {
    expect(verdicts({ content: `const v = (expect = lenient);\n${CASE}` })).toEqual([false]);
  });

  it("refuses a case beside an initialiser that reads a property, which can reach a getter", () => {
    expect(verdicts({ content: `const v = holder.value;\n${CASE}` })).toEqual([false]);
  });
});
