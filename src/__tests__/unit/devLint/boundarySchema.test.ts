/**
 * `boundary-schema`: a source that fetches and reads JSON owes a `defineBoundary`, a plain rule with no debt list.
 *
 * deleted-with-code: judgeBoundaryDebt, BOUNDARY_SCHEMA_DEBT
 */
import { describe, expect, it } from "vitest";

import { owesBoundary } from "../../../devLint/boundarySchema.js";

/** Where every fixture sits, so a relative import of the boundary module resolves to src/lib/boundary.js. */
const CLIENT_PATH = "src/datadog/client.ts";

const CLIENT = ["const response = await fetch(url);", "const body = await response.json();"].join("\n");

describe("owesBoundary", () => {
  it("fires on a bare fetch whose body is read as JSON", () => {
    expect(owesBoundary({ path: CLIENT_PATH, content: CLIENT })).toBe(true);
    expect(
      owesBoundary({ path: CLIENT_PATH, content: "const r = await globalThis.fetch(u);\nJSON.parse(await r.text());" }),
    ).toBe(true);
  });

  it("is satisfied by a declared boundary", () => {
    expect(
      owesBoundary({ path: CLIENT_PATH, content: `${CLIENT}\nconst B = defineBoundary({ endpoint, schema });` }),
    ).toBe(false);
  });

  it("ignores a fetch whose body is never read as JSON, and a method that happens to be called fetch", () => {
    expect(owesBoundary({ path: CLIENT_PATH, content: "const r = await fetch(url);\nreturn r.status;" })).toBe(false);
    expect(owesBoundary({ path: CLIENT_PATH, content: "await client.fetch(url);\nJSON.parse(text);" })).toBe(false);
  });

  it("ignores the calls when they appear only in comments", () => {
    expect(
      owesBoundary({ path: CLIENT_PATH, content: "// await fetch(url)\n * response.json()\nexport const x = 1;" }),
    ).toBe(false);
    // Every call is read off the syntax tree, so one named only in a TRAILING comment is not a read — main's
    // line-based strip kept that comment and fired on it.
    const trailing = "const r = await fetch(url); // parser.parseJson({ text });";
    expect(owesBoundary({ path: CLIENT_PATH, content: trailing })).toBe(false);
    expect(owesBoundary({ path: CLIENT_PATH, content: `${trailing}\nparser.parseJson({ text });` })).toBe(true);
  });

  it("fires on the Datadog raw-text transport whose text is parsed as JSON, so a split fetch stays visible", () => {
    const split = [
      "const answered = await transport.requestRawTextWithStatus({ method, path });",
      "const body = parseJson({ text: answered.value.bodyText });",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: split })).toBe(true);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: "await transport.requestRawText({ method, path });\nJSON.parse(text);",
      }),
    ).toBe(true);
  });

  it("leaves a raw-text read alone when nothing parses it, or when a boundary is declared", () => {
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: "const r = await transport.requestRawText({ method, path });\nout(r.bodyText);",
      }),
    ).toBe(false);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content:
          "await transport.requestRawTextWithStatus(input);\nparseJson({ text });\ndefineBoundary({ endpoint, schema });",
      }),
    ).toBe(false);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: "// transport.requestRawText(input)\n * parseJson({ text })\nexport const x = 1;",
      }),
    ).toBe(false);
  });

  it("fires on a bound transport.request whose body is parsed as JSON — the Vanta transport's spelling", () => {
    const VANTA_PATH = "src/atlas/vanta/oauth.ts";
    const raw = "const response = await transport.request({ body, method, path });";
    expect(owesBoundary({ content: `${raw}\nJSON.parse(response.value.body);`, path: VANTA_PATH })).toBe(true);
    expect(
      owesBoundary({ content: `${raw}\nparser.parseJson({ text: response.value.body });`, path: VANTA_PATH }),
    ).toBe(true);
    expect(owesBoundary({ content: `${raw}\nreturn response.value.status;`, path: VANTA_PATH })).toBe(false);
    // A free read handed explicit type arguments is still the read, nested generics included.
    const generic = `${raw}\nconst body = parseJson<Payload>(response.value.body);`;
    expect(owesBoundary({ content: generic, path: VANTA_PATH })).toBe(true);
    const nested = `${raw}\nconst body = safeJsonParse<Record<string, Payload>>({ text: response.value.body });`;
    expect(owesBoundary({ content: nested, path: VANTA_PATH })).toBe(true);
    // An optional-chained transport and a typed request are the same call.
    const optional = "const response = await deps.transport?.request({ path });\nJSON.parse(response.value.body);";
    expect(owesBoundary({ content: optional, path: VANTA_PATH })).toBe(true);
    const typed = "const response = await transport.request<Raw>({ path });\nJSON.parse(response.value.body);";
    expect(owesBoundary({ content: typed, path: VANTA_PATH })).toBe(true);
    // A type argument may hold parentheses of its own, which no lexical match survives.
    const fnTyped = "const response = await transport.request<() => Raw>({ path });\nJSON.parse(response.value.body);";
    expect(owesBoundary({ content: fnTyped, path: VANTA_PATH })).toBe(true);
    // Prettier wraps long type arguments over lines.
    const wrapped = `${raw}\nconst body = parseJson<\n  Payload\n>(response.value.body);`;
    expect(owesBoundary({ content: wrapped, path: VANTA_PATH })).toBe(true);
    // Prettier breaks a long chain before its member, so the call spans two lines.
    const broken = "const response = await transport\n  .request({ method, path });\nJSON.parse(response.value.body);";
    expect(broken.split("\n").some((line) => /transport\s*\.\s*request/.test(line))).toBe(false);
    expect(owesBoundary({ content: broken, path: VANTA_PATH })).toBe(true);
    // A declaration is a real call on the syntax tree: a trailing TODO or a string naming it declares nothing.
    // The namespace-member spelling is a real call.
    // A block comment opening the line hides nothing after it closes, and a comment after an emoji
    // still blanks only itself.
    const afterBlock = `/* istanbul ignore next */ ${raw}\nJSON.parse(response.value.body);`;
    expect(owesBoundary({ content: afterBlock, path: VANTA_PATH })).toBe(true);
    // A comment INSIDE the call splits the raw spelling, so no prefilter may judge the unblanked text.
    const inside = "const response = await transport.request /* why */ ({ path });\nJSON.parse(response.value.body);";
    expect(owesBoundary({ content: inside, path: VANTA_PATH })).toBe(true);
    // Counted in code points, the blank would land one unit late and swallow the `f` the comment abuts.
    const emoji = 'const label = "🦊"; /* note */fetch(url).then((r) => r.json());';
    expect(owesBoundary({ content: emoji, path: VANTA_PATH })).toBe(true);
    const unvalidated = `${raw}\nconst body = JSON.parse(response.value.body);`;
    const todo = `${unvalidated} // TODO: replace with defineBoundary({ endpoint, schema })`;
    expect(owesBoundary({ content: todo, path: VANTA_PATH })).toBe(true);
    expect(owesBoundary({ content: `${unvalidated}\nconst s = "defineBoundary(";`, path: VANTA_PATH })).toBe(true);
    expect(
      owesBoundary({
        content: `${unvalidated}\nconst B = lib.defineBoundary({ endpoint, schema });`,
        path: VANTA_PATH,
      }),
    ).toBe(false);
    expect(
      owesBoundary({
        content: `${raw}\nJSON.parse(response.value.body);\nconst B = defineBoundary({ endpoint, schema });`,
        path: VANTA_PATH,
      }),
    ).toBe(false);
    const licensed = [
      'import type { Boundary } from "#lib/boundary.js";',
      "export function read<T>(input: { boundary: Boundary<T> }) {",
      "  // Annotated, not destructured.",
      "  const boundary: Boundary<T> = input.boundary;",
      `  ${raw}`,
      "  return boundary.parseJson({ text: response.value.body });",
      "}",
    ].join("\n");
    expect(owesBoundary({ content: licensed, path: VANTA_PATH })).toBe(false);
    // A destructured `boundary` carries no annotation of its own, so it licenses nothing.
    const destructured = licensed.replace(
      "const boundary: Boundary<T> = input.boundary;",
      "const { boundary } = input;",
    );
    expect(destructured).toContain("const { boundary } = input;");
    expect(owesBoundary({ content: destructured, path: VANTA_PATH })).toBe(true);
  });

  it("reads a parseJson member call as the compliant read only when that receiver is declared Boundary-typed", () => {
    const body = [
      "async function read<T>(input: RawRequest<T>) {",
      "  const boundary: Boundary<T> = input.boundary;",
      "  const answered = await transport.requestRawTextWithStatus({ body, method, path });",
      "  return boundary.parseJson({ text: answered.value.bodyText });",
      "}",
    ];
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: ['import type { Boundary } from "#lib/boundary.js";', ...body].join("\n"),
      }),
    ).toBe(false);
    const wrapped = ["import {", "  type Boundary,", "  BoundaryErrors,", '} from "../lib/boundary.js";', ...body];
    expect(owesBoundary({ path: CLIENT_PATH, content: wrapped.join("\n") })).toBe(false);
    // The declaration without the import licenses nothing: a local type named Boundary is not the module's.
    expect(owesBoundary({ path: CLIENT_PATH, content: body.join("\n") })).toBe(true);
  });

  it("trusts only an import that resolves to src/lib/boundary.js, never another module named boundary.js (Codex)", () => {
    const body = [
      "export async function read(url: string, parser: Boundary<unknown>) {",
      "  const response = await fetch(url);",
      "  return parser.parseJson({ text: await response.text() });",
      "}",
    ];
    const from = ({ specifier }: { specifier: string }): string =>
      [`import type { Boundary } from "${specifier}";`, ...body].join("\n");
    expect(owesBoundary({ content: from({ specifier: "../lib/boundary.js" }), path: CLIENT_PATH })).toBe(false);
    expect(owesBoundary({ content: from({ specifier: "#lib/boundary.js" }), path: CLIENT_PATH })).toBe(false);
    expect(owesBoundary({ content: from({ specifier: "./fake/boundary.js" }), path: CLIENT_PATH })).toBe(true);
    expect(owesBoundary({ content: from({ specifier: "./boundary.js" }), path: CLIENT_PATH })).toBe(true);
    expect(owesBoundary({ content: from({ specifier: "some-package/boundary.js" }), path: CLIENT_PATH })).toBe(true);
    expect(owesBoundary({ content: from({ specifier: "./boundary.js" }), path: "src/lib/client.ts" })).toBe(false);
  });

  it("fires when Boundary is imported only as a marker, a counterexample", () => {
    const content = [
      'import type { Boundary } from "#lib/boundary.js";',
      "export type Marker = Boundary<unknown>;",
      "const response = await fetch(url);",
      "return parser.parseJson({ text: await response.text() });",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content })).toBe(true);
  });

  it("resolves the receiver to its nearest declaration, so an outer Boundary cannot license an inner parser", () => {
    const shadowed = [
      'import type { Boundary } from "#lib/boundary.js";',
      'import type { Parser } from "./permissiveParser.js";',
      "declare const parser: Boundary<unknown>;",
      "async function read(url: string, parser: Parser) {",
      "  const response = await fetch(url);",
      "  return parser.parseJson({ text: await response.text() });",
      "}",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: shadowed })).toBe(true);
    const parameter = shadowed.replace("parser: Parser)", "parser: Boundary<unknown>)");
    expect(owesBoundary({ path: CLIENT_PATH, content: parameter })).toBe(false);
  });

  it("reads a switch's clauses as one scope, so a sibling case's declaration shadows the outer Boundary (Codex)", () => {
    const shadowed = [
      'import type { Boundary } from "#lib/boundary.js";',
      "async function read(url: string, boundary: Boundary<unknown>, parser: Parser, mode: number) {",
      "  const response = await fetch(url);",
      "  switch (mode) {",
      "    case 0:",
      "      const boundary: Parser = parser;",
      "      return readBody();",
      "    case 1:",
      "      async function readBody() { return boundary.parseJson({ text: await response.text() }); }",
      "  }",
      "}",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: shadowed })).toBe(true);
    expect(
      owesBoundary({ path: CLIENT_PATH, content: shadowed.replace("const boundary: Parser = parser;", "break;") }),
    ).toBe(false);
  });

  it("fires when the name is bound to anything else in any scope, a var hoisted into a static block included (Codex)", () => {
    const hoisted = [
      'import type { Boundary } from "#lib/boundary.js";',
      'import { parser } from "./permissiveParser.js";',
      "declare const strict: Boundary<unknown>;",
      "const boundary: Boundary<unknown> = strict;",
      "class Reader {",
      "  static {",
      "    { var boundary = parser; }",
      "    fetch(url).then(async (response) => boundary.parseJson({ text: await response.text() }));",
      "  }",
      "}",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: hoisted })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: hoisted.replace("{ var boundary = parser; }", "") })).toBe(false);
    // A binding in an unrelated scope withdraws the licence too: over-strict on purpose, never under.
    const elsewhere = `${hoisted.replace("{ var boundary = parser; }", "")}\nfunction other(boundary: Parser) {}`;
    expect(owesBoundary({ path: CLIENT_PATH, content: elsewhere })).toBe(true);
  });

  it("fires when the Boundary-typed name is reassigned, destructured, a let, or its type name is redeclared", () => {
    const head = 'import type { Boundary } from "#lib/boundary.js";\nawait fetch(url);';
    const read = "boundary.parseJson({ text });";
    expect(owesBoundary({ path: CLIENT_PATH, content: `${head}\nconst boundary: Boundary<X> = b;\n${read}` })).toBe(
      false,
    );
    expect(owesBoundary({ path: CLIENT_PATH, content: `${head}\nlet boundary: Boundary<X> = b;\n${read}` })).toBe(true);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: `${head}\nfunction f(boundary: Boundary<X>) { boundary = p; ${read} }`,
      }),
    ).toBe(true);
    // A destructuring assignment replaces the parameter without a plain `boundary =`.
    const destructured = ({ target }: { target: string }): string =>
      `${head}\nfunction f(boundary: Boundary<X>) { ${target}; ${read} }`;
    expect(owesBoundary({ path: CLIENT_PATH, content: destructured({ target: "[boundary] = [p]" }) })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: destructured({ target: "({ x: boundary } = o)" }) })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: destructured({ target: "for (boundary of parsers) {}" }) })).toBe(
      true,
    );
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: `${head}\nconst { boundary }: { boundary: Boundary<X> } = b;\n${read}`,
      }),
    ).toBe(true);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: `${head}\ntype Boundary<T> = Parser<T>;\nconst boundary: Boundary<X> = b;\n${read}`,
      }),
    ).toBe(true);
    expect(
      owesBoundary({
        path: CLIENT_PATH,
        content: `${head}\nconst boundary: Boundary<X> = b;\nfunction f() { { var boundary = p; } ${read} }`,
      }),
    ).toBe(true);
  });

  it("fires on a parseJson member call whose receiver is an index or a call, which no declaration can license", () => {
    const head =
      'import type { Boundary } from "#lib/boundary.js";\nconst boundary: Boundary<X> = b;\nawait fetch(url);';
    expect(owesBoundary({ path: CLIENT_PATH, content: `${head}\nPARSERS[name].parseJson({ text });` })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: `${head}\nmakeParser().parseJson({ text });` })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: `${head}\nboundary.parseJson({ text });` })).toBe(false);
  });

  it("fires on a hand-written parser's parseJson member call, a counterexample", () => {
    const content = [
      'import { parser } from "./parser.js";',
      'const r = await transport.requestRawText({ method: "GET", path: "/p" });',
      "const body = parser.parseJson({ text: r.value.bodyText });",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: "await fetch(url);\nhelpers.safeJsonParse({ text });" })).toBe(
      true,
    );
    // A free parser whose name merely ENDS in parseJson still fires, exactly as main's \bparseJson did.
    const dollar = 'import { $parseJson } from "./json.js";\nconst r = await fetch(url);\n$parseJson(await r.text());';
    expect(owesBoundary({ path: CLIENT_PATH, content: dollar })).toBe(true);
    // A MEMBER so named fires too: main's (?<![.\w]) look-behind saw the `$`, not the dot.
    const member = "const response = await fetch(url);\nparser.$parseJson(await response.text());";
    expect(owesBoundary({ path: CLIENT_PATH, content: member })).toBe(true);
    // Not only a call: a constructed or aliased member reaches the same parser.
    const fetched = 'import { parser } from "./parser.js";\nconst response = await fetch(url);';
    const constructed = `${fetched}\nconst body = new parser.parseJson({ text: await response.text() });`;
    expect(owesBoundary({ path: CLIENT_PATH, content: constructed })).toBe(true);
    const aliased = `${fetched}\nconst read = parser.parseJson;\nconst body = read({ text: await response.text() });`;
    expect(owesBoundary({ path: CLIENT_PATH, content: aliased })).toBe(true);
  });

  it("still fires when the parse helpers arrive through a namespace import, so a member call cannot hide one", () => {
    const hidden = [
      'import * as json from "#lib/jsonParse.js";',
      "const answered = await fetch(url);",
      "const body = json.parseJson({ text: await answered.text() });",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: hidden })).toBe(true);
    const safe = 'import * as s from "../lib/safeJson.js";\nawait fetch(url);\ns.safeJsonParse({ text });';
    expect(owesBoundary({ path: CLIENT_PATH, content: safe })).toBe(true);
  });

  it("trusts the compiler's word, so a user-defined type predicate is the stated residue", () => {
    const predicate = [
      'import type { Boundary } from "#lib/boundary.js";',
      'import { permissiveParser } from "./permissiveParser.js";',
      "function isBoundary(value: unknown): value is Boundary<unknown> { return value === permissiveParser; }",
      "const candidate: unknown = permissiveParser;",
      'if (!isBoundary(candidate)) throw new Error("unreachable");',
      "const boundary: Boundary<unknown> = candidate;",
      "const response = await fetch(url);",
      "boundary.parseJson({ text: await response.text() });",
    ].join("\n");
    expect(owesBoundary({ path: CLIENT_PATH, content: predicate })).toBe(false);
  });

  it("sees through a wrapped callee, while an aliased or computed one is stated residue (Codex)", () => {
    const read = 'import { parseJson } from "#lib/jsonParse.js";\nparseJson({ text: await response.text() });';
    expect(owesBoundary({ path: CLIENT_PATH, content: `const response = await fetch(url);\n${read}` })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: `const response = await (fetch)(url);\n${read}` })).toBe(true);
    expect(
      owesBoundary({ path: CLIENT_PATH, content: `const get = fetch;\nconst response = await get(url);\n${read}` }),
    ).toBe(false);
    expect(
      owesBoundary({ path: CLIENT_PATH, content: "const response = await fetch(url);\nawait response.json();" }),
    ).toBe(true);
    expect(
      owesBoundary({ path: CLIENT_PATH, content: 'const response = await fetch(url);\nawait response["json"]();' }),
    ).toBe(false);
  });

  it("fires on a unicode-escaped fetch, whose text names neither prefilter word", () => {
    const escaped = String.raw`const response = await fetch(url);` + "\nconst body = await response.json();";
    expect(owesBoundary({ path: CLIENT_PATH, content: escaped })).toBe(true);
    expect(owesBoundary({ path: CLIENT_PATH, content: String.raw`const x = "A";` })).toBe(false);
  });
});
