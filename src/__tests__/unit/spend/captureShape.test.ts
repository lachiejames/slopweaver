import { describe, expect, it } from "vitest";

import { discoveryLines, fieldPathsOf, responseShapeOf } from "../../../spend/captureShape.js";

describe("fieldPathsOf", () => {
  it("reports every field path with its type, folding array elements into one step", () => {
    expect(
      fieldPathsOf({
        body: {
          items: [
            { amount: 155, status: "DECLINED" },
            { amount: 340, reason: null },
          ],
          limit: { used: 2410.58 },
        },
      }),
    ).toEqual([
      { path: "items", type: "array" },
      { path: "items[]", type: "object" },
      { path: "items[].amount", type: "number" },
      { path: "items[].status", type: "string" },
      { path: "items[].reason", type: "null" },
      { path: "limit", type: "object" },
      { path: "limit.used", type: "number" },
    ]);
  });

  it("prints a key that is data — a merchant, an id, a date — as <key>", () => {
    const paths = fieldPathsOf({
      body: {
        byMerchant: { "OPENAI *CHATGPT SUBSCR": { total: 155 }, "68eed638-8001": { total: 1 } },
        "2026-09-25": 4,
      },
    });
    expect(paths).toEqual([
      { path: "byMerchant", type: "object" },
      { path: "byMerchant.<key>", type: "object" },
      { path: "byMerchant.<key>.total", type: "number" },
      { path: "<key>", type: "number" },
    ]);
  });

  it("carries no field for a body that is a bare string", () => {
    expect(fieldPathsOf({ body: "turbo-stream text" })).toEqual([]);
  });
});

describe("responseShapeOf", () => {
  it("keeps the path and a GraphQL operation name, and drops the query, every value and the variables", () => {
    const shape = responseShapeOf({
      response: {
        body: { cardNumber: "4000123412344243", merchant: "OPENAI *CHATGPT SUBSCR" },
        method: "POST",
        requestBody: JSON.stringify({ operationName: "CardTransactions", variables: { cardId: "secret-card-id" } }),
        statusCode: 200,
        url: "https://www.airwallex.com/api/v1/graphql?cardId=secret-card-id",
      },
    });
    const printed = discoveryLines({ shapes: [shape] }).join("\n");
    expect(printed).toBe(
      "POST /api/v1/graphql (CardTransactions) → 200, 2 field(s)\n    cardNumber: string\n    merchant: string",
    );
    expect(printed).not.toContain("4243");
    expect(printed).not.toContain("secret-card-id");
    expect(printed).not.toContain("OPENAI");
  });

  it("names no operation whose name is not identifier-shaped", () => {
    expect(
      responseShapeOf({
        response: {
          body: {},
          method: "POST",
          requestBody: JSON.stringify({ operationName: "card 4243 spend" }),
          statusCode: 200,
          url: "https://www.airwallex.com/api/graphql",
        },
      }).operation,
    ).toBe(null);
  });

  it("names no operation for a request body that is not JSON", () => {
    expect(
      responseShapeOf({
        response: { body: {}, method: "POST", requestBody: "a=1", statusCode: 204, url: "https://www.airwallex.com/x" },
      }).operation,
    ).toBe(null);
  });
});
