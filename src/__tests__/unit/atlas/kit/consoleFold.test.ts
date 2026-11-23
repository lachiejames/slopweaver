import { describe, expect, it } from "vitest";

import {
  type ConsoleFoldSpec,
  foldConsoleCalls,
  type ObservedCall,
  pathShapeOf,
} from "../../../../atlas/kit/consoleFold.js";
import type { SegmentClassifier } from "../../../../atlas/kit/responseShape.js";

/** A console whose ids are plain integers: every all-digit segment is a value, every other one a word. */
const classify: SegmentClassifier = ({ segment }) =>
  /^\d+$/.test(segment) ? { collapsesWithPrevious: false, placeholder: "<id>" } : null;

const SPEC: ConsoleFoldSpec = { classify, depthCap: 5, pathCap: 10, telemetryParam: /^_t$/ };

/** One observed call, with only what a test names differing from a plain GET. */
function call({ over }: { over: Partial<ObservedCall> & { url: string } }): ObservedCall {
  return { body: undefined, method: "GET", onPage: "/people", statusCode: 200, ...over };
}

describe("pathShapeOf", () => {
  it("replaces every value-shaped segment with its placeholder and keeps every path word", () => {
    expect(pathShapeOf({ classify, url: "https://console.example.com/api/users/123/roles?x=1" })).toBe(
      "/api/users/<id>/roles",
    );
  });

  it("keeps a path holding no value segment exactly as it stands", () => {
    expect(pathShapeOf({ classify, url: "https://console.example.com/api/teams" })).toBe("/api/teams");
  });

  it("answers null for a URL that cannot be parsed", () => {
    expect(pathShapeOf({ classify, url: "not a url" })).toBe(null);
  });
});

describe("foldConsoleCalls", () => {
  it("folds calls to one endpoint into one row across pages, dropping telemetry and every value", () => {
    const folded = foldConsoleCalls({
      calls: [
        call({
          over: {
            body: { users: [{ id: 1, name: "a" }] },
            url: "https://console.example.com/api/users/1?page=2&_t=99",
          },
        }),
        call({
          over: {
            body: { users: [] },
            onPage: "/admin",
            statusCode: 404,
            url: "https://console.example.com/api/users/2?sort=name",
          },
        }),
        call({ over: { method: "POST", statusCode: 201, url: "https://console.example.com/api/users/3" } }),
        call({ over: { url: "not a url" } }),
      ],
      spec: SPEC,
    });

    expect(folded).toEqual([
      {
        method: "GET",
        observedOnPages: ["/admin", "/people"],
        paramNames: ["page", "sort"],
        pathShape: "/api/users/<id>",
        responseFieldPaths: ["users", "users[].id", "users[].name"],
        statusCodes: [200, 404],
      },
      {
        method: "POST",
        observedOnPages: ["/people"],
        paramNames: [],
        pathShape: "/api/users/<id>",
        responseFieldPaths: [],
        statusCodes: [201],
      },
    ]);
  });

  it("keeps no more response paths per endpoint than the platform's cap", () => {
    const folded = foldConsoleCalls({
      calls: [call({ over: { body: { a: 1, b: 2, c: 3 }, url: "https://console.example.com/api/flags" } })],
      spec: { ...SPEC, pathCap: 2 },
    });

    expect(folded.map((row) => row.responseFieldPaths)).toEqual([["a", "b"]]);
  });

  it("folds no calls into no rows", () => {
    expect(foldConsoleCalls({ calls: [], spec: SPEC })).toEqual([]);
  });
});
