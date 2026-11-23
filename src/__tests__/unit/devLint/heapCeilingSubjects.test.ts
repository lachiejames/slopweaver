import { describe, expect, it } from "vitest";

import {
  type CeilingReading,
  heapBudgetCeiling,
  lintGateCeilings,
  packageScriptCeilings,
  treeCeilings,
} from "../../../devLint/heapCeilingSubjects.js";
import { mentionsHeapFlag } from "../../../devLint/tscOwnerContract.js";

/** The root manifest's path, which every root-script case reads from. */
const ROOT = "package.json";

/** A `desktop/package.json` running its compiler under the owner, reached from its own directory. */
const DESKTOP_OWNED = JSON.stringify({
  scripts: {
    build:
      "bash ../scripts/tsc-owner.sh --timeout-seconds 540 --grace-seconds 5 --rss-ceiling-mib 4096 -- node_modules/.bin/tsc -p tsconfig.json",
  },
});

/** The three manifests a tree reads, the desktop and site ones carrying no ceiling. */
const MANIFESTS = ({ root }: { root: string }): ReadonlyMap<string, string> =>
  new Map([
    ["desktop/package.json", JSON.stringify({ scripts: { build: "tsc -p tsconfig.json" } })],
    [ROOT, root],
    ["site/package.json", JSON.stringify({ scripts: { build: "next build" } })],
  ]);

/**
 * Unwrap a reading this test expects to be read, throwing its reason otherwise.
 *
 * @param reading the reader's answer
 * @returns its ceilings
 */
function ceilingsOf({ reading }: { reading: CeilingReading }): ReadonlyMap<string, number> {
  if (reading.kind === "unread") {
    throw new Error(reading.why);
  }
  return reading.ceilings;
}

/**
 * Unwrap the uncapped subjects of a reading this test expects to be read, throwing its reason otherwise.
 *
 * @param reading the reader's answer
 * @returns the keys it holds with no ceiling
 */
function uncappedOf({ reading }: { reading: CeilingReading }): ReadonlySet<string> {
  if (reading.kind === "unread") {
    throw new Error(reading.why);
  }
  return reading.uncapped;
}

/** A `package.json` holding two ceilings and one script with none. */
const PACKAGE = JSON.stringify({
  scripts: {
    build: "node --max-old-space-size=10240 node_modules/typescript/bin/tsc -p tsconfig.build.json",
    lint: "tsx src/devLint/devLint.ts",
    typecheck: "node --max-old-space-size 8192 node_modules/typescript/bin/tsc --noEmit",
  },
});

/** A gate registry with one gate carrying a ceiling and one carrying none. */
const GATES = `
export const gates = [
  { args: ["--expose-gc", "--max-old-space-size=8192", "src/a.entry.ts"], cmd: "tsx", name: "named-object-params" },
  { args: ["src/b.entry.ts"], cmd: "tsx", name: "other" },
];
`;

describe("mentionsHeapFlag", () => {
  it("answers on both spellings V8 accepts and on a backslash-escaped one", () => {
    expect(mentionsHeapFlag({ text: "--max-old-space-size=1" })).toBe(true);
    expect(mentionsHeapFlag({ text: "--max_old_space_size=1" })).toBe(true);
    expect(mentionsHeapFlag({ text: "--max\\-old-space-size=1" })).toBe(true);
    expect(mentionsHeapFlag({ text: `--max-old-"space-size"=1` })).toBe(true);
    expect(mentionsHeapFlag({ text: "--max-old-\\\nspace-size=1" })).toBe(true);
    expect(mentionsHeapFlag({ text: "--max-semi-space-size=1" })).toBe(false);
  });
});

