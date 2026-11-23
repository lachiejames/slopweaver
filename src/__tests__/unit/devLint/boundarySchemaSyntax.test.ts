/**
 * The parser reads behind `boundary-schema`, each pinned on its own: a fetch and a JSON read are calls on the
 * syntax tree whatever surrounds their name, a `defineBoundary` counts only as a real call, and a
 * `Boundary`-annotated receiver earns its `.parseJson` licence.
 */
import { describe, expect, it } from "vitest";

import {
  callsFetch,
  declaresBoundary,
  readsJsonByCall,
  unlicensedMemberParse,
  withParsedSource,
} from "../../../devLint/boundarySchemaSyntax.js";

const PATH = "src/atlas/vanta/client.ts";
const LICENSED_IMPORT = 'import type { Boundary } from "#lib/boundary.js";';

/** {@link callsFetch} over one snippet. */
const fetches = ({ content }: { content: string }): boolean =>
  withParsedSource({ content, use: (source) => callsFetch({ source }) });
/** {@link readsJsonByCall} over one snippet. */
const readsJson = ({ content }: { content: string }): boolean =>
  withParsedSource({ content, use: (source) => readsJsonByCall({ source }) });
/** {@link declaresBoundary} over one snippet. */
const declares = ({ content }: { content: string }): boolean =>
  withParsedSource({ content, use: (source) => declaresBoundary({ source }) });

describe("callsFetch", () => {
  it("is true of every fetch spelling the criterion names", () => {
    expect(fetches({ content: "fetch(url);" })).toBe(true);
    expect(fetches({ content: "globalThis.fetch(url);" })).toBe(true);
    expect(fetches({ content: "raw.requestRawTextWithStatus({ path });" })).toBe(true);
    expect(fetches({ content: "this.transport.request({ path });" })).toBe(true);
  });

  it("is true however the call is spelled around its name", () => {
    expect(fetches({ content: "transport\n  .request({ path });" })).toBe(true);
    expect(fetches({ content: "transport.request /* why */ ({ path });" })).toBe(true);
    expect(fetches({ content: "deps.transport?.request({ path });" })).toBe(true);
    expect(fetches({ content: "deps.transport!.request({ path });" })).toBe(true);
    expect(fetches({ content: "transport.request<() => Raw>({ path });" })).toBe(true);
  });

  it("is true however the RECEIVER is wrapped, since a wrapped receiver is still the transport", () => {
    expect(fetches({ content: "(transport!).request({ path });" })).toBe(true);
    expect(fetches({ content: "(deps.transport as Transport).request({ path });" })).toBe(true);
    expect(fetches({ content: "(transport satisfies Transport)!.request({ path });" })).toBe(true);
  });

  it("is true of a member whose name ends in fetch after a non-word character, as main's look-behind counted", () => {
    expect(fetches({ content: "client.$fetch(url);" })).toBe(true);
  });

  it("is true however the CALLEE is wrapped, a non-null method included", () => {
    expect(fetches({ content: "transport.request!({ path });" })).toBe(true);
    expect(fetches({ content: "(transport.request as Send)({ path });" })).toBe(true);
    expect(fetches({ content: "(fetch)(url);" })).toBe(true);
    expect(fetches({ content: "(0, transport.request)({ path });" })).toBe(true);
  });

  it("is false of a mention, another object's fetch, and the stated residue", () => {
    expect(fetches({ content: "// transport.request({ path })" })).toBe(false);
    expect(fetches({ content: 'const s = "fetch(url)";' })).toBe(false);
    expect(fetches({ content: "client.fetch(url);" })).toBe(false);
    expect(fetches({ content: "(client.fetch)(url);" })).toBe(false);
    expect(fetches({ content: 'transport["request"]({ path });' })).toBe(false);
  });
});

describe("readsJsonByCall", () => {
  it("is true of every JSON read the criterion names, typed or not", () => {
    expect(readsJson({ content: "await response.json();" })).toBe(true);
    expect(readsJson({ content: "JSON.parse(text);" })).toBe(true);
    expect(readsJson({ content: "parseJson<\n  Payload\n>(text);" })).toBe(true);
    expect(readsJson({ content: "lib.safeJsonParse<Record<string, (a: A) => B>>({ text });" })).toBe(true);
    expect(readsJson({ content: 'import * as parse from "../lib/jsonParse.js";' })).toBe(true);
  });

  it("is true of every read main's word boundaries counted on a member or prefixed name", () => {
    expect(readsJson({ content: "parser.$parseJson(text);" })).toBe(true);
    expect(readsJson({ content: "$JSON.parse(text);" })).toBe(true);
    expect(readsJson({ content: "globalThis.JSON.parse(text);" })).toBe(true);
  });

  it("is true of a read whose callee is instantiated, then wrapped", () => {
    expect(readsJson({ content: "(parseJson<Payload>)(text);" })).toBe(true);
    expect(readsJson({ content: "(lib.safeJsonParse<Payload>)!({ text });" })).toBe(true);
  });

  it("is false of a member parseJson, a json call with arguments, and a mention", () => {
    expect(readsJson({ content: "boundary.parseJson({ text });" })).toBe(false);
    expect(readsJson({ content: "reply.json(body);" })).toBe(false);
    expect(readsJson({ content: "// JSON.parse(text)" })).toBe(false);
  });
});

describe("declaresBoundary", () => {
  it("is true of a bare call and of a namespace-member call", () => {
    expect(declares({ content: "const B = defineBoundary({ endpoint, schema });" })).toBe(true);
    expect(declares({ content: "const B = lib.defineBoundary({ endpoint, schema });" })).toBe(true);
  });

  it("is false of a comment, a string and an uncalled reference naming it", () => {
    expect(declares({ content: "// defineBoundary({ endpoint, schema })" })).toBe(false);
    expect(declares({ content: 'const s = "defineBoundary(";' })).toBe(false);
    expect(declares({ content: "const f = defineBoundary;" })).toBe(false);
  });
});

describe("unlicensedMemberParse", () => {
  /** {@link unlicensedMemberParse} over one snippet at {@link PATH}. */
  const unlicensed = ({ content }: { content: string }): boolean =>
    withParsedSource({ content, use: (source) => unlicensedMemberParse({ path: PATH, source }) });

  it("is false of a file with no parseJson in it", () => {
    expect(unlicensed({ content: "JSON.parse(text);" })).toBe(false);
  });

  it("is true of a parseJson on a receiver that is not a Boundary", () => {
    expect(unlicensed({ content: "parser.parseJson({ text });" })).toBe(true);
  });

  it("is false of a const annotated with the boundary module's Boundary", () => {
    expect(unlicensed({ content: `${LICENSED_IMPORT}\nconst b: Boundary<T> = given;\nb.parseJson({ text });` })).toBe(
      false,
    );
  });

  it("is true when the Boundary import resolves to a module other than src/lib/boundary.js", () => {
    const content =
      'import type { Boundary } from "./boundary.js";\nconst b: Boundary<T> = given;\nb.parseJson({ text });';
    expect(unlicensed({ content })).toBe(true);
  });

  it("is true when anything assigns to the licensed name", () => {
    const content = `${LICENSED_IMPORT}\nconst b: Boundary<T> = given;\n({ b } = other);\nb.parseJson({ text });`;
    expect(unlicensed({ content })).toBe(true);
  });
});
