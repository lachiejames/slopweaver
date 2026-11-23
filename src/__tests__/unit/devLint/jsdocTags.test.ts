import { describe, expect, it } from "vitest";
import type { JsdocDefect } from "../../../devLint/jsdocParamDefects.js";
import { isScannablePath, scanJsdocTags } from "../../../devLint/jsdocTags.js";

/** Scan an inline fixture as if it were a source file. */
function scan({ content }: { content: string }): readonly JsdocDefect[] {
  return scanJsdocTags({ content, path: "src/fixture.ts" });
}

/** The `kind` of every defect, in order — the shape most assertions here care about. */
function kinds({ content }: { content: string }): readonly string[] {
  return scan({ content }).map((defect) => defect.kind);
}

describe("scanJsdocTags — a fully documented export", () => {
  const documented = `
/**
 * Every leak-class hit in one file's content.
 *
 * @param path the file's identity for reporting — never read from disk
 * @param content the already-read text
 * @returns every hit, in line order
 */
export function scanContent({ path, content }: { path: string; content: string }): readonly string[] {
  return [path, content];
}
`;

  it("reports nothing", () => {
    expect(scan({ content: documented })).toEqual([]);
  });
});

describe("scanJsdocTags — doc rot, the defect this gate exists for", () => {
  // The real shape from src/cli/commands/linear/core.ts before this gate: a rename left the tag behind. Under
  // Option B a renamed field with no tag at all is no longer a defect (omission is allowed) — only the STALE
  // tag naming the field that no longer exists is.
  const renamed = `
/**
 * The provider input, built from the validated form.
 *
 * @param args the parsed invocation
 * @param description the rendered body
 * @returns the provider input
 */
export function createInputFor({ fields, description }: { fields: string; description: string }): string {
  return fields + description;
}
`;

  it("reports only the tag naming no parameter, not the field with no tag", () => {
    expect(kinds({ content: renamed })).toEqual(["stale-param"]);
  });

  it("names the stale tag and lists the parameters that do exist", () => {
    const stale = scan({ content: renamed }).find((defect) => defect.kind === "stale-param")!;
    expect(stale.detail).toBe('@param "args" names no parameter (expected: fields, description)');
    expect(stale.name).toBe("createInputFor");
    expect(stale.line).toBe(9);
  });
});

describe("scanJsdocTags — every field of a destructured parameter must be named", () => {
  it("accepts the flat field convention, not a synthesised root", () => {
    const flat = `
/**
 * Two fields, both named.
 *
 * @param left the left operand
 * @param right the right operand
 * @returns the sum
 */
export function add({ left, right }: { left: number; right: number }): number {
  return left + right;
}
`;
    expect(scan({ content: flat })).toEqual([]);
  });

  it("rejects the `root0.field` spelling the rules file forbids", () => {
    // Codex's rebase finding: an earlier draft reduced every tag to its leaf, so `root0.source` was accepted
    // for a field called `source` — the gate permitting the one spelling the prose forbids.
    const qualified = `
/**
 * Fetch one source.
 *
 * @param root0.source the source
 * @returns the source
 */
export function fetchOne({ source }: { source: string }): string {
  return source;
}
`;
    const flagged = scan({ content: qualified });
    expect(flagged.map((defect) => defect.kind)).toEqual(["stale-param"]);
    expect(flagged[0]!.detail).toBe('@param "root0.source" names no parameter (expected: source)');
  });

  it("rejects a tag naming nothing, which a presence-only rule accepts", () => {
    const typo = `
/**
 * Two fields, one bogus tag.
 *
 * @param typo names nothing at all
 * @returns the sum
 */
export function add({ left, right }: { left: number; right: number }): number {
  return left + right;
}
`;
    expect(kinds({ content: typo })).toEqual(["stale-param"]);
  });

  it("allows documenting only some fields — the rest are simply omitted", () => {
    const partial = `
/**
 * Three fields, one tagged.
 *
 * @param api the injected seam
 * @returns the result
 */
export function fetchIt({ api, window, onProgress }: { api: string; window: string; onProgress: string }): string {
  return api + window + onProgress;
}
`;
    expect(scan({ content: partial })).toEqual([]);
  });

  it("expects the field name, not the local binding, when a field is renamed", () => {
    const renamedField = `
/**
 * A renamed destructure.
 *
 * @param readStdin reads the raw payload
 * @returns the payload
 */
export function run({ readStdin: read }: { readStdin: () => string }): string {
  return read();
}
`;
    expect(scan({ content: renamedField })).toEqual([]);
  });

  it("rejects a tag naming the local binding instead of the field", () => {
    const boundName = `
/**
 * A renamed destructure, documented by its local binding.
 *
 * @param read reads the raw payload
 * @returns the payload
 */
export function run({ readStdin: read }: { readStdin: () => string }): string {
  return read();
}
`;
    expect(kinds({ content: boundName })).toEqual(["stale-param"]);
  });
});

