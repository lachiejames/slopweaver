/*
 * A Queue press's failure never prints its raw reason above the fold. `pressOnce` carries whatever the act route or a
 * caught fetch said — a JSON parse error, say — and both the panel's outcome line (`press.tsx`'s `Outcome`) and the
 * page's settle banner (`settling.tsx`'s `SettleLine`) say it through `PlainWhy`: the plain line, the raw message
 * folded under it. Neither draws `why` verbatim. The site lane renders no component, so this
 * reads both files with the TypeScript parser and pins the shape. The blind spot: a raw value reached through a
 * component either draws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { forEachChild, type LentAnswer, ts, withSourceFile } from "../../../src/lib/tsSyntax.js";

/** The top-level function of that name in one console component, read by `use`, which answers plain data. */
function readFunction<R>({
  file,
  name,
  use,
}: {
  file: string;
  name: string;
  use: (fn: ts.FunctionDeclaration) => LentAnswer<R>;
}): LentAnswer<R> {
  const path = join(import.meta.dirname, "../../components/console", file);
  return withSourceFile({
    fileName: path,
    scriptKind: ts.ScriptKind.TSX,
    text: readFileSync(path, "utf8"),
    use: (source) =>
      use(
        source.statements.find(
          (statement): statement is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(statement) && statement.name?.text === name,
        )!,
      ),
  });
}

/** Whether a node is a JSX expression drawn as an element's CHILD, such as `{state.why}` between two tags. */
function isDrawnChild(child: ts.Node): child is ts.JsxExpression {
  return ts.isJsxExpression(child) && ts.isJsxElement(child.parent);
}

/** Whether a node is a self-closing tag such as `<PlainWhy why={state.why} />`. */
function isSelfClosing(child: ts.Node): child is ts.JsxSelfClosingElement {
  return ts.isJsxSelfClosingElement(child);
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

describe("a press's failure reason", () => {
  it("is said plainly with the raw folded on the panel's outcome line, refused and unknown alike", () => {
    const drawn = readFunction({
      file: "press.tsx",
      name: "Outcome",
      use: (outcome): readonly (readonly string[])[] => [
        textsUnder({ node: outcome, test: isDrawnChild }).filter((text) => text.includes(".why")),
        textsUnder({ node: outcome, test: isSelfClosing }).filter((text) => text.startsWith("<PlainWhy")),
      ],
    });

    expect(drawn).toEqual([[], ["<PlainWhy why={state.why} />", "<PlainWhy why={state.why} />"]]);
  });

  it("says the page's own hold refusal as written, never as a technical error", () => {
    const drawn = readFunction({
      file: "press.tsx",
      name: "Outcome",
      use: (outcome) =>
        textsUnder({ node: outcome, test: isDrawnChild }).filter((text) => text.includes("HOLD_REFUSAL")),
    });
    const held = readFunction({
      file: "press.tsx",
      name: "usePress",
      use: (press) =>
        textsUnder({ node: press, test: ts.isObjectLiteralExpression }).filter((text) => text.includes("HOLD_REFUSAL")),
    });

    expect([drawn, held]).toEqual([
      ["{HOLD_REFUSAL[state.held]}"],
      ['{ held: hold, phase: "refused", why: HOLD_REFUSAL[hold] }'],
    ]);
  });

  it("puts the settle banner's line in a div, since an output element cannot hold the fold", () => {
    const tags = readFunction({
      file: "settling.tsx",
      name: "SettleLine",
      use: (line) => textsUnder({ node: line, test: ts.isJsxOpeningElement }).map((text) => text.split(/\s|>/u)[0]),
    });

    expect([tags.includes("<output"), tags.includes("<div")]).toEqual([false, true]);
  });

  it("is said plainly with the raw folded on the page's settle banner", () => {
    const drawn = readFunction({
      file: "settling.tsx",
      name: "SettleLine",
      use: (line): readonly (readonly string[])[] => [
        textsUnder({ node: line, test: isDrawnChild }).filter((text) => text.includes(".why")),
        textsUnder({ node: line, test: isSelfClosing }).filter((text) => text.startsWith("<PlainWhy")),
      ],
    });

    expect(drawn).toEqual([[], ["<PlainWhy why={outcome.why} />"]]);
  });
});
