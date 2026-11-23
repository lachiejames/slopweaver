/**
 * JumpCloud's census around the shared walker: statuses, carriers and surface routing. The walker's own cases —
 * key placeholders, unsafe keys, the email shape, `@timestamp` — moved with it to
 * `src/__tests__/unit/atlas/kit/responseStructure.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { jumpcloudBoundarySource } from "../../../../atlas/jumpcloud/boundaryCodegen.js";
import {
  type JumpcloudResponseCensus,
  jumpcloudCensusSurfaceFor,
  mergeJumpcloudResponseCensuses,
  observeJumpcloudAnswer,
  parseJumpcloudResponseCensus,
} from "../../../../atlas/jumpcloud/responseCensus.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

describe("observeJumpcloudAnswer's unsafe keys", () => {
  it("files a __proto__ key as unsafe, so it can neither reach a prototype nor be declared a field", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: '[{"__proto__":"x"}]' });
    expect(Object.keys(census["s"]!.paths)).toEqual(["[]", "[].<unsafe>"]);
    expect(Object.getPrototypeOf(census["s"]!.paths)).toBe(Object.prototype);
  });

  it("counts keys Object.prototype also carries as unsafe, never as an entry already counted", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: '{"constructor":1,"toString":"x"}' });
    expect(census["s"]!.paths).toEqual({ "<unsafe>": { emptyArrays: 0, kinds: { number: 1, string: 1 }, present: 2 } });
  });

  it("files an answer for a surface named like an Object.prototype member under a name no surface carries", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "__proto__", text: "[]" });
    expect(Object.keys(census)).toEqual(["<unsafe __proto__>"]);
    expect(Object.getPrototypeOf(census)).toBe(Object.prototype);
  });
});

describe("observeJumpcloudAnswer", () => {
  it("tallies paths, kinds, presence and empty arrays across answers, never a value", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({
      census,
      status: 200,
      surface: "s",
      text: JSON.stringify({ results: [{ id: "x", tags: [] }, { id: null }], totalCount: 2 }),
    });
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: JSON.stringify({ results: [], totalCount: 0 }) });
    const stat = census["s"]!;
    expect(stat.responses).toBe(2);
    expect(stat.statuses).toEqual({ "200": 2 });
    expect(stat.envelopes).toEqual({ "object{results,totalCount}": 2 });
    expect(stat.objects).toEqual({ "": 2, "results[]": 2 });
    expect(stat.paths["results"]).toEqual({ emptyArrays: 1, kinds: { array: 2 }, present: 2 });
    expect(stat.paths["results[].id"]).toEqual({ emptyArrays: 0, kinds: { null: 1, string: 1 }, present: 2 });
    expect(stat.paths["results[].tags"]).toEqual({ emptyArrays: 1, kinds: { array: 1 }, present: 1 });
    expect(JSON.stringify(census)).not.toContain('"x"');
  });

  it("files a data-keyed map under its placeholder rather than as fields", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({
      census,
      status: 200,
      surface: "s",
      text: JSON.stringify({ byHash: { ["a".repeat(64)]: 1, ["b".repeat(64)]: 2 } }),
    });
    expect(Object.keys(census["s"]!.paths)).toEqual(["byHash", "byHash.<sha256>"]);
    expect(census["s"]!.paths["byHash.<sha256>"]!.present).toBe(2);
  });

  it("names a top-level data-shaped key in the envelope by its placeholder, never the key itself", () => {
    const census: JumpcloudResponseCensus = {};
    const text = JSON.stringify({ "alice@example.com": { n: 1 }, "bob@example.com": { n: 2 }, total: 2 });
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text });
    expect(census["s"]!.envelopes).toEqual({ "object{<email>,total}": 1 });
    expect(JSON.stringify(census)).not.toContain("example.com");
    expect(text).toContain("example.com");
  });

  it("counts a number too large for JSON to read back apart from a number", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: '[{"n":1e400},{"n":1}]' });
    expect(census["s"]!.paths["[].n"]!.kinds).toEqual({ "non-finite": 1, number: 1 });
  });

  it("records each carrier a 2xx answer arrived in", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: "[]" });
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: "[{}]" });
    observeJumpcloudAnswer({ census, status: 204, surface: "s", text: "  " });
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: "-----BEGIN" });
    expect(census["s"]!.envelopes).toEqual({ "bare-array": 1, "bare-array-empty": 1, "empty-text": 1 });
    expect(census["s"]!.nonJson).toBe(1);
  });

  it("counts a refused status and reads nothing of its body", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 403, surface: "s", text: JSON.stringify({ message: "no" }) });
    expect(census["s"]).toEqual({
      envelopes: {},
      nonJson: 0,
      objects: {},
      paths: {},
      responses: 1,
      statuses: { "403": 1 },
    });
  });
});

describe("parseJumpcloudResponseCensus", () => {
  it("reads back exactly the census this module wrote", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: JSON.stringify([{ id: "x", n: null }]) });
    const read = parseJumpcloudResponseCensus({ text: JSON.stringify(census) });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual(census);
  });

  it("refuses a file of another shape, naming where it departs, rather than declaring boundaries from it", () => {
    const census: JumpcloudResponseCensus = {};
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text: "[{}]" });
    const drifted = { s: { ...census["s"]!, extra: 1 } };
    const read = parseJumpcloudResponseCensus({ text: JSON.stringify(drifted) });
    expect(unwrapErr(read)).toEqual(['s: Unrecognized key: "extra"']);
  });

  it("refuses a negative count, which summed into the baseline would subtract a measurement", () => {
    const census = walkOf({ texts: ['[{"a":1}]'] });
    const negative = { s: { ...census["s"]!, objects: { "[]": -1 } } };
    const read = parseJumpcloudResponseCensus({ text: JSON.stringify(negative) });
    expect(unwrapErr(read)).toEqual(["s.objects.[]: Too small: expected number to be >=0"]);
  });

  it("refuses a named key counted on more objects than its parent had, which could tip an optional key required", () => {
    const census = walkOf({ texts: ['[{"a":1},{}]'] });
    const overcounted = {
      s: {
        ...census["s"]!,
        paths: { ...census["s"]!.paths, "[].a": { emptyArrays: 0, kinds: { number: 3 }, present: 3 } },
      },
    };
    const read = parseJumpcloudResponseCensus({ text: JSON.stringify(overcounted) });
    expect(unwrapErr(read)).toEqual(['s: "[].a" counted present 3 time(s) on 2 object(s)']);
  });

  it("accepts a placeholder key repeated within one object, which a real walk writes", () => {
    const census = walkOf({ texts: ['{"m":{"1":"x","2":"y"}}'] });
    expect(census["s"]!.paths["m.<int>"]!.present).toBe(2);
    expect(unwrap(parseJumpcloudResponseCensus({ text: JSON.stringify(census) }))).toEqual(census);
  });

  it("keeps every census out of the tree, since one describes a single tenant", () => {
    const generated = "src/atlas/jumpcloud/generated";
    expect(readdirSync(generated).filter((name) => name.endsWith(".json"))).toEqual([]);
    expect(readFileSync(`${generated}/responseBoundaries1.ts`, "utf8")).toContain(
      "from the structural censuses of a live tenant named\n * on its command line (never committed)",
    );
  });
});

describe("jumpcloudCensusSurfaceFor", () => {
  const surfaces = ["v2-get-workflow", "v2-list-workflow-runs"];

  it("files a request under the fitting row with the most literal segments, not the first match", () => {
    expect(
      jumpcloudCensusSurfaceFor({
        method: "GET",
        surfaces,
        url: "https://console.jumpcloud.com/api/v2/workflows/runs?limit=100&skip=0",
      }),
    ).toBe("v2-list-workflow-runs");
    expect(
      jumpcloudCensusSurfaceFor({ method: "GET", surfaces, url: "https://console.jumpcloud.com/api/v2/workflows/abc" }),
    ).toBe("v2-get-workflow");
  });

  it("files a request no paged surface fits under a name no surface carries", () => {
    expect(
      jumpcloudCensusSurfaceFor({
        method: "POST",
        surfaces,
        url: "https://console.jumpcloud.com/api/v2/workflows/abc",
      }),
    ).toBe("<unmatched POST>");
    expect(
      jumpcloudCensusSurfaceFor({ method: "GET", surfaces, url: "https://api.jumpcloud.com/api/v2/workflows/abc" }),
    ).toBe("<unmatched GET>");
  });
});

/** One census holding each answer, all 200s, under surface `s`. */
function walkOf({ texts }: { texts: readonly string[] }): JumpcloudResponseCensus {
  const census: JumpcloudResponseCensus = {};
  for (const text of texts) {
    observeJumpcloudAnswer({ census, status: 200, surface: "s", text });
  }
  return census;
}

