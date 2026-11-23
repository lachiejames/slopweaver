import { describe, expect, it } from "vitest";

import {
  collectResponsePaths,
  redactValueSegments,
  responseFieldPaths,
  type SegmentClassifier,
} from "../../../../atlas/kit/responseShape.js";

/** A classifier whose digit placeholder COLLAPSES, mirroring a timestamp split across two segments. */
const TIMESTAMPS: SegmentClassifier = ({ segment }) => {
  if (/^[0-9]+$/u.test(segment)) {
    return { collapsesWithPrevious: true, placeholder: "<ts>" };
  }
  return /^[A-Z][A-Z0-9]{8,}$/u.test(segment) ? { collapsesWithPrevious: false, placeholder: "<id>" } : null;
};

describe("collectResponsePaths", () => {
  it("gives an array one entry however many elements it has", () => {
    const paths = collectResponsePaths({ body: { items: [{ a: 1 }, { a: 2 }, { b: 3 }] }, depthCap: 3 });
    expect([...paths].toSorted()).toEqual(["items", "items[].a", "items[].b"]);
  });

  it("stops at the depth cap", () => {
    const paths = collectResponsePaths({ body: { a: { b: { c: { d: 1 } } } }, depthCap: 2 });
    expect([...paths].toSorted()).toEqual(["a", "a.b", "a.b.c"]);
  });

  it("returns nothing for a non-object body", () => {
    expect([...collectResponsePaths({ body: "text", depthCap: 3 })]).toEqual([]);
  });
});

describe("redactValueSegments", () => {
  it("collapses two adjacent segments that were ONE value", () => {
    expect(redactValueSegments({ classify: TIMESTAMPS, path: "updates.1770145041.000100" })).toBe("updates.<ts>");
  });

  it("keeps two adjacent ids apart when the classifier says they are separate values", () => {
    expect(redactValueSegments({ classify: TIMESTAMPS, path: "map.CHANNELAAA.CHANNELBBB" })).toBe("map.<id>.<id>");
  });

  it("leaves a genuine field name untouched", () => {
    expect(redactValueSegments({ classify: TIMESTAMPS, path: "messages.reply_count" })).toBe("messages.reply_count");
  });
});

describe("responseFieldPaths", () => {
  it("deduplicates paths that redact to the same shape", () => {
    const paths = responseFieldPaths({
      body: { map: { AAAAAAAAA: { n: 1 }, BBBBBBBBB: { n: 2 } } },
      classify: TIMESTAMPS,
      depthCap: 3,
    });
    expect(paths).toEqual(["map", "map.<id>", "map.<id>.n"]);
  });

  it("redacts nothing when a platform declares no value shapes", () => {
    const paths = responseFieldPaths({ body: { AAAAAAAAA: 1 }, classify: () => null, depthCap: 3 });
    expect(paths).toEqual(["AAAAAAAAA"]);
  });
});