describe("packageScriptCeilings", () => {
  it("reads the joined and the separated spelling, and skips a script with no ceiling", () => {
    expect([...ceilingsOf({ reading: packageScriptCeilings({ manifest: ROOT, text: PACKAGE }) })]).toEqual([
      ["package-script.build", 10240],
      ["package-script.typecheck", 8192],
    ]);
  });

  it("reads the owner's RSS ceiling under its own metric key, prefixed by the manifest's directory", () => {
    const reading = packageScriptCeilings({ manifest: "desktop/package.json", text: DESKTOP_OWNED });
    expect([...ceilingsOf({ reading })]).toEqual([["desktop.package-script.build.process-tree-rss", 4096]]);
  });

  it("holds a script with neither kind of ceiling uncapped under both keys", () => {
    const text = JSON.stringify({ scripts: { lint: "tsx src/devLint/devLint.ts" } });
    expect([...uncappedOf({ reading: packageScriptCeilings({ manifest: ROOT, text }) })]).toEqual([
      "package-script.lint",
      "package-script.lint.process-tree-rss",
    ]);
  });

  it("refuses an owner command that also carries a V8 flag, rather than reading the flag as its ceiling", () => {
    const text = JSON.stringify({
      scripts: {
        build:
          "bash scripts/tsc-owner.sh --timeout-seconds 1 --grace-seconds 1 --rss-ceiling-mib 1 -- node --max-old-space-size=99999 node_modules/typescript/bin/tsc",
      },
    });
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `build`: it runs the TypeScript compiler and it carries a V8 heap ceiling, which bounds nothing a native compiler spends — the owner's `--rss-ceiling-mib` is its bound",
    });
  });

  it("refuses a script named with the RSS suffix, whose V8 key would be another script's RSS key (Codex 8b r1)", () => {
    const text = JSON.stringify({
      scripts: { "build.process-tree-rss": "node --max-old-space-size=10240 node_modules/typescript/bin/tsc" },
    });
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `build.process-tree-rss` ends in `.process-tree-rss`, the suffix this gate reserves for an RSS ceiling's key — rename the script",
    });
  });

  it("reads an owner whose name is spliced from quoted fragments, as the shell runs it (Codex 8b r1)", () => {
    const text = JSON.stringify({
      scripts: {
        probe:
          'bash scripts/tsc-"owner.sh" --timeout-seconds 1 --grace-seconds 1 --rss-ceiling-mib 99999 -- node_modules/.bin/tsc',
      },
    });
    const reading = packageScriptCeilings({ manifest: ROOT, text });
    expect(reading).toEqual({
      ceilings: new Map([["package-script.probe.process-tree-rss", 99999]]),
      kind: "read",
      uncapped: new Set(),
    });
  });

  it("refuses an owner reached through a glob, rather than reading its RSS ceiling as none (Codex 8b r1)", () => {
    const text = JSON.stringify({
      scripts: {
        probe:
          "bash scripts/tsc-owne?.sh --timeout-seconds 1 --grace-seconds 1 --rss-ceiling-mib 99999 -- node_modules/.bin/ts[c] -p x.json",
      },
    });
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `probe`: it runs the TypeScript compiler and it does not run as `bash scripts/tsc-owner.sh …`, the one owner that can stop a native compiler's process group",
    });
  });

  it("refuses an owner reached by the wrong path, so a misplaced owner is never read as no ceiling", () => {
    const text = DESKTOP_OWNED;
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `build`: it runs the TypeScript compiler and it does not run as `bash scripts/tsc-owner.sh …`, the one owner that can stop a native compiler's process group",
    });
  });

  it("refuses a script whose ceiling arrives through NODE_OPTIONS, which it cannot read as an argument", () => {
    const text = JSON.stringify({ scripts: { build: "NODE_OPTIONS=--max-old-space-size=99999 node x.js" } });
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `build`: it names no `--max-old-space-size`, so it runs at V8's own default ceiling",
    });
  });

  it("refuses a script naming the flag twice, since only the last would apply", () => {
    const text = JSON.stringify({ scripts: { build: "node --max-old-space-size=1 --max_old_space_size=99999 x.js" } });
    expect(packageScriptCeilings({ manifest: ROOT, text }).kind).toBe("unread");
  });

  it("refuses a NODE_OPTIONS ceiling beside a lower direct flag, which a child would inherit", () => {
    const text = JSON.stringify({
      scripts: { probe: "NODE_OPTIONS=--max-old-space-size=12288 node --max-old-space-size=1024 wrapper.js" },
    });
    expect(packageScriptCeilings({ manifest: ROOT, text })).toEqual({
      kind: "unread",
      why: "package.json script `probe`: it names the heap flag in more than one word, so a child it spawns can inherit a ceiling other than the one its own argv sets",
    });
  });

  it("refuses a flag a backslash-newline splits, which the shell rejoins before node reads it", () => {
    const text = JSON.stringify({ scripts: { build: "NODE_OPTIONS=--max-old-\\\nspace-size=12288 node x.js" } });
    expect(packageScriptCeilings({ manifest: ROOT, text }).kind).toBe("unread");
  });

  it("reads a flag the shell assembles from a quoted word", () => {
    const text = JSON.stringify({ scripts: { build: `node --max-old-"space-size"=12288 x.js` } });
    expect([...ceilingsOf({ reading: packageScriptCeilings({ manifest: ROOT, text }) })]).toEqual([
      ["package-script.build", 12288],
    ]);
  });

  it("refuses a manifest that is not JSON", () => {
    expect(packageScriptCeilings({ manifest: ROOT, text: "{" }).kind).toBe("unread");
  });
});