describe("scanJsdocTags — the contract is the TYPE, not what the body destructures", () => {
  // Measured: three exported functions here declare a field they deliberately never bind — a state guard
  // that makes an edge unreachable from the wrong state, and a `verb` kept for a stable signature. A caller
  // MUST pass them, so documenting them is correct; reading the binding pattern alone called all three stale.
  it("accepts a documented field the body never binds, because the caller still passes it", () => {
    const guard = `
/**
 * Post the progress frame.
 *
 * @param state the lifecycle, which must not have started
 * @param frame the rendered frame to post
 * @returns the in-flight state
 */
export function postProgress({ frame }: { state: { kind: "not-started" }; frame: string }): string {
  return frame;
}
`;
    expect(scan({ content: guard })).toEqual([]);
  });

  it("allows omitting a tag for a declared-but-unbound field, same as any other", () => {
    const undocumentedGuard = `
/**
 * Post the progress frame.
 *
 * @param frame the rendered frame to post
 * @returns the in-flight state
 */
export function postProgress({ frame }: { state: { kind: "not-started" }; frame: string }): string {
  return frame;
}
`;
    expect(scan({ content: undocumentedGuard })).toEqual([]);
  });

  it("refuses an annotation it cannot fully resolve, rather than checking only the part it can see", () => {
    // The earlier, lenient behaviour degraded to the bound fields and suppressed the stale check. Codex found
    // three separate types that slipped through that path, each hiding a required-but-unbound field. An
    // unresolvable annotation is now a defect: measured at zero occurrences in this repo, so it costs nothing.
    const opaqueIntersection = `
/**
 * Decay a score by age.
 *
 * @param tsMs the record's timestamp
 * @returns the weight
 */
export function decayWeight({ tsMs }: { tsMs: number } & DecayParams): number {
  return tsMs;
}
`;
    const flagged = scan({ content: opaqueIntersection });
    expect(flagged.map((defect) => defect.kind)).toEqual(["unnameable-param"]);
    expect(flagged[0]!.detail).toContain("inline the object type");
  });

  it("refuses an imported named type, the shape that made the fallback dead code", () => {
    const imported = `
/**
 * Define a command.
 *
 * @param run the handler
 * @returns the command
 */
export function defineCommand({ run }: ImportedInput): string {
  return run;
}
`;
    expect(kinds({ content: imported })).toEqual(["unnameable-param"]);
  });

  it("refuses an interface with an extends clause, whose members live in another declaration", () => {
    const inherited = `
interface Extended extends Base {
  frame: string;
}

/**
 * Post the frame.
 *
 * @param frame the rendered frame
 * @returns the posted frame
 */
export function post({ frame }: Extended): string {
  return frame;
}
`;
    expect(kinds({ content: inherited })).toEqual(["unnameable-param"]);
  });

  it("terminates on a self-referential alias instead of recursing forever", () => {
    const cyclic = `
type Loop = Loop;

/**
 * Takes a loop.
 *
 * @param frame the rendered frame
 * @returns the frame
 */
export function post({ frame }: Loop): string {
  return frame;
}
`;
    // The assertion that matters is that this RETURNS at all; the cycle guard makes the alias unresolvable.
    expect(kinds({ content: cyclic })).toEqual(["unnameable-param"]);
  });

  it("still resolves an intersection when EVERY part is readable", () => {
    const bothInline = `
/**
 * Decay a score by age.
 *
 * @param tsMs the record's timestamp
 * @param nowMs the reference now
 * @returns the weight
 */
export function decayWeight({ tsMs, nowMs }: { tsMs: number } & { nowMs: number }): number {
  return nowMs - tsMs;
}
`;
    expect(scan({ content: bothInline })).toEqual([]);
  });

  it("allows an intersection field to go undocumented, same as any other omission", () => {
    const missingHalf = `
/**
 * Decay a score by age.
 *
 * @param tsMs the record's timestamp
 * @returns the weight
 */
export function decayWeight({ tsMs, nowMs }: { tsMs: number } & { nowMs: number }): number {
  return nowMs - tsMs;
}
`;
    expect(scan({ content: missingHalf })).toEqual([]);
  });

  it("resolves a locally-declared interface, so a stale tag on it is still caught", () => {
    // Codex's counterexample was about a hidden REQUIRED field; under Option B omitting `state` is no longer
    // a defect either way. Resolution still matters for `stale-param`: it is only reported when the contract
    // is fully visible, so a wrong tag on an unresolvable type would otherwise slip through as "maybe real".
    const wrongTag = `
interface ProgressInput {
  state: { kind: "not-started" };
  frame: string;
}

/**
 * Post the progress frame.
 *
 * @param frame the rendered frame
 * @param typo not a real field
 * @returns the posted frame
 */
export function postProgress({ frame }: ProgressInput): string {
  return frame;
}
`;
    const flagged = scan({ content: wrongTag });
    expect(flagged.map((defect) => defect.kind)).toEqual(["stale-param"]);
    expect(flagged[0]!.detail).toBe('@param "typo" names no parameter (expected: state, frame)');
  });

  it("accepts the same shape once the hidden field is documented", () => {
    const documented = `
interface ProgressInput {
  state: { kind: "not-started" };
  frame: string;
}

/**
 * Post the progress frame.
 *
 * @param state the lifecycle, which must not have started
 * @param frame the rendered frame
 * @returns the posted frame
 */
export function postProgress({ frame }: ProgressInput): string {
  return frame;
}
`;
    expect(scan({ content: documented })).toEqual([]);
  });

  it("resolves a type alias whose right-hand side is an intersection", () => {
    // Codex's second counterexample: the first fix resolved a bare interface but refused to look inside an
    // alias to an intersection, so this failed closed as unnameable-param instead of resolving cleanly.
    const aliased = `
type ProgressInput = { frame: string } & { state: { kind: "not-started" } };

/**
 * Post the progress frame.
 *
 * @param frame the rendered frame
 * @returns the posted frame
 */
export function postProgress({ frame }: ProgressInput): string {
  return frame;
}
`;
    expect(scan({ content: aliased })).toEqual([]);
  });

  it("looks inside a parenthesized intersection in a local alias", () => {
    // Codex's third counterexample in this family: the parens are their own AST node, and not unwrapping
    // them made the entire alias opaque, which would fail closed as unnameable-param instead of resolving.
    const parenthesised = `
type ProgressInput = ({ frame: string } & { state: { kind: "not-started" } });

/**
 * Post the progress frame.
 *
 * @param frame the rendered frame
 * @returns the posted frame
 */
export function postProgress({ frame }: ProgressInput): string {
  return frame;
}
`;
    expect(scan({ content: parenthesised })).toEqual([]);
  });
});

