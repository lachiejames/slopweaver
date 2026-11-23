import { describe, expect, it } from "vitest";

import { loaderTargetsIn, reachableTestSources, targetsWithoutTests } from "../../../devLint/manifestLoaderTests.js";

describe("loaderTargetsIn", () => {
  it("normalises the ESM `.js` specifier to the `.ts` file on disk", () => {
    // THE TRAP: a manifest imports `run.js`; the file is `run.ts`. Comparing the literal `.ts` path against
    // test sources reports every module as untested — an earlier draft of this work did exactly that.
    const targets = loaderTargetsIn({
      manifestSources: ['const load = () => import("../commands/audit/run.js").then((m) => m.auditRunCommand);'],
    });
    expect(targets).toEqual([{ path: "src/cli/commands/audit/run.ts" }]);
  });

  it("finds targets nested deeper than one level, which a `commands/*/run.ts` glob misses", () => {
    const targets = loaderTargetsIn({
      manifestSources: ['import("../commands/slack/lifecycleRun.js")', 'import("../commands/dev/doorCoverage.js")'],
    });
    expect(targets.map((t) => t.path)).toEqual([
      "src/cli/commands/dev/doorCoverage.ts",
      "src/cli/commands/slack/lifecycleRun.ts",
    ]);
  });

  it("dedupes a module several verbs share", () => {
    const targets = loaderTargetsIn({
      manifestSources: ['import("../commands/codex/run.js")\nimport("../commands/codex/run.js")'],
    });
    expect(targets).toEqual([{ path: "src/cli/commands/codex/run.ts" }]);
  });

  it("finds nothing in a manifest with no dynamic import", () => {
    expect(loaderTargetsIn({ manifestSources: ["export const x = 1;"] })).toEqual([]);
  });
});

