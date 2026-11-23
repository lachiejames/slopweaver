import { describe, expect, it } from "vitest";
import {
  connectionNodes,
  connectionStrings,
  displayName,
  nestedNum,
  nestedStr,
  num,
  optionalStrings,
  PROJECT_STRING_FIELDS,
  str,
  strOrEmpty,
} from "../../../../corpus/linear/parseFields.js";

describe("str and strOrEmpty", () => {
  it("reads a string and keeps its absence apart from the required-field sentinel", () => {
    expect(str({ value: "ENG-42" })).toBe("ENG-42");
    expect(str({ value: 42 })).toBeUndefined();
    expect(strOrEmpty({ value: "ENG-42" })).toBe("ENG-42");
    expect(strOrEmpty({ value: undefined })).toBe("");
  });
});

describe("num", () => {
  it("keeps a finite number, zero included, and refuses every other shape", () => {
    expect(num({ value: 0 })).toBe(0);
    expect(num({ value: 2.5 })).toBe(2.5);
    expect(num({ value: Number.NaN })).toBeUndefined();
    expect(num({ value: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(num({ value: "2" })).toBeUndefined();
  });
});

describe("the nested readers", () => {
  it("reads a field off a record holder and answers undefined for any other holder", () => {
    expect(displayName({ value: { displayName: "Dana" } })).toBe("Dana");
    expect(displayName({ value: "Dana" })).toBeUndefined();
    expect(nestedStr({ key: "key", value: { key: "ENG" } })).toBe("ENG");
    expect(nestedStr({ key: "key", value: null })).toBeUndefined();
    expect(nestedNum({ key: "number", value: { number: 12 } })).toBe(12);
    expect(nestedNum({ key: "number", value: { number: "12" } })).toBeUndefined();
  });
});

describe("connectionStrings", () => {
  it("dedupes and sorts the field, skipping nodes that lack it", () => {
    const nodes = [{ name: "b" }, { name: "a" }, { name: "b" }, { other: "c" }, "not a record"];
    expect(connectionStrings({ field: "name", nodes })).toEqual(["a", "b"]);
  });
});

describe("optionalStrings", () => {
  it("copies each present string under its item key and drops the rest", () => {
    const node = { canceledAt: 7, completedAt: "2026-05-02", content: "the brief" };
    expect(optionalStrings({ node, pairs: PROJECT_STRING_FIELDS })).toEqual({
      completedAtIso: "2026-05-02",
      content: "the brief",
    });
  });
});

describe("connectionNodes", () => {
  it("reads a connection's nodes and answers empty when the holder has none", () => {
    expect(connectionNodes({ holder: { labels: { nodes: [{ name: "a" }] } }, key: "labels" })).toEqual([{ name: "a" }]);
    expect(connectionNodes({ holder: { labels: "malformed" }, key: "labels" })).toEqual([]);
    expect(connectionNodes({ holder: undefined, key: "labels" })).toEqual([]);
  });
});