describe("scanJsdocTags — @returns is required only when a value comes back", () => {
  const withReturnType = ({ type, body }: { type: string; body: string }): string => `
/**
 * Does the thing.
 *
 * @param a the input
 */
export function doIt({ a }: { a: string }): ${type} {
  ${body}
}
`;

  it("exempts void", () => {
    expect(scan({ content: withReturnType({ body: "void a;", type: "void" }) })).toEqual([]);
  });

  it("exempts Promise<void>", () => {
    const asyncVoid = `
/**
 * Does the thing.
 *
 * @param a the input
 */
export async function doIt({ a }: { a: string }): Promise<void> {
  await Promise.resolve(a);
}
`;
    expect(scan({ content: asyncVoid })).toEqual([]);
  });

  it("exempts never — a function that always throws returns nothing to describe", () => {
    expect(scan({ content: withReturnType({ body: "throw new Error(a);", type: "never" }) })).toEqual([]);
  });

  it("requires it for a plain value", () => {
    expect(kinds({ content: withReturnType({ body: "return a;", type: "string" }) })).toEqual(["missing-returns"]);
  });

  it("requires it for Promise<string> — a resolved value still needs describing", () => {
    const asyncValue = `
/**
 * Does the thing.
 *
 * @param a the input
 */
export async function doIt({ a }: { a: string }): Promise<string> {
  return await Promise.resolve(a);
}
`;
    expect(kinds({ content: asyncValue })).toEqual(["missing-returns"]);
  });

  it("requires it for Result<void> — the failure branch still has to be explained", () => {
    expect(
      kinds({ content: withReturnType({ body: "return { ok: true, value: a };", type: "Result<void>" }) }),
    ).toEqual(["missing-returns"]);
  });

  it("falls back to the body when there is no annotation, and a value comes back", () => {
    const unannotated = `
/**
 * Does the thing.
 *
 * @param a the input
 */
export function doIt({ a }: { a: string }) {
  return a;
}
`;
    expect(kinds({ content: unannotated })).toEqual(["missing-returns"]);
  });

  it("exempts an unannotated arrow whose type comes from its variable and which returns nothing", () => {
    // The measured case: `unrefIntervalStallTimer: StallTimer = ({ … }) => { … }`. The arrow carries no
    // annotation, so an annotation-only rule would fail closed and demand @returns on a void function.
    const contextual = `
/**
 * The production stall watchdog.
 *
 * @param intervalMs how often to check
 */
export const stallTimer: StallTimer = ({ intervalMs }) => {
  setInterval(() => undefined, intervalMs);
};
`;
    expect(scan({ content: contextual })).toEqual([]);
  });

  it("requires @returns for a concise arrow body, which has no return statement to find", () => {
    // Codex's final finding: `() => 42` yields a value with no `ReturnStatement`, and the arrow carries no
    // annotation of its own (the type sits on the variable), so an earlier version accepted it undocumented.
    const concise = `
/**
 * Return the answer.
 */
export const answer: () => number = () => 42;
`;
    expect(kinds({ content: concise })).toEqual(["missing-returns"]);
  });

  it("exempts a concise `void expr` body, whose value is undefined by definition", () => {
    const conciseVoid = `
/**
 * Fire and forget.
 *
 * @param task the thing to start
 */
export const start: Starter = ({ task }) => void task();
`;
    expect(scan({ content: conciseVoid })).toEqual([]);
  });

  it("does not mistake a nested function's return for the outer function's", () => {
    const nested = `
/**
 * Registers a handler and returns nothing itself.
 *
 * @param onEach the handler
 */
export const register: Registrar = ({ onEach }) => {
  onEach(() => {
    return 42;
  });
};
`;
    expect(scan({ content: nested })).toEqual([]);
  });
});

