/*
 * A sync run's panel never leads with or lists a raw stored error: a failed run's lead is `failedRunLeadOf`'s fixed
 * sentence, never the verb's `why` (which quotes the first stored error), and every problem line draws its plain words
 * with the raw message under `RawFold`. Both were once drawn raw on the Automations page. The site lane
 * renders no component, so this reads `SyncRunPanel.tsx` with the TypeScript parser and pins the shape. The blind spot:
 * a raw value reached through a component this file draws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { forEachChild, ts, withSourceFile } from "../../../src/lib/tsSyntax.js";

/** The panel's own source. */
const PATH = join(import.meta.dirname, "../../components/live/SyncRunPanel.tsx");

/** The top-level function of that name in the file. */
function functionNamed({ file, name }: { file: ts.SourceFile; name: string }): ts.FunctionDeclaration {
  return file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )!;
}

/** Whether a node is a property read such as `run.why`. */
function isRead(child: ts.Node): child is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(child);
}

/** Every node under a node that satisfies a test, as its source text. */
function textsUnder({ node, test }: { node: ts.Node; test: (child: ts.Node) => boolean }): readonly string[] {
  const found: string[] = [];
  const walk = (child: ts.Node): void => {
    if (test(child)) {
      found.push(child.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return found;
}

describe("SyncRunPanel", () => {
  it("leads through syncRunLeadOf, chips its word, folds its raw, and folds every raw problem", () => {
    const isTag = (child: ts.Node): boolean => ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child);
    // The tree is only lent to `use`, so every reading is taken inside it as plain data.
    const read = withSourceFile({
      fileName: PATH,
      scriptKind: ts.ScriptKind.TSX,
      text: readFileSync(PATH, "utf8"),
      use: (file): readonly (number | boolean | readonly string[])[] => {
        const panel = functionNamed({ file, name: "SyncRunPanel" });
        const problems = functionNamed({ file, name: "RunProblems" });
        return [
          textsUnder({ node: panel, test: (child) => child.getText() === "run.why" && isRead(child) }).length,
          textsUnder({ node: panel, test: (child) => ts.isCallExpression(child) }).includes(
            "syncRunLeadOf({ errors: run.errors, state: run.state, why: run.why })",
          ),
          textsUnder({ node: panel, test: isTag }).filter(
            (tag) => tag.startsWith("<StateChip ") || tag.startsWith("<RawFold "),
          ),
          textsUnder({ node: panel, test: (child) => child.getText() === "run.state" && isRead(child) }).length,
          textsUnder({ node: problems, test: (child) => ts.isCallExpression(child) }).includes(
            "run.errors.map((error) => plainReasonOf({ why: error }))",
          ),
          textsUnder({ node: problems, test: isTag }).includes("<RawFold raw={line.raw} />"),
        ];
      },
    });

    expect(read).toEqual([1, true, ["<StateChip state={chip} />", "<RawFold raw={raw} />"], 2, true, true]);
  });
});
