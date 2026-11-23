/**
 * The in-process path scanner, over synthetic trees: how a command's runner reaches a verb body — the key its words
 * arrive under, the shape the runner is held in, every write that binds it, and a call nested in another.
 * `src/__tests__/unit/cli/inProcessRulingGate.test.ts` runs it over the real tree.
 */
import { describe, expect, it } from "vitest";

import { pairs, tree } from "./harness.js";

describe("scanInProcessPaths", () => {
  it("finds a body taking its words under a renamed, quoted or computed key", () => {
    const files = tree({
      files: {
        caller: `import { m, n, o } from "./target.js";\nm({ argv: [] });\nn({ rest: [] });\no({});`,
        target: `export function m({ "argv": words }: { "argv": readonly string[] }): number { return 0; }
export function n({ rest: words }: { rest: readonly string[] }): number { return 0; }
export function o({ [KEY]: words }: Record<string, readonly string[]>): number { return 0; }
export const one = defineCommand({ run: (argv) => m({ argv }) });
export const two = defineCommand({ run: (rest) => n({ rest }) });
export const three = defineCommand({ run: () => o({}) });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> m", "caller.ts -> n", "caller.ts -> o"]);
  });

  it("finds a body taking its words in a nested destructure or a nested inline type, not a parsed value", () => {
    const files = tree({
      files: {
        caller: `import { p, q, r, s } from "./target.js";\np({ options: { argv: [] } });\nq({ options: { argv: [] } });\nr({ home: "h" });\ns({ value: { argv: [] } });`,
        target: `type Box<T> = { value: T };
export function p({ options: { argv } }: { options: { argv: readonly string[] } }): number { return 0; }
export function q(input: { options: { "rest": readonly string[] } }): number { return 0; }
export function r({ home }: { home: string }): number { return 0; }
export function s(input: Box<{ argv: readonly string[] }>): number { return 0; }
export const one = defineCommand({ run: (argv) => p({ options: { argv } }) + q({ options: { rest: argv } }) + r({ home: "" }) + s({ value: { argv } }) });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> p", "caller.ts -> q", "caller.ts -> s"]);
  });

  it("follows a runner in any shape: a method, a held reference, an options object built elsewhere", () => {
    const files = tree({
      files: {
        caller: `import { runAlias, runAssigned, runHeld, runMethod, runSpec } from "./target.js";
runMethod([]);\nrunHeld([]);\nrunSpec([]);\nrunAlias([]);\nrunAssigned([]);`,
        target: `export function runMethod(argv: readonly string[]): number { return 0; }
export function runHeld(argv: readonly string[]): number { return 0; }
export function runSpec(argv: readonly string[]): number { return 0; }
export function runAlias(argv: readonly string[]): number { return 0; }
export function runAssigned(argv: readonly string[]): number { return 0; }
function runIndirect(argv: readonly string[]): number { const go = runHeld; return go(argv); }
const spec = { run: runSpec };
const holder = { runAlias };
const { runAlias: aliased } = holder;
const later: { run?: (argv: readonly string[]) => number } = {};
later.run = runAssigned;
export const one = defineCommand({ run(argv: readonly string[]) { return runMethod(argv); } });
export const two = defineCommand({ run: runIndirect });
export const three = defineCommand(spec);
export const four = defineCommand({ run: aliased });
export const five = defineCommand({ run: later.run! });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual([
      "caller.ts -> runAlias",
      "caller.ts -> runAssigned",
      "caller.ts -> runHeld",
      "caller.ts -> runMethod",
      "caller.ts -> runSpec",
    ]);
  });

  it("follows a runner through every write: a compound or destructuring assignment, a default, a mutating call", () => {
    const names = [
      "runCoalesced",
      "runDefaulted",
      "runDestructured",
      "runFielded",
      "runMerged",
      "runParamDefault",
      "runRegistered",
    ];
    const files = tree({
      files: {
        caller: `import { ${names.join(", ")} } from "./target.js";\n${names.map((name) => `${name}([]);`).join("\n")}`,
        target: `${names.map((name) => `export function ${name}(argv: readonly string[]): number { return 0; }`).join("\n")}
let coalesced: { run?: typeof runCoalesced } | undefined;
coalesced ??= { run: runCoalesced };
let destructured: typeof runDestructured;
({ run: destructured } = { run: runDestructured });
function build(options = { run: runDefaulted }) { return defineCommand(options); }
function nested() { const { run = runFielded } = {}; return defineCommand({ run }); }
const merged = {};
Object.assign((merged as object), { run: runMerged });
const registry = new Map();
registry.set("run", runRegistered);
export const one = defineCommand(coalesced);
export const two = defineCommand({ run: destructured });
export const three = build();
export const four = nested();
export const five = defineCommand(merged);
export const six = defineCommand({ run: registry.get("run") });
function command(argv: readonly string[], ignored = runParamDefault(argv)): number { return 0; }
export const seven = defineCommand({ run: command });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(names.map((name) => `caller.ts -> ${name}`));
  });

  it("finds a body its runner calls inside another call's argument, or hands to one by name", () => {
    const files = tree({
      files: {
        caller: `import { runHanded, runTarget } from "./target.js";\nrunTarget([]);\nrunHanded([]);`,
        target: `function identity<T>(value: T): T { return value; }
export function runTarget(argv: readonly string[]): number { return 0; }
export function runHanded(argv: readonly string[]): number { return 0; }
function runWrapped(argv: readonly string[]): number { return identity(runTarget(argv)) + retry(runHanded); }
export const targetCommand = defineCommand({ run: runWrapped });`,
      },
      loaded: ["target"],
    });

    expect(pairs({ files })).toEqual(["caller.ts -> runHanded", "caller.ts -> runTarget"]);
  });
});
