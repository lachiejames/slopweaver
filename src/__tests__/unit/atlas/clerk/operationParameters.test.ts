/*
 * The parameter names one Clerk operation declares: path-level and operation-level lists merged, a
 * `components.parameters` reference resolved, query names de-duplicated and sorted.
 */
import { describe, expect, it } from "vitest";

import { parameterNames } from "../../../../atlas/clerk/operationParameters.js";

/** The document's `components.parameters` map, holding the one parameter Clerk declares by reference. */
const PARAMETERS: Record<string, unknown> = {
  Limit: { in: "query", name: "limit" },
};

describe("parameterNames", () => {
  it("merges the path item's parameters ahead of the operation's and resolves a reference", () => {
    expect(
      parameterNames({
        operation: {
          parameters: [
            { $ref: "#/components/parameters/Limit" },
            { in: "query", name: "email_address" },
            { in: "query", name: "email_address" },
          ],
        },
        parameters: PARAMETERS,
        pathItem: { parameters: [{ in: "path", name: "user_id" }] },
      }),
    ).toEqual({
      all: ["user_id", "limit", "email_address", "email_address"],
      path: ["user_id"],
      query: ["email_address", "limit"],
    });
  });

  it("drops an entry that is not a mapping, a dangling reference and one with no name", () => {
    expect(
      parameterNames({
        operation: {
          parameters: ["limit", { $ref: "#/components/parameters/Missing" }, { in: "query" }],
        },
        parameters: PARAMETERS,
        pathItem: {},
      }),
    ).toEqual({ all: [], path: [], query: [] });
  });

  it("reads nothing from an operation and path item that declare no parameter list", () => {
    expect(parameterNames({ operation: {}, parameters: {}, pathItem: { parameters: "none" } })).toEqual({
      all: [],
      path: [],
      query: [],
    });
  });
});