describe("scanJsdocTags — a file-overview comment does not document the first export", () => {
  // The measured trap: ts.getJSDocCommentsAndTags credits this header to `isRecord`, so an earlier draft of
  // this scanner scored src/lib/parsers.ts as documented when the file's own header was all it had.
  const fileHeader = `/** Small type-narrowing predicates shared across the CLI spine. Pure: no I/O, no state. */

export function isRecord(value: unknown): boolean {
  return typeof value === "object";
}
`;

  it("reports the export as undocumented despite the header above it", () => {
    expect(kinds({ content: fileHeader })).toEqual(["no-block"]);
  });

  it("accepts the same block when no blank line separates it from the declaration", () => {
    const attached = `/**
 * Whether the value is a plain record.
 *
 * @param value the value to narrow
 * @returns true for a non-array object
 */
export function isRecord(value: unknown): boolean {
  return typeof value === "object";
}
`;
    expect(scan({ content: attached })).toEqual([]);
  });
});

describe("scanJsdocTags — what is in scope", () => {
  it("ignores a function that is not exported", () => {
    const internal = `
function helper({ a }: { a: string }): string {
  return a;
}
export const used = (): string => helper({ a: "x" });
`;
    // `used` is flagged for its own missing block; `helper` is invisible to the gate. Only `no-block` fires
    // for `used` — with no block there is nothing to check tags against, so the report stays one line.
    expect(scan({ content: internal }).map((defect) => defect.name)).toEqual(["used"]);
    expect(kinds({ content: internal })).toEqual(["no-block"]);
  });

  it("reads the block off the statement for an exported arrow constant", () => {
    const arrow = `
/**
 * The machine lane.
 *
 * @param document the thread to serialise
 * @returns one JSON document
 */
export const renderJson = ({ document }: { document: string }): string => document;
`;
    expect(scan({ content: arrow })).toEqual([]);
  });

  it("reports an arrow constant's stale tag, proving arrows are actually discovered", () => {
    // The positive test above stays green if arrow discovery were dropped entirely — the fixture would
    // simply be skipped. This asserts a DEFECT on an arrow, so the discovery branch is load-bearing.
    // (Omission is now allowed, so a genuinely undocumented arrow would report nothing either way — a STALE
    // tag is the one defect that can only fire if the arrow's real parameter list was actually read.)
    const staleArrow = `
/**
 * The machine lane.
 *
 * @param wrong not a real field
 * @returns one JSON document
 */
export const renderJson = ({ document }: { document: string }): string => document;
`;
    const flagged = scan({ content: staleArrow });
    expect(flagged.map((defect) => defect.detail)).toEqual(['@param "wrong" names no parameter (expected: document)']);
  });

  it("does NOT unwrap a call expression, whose RESULT is what gets exported", () => {
    // The boundary is "erases at runtime", not "has a child expression". Unwrapping a call would document the
    // factory instead of the export — and here the factory is not exported at all.
    const fromFactory = `
const makeFn = (): (() => number) => () => 42;

export const answer = makeFn();
`;
    expect(scan({ content: fromFactory })).toEqual([]);
  });

  it("sees through every type-erasing wrapper, not just the ones someone listed", () => {
    // Codex's seventh finding. `satisfies` is the construct .claude/rules/typescript-patterns.md tells people
    // to prefer, so a discovery check that only accepted a bare arrow had a hole in the common case.
    const wrapped = `
type Answer = () => number;
type Thunk = () => string;

export const viaSatisfies = ((): number => 42) satisfies Answer;
export const viaAs = ((): string => "x") as Thunk;
export const viaParens = ((): number => 1);
export const viaAngleBracket = <Answer>((): number => 2);
export const viaNonNull = (((): number => 3) as Answer)!;
`;
    expect(scan({ content: wrapped }).map((defect) => defect.name)).toEqual([
      "viaSatisfies",
      "viaAs",
      "viaParens",
      "viaAngleBracket",
      "viaNonNull",
    ]);
  });

  it("discovers EVERY export form, so dropping any one of them fails this test", () => {
    // One test covering the whole discovery surface. Each declaration below is undocumented, so removing any
    // branch of `exportedFunctions` shortens this list rather than silently skipping a fixture.
    const everyForm = `
export function plainDecl({ a }: { a: string }): string {
  return a;
}

export const arrowConst = ({ b }: { b: string }): string => b;

export const fnExpr = function ({ c }: { c: string }): string {
  return c;
};

export class Holder {
  public method({ d }: { d: string }): string {
    return d;
  }
}

export default function defaultDecl({ e }: { e: string }): string {
  return e;
}
`;
    expect(scan({ content: everyForm }).map((defect) => defect.name)).toEqual([
      "plainDecl",
      "arrowConst",
      "fnExpr",
      "Holder.method",
      "defaultDecl",
    ]);
  });

  it("gates a public method of an exported class but not its constructor", () => {
    const klass = `
/** Raised when a mention cannot be resolved. */
export class UnresolvedMentionError extends Error {
  constructor({ person }: { person: string }) {
    super(person);
  }

  public retryable({ roster }: { roster: string }): boolean {
    return roster.length > 0;
  }

  private hidden({ roster }: { roster: string }): boolean {
    return roster.length > 0;
  }
}
`;
    const flagged = scan({ content: klass });
    expect(flagged.map((defect) => defect.name)).toEqual(["UnresolvedMentionError.retryable"]);
    expect(flagged.map((defect) => defect.kind)).toEqual(["no-block"]);
  });

  it("gates a default-exported function", () => {
    // Export detection reads the statement's modifiers; `export default` carries BOTH keywords, so this
    // pins that the default form is not silently skipped.
    const defaulted = `
export default function main({ argv }: { argv: readonly string[] }): number {
  return argv.length;
}
`;
    expect(kinds({ content: defaulted })).toEqual(["no-block"]);
    expect(scan({ content: defaulted }).map((defect) => defect.name)).toEqual(["main"]);
  });

  it("ignores an overload signature and reads the implementation's block", () => {
    const overloaded = `
export function pick(a: string): string;
export function pick(a: number): number;
/**
 * Passthrough.
 *
 * @param a the input
 * @returns the input
 */
export function pick(a: string | number): string | number {
  return a;
}
`;
    expect(scan({ content: overloaded })).toEqual([]);
  });
});

