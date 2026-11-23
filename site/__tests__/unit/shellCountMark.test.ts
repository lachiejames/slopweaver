/*
 * A stale sidebar count draws the warning glyph, which carries the reading's age and cause, never `StaleMark`: that
 * one swaps a cause it reads as an unconnected integration for a Connect chip, which drops the age and the cause and,
 * on the collapsed icon rail, spills a chip's width where a dot sits. The
 * site lane renders no component, so this reads `ShellCount.tsx` with the TypeScript parser and pins which marks it
 * draws. The blind spot: a mark reached through another component this file draws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { forEachChild, ts, withSourceFile } from "../../../src/lib/tsSyntax.js";

/** The sidebar count's own source. */
const PATH = join(import.meta.dirname, "../../components/console/ShellCount.tsx");

/** Every JSX tag drawn anywhere in the file, in source order. */
function tagsIn({ file }: { file: ts.SourceFile }): readonly string[] {
  const tags: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      tags.push(child.tagName.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(file);
  return tags;
}

describe("ShellCount", () => {
  it("marks a failed or withheld count with the warning glyph in all four drawings, never StaleMark's Connect chip", () => {
    const tags = withSourceFile({
      fileName: PATH,
      scriptKind: ts.ScriptKind.TSX,
      text: readFileSync(PATH, "utf8"),
      use: (file) => tagsIn({ file }),
    });

    // Four: a stand-in over a failed read, a withheld count, a count with no number whose reads failed, and a printed
    // count whose read failed. A count merely being updated draws the progress indicator, once.
    expect([
      tags.filter((tag) => tag === "WarningMark").length,
      tags.filter((tag) => tag === "ReadingIndicator").length,
      tags.includes("StaleMark"),
    ]).toEqual([4, 1, false]);
  });
});
