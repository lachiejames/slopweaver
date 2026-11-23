import { describe, expect, it } from "vitest";

import {
  type DatadogOperationCensus,
  type DatadogResponseCensus,
  datadogCensusContradictions,
  observeDatadogAnswer,
  parseDatadogResponseCensus,
} from "../../../../atlas/datadog/responseCensus.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A fresh census run. */
function run(): DatadogResponseCensus {
  return { operations: {}, takenAt: "2026-10-23T00:00:00.000Z" };
}

describe("observeDatadogAnswer", () => {
  it("tallies statuses, roots and structure, and never a value", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: '{"data":[{"id":"secret-1"}]}' });
    observeDatadogAnswer({ census, status: 200, surface: "op", text: "[]" });
    observeDatadogAnswer({ census, status: 403, surface: "op", text: null });
    observeDatadogAnswer({ census, status: null, surface: "op", text: null });
    expect(census.operations["op"]).toEqual({
      objects: { "": 1, "data[]": 1 },
      paths: {
        data: { emptyArrays: 0, kinds: { array: 1 }, present: 1 },
        "data[]": { emptyArrays: 0, kinds: { object: 1 }, present: 1 },
        "data[].id": { emptyArrays: 0, kinds: { string: 1 }, present: 1 },
      },
      roots: { array: 1, object: 1 },
      statuses: { "200": 2, "403": 1, none: 1 },
    });
    expect(JSON.stringify(census)).not.toContain("secret-1");
  });

  it("counts an empty 2xx body and one that is not JSON apart from every JSON root", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 204, surface: "op", text: "  " });
    observeDatadogAnswer({ census, status: 200, surface: "op", text: "kind: yaml" });
    expect(census.operations["op"]!.roots).toEqual({ "empty-text": 1, "non-json": 1 });
  });

  it("counts a body that came with no 2xx by its status alone, never reading its structure", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 500, surface: "op", text: '{"id":"a"}' });
    observeDatadogAnswer({ census, status: 302, surface: "op", text: '{"id":"a"}' });
    expect(census.operations["op"]).toEqual({ objects: {}, paths: {}, roots: {}, statuses: { "302": 1, "500": 1 } });
  });

  it("files an operation named like an Object.prototype member as its own entry", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "constructor", text: "{}" });
    expect(census.operations["constructor"]!.statuses).toEqual({ "200": 1 });
  });
});

describe("datadogCensusContradictions", () => {
  /** One operation's tally after a run of answers. */
  function tallyOf({ answers }: { answers: readonly string[] }): DatadogOperationCensus {
    const census = run();
    for (const text of answers) {
      observeDatadogAnswer({ census, status: 200, surface: "op", text });
    }
    return census.operations["op"]!;
  }

  it("finds none in any tally a run writes, nested objects, arrays and an empty array included", () => {
    const answers = ['{"a":{"b":[{"c":1},{"c":null}]},"d":[]}', '[{"x":[[1]]}]', '{"a":{"1":0,"2":0,"a.b":1,"c.d":2}}'];
    expect(datadogCensusContradictions({ operation: tallyOf({ answers }) })).toEqual([]);
  });

  it("names a presence that is not the sum of its kinds", () => {
    const operation = tallyOf({ answers: ['{"n":1}'] });
    operation.paths["n"]!.present = 2;
    expect(datadogCensusContradictions({ operation })).toEqual([
      "n: present 2 times but its kinds count 1",
      "n: present on more objects than its parent counted",
    ]);
  });

  it.each([["constructor"], ["a.toString"], ["<nope>"], ["x[]y"]])(
    "names a raw key %s the walker records only under a placeholder",
    (key) => {
      const operation = tallyOf({ answers: ['{"a":{"b":1}}'] });
      operation.paths[key] = { emptyArrays: 0, kinds: { number: 1 }, present: 1 };
      expect(datadogCensusContradictions({ operation }).at(0)).toBe(
        `${key}: a key the census records only under a placeholder`,
      );
    },
  );

  it("names items under a path no array was counted at", () => {
    const operation = tallyOf({ answers: ['{"n":1}'] });
    operation.paths["n[]"] = { emptyArrays: 0, kinds: { number: 1 }, present: 1 };
    expect(datadogCensusContradictions({ operation })).toEqual(["n[]: items under a path no array was counted at"]);
  });

  it("names an object count that disagrees with the object kind at its path", () => {
    const operation = tallyOf({ answers: ['{"a":{"b":1}}'] });
    operation.objects["a"] = 2;
    expect(datadogCensusContradictions({ operation })).toEqual([
      "a: objects counted apart from the object kind counted there",
    ]);
  });

  it("names counts too large to add exactly, which would fold a measured omission away", () => {
    const operation = tallyOf({ answers: ['{"m":{"3f1c2b4e-8a9d-4c1e-9f2a-1b2c3d4e5f60":{"n":1}}}'] });
    operation.objects["m.<uuid>"] = 1e308;
    operation.paths["m.<uuid>"] = { emptyArrays: 0, kinds: { object: 1e308 }, present: 1e308 };
    operation.paths["m.<uuid>.n"] = { emptyArrays: 0, kinds: { number: 1e308 }, present: 1e308 };
    expect(datadogCensusContradictions({ operation })).toEqual([
      "(operation): counts summing past the largest integer a number holds exactly, which no fold reads",
    ]);
  });

  it("names a negative count that would cancel an oversized one out of the total", () => {
    const operation = tallyOf({ answers: ['{"m":{"3f1c2b4e-8a9d-4c1e-9f2a-1b2c3d4e5f60":{"n":"a"},"7":{"n":"b"}}}'] });
    operation.objects["m.<uuid>"] = 2 ** 53;
    operation.paths["m"]!.emptyArrays = -(2 ** 53) * 5;
    operation.paths["m.<uuid>"] = { emptyArrays: 0, kinds: { object: 2 ** 53 }, present: 2 ** 53 };
    operation.paths["m.<uuid>.n"] = { emptyArrays: 0, kinds: { string: 2 ** 53 - 1 }, present: 2 ** 53 - 1 };
    expect(datadogCensusContradictions({ operation })).toEqual([
      "(operation): counts summing past the largest integer a number holds exactly, which no fold reads",
    ]);
  });

  it("names structure counted for an operation that never answered 2xx", () => {
    const operation = tallyOf({ answers: ['{"id":"a"}'] });
    operation.statuses = { "500": 1 };
    expect(datadogCensusContradictions({ operation })).toEqual(["(operation): 1 roots counted against 0 2xx answers"]);
  });

  it("names more empty arrays than arrays counted at a path", () => {
    const operation = tallyOf({ answers: ['{"a":[]}'] });
    operation.paths["a"]!.emptyArrays = 2;
    expect(datadogCensusContradictions({ operation })).toEqual(["a: more empty arrays counted than arrays"]);
  });
});

