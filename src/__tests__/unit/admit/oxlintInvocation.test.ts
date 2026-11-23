/**
 * `oxlintInvocation.ts`: what a type-aware lint run covers, read from its own words.
 */
import { describe, expect, it } from "vitest";

import { typeAwareLintScope } from "../../../admit/oxlintInvocation.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** Judge one literal `oxlint`/`tsgolint` line. */
function scope({ text }: { text: string }): ReturnType<typeof typeAwareLintScope> {
  const [program, ...args] = shellWords({ text }).words;
  return typeAwareLintScope({ args, program: program!.text });
}

describe("typeAwareLintScope", () => {
  it("names a directory or no operand as the whole run", () => {
    expect(scope({ text: "oxlint --type-aware src" })).toEqual({ kind: "whole", over: "src" });
    expect(scope({ text: "tsgolint" })).toEqual({ kind: "whole", over: "the whole tree" });
  });

  it("skips a value flag's value rather than reading it as an operand", () => {
    expect(scope({ text: "oxlint --type-aware --tsconfig config/tsconfig.json src/a.ts" })).toEqual({
      kind: "local",
    });
    expect(scope({ text: "oxlint --type-check -D no-console ." })).toEqual({ kind: "whole", over: "." });
  });

  it("keeps source files, a computed list, an untyped run and a printing run local", () => {
    expect(scope({ text: "oxlint --type-aware src/a.ts src/b.tsx" })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint --type-aware $(git diff --name-only)" })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint src" })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint --type-aware --debug=files ." })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint --type-aware --debug files ." })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint --type-aware --debug timings,files ." })).toEqual({ kind: "local" });
    expect(scope({ text: "oxlint --type-aware --debug timings ." })).toEqual({ kind: "whole", over: "." });
  });
});