describe("lintGateCeilings", () => {
  it("reads each gate's argv ceiling under its own name", () => {
    expect([...ceilingsOf({ reading: lintGateCeilings({ text: GATES }) })]).toEqual([
      ["lint-gate.named-object-params", 8192],
    ]);
  });

  it("refuses a flag hoisted into a constant, as an argv it cannot read", () => {
    const text = `const FLAG = "--max-old-space-size=99999";\nexport const gates = [{ args: [FLAG, "x.ts"], name: "g" }];\n`;
    expect(lintGateCeilings({ text })).toEqual({
      kind: "unread",
      why: "src/devLint/gateGroups.ts gate `g`: its entry is not plain identifier keys with `args` one array of plain string literals, so the name or argv reaching the child cannot be read",
    });
  });

  it("refuses a flag literal that sits in no gate at all, naming its line", () => {
    const text = `${GATES}export const stray = ["--max-old-space-size=99999"];\n`;
    expect(lintGateCeilings({ text })).toEqual({
      kind: "unread",
      why: "src/devLint/gateGroups.ts:6 names the heap flag outside a gate's plain-literal `args`, so this gate cannot read the ceiling it sets",
    });
  });

  it("refuses a templated ceiling, whose number is computed", () => {
    const text = 'const n = 9;\nexport const gates = [{ args: [`--max-old-space-size=${n}`, "x.ts"], name: "g" }];\n';
    expect(lintGateCeilings({ text }).kind).toBe("unread");
  });

  it("refuses a flag split across concatenated literals, which no single literal names", () => {
    const text = `export const gates = [{ args: ["--max-old-" + "space-size=12288", "a.ts"], name: "named-object-params" }];\n`;
    expect(lintGateCeilings({ text })).toEqual({
      kind: "unread",
      why: "src/devLint/gateGroups.ts gate `named-object-params`: its entry is not plain identifier keys with `args` one array of plain string literals, so the name or argv reaching the child cannot be read",
    });
  });

  it("refuses a shorthand `args` and an object spread, either of which could carry a ceiling in", () => {
    const shorthand = `const args = ["x.ts"];\nexport const gates = [{ args, name: "g" }];\n`;
    const spread = `const base = { args: ["x.ts"] };\nexport const gates = [{ ...base, name: "g" }];\n`;
    expect(lintGateCeilings({ text: shorthand }).kind).toBe("unread");
    expect(lintGateCeilings({ text: spread })).toEqual(lintGateCeilings({ text: shorthand }));
  });

  it("refuses a computed key or a repeated `name`, either of which renames the gate at run time", () => {
    const computed = `export const gates = [{ args: ["--max-old-space-size=1", "x.ts"], name: "b", ["na" + "me"]: "a" }];\n`;
    const repeated = `export const gates = [{ args: ["--max-old-space-size=1", "x.ts"], name: "b", name: "a" }];\n`;
    const refusal = {
      kind: "unread",
      why: "src/devLint/gateGroups.ts gate `b`: its entry is not plain identifier keys with `args` one array of plain string literals, so the name or argv reaching the child cannot be read",
    };
    expect(lintGateCeilings({ text: computed })).toEqual(refusal);
    expect(lintGateCeilings({ text: repeated })).toEqual(refusal);
  });

  it("follows ONE hop to a same-file const array, as `prettier`'s argv is spelled", () => {
    const text = `const ARGS: readonly string[] = ["--max-old-space-size=2048", "x.ts"];\nexport const gates = [{ args: ARGS, name: "g" }];\n`;
    expect([...ceilingsOf({ reading: lintGateCeilings({ text }) })]).toEqual([["lint-gate.g", 2048]]);
  });

  it("refuses that constant when anything else in the file touches it, or when it is a let", () => {
    const pushed = `const ARGS: string[] = ["x.ts"];\nARGS.push("--max-old-" + "space-size=99999");\nexport const gates = [{ args: ARGS, name: "g" }];\n`;
    const mutable = `let ARGS = ["x.ts"];\nexport const gates = [{ args: ARGS, name: "g" }];\n`;
    const refusal = {
      kind: "unread",
      why: "src/devLint/gateGroups.ts gate `g`: its entry is not plain identifier keys with `args` one array of plain string literals, so the name or argv reaching the child cannot be read",
    };
    expect(lintGateCeilings({ text: pushed })).toEqual(refusal);
    expect(lintGateCeilings({ text: mutable })).toEqual(refusal);
  });

  it("refuses one gate name declared twice, whether both carry a ceiling or only one does", () => {
    const capped = `{ args: ["--max-old-space-size=1", "x.ts"], name: "g" }`;
    const uncapped = `{ args: ["y.ts"], name: "g" }`;
    const refusal = { kind: "unread", why: "src/devLint/gateGroups.ts gate `g` is declared twice" };
    expect(lintGateCeilings({ text: `export const gates = [${capped}, ${capped}];\n` })).toEqual(refusal);
    expect(lintGateCeilings({ text: `export const gates = [${uncapped}, ${capped}];\n` })).toEqual(refusal);
  });

  it("does not read a comment that names the flag", () => {
    const reading = lintGateCeilings({ text: `// --max-old-space-size=99999\n${GATES}` });
    expect([...ceilingsOf({ reading })]).toEqual([["lint-gate.named-object-params", 8192]]);
  });
});