describe("parseDatadogResponseCensus", () => {
  it("reads back exactly what a run wrote", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: '{"a":1}' });
    expect(unwrap(parseDatadogResponseCensus({ text: JSON.stringify(census) }))).toEqual(census);
  });

  it("refuses a file of any other shape, naming where it departs", () => {
    const errors = unwrapErr(parseDatadogResponseCensus({ text: '{"operations":{},"takenAt":"yesterday"}' }));
    expect(errors).toEqual(["takenAt: Invalid ISO datetime"]);
  });

  it("refuses a kind counted zero times, which would declare a kind no answer carried", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: '{"n":1}' });
    census.operations["op"]!.paths["n"]!.kinds = { number: 1, string: 0 };
    expect(unwrapErr(parseDatadogResponseCensus({ text: JSON.stringify(census) }))).toEqual([
      "operations.op.paths.n: a path present, or of a kind, zero times, or a count no run could write, which this census never writes",
    ]);
  });

  it("refuses a negative empty-array count, which no run writes", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: '{"n":[]}' });
    census.operations["op"]!.paths["n"]!.emptyArrays = -1;
    expect(unwrapErr(parseDatadogResponseCensus({ text: JSON.stringify(census) }))).toEqual([
      "operations.op.paths.n.emptyArrays: Too small: expected number to be >=0",
      "operations.op.paths.n: a path present, or of a kind, zero times, or a count no run could write, which this census never writes",
      "operations.op: (operation): counts summing past the largest integer a number holds exactly, which no fold reads",
    ]);
  });

  it("refuses a key no parent object was counted for, naming the contradiction", () => {
    const text = JSON.stringify({
      operations: {
        op: {
          objects: {},
          paths: { extra: { emptyArrays: 0, kinds: { boolean: 1 }, present: 1 } },
          roots: { object: 1 },
          statuses: { "200": 1 },
        },
      },
      takenAt: "2026-10-23T00:00:00.000Z",
    });
    expect(unwrapErr(parseDatadogResponseCensus({ text }))).toEqual([
      "operations.op: extra: present on more objects than its parent counted",
      "operations.op: (root): objects counted apart from the object kind counted there",
    ]);
  });

  it("refuses an object counted zero times, which would make a field required on no evidence", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: '{"n":1}' });
    census.operations["op"]!.objects[""] = 0;
    expect(unwrapErr(parseDatadogResponseCensus({ text: JSON.stringify(census) }))).toEqual([
      "operations.op.objects: a count of zero, a fraction or one too large to hold exactly, which this census never writes",
      "operations.op: n: present on more objects than its parent counted",
      "operations.op: (root): objects counted apart from the object kind counted there",
    ]);
  });

  it("refuses a root no answer can be counted as, which would be listed as lag no boundary admits", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: "1" });
    census.operations["op"]!.roots = { bogus: 1 };
    expect(unwrapErr(parseDatadogResponseCensus({ text: JSON.stringify(census) }))).toEqual([
      "operations.op.roots: a root this census never writes: neither a JSON kind, empty-text nor non-json",
    ]);
  });

  it("reads back an empty and a non-JSON root a run wrote", () => {
    const census = run();
    observeDatadogAnswer({ census, status: 200, surface: "op", text: "" });
    observeDatadogAnswer({ census, status: 200, surface: "op", text: "<html>" });
    expect(unwrap(parseDatadogResponseCensus({ text: JSON.stringify(census) })).operations["op"]!.roots).toEqual({
      "empty-text": 1,
      "non-json": 1,
    });
  });
});
