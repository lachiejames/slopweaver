/**
 * Data-scale accumulation. `appendAll` appends one element at a time, so a source past the engine's spread
 * argument limit (measured at 123,947 on Node 24; the outage file held between that and two hundred thousand) still appends; `appendUnder` mints
 * a bucket on first use and appends to it after.
 */
import { describe, expect, it } from "vitest";

import { appendAll, appendUnder } from "../../../lib/arrays.js";

describe("appendAll", () => {
  it("appends the source after what the destination already holds, in source order", () => {
    const into = ["a", "b"];

    appendAll({ from: ["c", "d", "e"], into });

    expect(into).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("leaves the destination unchanged for an empty source", () => {
    const into = [1, 2];

    appendAll({ from: [], into });

    expect(into).toEqual([1, 2]);
  });

  it("appends a 200,000-element source, longer than the under-two-hundred-thousand-record file behind the spread outage", () => {
    const from = Array.from({ length: 200_000 }, (_, index) => index);
    const into = [-1];

    appendAll({ from, into });

    expect(into.length).toBe(200_001);
    expect(into[0]).toBe(-1);
    expect(into[1]).toBe(0);
    expect(into[200_000]).toBe(199_999);
  });
});

describe("appendUnder", () => {
  it("mints a one-element bucket for a key it has not seen, on the map it was given", () => {
    const into = new Map<string, number[]>();

    appendUnder({ into, key: "x", value: 1 });

    expect([...into.entries()]).toEqual([["x", [1]]]);
  });

  it("appends to an existing bucket in call order, keeping other keys apart", () => {
    const into = new Map<string, number[]>([["y", [9]]]);

    appendUnder({ into, key: "x", value: 1 });
    appendUnder({ into, key: "x", value: 2 });
    appendUnder({ into, key: "y", value: 10 });

    expect([...into.entries()]).toEqual([
      ["y", [9, 10]],
      ["x", [1, 2]],
    ]);
  });
});