/** The boundary source a census declares for surface `s`. */
function declared({ census }: { census: JumpcloudResponseCensus }): string {
  return unwrap(
    jumpcloudBoundarySource({
      documentPaths: new Set(),
      specCarrier: () => ok({ kind: "bare-array" }),
      stat: census["s"],
      surface: "s",
    }),
  );
}

describe("mergeJumpcloudResponseCensuses", () => {
  it("sums to exactly the census one walk over every answer would have taken", () => {
    const earlier = walkOf({ texts: ['[{"a":1,"b":"x"}]'] });
    const today = walkOf({ texts: ['[{"a":2}]', "[]"] });
    const once = walkOf({ texts: ['[{"a":1,"b":"x"}]', '[{"a":2}]', "[]"] });
    expect(unwrap(mergeJumpcloudResponseCensuses({ censuses: [earlier, today] }))).toEqual(once);
  });

  it("keeps a field only an earlier walk met, now optional, where today's walk alone drops it", () => {
    const earlier = walkOf({ texts: ['[{"id":"a","policy_name":"p"}]'] });
    const today = walkOf({ texts: ['[{"id":"b","device_id":"d"}]'] });
    expect(declared({ census: today })).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ device_id: z.string(), id: z.string() }), surface: "s" })',
    );
    expect(declared({ census: unwrap(mergeJumpcloudResponseCensuses({ censuses: [earlier, today] })) })).toBe(
      'defineJumpcloudArrayBoundary({ item: z.strictObject({ device_id: z.string().optional(), id: z.string(), policy_name: z.string().optional() }), surface: "s" })',
    );
  });

  it("keeps a surface only an earlier walk reached", () => {
    const earlier = walkOf({ texts: ['[{"id":"a"}]'] });
    const merged = unwrap(mergeJumpcloudResponseCensuses({ censuses: [earlier, {}] }));
    expect(merged).toEqual(earlier);
  });

  it("unions the kinds each walk measured at a key", () => {
    const merged = unwrap(
      mergeJumpcloudResponseCensuses({
        censuses: [walkOf({ texts: ['[{"n":1}]'] }), walkOf({ texts: ['[{"n":"one"}]'] })],
      }),
    );
    expect(merged["s"]!.paths["[].n"]).toEqual({ emptyArrays: 0, kinds: { number: 1, string: 1 }, present: 2 });
  });

  it("refuses a sum too large to hold exactly, where rounding would tip an optional key into required", () => {
    // 200 + n and 199 + n round to the same double for this n, so the one-object gap that keeps `[].a` optional is lost.
    const n = 9_007_199_254_740_989;
    const baseline = walkOf({ texts: [`[${'{"a":1},'.repeat(199)}{}]`] });
    const huge: JumpcloudResponseCensus = {
      s: {
        envelopes: {},
        nonJson: 0,
        objects: { "[]": n },
        paths: {
          "[]": { emptyArrays: 0, kinds: { object: n }, present: n },
          "[].a": { emptyArrays: 0, kinds: { number: n }, present: n },
        },
        responses: 0,
        statuses: {},
      },
    };
    // Each input alone is a census the generator accepts; only their sum is not.
    expect(unwrap(parseJumpcloudResponseCensus({ text: JSON.stringify(huge) }))).toEqual(huge);
    const tooBig = "Too big: expected int to be <=9007199254740991";
    expect(unwrapErr(mergeJumpcloudResponseCensuses({ censuses: [baseline, huge] }))).toEqual([
      `s.objects.[]: ${tooBig}`,
      `s.paths.[].kinds.object: ${tooBig}`,
      `s.paths.[].present: ${tooBig}`,
      `s.paths.[].a.kinds.number: ${tooBig}`,
      `s.paths.[].a.present: ${tooBig}`,
    ]);
  });

  it("changes neither input", () => {
    const earlier = walkOf({ texts: ['[{"a":1}]'] });
    const today = walkOf({ texts: ['[{"a":2}]'] });
    unwrap(mergeJumpcloudResponseCensuses({ censuses: [earlier, today] }));
    expect(earlier).toEqual(walkOf({ texts: ['[{"a":1}]'] }));
    expect(today).toEqual(walkOf({ texts: ['[{"a":2}]'] }));
  });
});
