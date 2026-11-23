import { describe, expect, it } from "vitest";

import {
  isPrototypeName,
  observeResponseStructure,
  type ResponseStructure,
  responseCensusKey,
  responseCensusKeyShape,
  responseJsonKind,
} from "../../../../atlas/kit/responseStructure.js";

describe("responseCensusKey", () => {
  it("records each data-shaped key under its placeholder", () => {
    expect(responseCensusKey({ key: "5f0c1d2e3a4b5c6d7e8f9a0b" })).toBe("<objectid>");
    expect(responseCensusKey({ key: "0b9a8c7d-1234-4abc-9def-0123456789ab" })).toBe("<uuid>");
    expect(responseCensusKey({ key: "a".repeat(64) })).toBe("<sha256>");
    expect(responseCensusKey({ key: "someone@example.com" })).toBe("<email>");
    expect(responseCensusKey({ key: "42" })).toBe("<int>");
  });

  it("records a key the path notation cannot carry as unsafe", () => {
    expect(responseCensusKey({ key: "a.b" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "list[]" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "<int>" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "__proto__" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "constructor" })).toBe("<unsafe>");
    expect(responseCensusKey({ key: "toString" })).toBe("<unsafe>");
  });

  it("does not take a domain with no dot after its first label for an email", () => {
    expect(responseCensusKey({ key: "someone@localhost" })).toBe("someone@localhost");
    expect(responseCensusKey({ key: "a@b.c.d" })).toBe("<email>");
  });

  it("keeps a field name, @timestamp included, as itself", () => {
    expect(responseCensusKey({ key: "@timestamp" })).toBe("@timestamp");
    expect(responseCensusKey({ key: "Agent Status" })).toBe("Agent Status");
    expect(responseCensusKey({ key: "totalCount" })).toBe("totalCount");
  });
});

describe("isPrototypeName", () => {
  it("answers for a name Object.prototype carries, and not for an ordinary one", () => {
    expect(isPrototypeName({ name: "constructor" })).toBe(true);
    expect(isPrototypeName({ name: "__proto__" })).toBe(true);
    expect(isPrototypeName({ name: "s" })).toBe(false);
  });
});

describe("responseCensusKeyShape", () => {
  it("answers the shape a placeholder's keys matched, and nothing for unsafe or a field name", () => {
    expect(responseCensusKeyShape({ placeholder: "<int>" })).toEqual(/^\d+$/);
    expect(responseCensusKeyShape({ placeholder: "<unsafe>" })).toBe(null);
    expect(responseCensusKeyShape({ placeholder: "totalCount" })).toBe(null);
  });
});

describe("responseJsonKind", () => {
  it("counts a non-finite number apart from a number, and an array apart from an object", () => {
    expect(responseJsonKind({ value: Number.POSITIVE_INFINITY })).toBe("non-finite");
    expect(responseJsonKind({ value: 1 })).toBe("number");
    expect(responseJsonKind({ value: [] })).toBe("array");
    expect(responseJsonKind({ value: {} })).toBe("object");
    expect(responseJsonKind({ value: null })).toBe("null");
  });
});

describe("observeResponseStructure", () => {
  it("tallies paths, kinds, presence and empty arrays from the root, never a value", () => {
    const structure: ResponseStructure = { objects: {}, paths: {} };
    observeResponseStructure({
      path: "",
      structure,
      value: { data: [{ id: "x", tags: [] }, { id: null }], meta: { count: 2 } },
    });
    expect(structure.objects).toEqual({ "": 1, "data[]": 2, meta: 1 });
    expect(structure.paths).toEqual({
      data: { emptyArrays: 0, kinds: { array: 1 }, present: 1 },
      "data[]": { emptyArrays: 0, kinds: { object: 2 }, present: 2 },
      "data[].id": { emptyArrays: 0, kinds: { null: 1, string: 1 }, present: 2 },
      "data[].tags": { emptyArrays: 1, kinds: { array: 1 }, present: 1 },
      meta: { emptyArrays: 0, kinds: { object: 1 }, present: 1 },
      "meta.count": { emptyArrays: 0, kinds: { number: 1 }, present: 1 },
    });
    expect(JSON.stringify(structure)).not.toContain('"x"');
  });

  it("records a data-keyed map under its placeholder, and a prototype name as unsafe in an own entry", () => {
    const structure: ResponseStructure = { objects: {}, paths: {} };
    observeResponseStructure({ path: "", structure, value: JSON.parse('{"byId":{"1":true,"2":false},"__proto__":0}') });
    expect(Object.keys(structure.paths)).toEqual(["byId", "byId.<int>", "<unsafe>"]);
    expect(structure.paths["byId.<int>"]!.present).toBe(2);
    expect(Object.getPrototypeOf(structure.paths)).toBe(Object.prototype);
  });
});
