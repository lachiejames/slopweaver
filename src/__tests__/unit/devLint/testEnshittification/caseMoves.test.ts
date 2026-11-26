import { describe, expect, it } from "vitest";
import { caseUnits, moveCredits, unitsMinus } from "../../../../devLint/testCaseMoves.js";

const SHRUNK = "src/__tests__/unit/x/a.test.ts";
const SIBLING = "src/__tests__/unit/x/aLine.test.ts";

const MOVED_CASE = [
  'it("reads the line", () => {',
  '  expect(line("a")).toBe("a");',
  '  expect(line("")).toBe("");',
  "});",
];
const KEPT_CASE = ['it("keeps the rest", () => {', "  expect(rest()).toEqual([]);", "});"];

/** A suite around cases, each line indented by `depth` levels. */
function suite({
  title,
  cases,
  depth = 1,
}: {
  title: string;
  cases: readonly (readonly string[])[];
  depth?: number;
}): string {
  const pad = "  ".repeat(depth);
  const body = cases.flatMap((lines) => lines.map((line) => `${pad}${line}`));
  return [`describe("${title}", () => {`, ...body, "});", ""].join("\n");
}

const BASE = suite({ cases: [MOVED_CASE, KEPT_CASE], title: "chair" });
const HEAD = suite({ cases: [KEPT_CASE], title: "chair" });

describe("caseUnits", () => {
  it("owns each expect by its innermost case, so a describe of cases is not a unit", () => {
    expect(caseUnits({ content: BASE }).map((unit) => [unit.expects, unit.strong])).toEqual([
      [2, 2],
      [1, 1],
    ]);
  });

  it("makes a describe a unit when an expect sits directly in its body", () => {
    const content =
      'describe("s", () => {\n  expect(1).toBe(1);\n  it("c", () => {\n    expect(2).toBeDefined();\n  });\n});\n';
    expect(caseUnits({ content }).map((unit) => [unit.expects, unit.strong])).toEqual([
      [1, 1],
      [1, 0],
    ]);
  });

  it("gives an expect outside every case to no unit", () => {
    expect(caseUnits({ content: "function check() {\n  expect(1).toBe(1);\n}\n" })).toEqual([]);
  });

  it("follows an aliased expect", () => {
    const content = 'import { expect as check } from "vitest";\nit("c", () => {\n  check(1).toBe(1);\n});\n';
    expect(caseUnits({ content }).map((unit) => [unit.expects, unit.strong])).toEqual([[1, 1]]);
  });

  it("marks a case registered only when statements, blocks and suite callbacks alone sit above it", () => {
    const files = [
      'it("top", () => {\n  expect(1).toBe(1);\n});',
      'describe("s", () => {\n  it("nested", () => {\n    expect(2).toBe(2);\n  });\n});',
      'if (flag) {\n  it("guarded", () => {\n    expect(3).toBe(3);\n  });\n}',
      'for (const n of ns) {\n  it("looped", () => {\n    expect(n).toBe(n);\n  });\n}',
      '(() => {\n  it("invoked", () => {\n    expect(4).toBe(4);\n  });\n})();',
    ];
    const registered = files.map((content) => caseUnits({ content }).map((unit) => unit.registered));
    expect(registered).toEqual([[true], [true], [false], [false], [false]]);
  });

  it("keys a case the same at any nesting depth", () => {
    const shallow = caseUnits({ content: suite({ cases: [MOVED_CASE], title: "a" }) });
    const deep = caseUnits({ content: suite({ cases: [MOVED_CASE], depth: 3, title: "b" }) });
    expect(deep.map((unit) => unit.key)).toEqual(shallow.map((unit) => unit.key));
  });
});

describe("unitsMinus", () => {
  it("keeps multiplicity: two copies less one leaves one", () => {
    const one = caseUnits({ content: suite({ cases: [MOVED_CASE], title: "a" }) });
    const two = caseUnits({ content: suite({ cases: [MOVED_CASE, MOVED_CASE], title: "a" }) });
    expect(unitsMinus({ from: two, take: one })).toEqual(one);
  });
});

