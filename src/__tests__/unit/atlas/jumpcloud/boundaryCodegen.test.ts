import { describe, expect, it } from "vitest";

import { jumpcloudBoundarySource, jumpcloudUnroutedCensus } from "../../../../atlas/jumpcloud/boundaryCodegen.js";
import {
  type JumpcloudDeclaredCarrier,
  jumpcloudCarrierFromCensus,
  jumpcloudCarrierFromSpec,
} from "../../../../atlas/jumpcloud/carrierCodegen.js";
import { JumpcloudCodegenErrors } from "../../../../atlas/jumpcloud/codegenErrors.js";
import {
  type JumpcloudResponseCensus,
  type JumpcloudSurfaceCensus,
  observeJumpcloudAnswer,
} from "../../../../atlas/jumpcloud/responseCensus.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** The census one surface's answers produce. */
function censusOf({ answers }: { answers: readonly { status?: number; text: string }[] }): JumpcloudSurfaceCensus {
  const census: JumpcloudResponseCensus = {};
  for (const { status = 200, text } of answers) {
    observeJumpcloudAnswer({ census, status, surface: "s", text });
  }
  return census["s"]!;
}

const BARE: JumpcloudDeclaredCarrier = { kind: "bare-array" };

/** No document-valued paths, which is what every surface but the three named ones generates with. */
const NONE: ReadonlySet<string> = new Set();

/** Why a key the census recorded as `<unsafe>` is refused. */
const UNSAFE = "a key no path or schema can carry: path notation, empty, or an Object.prototype name";

/** The record an unmeasured collection or object declares. */
const UNMEASURED = "z.strictObject({ noRecordWasEverMeasuredHere: z.never() })";

describe("jumpcloudCarrierFromCensus", () => {
  it("reads each carrier from the envelopes measured", () => {
    const of = ({ text }: { text: string }) =>
      unwrap(jumpcloudCarrierFromCensus({ stat: censusOf({ answers: [{ text }] }), surface: "s" }));
    expect(of({ text: "[]" })).toEqual({ kind: "bare-array" });
    expect(of({ text: '{"results":[],"totalCount":0}' })).toEqual({ envelope: "results-total", kind: "wrapped" });
    expect(of({ text: '{"results":[]}' })).toEqual({ envelope: "results-only", kind: "wrapped" });
    expect(of({ text: '{"id":"x"}' })).toEqual({ kind: "single-object" });
    expect(of({ text: "" })).toEqual({ kind: "empty" });
  });

  it("answers null when no 2xx answer was measured", () => {
    const stat = censusOf({ answers: [{ status: 404, text: "{}" }] });
    expect(unwrap(jumpcloudCarrierFromCensus({ stat, surface: "s" }))).toBe(null);
  });

  it("refuses two carriers on one surface, naming both", () => {
    const stat = censusOf({ answers: [{ text: "[]" }, { text: '{"results":[]}' }] });
    const error = unwrapErr(jumpcloudCarrierFromCensus({ stat, surface: "s" }));
    expect(error.code).toBe("MIXED_CARRIER");
    expect(error.message).toBe("s: answered in 2 carriers (bare-array, wrapped results-only); a boundary declares one");
  });

  it("treats two single objects with different keys as one carrier", () => {
    const stat = censusOf({ answers: [{ text: '{"a":1}' }, { text: '{"b":1}' }] });
    expect(unwrap(jumpcloudCarrierFromCensus({ stat, surface: "s" }))).toEqual({ kind: "single-object" });
  });

  it("refuses a non-JSON 2xx answer rather than reading it as unmeasured, beside a JSON one too", () => {
    const alone = censusOf({ answers: [{ text: "-----BEGIN" }] });
    expect(unwrapErr(jumpcloudCarrierFromCensus({ stat: alone, surface: "s" }))).toEqual(
      JumpcloudCodegenErrors.nonJsonAnswer({ count: 1, surface: "s" }),
    );
    const beside = censusOf({ answers: [{ text: "[]" }, { text: "-----BEGIN" }] });
    expect(unwrapErr(jumpcloudCarrierFromCensus({ stat: beside, surface: "s" })).code).toBe("NON_JSON_ANSWER");
    expect(
      unwrapErr(
        jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat: alone, surface: "s" }),
      ).message,
    ).toBe("s: 1 2xx answer(s) were not JSON, which no carrier declares");
  });

  it("refuses a wrapped envelope whose keys were measured as a kind its carrier does not declare", () => {
    const stringTotal = censusOf({ answers: [{ text: '{"results":[{}],"totalCount":"0"}' }] });
    expect(unwrapErr(jumpcloudCarrierFromCensus({ stat: stringTotal, surface: "s" }))).toEqual(
      JumpcloudCodegenErrors.envelopeKind({
        declared: "number",
        key: "totalCount",
        measured: ["string"],
        surface: "s",
      }),
    );
    const objectResults = censusOf({ answers: [{ text: '{"results":{}}' }, { text: '{"results":[]}' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat: objectResults, surface: "s" }),
    );
    expect(error.message).toBe(
      's: the envelope\'s "results" was measured as array | object, where the wrapped carrier declares array',
    );
  });

  it("refuses a bare scalar root", () => {
    const error = unwrapErr(jumpcloudCarrierFromCensus({ stat: censusOf({ answers: [{ text: "3" }] }), surface: "s" }));
    expect(error.message).toBe("s: answered a bare number, which no carrier declares");
  });
});

