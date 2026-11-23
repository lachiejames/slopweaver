import { describe, expect, it } from "vitest";

import { foldTrelicaFirstPartyCalls } from "../../../../atlas/trelica/methodFold.js";

describe("foldTrelicaFirstPartyCalls", () => {
  it("folds two calls reaching one operation onto one detail, widening the fields and counting both", () => {
    const folded = foldTrelicaFirstPartyCalls({
      calls: [
        { callId: "ai-alerts-spike", providerId: "GET /AppsApi/AppAIAlert/History", statusCode: 200 },
        { callId: "ai-alerts-budget", providerId: "GET /AppsApi/AppAIAlert/History", statusCode: 200 },
      ],
      fieldNames: new Map([
        ["ai-alerts-spike", ["trend", "id"]],
        ["ai-alerts-budget", ["id", "status"]],
      ]),
    });
    expect([...folded.entries()]).toEqual([
      [
        "GET /AppsApi/AppAIAlert/History",
        { callCount: 2, calledDirectly: true, responseFields: ["id", "status", "trend"], statusCode: 200 },
      ],
    ]);
  });

  it("keeps a call with no observed fields as an operation with none", () => {
    const folded = foldTrelicaFirstPartyCalls({
      calls: [{ callId: "roles", providerId: "GET /api/roles", statusCode: 200 }],
      fieldNames: new Map(),
    });
    expect(folded.get("GET /api/roles")).toEqual({
      callCount: 1,
      calledDirectly: true,
      responseFields: [],
      statusCode: 200,
    });
  });

  it("answers an empty map for no calls", () => {
    expect(foldTrelicaFirstPartyCalls({ calls: [], fieldNames: new Map() }).size).toBe(0);
  });
});
