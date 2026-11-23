/*
 * Every console warning opens on its plain words with the raw message folded under them, in BOTH of the mark's
 * drawings: the ordinary one, and the image it becomes inside a control of its own (a Queue row, a sidebar link).
 * The inside-a-control drawing must never be a plain tooltip that drops the raw message entirely. The
 * site lane renders no component, so this reads `WarningMark.tsx` with the TypeScript parser and pins the shape: each
 * of `WarningMark`'s returns draws the one shared `WarningCard`, no tooltip stands in for it, and that card draws the
 * `RawFold`. The blind spot: a card reached through a variable rather than drawn as a tag in the return.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  forEachChild,
  isFunctionLikeDeclaration,
  type LentAnswer,
  ts,
  withSourceFile,
} from "../../../src/lib/tsSyntax.js";

/** The mark's own source. */
const PATH = join(import.meta.dirname, "../../components/console/WarningMark.tsx");

/** Every JSX tag drawn anywhere under a node, in source order. */
function tagsUnder({ node }: { node: ts.Node }): readonly string[] {
  const tags: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      tags.push(child.tagName.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return tags;
}

/** Every JSX attribute's name drawn anywhere under a node, in source order. */
function attributesUnder({ node }: { node: ts.Node }): readonly string[] {
  const found: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isJsxAttribute(child)) {
      found.push(child.name.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return found;
}

/** The top-level function of that name in the file. */
function functionNamed({ file, name }: { file: ts.SourceFile; name: string }): ts.FunctionDeclaration {
  return file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )!;
}

/** The return statements directly in a function's body, never one inside a nested function. */
function returnsOf({ fn }: { fn: ts.FunctionDeclaration }): readonly ts.ReturnStatement[] {
  const found: ts.ReturnStatement[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isReturnStatement(child)) {
      found.push(child);
      return;
    }
    if (isFunctionLikeDeclaration(child)) {
      return;
    }
    forEachChild({ node: child, visit: walk });
  };
  forEachChild({ node: fn.body!, visit: walk });
  return found;
}

/** The mark's file, parsed and read by `use`, which answers plain data (the tree is only lent to it). */
function readMark<R>({ use }: { use: (file: ts.SourceFile) => LentAnswer<R> }): LentAnswer<R> {
  return withSourceFile({ fileName: PATH, scriptKind: ts.ScriptKind.TSX, text: readFileSync(PATH, "utf8"), use });
}

describe("WarningMark", () => {
  it("draws the one shared card, raw fold and all, in both drawings, with no tooltip standing in", () => {
    const drawings = readMark({
      use: (file): readonly (readonly boolean[])[] =>
        returnsOf({ fn: functionNamed({ file, name: "WarningMark" }) }).map((statement) => {
          const tags = tagsUnder({ node: statement });
          return [tags.includes("WarningCard"), tags.some((tag) => tag.startsWith("Tooltip"))];
        }),
    });
    const card = readMark({ use: (file) => tagsUnder({ node: functionNamed({ file, name: "WarningCard" }) }) });

    expect(drawings).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(card).toEqual(["HoverCardContent", "p", "RawFold"]);
  });

  it("describes the focusable mark with the raw message, since a hover card reaches no keyboard or screen reader", () => {
    const attributes = readMark({
      use: (file): readonly string[] => {
        const [, focusable] = returnsOf({ fn: functionNamed({ file, name: "WarningMark" }) });
        return attributesUnder({ node: focusable });
      },
    });

    expect(["aria-describedby", "id"].map((name) => attributes.includes(name))).toEqual([true, true]);
  });

  it("lends the raw message to the control a nested mark sits in, hidden from its name, and opens on its focus (steer 7)", () => {
    const nested = readMark({
      use: (file): readonly string[] => {
        const [inside] = returnsOf({ fn: functionNamed({ file, name: "WarningMark" }) });
        return attributesUnder({ node: inside });
      },
    });
    const source = readFileSync(PATH, "utf8");

    expect(["ref", "id", "hidden", "open", "onOpenChange"].map((name) => nested.includes(name))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      [
        'closest<HTMLElement>("a, button")',
        "describedByWith({",
        "describedByWithout({",
        // Focus is judged wherever it lands, so a Tab into a portalled card never closes it.
        'document.addEventListener("focusin"',
        ':focus-visible"',
        // A blur under the pointer, on the card or on the mark, keeps the card open.
        "[card.current, anchor.current].some(",
        // The id leaves the control in the commit that removes its description, never a paint later.
        "useLayoutEffect(() => {",
        // Tab off a keyboard-focused row walks every card of the row, routed once per row.
        'host.addEventListener("keydown"',
        "marksIn({ host })[0] === describedBy",
        "nestedCardMove({",
        // Past the row, focus goes back to it and the browser's own Tab picks the next stop.
        "  host.focus();\n}",
        "data-warning-mark={describedBy}",
        "data-warning-card-for={keyboard?.mark}",
      ].map((fragment) => source.includes(fragment)),
    ).toEqual([true, true, true, true, true, true, true, true, true, true, true, true, true]);
  });
});
