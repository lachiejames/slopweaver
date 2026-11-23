/**
 * One operation seen on two pages is ONE accumulator whose response fields are WIDENED — letting the last page win
 * would understate the surface a both-surfaces atlas exists to report.
 */
import { describe, expect, it } from "vitest";

import { foldObservedOperations } from "../../../../atlas/kit/observedOperations.js";

interface Call {
  readonly op: string;
  readonly fields: readonly string[];
  readonly tag: string;
}

const keyOf = ({ call }: { call: Call }): string => call.op;
const fieldsOf = ({ call }: { call: Call }): readonly string[] => call.fields;

describe("foldObservedOperations", () => {
  it("folds one operation across pages: first call kept, calls counted, pages and fields widened and sorted", () => {
    const folded = foldObservedOperations({
      fieldsOf,
      keyOf,
      pages: [
        {
          calls: [
            { fields: ["name", "id"], op: "listMembers", tag: "first" },
            { fields: ["plan"], op: "getBilling", tag: "billing" },
          ],
          finalUrl: "https://app.example.com/members",
          surface: "members",
        },
        {
          calls: [
            { fields: ["role", "id"], op: "listMembers", tag: "second" },
            { fields: ["id"], op: "listMembers", tag: "third" },
          ],
          finalUrl: "https://app.example.com/admin",
          surface: "admin",
        },
      ],
    });

    expect([...folded.keys()].toSorted()).toEqual(["getBilling", "listMembers"]);
    expect(folded.get("listMembers")).toEqual({
      call: { fields: ["name", "id"], op: "listMembers", tag: "first" },
      callCount: 3,
      deepLink: "https://app.example.com/members",
      responseFields: ["id", "name", "role"],
      seenOn: ["admin", "members"],
    });
    expect(folded.get("getBilling")).toEqual({
      call: { fields: ["plan"], op: "getBilling", tag: "billing" },
      callCount: 1,
      deepLink: "https://app.example.com/members",
      responseFields: ["plan"],
      seenOn: ["members"],
    });
  });

  it("keeps the deep link of the FIRST page that made the call, even when it never settled", () => {
    const folded = foldObservedOperations({
      fieldsOf,
      keyOf,
      pages: [
        { calls: [{ fields: [], op: "ping", tag: "a" }], finalUrl: "", surface: "home" },
        { calls: [{ fields: [], op: "ping", tag: "b" }], finalUrl: "https://app.example.com/x", surface: "x" },
      ],
    });

    expect(folded.get("ping")!.deepLink).toBe("");
  });

  it("folds no pages, and pages with no calls, to an empty map", () => {
    expect(foldObservedOperations({ fieldsOf, keyOf, pages: [] }).size).toBe(0);
    expect(
      foldObservedOperations({ fieldsOf, keyOf, pages: [{ calls: [], finalUrl: "", surface: "empty" }] }).size,
    ).toBe(0);
  });
});
