import { describe, expect, it } from "vitest";

import {
  arrayField,
  graphqlErrorMessages,
  isRecord,
  readGraphqlEnvelope,
  stringField,
} from "../../../../atlas/graphqlHive/client.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("readGraphqlEnvelope", () => {
  it("returns the data object for a well-formed 200", () => {
    const read = readGraphqlEnvelope({ response: { status: 200, text: '{"data":{"organization":{"slug":"a"}}}' } });
    expect(unwrap(read)).toStrictEqual({ organization: { slug: "a" } });
  });

  it("reports a non-200 with its status, which is a different failure from a bad body", () => {
    const read = readGraphqlEnvelope({ response: { status: 401, text: "nope" } });
    expect(unwrapErr(read).code).toBe("HTTP_STATUS");
  });

  it("reports an unparseable body rather than throwing on provider bytes", () => {
    const read = readGraphqlEnvelope({ response: { status: 200, text: "<html>" } });
    expect(unwrapErr(read).code).toBe("MALFORMED_RESPONSE");
  });

  it("refuses a 200 carrying a GraphQL errors array, which is a provider-shaped FALSE SUCCESS", () => {
    const read = readGraphqlEnvelope({
      response: { status: 200, text: '{"data":null,"errors":[{"message":"no such field"}]}' },
    });
    expect(unwrapErr(read).code).toBe("GRAPHQL_ERRORS");
  });

  it("carries every GraphQL error message into the failure, so a reader can act on it", () => {
    const read = readGraphqlEnvelope({
      response: { status: 200, text: '{"errors":[{"message":"a"},{"message":"b"}]}' },
    });
    expect(unwrapErr(read).message).toContain("a; b");
  });

  it("refuses a 200 whose body carries no data object at all", () => {
    const read = readGraphqlEnvelope({ response: { status: 200, text: '{"data":null}' } });
    expect(unwrapErr(read).code).toBe("MALFORMED_RESPONSE");
  });
});

describe("graphqlErrorMessages", () => {
  it("answers nothing when the response declares no errors", () => {
    expect(graphqlErrorMessages({ envelope: { data: {} } })).toStrictEqual([]);
  });

  it("names an error entry that carries no message, rather than dropping it", () => {
    expect(graphqlErrorMessages({ envelope: { errors: [{}] } })).toStrictEqual(["error 0 carried no message"]);
  });
});

describe("stringField", () => {
  it("trims a present value", () => {
    expect(stringField({ key: "a", record: { a: "  x  " } })).toBe("x");
  });

  it("answers null for a blank value, so an empty string never reaches a schema that forbids one", () => {
    expect(stringField({ key: "a", record: { a: "   " } })).toBeNull();
  });

  it("answers null for a value of the wrong type", () => {
    expect(stringField({ key: "a", record: { a: 7 } })).toBeNull();
  });
});

describe("arrayField", () => {
  it("answers the entries of an array field", () => {
    expect(arrayField({ key: "a", record: { a: [1, 2] } })).toStrictEqual([1, 2]);
  });

  it("answers nothing when the field is absent", () => {
    expect(arrayField({ key: "a", record: {} })).toStrictEqual([]);
  });
});

describe("isRecord", () => {
  it("rejects an array, which is an object JavaScript would otherwise let through", () => {
    expect(isRecord([])).toBe(false);
  });

  it("rejects null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("accepts a plain object", () => {
    expect(isRecord({})).toBe(true);
  });
});