describe("targetsWithoutTests", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];

  it("accepts a real import of the module", () => {
    const testSources = ['import { runSeed } from "../../../../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });

  it("REJECTS a mere path mention in a string literal", () => {
    // Not hypothetical: while this gate was being written, `slack/pollRun.ts` briefly read as covered
    // because an unrelated test used its path as a fixture value.
    const testSources = ['const path = "src/cli/commands/seed/run.ts";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("reports a module no test mentions at all", () => {
    expect(targetsWithoutTests({ targets, testSources: ["export const x = 1;"] })).toEqual([
      "src/cli/commands/seed/run.ts",
    ]);
  });

  it("does not confuse a different module with a similar name", () => {
    const testSources = ['import { x } from "../../cli/commands/seedling/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });
});

describe("targetsWithoutTests — a commented-out import does not count", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];

  it("REJECTS a `//` commented import, which the first version accepted", () => {
    // The header promised comments do not count and the regex did not enforce it. A review pass produced
    // this exact line and the gate reported clean for a module no test imports.
    const testSources = ['// import { runSeed } from "../../../../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS an import mentioned only inside a JSDoc block", () => {
    const testSources = [' * import { runSeed } from "../../../../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("still accepts a real import that happens to sit below a comment", () => {
    const testSources = ['// a note\nimport { runSeed } from "../../../../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });
});

describe("targetsWithoutTests — block comments are stripped too", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];

  it("REJECTS a single-line /* … */ commented import", () => {
    // The second counterexample from review: the `//`-only filter left this one through, so the gate still
    // certified a target no test imports while claiming comments do not count.
    const testSources = ['/* import { runSeed } from "../../../../../cli/commands/seed/run.js"; */'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a multi-line block comment containing the import", () => {
    const testSources = ['/*\n  import { runSeed } from "../../../../../cli/commands/seed/run.js";\n*/'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("still accepts a real import following a block comment", () => {
    const testSources = ['/* a note */\nimport { runSeed } from "../../../../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });
});

describe("targetsWithoutTests — only a real import statement counts", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];

  it("REJECTS a specifier quoted inside a string literal", () => {
    // THIS GATE'S OWN TEST FIXTURES are string literals containing import text. The unanchored matcher
    // therefore certified seed/run.ts as imported on the strength of a fixture in this very file — the gate
    // defeating itself. Verified end-to-end, not just here.
    const testSources = ["const fixture = 'import { runSeed } from \"../../cli/commands/seed/run.js\";';"];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("accepts the CLOSING line of a multi-line import", () => {
    const testSources = ['import {\n  runSeed,\n  seedRunCommand,\n} from "../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });

  it("accepts a plain single-line import", () => {
    const testSources = ['import { runSeed } from "../../cli/commands/seed/run.js";'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });
});

describe("targetsWithoutTests — a template-literal decoy does not count", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];

  it("REJECTS an import-looking line inside a multi-line template literal", () => {
    // The anchored matcher accepts a line STARTING with `import`, and a template literal can put one there.
    // A review pass built this decoy after the string-literal hole was closed.
    const testSources = ['const decoy = `\nimport { runSeed } from "../../cli/commands/seed/run.js";\n`;'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("still accepts a real import in a file that also contains a template literal", () => {
    const testSources = ['import { runSeed } from "../../cli/commands/seed/run.js";\nconst msg = `hello\nworld`;'];
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });
});

describe("reachableTestSources — a helper counts only when a test reaches it", () => {
  const targets = [{ path: "src/cli/commands/seed/run.ts" }];
  const seedImport = 'import { runSeed } from "../../../cli/commands/seed/run.js";';
  const test = { path: "src/__tests__/unit/a/x.test.ts", source: 'import { rows } from "./x/rows.js";' };
  const rows = { path: "src/__tests__/unit/a/x/rows.ts", source: 'export { more } from "./deeper/index.js";' };
  const deeper = {
    path: "src/__tests__/unit/a/x/deeper/index.ts",
    source: seedImport.replace("../../../", "../../../../../"),
  };

  it("accepts a target a test loads through two helpers, the second named by its index path", () => {
    const testSources = reachableTestSources({ helpers: [rows, deeper], tests: [test] });
    expect(testSources.length).toBe(3);
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });

  // NodeNext resolves `./deeper.js` to `deeper.ts` only, never `deeper/index.ts`.
  it("REJECTS a directory-index fallback the ESM resolver never makes", () => {
    const bare = { ...rows, source: 'export { more } from "./deeper.js";' };
    const testSources = reachableTestSources({ helpers: [bare, deeper], tests: [test] });
    expect(testSources.length).toBe(2);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  // `./x/..js` names the file `x/..ts`; stripping `.js` first must not re-read it as `./x/..`.
  it("REJECTS a dot-led filename that stripping `.js` would turn into a parent segment", () => {
    const parent = { path: "src/__tests__/unit/a/x.ts", source: seedImport };
    const testSources = reachableTestSources({
      helpers: [parent],
      tests: [{ ...test, source: 'import "./x/..js";' }],
    });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  // A specifier is a URL, so `%2F` resolves to no file literally named `x%2Fy.ts`.
  it("REJECTS a percent-encoded specifier the ESM resolver never maps to a literal filename", () => {
    const encoded = { path: "src/__tests__/unit/a/x%2Fy.ts", source: seedImport };
    const testSources = reachableTestSources({
      helpers: [encoded],
      tests: [{ ...test, source: 'import "./x%2Fy.js";' }],
    });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a `.d.js` specifier, which loads that JavaScript file and never its sibling declaration file", () => {
    const declaration = { path: "src/__tests__/unit/a/decl.d.ts", source: seedImport };
    const testSources = reachableTestSources({
      helpers: [declaration],
      tests: [{ ...test, source: 'import { x } from "./decl.d.js";' }],
    });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a `.ts` helper shadowed by a tracked `.js` of the same name, which is the file the resolver loads", () => {
    const shadowed = { path: "src/__tests__/unit/a/helper.ts", source: seedImport };
    const shadow = { path: "src/__tests__/unit/a/helper.js", source: "export const x = 1;" };
    const testSources = reachableTestSources({
      helpers: [shadowed, shadow],
      tests: [{ ...test, source: 'import "./helper.js";' }],
    });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a target a reached helper only names as a quoted binding, while the import loads another module", () => {
    const decoy = {
      path: "src/__tests__/unit/a/helper.ts",
      source: `import { "../../../cli/commands/seed/run.js" as decoy } from "./actual.js";\nexport const helper = decoy;`,
    };
    const testSources = reachableTestSources({
      helpers: [decoy],
      tests: [{ ...test, source: 'import { helper } from "./helper.js";\nvoid helper;' }],
    });
    expect(testSources).toContain("");
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a target whose path a reached helper's test-tree fixture import merely ends like", () => {
    const fixture = {
      path: "src/__tests__/unit/a/helper.ts",
      source: `import { decoy } from "./fixtures/commands/seed/run.js";\nexport const helper = decoy;`,
    };
    const testSources = reachableTestSources({
      helpers: [fixture],
      tests: [{ ...test, source: 'import { helper } from "./helper.js";\nvoid helper;' }],
    });
    expect(testSources).toContain("");
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("CERTIFIES a target a reached helper's kept import resolves to, re-spelled as its repository path", () => {
    const helper = {
      path: "src/__tests__/unit/a/helper.ts",
      source: `import { runSeed } from "../../../cli/commands/seed/run.js";\nexport const helper = runSeed;`,
    };
    const testSources = reachableTestSources({
      helpers: [helper],
      tests: [{ ...test, source: 'import { helper } from "./helper.js";\nvoid helper;' }],
    });
    expect(testSources).toContain('import "src/cli/commands/seed/run.js";');
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });

  it("REJECTS a target a reached helper only `import type`s, which TypeScript erases and Node never loads", () => {
    const typeOnly = {
      path: "src/__tests__/unit/a/helper.ts",
      source: `import type { runSeed } from "../../../cli/commands/seed/run.js";\nexport type Runner = typeof runSeed;\nexport const helper = 1;`,
    };
    const testSources = reachableTestSources({
      helpers: [typeOnly],
      tests: [{ ...test, source: 'import { helper } from "./helper.js";\nvoid helper;' }],
    });
    expect(testSources.length).toBe(2);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a target only a helper no test imports names", () => {
    const stray = { path: "src/__tests__/unit/a/stray.ts", source: seedImport };
    const testSources = reachableTestSources({ helpers: [stray], tests: [test] });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("REJECTS a helper import that is commented out", () => {
    const commented = { ...test, source: '// import { rows } from "./x/rows.js";' };
    const testSources = reachableTestSources({ helpers: [rows, deeper], tests: [commented] });
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  // Counterexample: an exported string constant is not a re-export, and neither is a trailing
  // comment or a second statement on the same line.
  it.each([
    'export const decoy = "./x/rows.js";',
    'export const n = 1; // from "./x/rows.js"',
    'import { a } from "./other.js"; const s = "./x/rows.js";',
    '} from "./x/rows.js";',
    // Counterexample: a type-only import is erased, so the helper never loads.
    'import type { Rows } from "./x/rows.js";',
    'import type{Rows} from "./x/rows.js";',
    'import {type Rows} from "./x/rows.js";',
    'import {type/**/Rows} from "./x/rows.js";',
    'const decoy = `\nimport { rows } from "./x/rows.js";\n`;',
    'import type*as rows from "./x/rows.js";',
    'import { type Rows } from "./x/rows.js";',
    'export type { Rows } from "./x/rows.js";',
    'import {\n  type Rows,\n  type More,\n} from "./x/rows.js";',
  ])("REJECTS a path a test names but never loads at run time: %s", (source) => {
    const testSources = reachableTestSources({ helpers: [rows, deeper], tests: [{ ...test, source }] });
    expect(testSources.length).toBe(1);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it.each([
    'import "./x/rows.js";',
    'export * from "./x/rows.js";',
    'import rows from "./x/rows.js";',
    'import { type Rows, rows } from "./x/rows.js";',
    'import { rows } from "./x/rows.js"; // the rows every case reads',
    'import {\n  type Rows,\n  rows,\n} from "./x/rows.js";',
    'export { b } from "./elsewhere.js";\nimport { rows } from "./x/rows.js";',
    // An empty-brace import is still an import, as the direct matcher reads one.
    'import {} from "./x/rows.js";',
    'export {} from "./x/rows.js";',
  ])("follows every statement that loads the helper at run time: %s", (source) => {
    const testSources = reachableTestSources({ helpers: [rows, deeper], tests: [{ ...test, source }] });
    expect(testSources.length).toBe(3);
    expect(targetsWithoutTests({ targets, testSources })).toEqual([]);
  });

  // The strip is not idempotent, so a source sanitised twice can splice an import out of comments.
  it("REJECTS a comment-spliced import, which a second sanitising pass would assemble", () => {
    const spliced = 'const im = 0;\nim//*x*/* y */port { runSeed } from "../../../cli/commands/seed/run.js";';
    const testSources = reachableTestSources({ helpers: [], tests: [{ ...test, source: spliced }] });
    expect(testSources).toEqual([spliced]);
    expect(targetsWithoutTests({ targets, testSources })).toEqual(["src/cli/commands/seed/run.ts"]);
  });

  it("visits a helper two tests share once, and terminates on an import cycle", () => {
    const cycleA = { path: "src/__tests__/unit/a/x/rows.ts", source: 'import { b } from "./b.js";' };
    const cycleB = { path: "src/__tests__/unit/a/x/b.ts", source: 'import { a } from "./rows.js";' };
    const second = { ...test, path: "src/__tests__/unit/a/y.test.ts" };
    expect(reachableTestSources({ helpers: [cycleA, cycleB], tests: [test, second] }).length).toBe(4);
  });
});
