/**
 * The in-process path scanner, over synthetic trees: which function counts as a verb body — the exit-code return
 * types it reads off the syntax, the shapes it errs IN on, and the helpers and unloaded modules it skips.
 * `src/__tests__/unit/cli/inProcessRulingGate.test.ts` runs it over the real tree.
 */
import { describe, expect, it } from "vitest";

import { pairs, TARGET, tree } from "./harness.js";

describe("scanInProcessPaths", () => {
  it("finds a body answering a numeric-literal union, a local alias of one, an imported type or no annotation", () => {
    const files = tree({
      files: {
        caller: `import { a, b, c, d } from "./target.js";\na([]);\nb([]);\nc([]);\nd([]);`,
        target: `type Code = (0 | 1) | -1;
export async function a(argv: readonly string[]): Promise<0 | 1> { return 0; }
export function b(argv: readonly string[]): Code { return 0; }
export function c({ rest }: { rest: readonly string[] }): Promise<ImportedOutcome> { return go(rest); }
export const d = async (argv: readonly string[]) => 0;
export const one = defineCommand({ run: (argv) => a(argv) });
export const two = defineCommand({ run: (argv) => b(argv) });
export const three = defineCommand({ run: (rest) => c({ rest }) });
export const four = defineCommand({ run: d });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> a", "caller.ts -> b", "caller.ts -> c", "caller.ts -> d"]);
  });

  it("finds a body answering a type named through a namespace or an import type", () => {
    const files = tree({
      files: {
        caller: `import { e, f } from "./target.js";\ne([]);\nf([]);`,
        target: `import type * as outcomes from "./types.js";
export async function e(argv: readonly string[]): Promise<outcomes.ExitCode> { return 0; }
export function f(argv: readonly string[]): import("./types.js").ExitCode { return 0; }
export const one = defineCommand({ run: e });
export const two = defineCommand({ run: f });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> e", "caller.ts -> f"]);
  });

  it("unwraps only the built-in `Promise`, judging a local or imported one as the name it is", () => {
    const files = tree({
      files: {
        builtIn: `import { runOut } from "./plain.js";\nrunOut([]);`,
        caller: `import { runLocal } from "./local.js";\nimport { runImported } from "./imported.js";\nrunLocal([]);\nrunImported([]);`,
        imported: `import type { Promise } from "./outcome.js";
export function runImported(argv: readonly string[]): Promise<string> { return go(argv); }
export const importedCommand = defineCommand({ run: runImported });`,
        local: `type Promise = { readonly exitCode: number };
export function runLocal(argv: readonly string[]): Promise { return { exitCode: argv.length }; }
export const localCommand = defineCommand({ run: runLocal });`,
        plain: `export async function runOut(argv: readonly string[]): Promise<string> { return ""; }
export const plainCommand = defineCommand({ run: runOut });`,
      },
      loaded: ["imported", "local", "plain"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runImported", "caller.ts -> runLocal"]);
  });

  it("errs IN on a shape it cannot read off the syntax, and OUT only on one it can", () => {
    const files = tree({
      files: {
        caller: `import { g, h, i, j, k, l } from "./target.js";\ng([]);\nh([]);\ni([]);\nj([]);\nk([]);\nl([]);`,
        target: `interface Quoted { readonly "exitCode": number }
interface Inherits extends Imported {}
interface Plain { readonly code: number }
export async function g(argv: readonly string[]): Promise<Quoted> { return { exitCode: 0 }; }
export async function h(argv: readonly string[]): Promise<Inherits> { return go(argv); }
export function i(argv: readonly string[]): Plain & Imported { return go(argv); }
export function j(argv: readonly string[]): { [key: string]: number } { return go(argv); }
export function k(argv: readonly string[]): Plain { return { code: 0 }; }
export function l(argv: readonly string[]): readonly string[] { return argv; }
export const one = defineCommand({ run: g });
export const two = defineCommand({ run: h });
export const three = defineCommand({ run: i });
export const four = defineCommand({ run: j });
export const five = defineCommand({ run: k });
export const six = defineCommand({ run: l });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> g", "caller.ts -> h", "caller.ts -> i", "caller.ts -> j"]);
  });

  it("skips a module no manifest loads, even one carrying defineCommand", () => {
    const files = tree({
      files: { caller: `import { runTarget } from "./target.js";\nrunTarget([]);`, target: TARGET },
      loaded: [],
    });

    expect(pairs({ files })).toEqual([]);
  });

  it("skips a helper that takes parsed values, and a parse shell answering no exit code", () => {
    const files = tree({
      files: {
        caller: `import { helper, prepare } from "./target.js";\nhelper({ home: "h" });\nprepare({ argv: [] });`,
        target: `${TARGET}
export function prepare({ argv }: { argv: readonly string[] }): Prepared | { code: number } {
  return { code: 0 };
}
async function runTargetFully(argv: readonly string[]): Promise<number> {
  helper({ home: "h" });
  prepare({ argv });
  return 0;
}
export const second = defineCommand({ run: runTargetFully });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual([]);
  });
});
