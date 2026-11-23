/**
 * The in-process path scanner, over synthetic trees: which ruling gate a reached verb body opens with — a sole
 * delegation followed to the gated core, and every binding that only looks like the real gate counted as none.
 * `src/__tests__/unit/cli/inProcessRulingGate.test.ts` runs it over the real tree.
 */
import { describe, expect, it } from "vitest";

import { scanInProcessPaths } from "../../inProcessVerbPaths.js";
import { GATE_IMPORT, gatesOf, ROOT, TARGET, tree } from "./harness.js";

describe("scanInProcessPaths", () => {
  it("follows a sole delegation to the gated core, and reports an ungated body as null", () => {
    const files = tree({
      files: {
        caller: `import { coreRow, runWrapper, runTarget } from "./target.js";\ncoreRow({ argv: [] });\nrunWrapper([]);\nrunTarget([]);`,
        target: `${GATE_IMPORT}${TARGET}
export interface Execution { readonly exitCode: number }
export async function runWrapper(argv: readonly string[]): Promise<number> {
  return coreRow({ argv, out: logger.out });
}
export async function coreRow({ argv }: { argv: readonly string[] }): Promise<Execution> {
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(4), verb: "register" });
  if (gated !== undefined) {
    return { exitCode: gated };
  }
  return { exitCode: 0 };
}
export const wrapperCommand = defineCommand({ run: runWrapper });`,
      },
      loaded: ["target"],
    });

    const reached = scanInProcessPaths({ commandsRoot: ROOT, files })
      .reached.map((body) => {
        if (body.gate === null) {
          return `${body.body}: ungated`;
        }
        return `${body.body}: ${body.gate.noun} ${String(body.gate.verb)}`;
      })
      .toSorted();

    expect(reached).toEqual(["coreRow: handover register", "runTarget: ungated", "runWrapper: handover register"]);
  });

  it("counts no gate where a parameter rebinds the delegate, the gate or `undefined`", () => {
    const opening = `const g = refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "post" });
  if (g !== undefined) { return g; }
  return 0;`;
    const files = tree({
      files: {
        caller: `import { a, b } from "./target.js";\nimport { c } from "./gateParam.js";\nimport { d } from "./undefinedParam.js";\na({ rest: [] });\nb({ rest: [] });\nc({ rest: [] });\nd({ rest: [] });`,
        gateParam: `${GATE_IMPORT}export function c({ rest, refuseRunnerOnStandingRuling }: { rest: readonly string[]; refuseRunnerOnStandingRuling: Fake }): number {
  ${opening}
}
export const three = defineCommand({ run: (rest) => c({ rest, refuseRunnerOnStandingRuling: fake }) });`,
        target: `${GATE_IMPORT}function guarded({ rest }: { rest: readonly string[] }): number {
  ${opening}
}
export function a({ rest }: { rest: readonly string[] }): number { return guarded({ rest }); }
export function b({ rest, guarded }: { rest: readonly string[]; guarded: () => number }): number { return guarded(); }
export const one = defineCommand({ run: (rest) => a({ rest }) });
export const two = defineCommand({ run: (rest) => b({ rest, guarded: () => 0 }) });`,
        undefinedParam: `${GATE_IMPORT}export function d({ rest, undefined }: { rest: readonly string[]; undefined: number }): number {
  ${opening}
}
export const four = defineCommand({ run: (rest) => d({ rest, undefined: 1 }) });`,
      },
      loaded: ["target", "gateParam", "undefinedParam"],
    });

    expect(gatesOf({ files })).toEqual(['a: {"noun":"slack","verb":"post"}', "b: null", "c: null", "d: null"]);
  });

  it("counts no gate where the module binds the gate's name other than by importing the real one", () => {
    const body = ({ name }: { name: string }): string => `export function ${name}(rest: readonly string[]): number {
  const g = refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "post" });
  if (g !== undefined) { return g; }
  return 0;
}
export const command = defineCommand({ run: ${name} });`;
    const modules = {
      aliased: `import { other as refuseRunnerOnStandingRuling } from "../rulingGateDoor.js";\n${body({ name: "runAliased" })}`,
      fake: `${GATE_IMPORT}function refuseRunnerOnStandingRuling(_: unknown): undefined { return undefined; }\n${body({ name: "runFake" })}`,
      hoisted: `${GATE_IMPORT}${body({ name: "runHoisted" }).replace("return 0;", "return 0;\n  function refuseRunnerOnStandingRuling() { return undefined; }")}`,
      local: `function refuseRunnerOnStandingRuling(_: unknown): undefined { return undefined; }\n${body({ name: "runLocal" })}`,
      real: `${GATE_IMPORT}${body({ name: "runReal" })}`,
      typeOnly: `import type { refuseRunnerOnStandingRuling } from "../rulingGateDoor.js";\n${body({ name: "runTypeOnly" })}`,
      undefinedBound: `${GATE_IMPORT}const undefined = 1;\n${body({ name: "runUndefined" })}`,
      wrongModule: `import { refuseRunnerOnStandingRuling } from "./fakeDoor.js";\n${body({ name: "runWrong" })}`,
    };
    const names = Object.keys(modules);
    const caller = names.map((name) => `import * as ${name} from "./${name}.js";\nrun(${name});`).join("\n");
    const files = tree({ files: { caller, ...modules }, loaded: names });

    expect(gatesOf({ files })).toEqual([
      "runAliased: null",
      "runFake: null",
      "runHoisted: null",
      "runLocal: null",
      'runReal: {"noun":"slack","verb":"post"}',
      "runTypeOnly: null",
      "runUndefined: null",
      "runWrong: null",
    ]);
  });

  it("counts a gate call nothing obeys as no gate: one in an uncalled closure, one whose answer is dropped", () => {
    const files = tree({
      files: {
        caller: `import { closure, dropped } from "./target.js";\nclosure([]);\ndropped([]);`,
        target: `${GATE_IMPORT}export async function closure(rest: readonly string[]): Promise<number> {
  const neverCalled = () => refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "post" });
  return 0;
}
export async function dropped(rest: readonly string[]): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "post" });
  return 0;
}
export const one = defineCommand({ run: closure });
export const two = defineCommand({ run: dropped });`,
      },
      loaded: ["target"],
    });

    expect(gatesOf({ files })).toEqual(["closure: null", "dropped: null"]);
  });

  it("counts only a `const` binding as the gate, since `let` or `var` can be reassigned before its check", () => {
    const opening = ({ keyword }: { keyword: string }): string =>
      `${keyword} gated = refuseRunnerOnStandingRuling({ noun: "slack", rest, verb: "post" });
  if (gated !== undefined) { return gated; }
  return 0;`;
    const files = tree({
      files: {
        caller: `import { held, hoisted, rebound } from "./target.js";\nheld([]);\nhoisted([]);\nrebound([]);`,
        target: `${GATE_IMPORT}export async function held(rest: readonly string[]): Promise<number> {
  ${opening({ keyword: "const" })}
}
export async function hoisted(rest: readonly string[]): Promise<number> {
  ${opening({ keyword: "var" })}
}
export async function rebound(rest: readonly string[]): Promise<number> {
  ${opening({ keyword: "let" })}
}
export const one = defineCommand({ run: held });
export const two = defineCommand({ run: hoisted });
export const three = defineCommand({ run: rebound });`,
      },
      loaded: ["target"],
    });

    expect(gatesOf({ files })).toEqual(['held: {"noun":"slack","verb":"post"}', "hoisted: null", "rebound: null"]);
  });
});