describe("heapBudgetCeiling", () => {
  it("reads one numeric literal, separators included", () => {
    expect(heapBudgetCeiling({ text: "export const HEAP_BUDGET_MIB = 6_543;\n" })).toEqual({
      ceilings: new Map([["named-object-params.budget", 6543]]),
      kind: "read",
      uncapped: new Set(),
    });
  });

  it("refuses a computed budget", () => {
    expect(heapBudgetCeiling({ text: "export const HEAP_BUDGET_MIB = 6543 * 2;\n" }).kind).toBe("unread");
  });

  it("refuses a file with no budget at all", () => {
    expect(heapBudgetCeiling({ text: "export const OTHER = 1;\n" }).kind).toBe("unread");
  });
});

describe("treeCeilings", () => {
  /** The budget file every tree case reads. */
  const BUDGET = "export const HEAP_BUDGET_MIB = 6543;";

  it("merges every source", () => {
    const reading = treeCeilings({
      texts: { gateGroups: GATES, heapBudget: BUDGET, manifests: MANIFESTS({ root: PACKAGE }) },
    });
    expect([...ceilingsOf({ reading }).keys()]).toEqual([
      "package-script.build",
      "package-script.typecheck",
      "lint-gate.named-object-params",
      "named-object-params.budget",
    ]);
  });

  it("names every script and gate that runs with no ceiling of its own, in every manifest, and every V8 script's RSS key", () => {
    const reading = treeCeilings({
      texts: { gateGroups: GATES, heapBudget: BUDGET, manifests: MANIFESTS({ root: PACKAGE }) },
    });
    expect([...uncappedOf({ reading })]).toEqual([
      "desktop.package-script.build",
      "desktop.package-script.build.process-tree-rss",
      "package-script.build.process-tree-rss",
      "package-script.lint",
      "package-script.lint.process-tree-rss",
      "package-script.typecheck.process-tree-rss",
      "site.package-script.build",
      "site.package-script.build.process-tree-rss",
      "lint-gate.other",
    ]);
  });

  it("is unread when a manifest it reads was never supplied", () => {
    const manifests = new Map([[ROOT, PACKAGE]]);
    expect(treeCeilings({ texts: { gateGroups: GATES, heapBudget: BUDGET, manifests } })).toEqual({
      kind: "unread",
      why: "desktop/package.json was not read, so its scripts' ceilings were never seen",
    });
  });

  it("is unread when any one source is", () => {
    const reading = treeCeilings({
      texts: { gateGroups: GATES, heapBudget: "", manifests: MANIFESTS({ root: PACKAGE }) },
    });
    expect(reading.kind).toBe("unread");
  });
});