describe("scanJsdocTags — a tag with no description is not documentation", () => {
  it("rejects the bare tags an autofixer would insert", () => {
    const bare = `
/**
 * Does the thing.
 *
 * @param a
 * @returns
 */
export function doIt({ a }: { a: string }): string {
  return a;
}
`;
    expect(kinds({ content: bare })).toEqual(["low-information-param", "blank-description"]);
  });

  it("rejects a block whose only content is tags, with no prose why", () => {
    const noProse = `
/**
 * @param a the input
 * @returns the output
 */
export function doIt({ a }: { a: string }): string {
  return a;
}
`;
    expect(kinds({ content: noProse })).toEqual(["no-description"]);
  });

  it("accepts @return as well as @returns, so the singular is not silently missing", () => {
    const singular = `
/**
 * Does the thing.
 *
 * @param a the input
 * @return the output
 */
export function doIt({ a }: { a: string }): string {
  return a;
}
`;
    expect(scan({ content: singular })).toEqual([]);
  });
});

describe("scanJsdocTags — zero-parameter exports", () => {
  it("needs only @returns", () => {
    const noParams = `
/**
 * The fixed CLI args.
 *
 * @returns the args, in order
 */
export function cliArgs(): readonly string[] {
  return ["-p"];
}
`;
    expect(scan({ content: noParams })).toEqual([]);
  });

  it("rejects a zero-parameter function that returns a value with no @returns", () => {
    // Falsifiability: the positive test above stays green if @returns enforcement were skipped for
    // zero-parameter functions specifically, so this asserts the negative case that pins it.
    const undocumented = `
/**
 * The fixed CLI args.
 */
export function cliArgs(): readonly string[] {
  return ["-p"];
}
`;
    expect(kinds({ content: undocumented })).toEqual(["missing-returns"]);
  });

  it("still rejects a leftover @param on a function that takes none", () => {
    const leftover = `
/**
 * The fixed CLI args.
 *
 * @param model the model to request
 * @returns the args, in order
 */
export function cliArgs(): readonly string[] {
  return ["-p"];
}
`;
    expect(kinds({ content: leftover })).toEqual(["stale-param"]);
  });
});

describe("isScannablePath", () => {
  it("takes TypeScript sources", () => {
    expect(isScannablePath({ path: "src/lib/parsers.ts" })).toBe(true);
  });

  it("takes a test-support module, which exports helpers like any other", () => {
    expect(isScannablePath({ path: "src/__tests__/tempGitRepo.ts" })).toBe(true);
  });

  it("skips a declaration file, which declares rather than implements", () => {
    expect(isScannablePath({ path: "stubs/sharp/index.d.ts" })).toBe(false);
  });

  it("skips a non-TypeScript file", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});