describe("moveCredits — a case moved verbatim into a same-directory sibling", () => {
  const compared = [{ baseText: BASE, headText: HEAD, path: SHRUNK }];

  it("credits the shrunk file with every assertion the moved case carries", () => {
    const added = [{ path: SIBLING, text: suite({ cases: [MOVED_CASE], title: "the line" }) }];
    expect(moveCredits({ added, compared }).get(SHRUNK)).toEqual({ expects: 2, strong: 2 });
  });

  // The incident's own sibling shape: a file comment, named imports, a string const, then the suite.
  it("credits a sibling holding only imports, a plain const and the suite", () => {
    const head = ["/** The line. */", 'import { describe, expect, it } from "vitest";', 'const CALL = "a-call";'];
    const text = [...head, suite({ cases: [MOVED_CASE], title: "the line" })].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual({ expects: 2, strong: 2 });
  });

  it("credits a case re-nested deeper in the sibling", () => {
    const added = [{ path: SIBLING, text: suite({ cases: [MOVED_CASE], depth: 2, title: "the line" }) }];
    expect(moveCredits({ added, compared }).get(SHRUNK)).toEqual({ expects: 2, strong: 2 });
  });

  it("credits a case moved into an existing sibling's gain, and takes it off that sibling's head", () => {
    const sibling = {
      baseText: suite({ cases: [KEPT_CASE], title: "line" }),
      headText: suite({ cases: [KEPT_CASE, MOVED_CASE], title: "line" }),
      path: SIBLING,
    };
    const credits = moveCredits({ added: [], compared: [...compared, sibling] });
    expect([credits.get(SHRUNK), credits.get(SIBLING)]).toEqual([
      { expects: 2, strong: 2 },
      { expects: -2, strong: -2 },
    ]);
  });

  it("still credits beside a const of literals, names, functions and nested literals", () => {
    const table = 'const TABLE = [{ a: 1, b: -2, c: "x", d: null, e: () => 1 }, OTHER] as const;';
    const text = [table, ...MOVED_CASE, ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual({ expects: 2, strong: 2 });
  });
});

describe("moveCredits — a real deletion stays a deletion", () => {
  const compared = [{ baseText: BASE, headText: HEAD, path: SHRUNK }];
  const nothing = { expects: 0, strong: 0 };

  // The plan pass's counterexample: the SAME assertions, in an unrelated new case, must not hide the loss.
  it("credits nothing for identical assertions in an unrelated case of a new sibling", () => {
    const unrelated = [
      'it("an unrelated case", () => {',
      '  expect(line("a")).toBe("a");',
      '  expect(line("")).toBe("");',
      "});",
    ];
    const added = [{ path: SIBLING, text: suite({ cases: [unrelated], title: "other" }) }];
    expect(moveCredits({ added, compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing for a case edited while it moved", () => {
    const edited = MOVED_CASE.map((line) => line.replace('toBe("a")', 'toBe("b")'));
    const added = [{ path: SIBLING, text: suite({ cases: [edited], title: "the line" }) }];
    expect(moveCredits({ added, compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("tells whitespace inside a literal apart, which a whitespace collapse would not", () => {
    const spaced = ({ gap }: { gap: string }): readonly string[] => [
      'it("c", () => {',
      `  expect(f()).toBe("a${gap}b");`,
      "});",
    ];
    const base = suite({ cases: [spaced({ gap: " " })], title: "s" });
    const shrunk = [{ baseText: base, headText: suite({ cases: [], title: "s" }), path: SHRUNK }];
    const added = [{ path: SIBLING, text: suite({ cases: [spaced({ gap: "  " })], title: "s" }) }];
    expect(moveCredits({ added, compared: shrunk }).get(SHRUNK)).toEqual(nothing);
  });

  it("tells a multi-line template literal's indentation apart, which line trimming alone would not", () => {
    const templated = ({ indent }: { indent: string }): readonly string[] => [
      'it("c", () => {',
      "  expect(f()).toBe(`a",
      `${indent}b\`);`,
      "});",
    ];
    const base = suite({ cases: [templated({ indent: "" })], title: "s" });
    const shrunk = [{ baseText: base, headText: suite({ cases: [], title: "s" }), path: SHRUNK }];
    const added = [{ path: SIBLING, text: suite({ cases: [templated({ indent: "    " })], title: "s" }) }];
    expect(moveCredits({ added, compared: shrunk }).get(SHRUNK)).toEqual(nothing);
  });

  // Codex review pass r1's counterexample: a verbatim case that never registers must not stand in for one.
  it("credits nothing for a verbatim case under if (false) in a new sibling", () => {
    const text = ["if (false) {", ...MOVED_CASE, "}", ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  // Codex review pass r2's counterexample: every node above the case is a suite callback, and it still returns first.
  it("credits nothing for a verbatim case after a return in the sibling's describe callback", () => {
    const text = ['describe("wrapper", () => {', "  return;", ...MOVED_CASE, "});", ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing for a verbatim case after a conditional throw at the top of the sibling", () => {
    const text = ['if (process.env["X"] === undefined) throw new Error("x");', ...MOVED_CASE, ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("still credits a case after a helper whose own return is inside a function", () => {
    const text = ["const make = () => {", "  return 1;", "};", ...MOVED_CASE, ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual({ expects: 2, strong: 2 });
  });

  // Fail closed: a statement kind the closed list does not name refuses, whatever it is.
  it("credits nothing beside a statement kind the inert list does not name", () => {
    const unnamed = [["class Later {}"], ["ready: ;"], ["debugger;"]];
    const credited = unnamed.map((lines) => {
      const text = [...lines, ...MOVED_CASE, ""].join("\n");
      return moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK);
    });
    expect(credited).toEqual([nothing, nothing, nothing]);
  });

  it("credits nothing beside a hook, even one registered after the case, which skips it at runtime", () => {
    const text = suite({ cases: [MOVED_CASE, ["beforeEach(({ skip }) => skip());"]], title: "line" });
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing where the sibling rebinds expect or a suite name to its own function", () => {
    const rebinds = [
      "const expect = () => ({ toBe: () => undefined });",
      'import { expect } from "./lenient.js";',
      "function describe() {}",
    ];
    const credited = rebinds.map((line) => {
      const text = [line, suite({ cases: [MOVED_CASE], title: "line" })].join("\n");
      return moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK);
    });
    expect(credited).toEqual([nothing, nothing, nothing]);
  });

  it("credits nothing under a suite given an options object beside its title", () => {
    const text = suite({ cases: [MOVED_CASE], title: "line" }).replace('"line", ', '"line", { fails: true }, ');
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing beside a const whose initialiser calls something at load", () => {
    const text = ["const ready = setup();", ...MOVED_CASE, ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  // The whole-diff read's open question: an initialiser that runs code without calling anything.
  it("credits nothing beside an initialiser that assigns, reads a property, coerces or spreads", () => {
    const running = [
      "const v = (expect = lenient);",
      "const v = holder.value;",
      "const v = `${holder}`;",
      "const v = [...items];",
      "const v = { [key]: 1 };",
    ];
    const credited = running.map((line) => {
      const text = [line, ...MOVED_CASE, ""].join("\n");
      return moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK);
    });
    expect(credited).toEqual([nothing, nothing, nothing, nothing, nothing]);
  });

  it("credits nothing beside an import kept only for its side effects", () => {
    const text = ['import "./registersHooks.js";', ...MOVED_CASE, ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing under a suite that may call its callback zero times", () => {
    const text = suite({ cases: [MOVED_CASE], title: "line" }).replace("describe(", "describe.each([])(");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing under a generator callback, whose body never runs", () => {
    const text = suite({ cases: [MOVED_CASE], title: "line" }).replace("() => {", "function* () {");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing for a verbatim case inside a named function nobody may call", () => {
    const text = ["function later() {", ...MOVED_CASE, "}", ""].join("\n");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing from another directory, which may be another lane", () => {
    const added = [{ path: "src/__tests__/unit/y/aLine.test.ts", text: suite({ cases: [MOVED_CASE], title: "line" }) }];
    expect(moveCredits({ added, compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing from a sibling that skips anything", () => {
    const text = suite({ cases: [MOVED_CASE], title: "line" }).replace("describe(", "describe.skip(");
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing from a sibling carrying a .only", () => {
    const text = `${suite({ cases: [MOVED_CASE], title: "line" })}it.only("f", () => {});\n`;
    expect(moveCredits({ added: [{ path: SIBLING, text }], compared }).get(SHRUNK)).toEqual(nothing);
  });

  it("credits nothing from an existing sibling that already held the case", () => {
    const already = suite({ cases: [MOVED_CASE], title: "line" });
    const sibling = { baseText: already, headText: already, path: SIBLING };
    expect(moveCredits({ added: [], compared: [...compared, sibling] }).get(SHRUNK)).toEqual(nothing);
  });
});

describe("moveCredits — two files losing the same case share one copy all-or-none", () => {
  const second = "src/__tests__/unit/x/b.test.ts";
  const compared = [
    { baseText: BASE, headText: HEAD, path: SHRUNK },
    { baseText: BASE, headText: HEAD, path: second },
  ];

  it("credits neither when only one copy arrived", () => {
    const added = [{ path: SIBLING, text: suite({ cases: [MOVED_CASE], title: "line" }) }];
    const credits = moveCredits({ added, compared });
    expect([credits.get(SHRUNK), credits.get(second)]).toEqual([
      { expects: 0, strong: 0 },
      { expects: 0, strong: 0 },
    ]);
  });

  it("credits both when a copy arrived for each", () => {
    const added = [{ path: SIBLING, text: suite({ cases: [MOVED_CASE, MOVED_CASE], title: "line" }) }];
    const credits = moveCredits({ added, compared });
    expect([credits.get(SHRUNK), credits.get(second)]).toEqual([
      { expects: 2, strong: 2 },
      { expects: 2, strong: 2 },
    ]);
  });
});
