/**
 * The in-process path scanner, over synthetic trees: how an importer names a verb body — static, dynamic, namespace
 * and re-exported imports, the shapes it cannot name, and an export resolved to the body it declares.
 * `src/__tests__/unit/cli/inProcessRulingGate.test.ts` runs it over the real tree.
 */
import { describe, expect, it } from "vitest";

import { pairs, TARGET, tree } from "./harness.js";

describe("scanInProcessPaths", () => {
  it("finds a multi-line, aliased static import that is called", () => {
    const files = tree({
      files: {
        caller: `import {\n  helper,\n  runTarget as go,\n} from "./target.js";\nexport function c() { return go(["a"]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("finds a destructured dynamic import", () => {
    const files = tree({
      files: {
        caller: `export async function c() { const { runTarget } = await import("./target.js"); return runTarget([]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("finds a destructured dynamic import renamed off a quoted key", () => {
    const files = tree({
      files: {
        caller: `export async function c() { const { "runTarget": go } = await import("./target.js"); return go([]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("finds a body called through a static namespace import, and not a helper read off the same one", () => {
    const files = tree({
      files: {
        caller: `import * as target from "./target.js";\nexport function c() { target.helper({ home: "h" }); return target.runTarget([]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("finds a body called off an awaited dynamic import held whole", () => {
    const files = tree({
      files: {
        caller: `export async function c() { const mod = await import("./target.js"); return mod.runTarget([]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("counts a named import used as a destructuring default, and not one only re-bound by name", () => {
    const files = tree({
      files: {
        defaulted: `import { runTarget } from "./target.js";\nconst { go = runTarget }: { go?: typeof runTarget } = {};\ngo([]);`,
        keyed: `import { runTarget } from "./target.js";\nconst { runTarget: other } = { runTarget: () => 0 };\nother();`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["defaulted.ts -> runTarget"]);
  });

  it("finds a body read off a namespace by a quoted key", () => {
    const files = tree({
      files: {
        caller: `import * as target from "./target.js";\nexport function c() { return target["runTarget"]([]); }`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runTarget"]);
  });

  it("reads a destructured awaited import through `satisfies`, `as`, parentheses and `!`", () => {
    const files = tree({
      files: {
        caller: `export async function c() {
  const { runTarget } = (await import("./target.js")) satisfies typeof import("./target.js");
  const { runOther } = (await (import("./other.js") as Promise<Other>))!;
  return runTarget([]) + runOther([]);
}`,
        other: `export function runOther(argv: readonly string[]): number { return 0; }
export function runUnused(argv: readonly string[]): number { return 0; }
export const otherCommand = defineCommand({ run: (argv) => runOther(argv) + runUnused(argv) });`,
        target: TARGET,
      },
      loaded: ["other", "target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runOther", "caller.ts -> runTarget"]);
  });

  it("counts EVERY verb body of a module loaded in a shape whose members it cannot name", () => {
    const body = ({ name }: { name: string }): string =>
      `export function ${name}(argv: readonly string[]): number { return 0; }`;
    const module = ({ prefix }: { prefix: string }): string => `${body({ name: `${prefix}One` })}
${body({ name: `${prefix}Two` })}
export function ${prefix}Helper({ home }: { home: string }): number { return 0; }
export const ${prefix}Command = defineCommand({ run: (argv) => ${prefix}One(argv) + ${prefix}Two(argv) });`;
    const files = tree({
      files: {
        chained: `export async function c() { return (await import("./a.js")).aOne([]); }`,
        computed: `import * as b from "./b.js";\nexport function c(key: "bOne") { return b[key]([]); }`,
        typed: `import * as j from "./j.js";\ntype Whole = typeof j;\nj.jOne([]);`,
        handed: `export async function c() { const mod = await import("./c.js"); return run(mod); }`,
        a: module({ prefix: "a" }),
        b: module({ prefix: "b" }),
        c: module({ prefix: "c" }),
        d: module({ prefix: "d" }),
        e: module({ prefix: "e" }),
        f: module({ prefix: "f" }),
        g: module({ prefix: "g" }),
        h: module({ prefix: "h" }),
        i: module({ prefix: "i" }),
        j: module({ prefix: "j" }),
        k: module({ prefix: "k" }),
        deepTyped: `import * as k from "./k.js";\nexport type Snapshot = Readonly<typeof k>;`,
        nested: `export async function c() { const { [name]: go } = await import("./d.js"); return go([]); }`,
        rest: `export async function c() { const { ...all } = await import("./e.js"); return all.eOne([]); }`,
        reExported: `export { hOne } from "./h.js";`,
        sideEffect: `import "./g.js";`,
        templated: `export async function c() { const { iOne } = await import(\`./i.js\`); return iOne([]); }`,
        promised: `export function c() { return import("./f.js").then((m) => m.fOne([])); }`,
      },
      loaded: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    });

    expect(pairs({ files })).toEqual([
      "chained.ts -> aOne",
      "chained.ts -> aTwo",
      "computed.ts -> bOne",
      "computed.ts -> bTwo",
      "deepTyped.ts -> kOne",
      "deepTyped.ts -> kTwo",
      "handed.ts -> cOne",
      "handed.ts -> cTwo",
      "nested.ts -> dOne",
      "nested.ts -> dTwo",
      "promised.ts -> fOne",
      "promised.ts -> fTwo",
      "reExported.ts -> hOne",
      "reExported.ts -> hTwo",
      "rest.ts -> eOne",
      "rest.ts -> eTwo",
      "sideEffect.ts -> gOne",
      "sideEffect.ts -> gTwo",
      "templated.ts -> iOne",
      "typed.ts -> jOne",
      "typed.ts -> jTwo",
    ]);
  });

  it("resolves an export name to the body it declares: a default export, and an export alias", () => {
    const files = tree({
      files: {
        alias: `import { go } from "./listed.js";\ngo([]);`,
        defaulted: `import run from "./target.js";\nrun([]);`,
        listed: `function runListed(argv: readonly string[]): number { return 0; }
export { runListed as go };
export const listedCommand = defineCommand({ run: runListed });`,
        named: `import second from "./trailing.js";\nsecond([]);`,
        spaced: `import * as target from "./target.js";\ntarget.default([]);`,
        target: `export default function runTarget(argv: readonly string[]): number { return 0; }
export const targetCommand = defineCommand({ run: runTarget });`,
        trailing: `function runTrailing(argv: readonly string[]): number { return 0; }
export default runTrailing;
export const trailingCommand = defineCommand({ run: runTrailing });`,
      },
      loaded: ["listed", "target", "trailing"],
    });

    expect(pairs({ files })).toEqual([
      "alias.ts -> runListed",
      "defaulted.ts -> runTarget",
      "named.ts -> runTrailing",
      "spaced.ts -> runTarget",
    ]);
  });

  it("counts a body handed on as a value, and skips one only imported", () => {
    const files = tree({
      files: {
        handsOn: `import { runTarget } from "./target.js";\nexport const deps = { spawn: runTarget };`,
        importsOnly: `import { runTarget } from "./target.js";`,
        target: TARGET,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["handsOn.ts -> runTarget"]);
  });
});