describe("jumpcloudBoundarySource", () => {
  it("declares a key required only when every record carried it, and types it by every kind measured", () => {
    const stat = censusOf({
      answers: [{ text: '[{"id":"a","n":1,"tag":null},{"id":"b","tag":"x"}]' }],
    });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ id: z.string(), n: z.number().optional(), tag: z.string().nullable() }), surface: "s" })',
    );
  });

  it("declares a key only ever null as null, and an array only ever empty as never holding an item", () => {
    const stat = censusOf({ answers: [{ text: '{"results":[{"gone":null,"list":[]}],"totalCount":1}' }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe(
      'defineJumpcloudWrappedBoundary({ envelope: "results-total", item: z.strictObject({ gone: z.null(), list: z.array(z.never()) }), surface: "s" })',
    );
  });

  it("unions every kind a key was measured as, and nests objects and arrays", () => {
    const stat = censusOf({ answers: [{ text: '{"a":[{"b":true}],"c":1}' }, { text: '{"a":[],"c":"x"}' }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe(
      'defineJumpcloudObjectBoundary({ object: z.strictObject({ a: z.array(z.strictObject({ b: z.boolean() })), c: z.union([z.number(), z.string()]) }), surface: "s" })',
    );
  });

  it("declares a data-keyed map as a record whose keys hold to the shape measured, and quotes a non-identifier key", () => {
    const hash = "a".repeat(64);
    const stat = censusOf({ answers: [{ text: `[{"Agent Status":"ok","byHash":{"${hash}":{"n":1}}}]` }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ "Agent Status": z.string(), byHash: z.record(z.string().regex(/^[0-9a-f]{64}$/i), z.strictObject({ n: z.number() })) }), surface: "s" })',
    );
  });

  it("refuses a map whose keys took more than one data shape", () => {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const stat = censusOf({ answers: [{ text: `{"m":{"42":1,"${uuid}":2}}` }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe('s: keys of more than one data shape in one map at "m"');
  });

  it("refuses a map mixing data-shaped keys and field names", () => {
    const stat = censusOf({ answers: [{ text: '{"m":{"42":1,"name":"x"}}' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe('s: data-shaped keys beside field names at "m"');
  });

  it("refuses a key Object.prototype also carries, which defineBoundary would refuse at load", () => {
    const stat = censusOf({ answers: [{ text: '[{"constructor":1}]' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe(`s: ${UNSAFE} at "[]"`);
  });

  it("refuses a number too large for JSON to read back rather than declaring a number no answer of it passes", () => {
    const stat = censusOf({ answers: [{ text: '[{"n":1e400}]' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error).toEqual(JumpcloudCodegenErrors.nonFiniteNumber({ path: "[].n", surface: "s" }));
  });

  it("refuses a data-keyed map measured beside another kind rather than writing a union defineBoundary refuses", () => {
    const stat = censusOf({ answers: [{ text: '[{"m":{"42":1}},{"m":"x"}]' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe(
      's: a data-keyed map measured beside another kind, a union no boundary can tell apart at "[].m"',
    );
  });

  it("refuses a data-keyed map as the whole answer, which the object boundary cannot carry", () => {
    const stat = censusOf({ answers: [{ text: `{"${"a".repeat(64)}":1}` }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe('s: a data-keyed map as the whole answer, which an object boundary cannot carry at ""');
  });

  it("refuses a key the path notation cannot carry", () => {
    const stat = censusOf({ answers: [{ text: '{"a.b":1}' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe(`s: ${UNSAFE} at ""`);
  });

  it("refuses an empty key holding an object rather than recursing into the root's own path", () => {
    const stat = censusOf({ answers: [{ text: '{"":{"a":1}}' }] });
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" }),
    );
    expect(error.message).toBe(`s: ${UNSAFE} at ""`);
  });

  it("declares a collection measured only empty with a record that refuses the first to arrive", () => {
    const stat = censusOf({ answers: [{ text: "[]" }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe(`defineJumpcloudArrayBoundary({ item: ${UNMEASURED}, surface: "s" })`);
  });

  it("declares the empty carrier for a surface measured answering no body", () => {
    const stat = censusOf({ answers: [{ status: 204, text: "" }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat, surface: "s" })),
    ).toBe('defineJumpcloudEmptyBoundary({ surface: "s" })');
  });

  it("takes an unmeasured surface's carrier from the document, with a record that refuses the first to arrive", () => {
    const specCarrier = () => ok<JumpcloudDeclaredCarrier>({ kind: "single-object" });
    expect(unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier, stat: undefined, surface: "s" }))).toBe(
      `defineJumpcloudObjectBoundary({ object: ${UNMEASURED}, surface: "s" })`,
    );
    const refused = censusOf({ answers: [{ status: 404, text: "{}" }] });
    expect(
      unwrap(
        jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: () => ok(BARE), stat: refused, surface: "s" }),
      ),
    ).toBe(`defineJumpcloudArrayBoundary({ item: ${UNMEASURED}, surface: "s" })`);
  });

  it("reads the document only for an unmeasured surface, and refuses with its reason", () => {
    const unreadable = () => err(JumpcloudCodegenErrors.unreadableSpec({ surface: "s", why: "no response" }));
    const measured = censusOf({ answers: [{ text: "[]" }] });
    expect(
      unwrap(jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: unreadable, stat: measured, surface: "s" })),
    ).toBe(`defineJumpcloudArrayBoundary({ item: ${UNMEASURED}, surface: "s" })`);
    const error = unwrapErr(
      jumpcloudBoundarySource({ documentPaths: NONE, specCarrier: unreadable, stat: undefined, surface: "s" }),
    );
    expect(error.message).toBe("s: no carrier in the published document — no response");
  });
});

describe("jumpcloudUnroutedCensus", () => {
  it("refuses every entry filed under a name no paged surface carries, and passes one that is paged", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "<unmatched GET>", text: "3" });
    observeJumpcloudAnswer({ census, status: 200, surface: "<ambiguous a|b>", text: "[]" });
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: "[]" });
    expect(jumpcloudUnroutedCensus({ census, paged: new Set(["s"]) })).toEqual([
      JumpcloudCodegenErrors.unroutedAnswer({ surface: "<ambiguous a|b>" }),
      JumpcloudCodegenErrors.unroutedAnswer({ surface: "<unmatched GET>" }),
    ]);
    expect(jumpcloudUnroutedCensus({ census, paged: new Set(["s", "<unmatched GET>", "<ambiguous a|b>"]) })).toEqual(
      [],
    );
  });
});

describe("jumpcloudCarrierFromSpec", () => {
  it("reads each carrier the document can declare", () => {
    type Input = Omit<Parameters<typeof jumpcloudCarrierFromSpec>[0], "surface">;
    const of = (input: Input) => unwrap(jumpcloudCarrierFromSpec({ ...input, surface: "s" }));
    expect(of({ results: null, schema: null })).toEqual({ kind: "empty" });
    expect(of({ results: null, schema: { type: "array" } })).toEqual({ kind: "bare-array" });
    const totalled = { properties: { results: {}, totalCount: {} }, type: "object" };
    expect(of({ results: { type: "array" }, schema: totalled })).toEqual({
      envelope: "results-total",
      kind: "wrapped",
    });
    const untotalled = { properties: { results: {} } };
    expect(of({ results: { type: "array" }, schema: untotalled })).toEqual({
      envelope: "results-only",
      kind: "wrapped",
    });
    expect(of({ results: null, schema: { properties: { id: {} }, type: "object" } })).toEqual({
      kind: "single-object",
    });
  });

  it("refuses a response the document types as a scalar", () => {
    const error = unwrapErr(jumpcloudCarrierFromSpec({ results: null, schema: { type: "string" }, surface: "s" }));
    expect(error.message).toBe("s: no carrier in the published document — a string response");
  });
});
