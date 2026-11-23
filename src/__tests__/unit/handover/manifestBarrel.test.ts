import { describe, expect, it } from "vitest";

import { exportedLocals, nounBinding, withParsedManifest } from "../../../handover/manifestBarrel.js";

/** A barrel importing `old` and `current` from two sibling manifests, with `rows` as its `MANIFEST_MODULES`. */
function barrel({ rows }: { rows: string }): string {
  return `import { old } from "./old.js";\nimport { now as current } from "./current.js";\nexport const MANIFEST_MODULES = [${rows}];`;
}

const OLD = { exported: "old", file: "old.ts" };
const CURRENT = { exported: "now", file: "current.ts" };

describe("nounBinding", () => {
  it("binds a noun to the import its row's last `verbs:` names, as JavaScript reads the row", () => {
    const rows = [
      '{ noun: "codex", verbs: old }',
      '{ noun: "codex", verbs: old, ...{ verbs: current } }',
      '{ noun: "codex", ...{ verbs: current }, verbs: old }',
      '{ "noun": "codex", verbs: current }, { noun: "slack", verbs: old }',
      '{ noun: "slack", verbs: old }',
      '({ noun: ("codex" as const), verbs: (current satisfies V) })',
    ];
    expect(rows.map((each) => nounBinding({ barrel: barrel({ rows: each }), noun: "codex" }))).toEqual([
      OLD,
      CURRENT,
      OLD,
      CURRENT,
      "unbound",
      CURRENT,
    ]);
  });

  it("binds a noun named by two rows to the LAST, as the CLI's Object.fromEntries routes", () => {
    const rows = [
      '{ noun: "codex", verbs: old }, { noun: "codex", verbs: current }',
      '{ noun: "codex", verbs: current }, { noun: "codex", verbs: old }',
      '...more, { noun: "codex", verbs: current }',
      '{ noun: "codex", verbs: current }, ...more',
    ];
    expect(rows.map((each) => nounBinding({ barrel: barrel({ rows: each }), noun: "codex" }))).toEqual([
      CURRENT,
      OLD,
      CURRENT,
      undefined,
    ]);
  });

  it("reads nothing when the last row that could bind the noun cannot be read", () => {
    const rows = [
      '{ noun: "codex", verbs: old, ...extra }',
      '{ noun: "codex", verbs: old, [key]: current }',
      "{ noun: NOUN, verbs: old }",
      "...more",
      "row",
      '{ noun: "codex", verbs: local }',
      '{ noun: "codex", verbs: pick(old) }',
    ];
    expect(rows.map((each) => nounBinding({ barrel: barrel({ rows: each }), noun: "codex" }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads a spread of an imported array in place, so the last row wins across files", () => {
    const manifests = new Map([
      [
        "family.ts",
        'import { old } from "./old.js";\nexport const FAMILY = [{ noun: "codex", verbs: old }, { noun: "slack", verbs: old }];',
      ],
      [
        "later.ts",
        'import { old } from "./old.js";\nimport { INNER } from "./inner.js";\nexport const LATER = [{ noun: "codex", verbs: old }, ...INNER];',
      ],
      ["inner.ts", 'import { now } from "./current.js";\nexport const INNER = [{ noun: "codex", verbs: now }];'],
    ]);
    const withSpread = ({ rows }: { rows: string }): string =>
      `import { FAMILY } from "./family.js";\nimport { LATER } from "./later.js";\nimport { old } from "./old.js";\nimport { now as current } from "./current.js";\nexport const MANIFEST_MODULES = [${rows}];`;
    const nested = withSpread({ rows: "...FAMILY, ...LATER" });
    expect([
      nounBinding({ barrel: withSpread({ rows: "...FAMILY" }), manifests, noun: "codex" }),
      nounBinding({ barrel: withSpread({ rows: "...FAMILY" }), manifests, noun: "slack" }),
      nounBinding({ barrel: withSpread({ rows: "...FAMILY" }), manifests, noun: "linear" }),
      nounBinding({
        barrel: withSpread({ rows: '...FAMILY, { noun: "codex", verbs: current }' }),
        manifests,
        noun: "codex",
      }),
      nounBinding({
        barrel: withSpread({ rows: '{ noun: "codex", verbs: current }, ...FAMILY' }),
        manifests,
        noun: "codex",
      }),
      nounBinding({ barrel: nested, manifests, noun: "codex" }),
    ]).toEqual([OLD, OLD, "unbound", CURRENT, OLD, { exported: "now", file: "current.ts" }]);
  });

  it("reads nothing from a spread it cannot follow, or one that loops", () => {
    const manifests = new Map([
      ["a.ts", 'import { B } from "./b.js";\nexport const A = [...B];'],
      ["b.ts", 'import { A } from "./a.js";\nexport const B = [...A];'],
      ["notArray.ts", "export const NOT = makeRows();"],
    ]);
    const spread = ({ name, file }: { name: string; file: string }): string =>
      `import { ${name} } from "./${file}.js";\nexport const MANIFEST_MODULES = [...${name}];`;
    expect([
      nounBinding({ barrel: spread({ file: "a", name: "A" }), manifests, noun: "codex" }),
      nounBinding({ barrel: spread({ file: "notArray", name: "NOT" }), manifests, noun: "codex" }),
      nounBinding({ barrel: spread({ file: "missing", name: "GONE" }), manifests, noun: "codex" }),
      nounBinding({ barrel: "export const MANIFEST_MODULES = [...LOCAL];", manifests, noun: "codex" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("exportedLocals", () => {
  it("keys each exported value by the name it is exported as, and skips a type-only export", () => {
    const locals = withParsedManifest({
      text: "export const a = 1;\nconst b = 2;\nconst c = 3;\nexport { b as d, type c };",
      use: (source) => [...exportedLocals({ source })],
    });
    expect(locals).toEqual([
      ["a", "a"],
      ["d", "b"],
    ]);
  });
});
