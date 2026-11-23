import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as ts from "#lib/tsCompiler.js";

import {
  identifierArguments,
  isInlineCallback,
  isPassedByReference,
} from "../../../devLint/namedObjectParamsCallbacks.js";
import { startCompiler } from "../../../devLint/namedObjectParamsProgram.js";

/**
 * One module carrying every shape the two callback exemptions separate: a consumer that declares a function
 * parameter (`on`, `define`'s `run`), one that takes an opaque generic value (`opaque`), and two same-spelled
 * `transform`s of which only one is handed to a callback position. No lib is loaded: every type the checker is
 * asked about is declared here.
 */
const SOURCE = [
  "declare function on(event: string, listener: (line: string) => void): void;",
  "declare function opaque<T>(value: T): T;",
  "declare function define(spec: { name: string; run: (argv: string) => number }): void;",
  "function onData(line: string): void {}",
  `on("data", onData);`,
  "function authored(text: string): string { return text; }",
  "opaque(authored);",
  `{ function transform(first: string): void {} on("x", transform); }`,
  "{ function transform(second: string): void {} opaque(transform); }",
  "function unused(alone: string): void {}",
  `on("x", (inlineLine: string) => {});`,
  "opaque((opaqueValue: string) => opaqueValue);",
  `define({ name: "x", run: (runArgv: string) => 0 });`,
  "const loose = (looseValue: string) => looseValue;",
  "export { loose };",
].join("\n");

let dir: string;
let checker: ts.Checker;
let sf: ts.SourceFile;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nop-callbacks-")));
  const file = join(dir, "subject.ts");
  writeFileSync(file, `${SOURCE}\n`);
  const program = startCompiler({ cwd: dir }).createProgram([file], {
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  });
  checker = program.getProject().checker;
  sf = program.getSourceFile(file)!;
});

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Every node in the fixture, depth first. */
function allNodes(): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(node);
    node.forEachChild(visit);
  };
  visit(sf);
  return nodes;
}

/** The function-like whose first parameter is spelled `name` — each is unique in the fixture. */
function byFirstParam({ name }: { name: string }): ts.SignatureDeclaration {
  return allNodes().find(
    (n): n is ts.SignatureDeclaration =>
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n)) && n.parameters[0]?.name.getText(sf) === name,
  )!;
}

describe("identifierArguments", () => {
  it("groups every bare-identifier call argument by its text and skips literals", () => {
    const byName = identifierArguments({ sf });
    expect([...byName.keys()].toSorted()).toEqual(["authored", "onData", "transform"]);
    expect(byName.get("transform")!.length).toBe(2);
    expect(byName.get("onData")![0]!.call.expression.getText(sf)).toBe("on");
  });
});

describe("isPassedByReference", () => {
  const passed = ({ name }: { name: string }): boolean =>
    isPassedByReference({ argumentsByName: identifierArguments({ sf }), checker, node: byFirstParam({ name }) });

  it("exempts a function handed to a parameter the callee declares as a function", () => {
    expect(passed({ name: "line" })).toBe(true);
  });

  it("does not exempt a function handed to an opaque generic value", () => {
    expect(passed({ name: "text" })).toBe(false);
  });

  it("matches by symbol, so a same-spelled function passed elsewhere is not exempted with it", () => {
    expect(passed({ name: "first" })).toBe(true);
    expect(passed({ name: "second" })).toBe(false);
  });

  it("does not exempt a function never handed to a call", () => {
    expect(passed({ name: "alone" })).toBe(false);
  });
});

describe("isInlineCallback", () => {
  const inline = ({ name }: { name: string }): boolean => isInlineCallback({ checker, node: byFirstParam({ name }) });

  it("exempts a literal in a callback position the callee declares", () => {
    expect(inline({ name: "inlineLine" })).toBe(true);
  });

  it("exempts a literal under an object property the callee declares as a function", () => {
    expect(inline({ name: "runArgv" })).toBe(true);
  });

  it("does not exempt a literal handed to an opaque generic value", () => {
    expect(inline({ name: "opaqueValue" })).toBe(false);
  });

  it("does not exempt a literal that is not a call argument at all", () => {
    expect(inline({ name: "looseValue" })).toBe(false);
  });
});
