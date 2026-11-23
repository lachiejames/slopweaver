import { describe, expect, it } from "vitest";

import {
  classifyHexSegment,
  hexGraphqlOperationName,
  hexResponseFieldPaths,
  isFirstPartyHexResponse,
  isHexResultBearing,
} from "../../../../atlas/hex/webReduction.js";

describe("recognising a first-party Hex response", () => {
  it("admits both registrable domains the product serves itself from", () => {
    expect(isFirstPartyHexResponse({ response: { body: { a: 1 }, url: "https://app.hex.tech/api/v1/projects" } })).toBe(
      true,
    );
    expect(isFirstPartyHexResponse({ response: { body: { a: 1 }, url: "https://static.hex.site/openapi.json" } })).toBe(
      true,
    );
  });

  // CodeQL caught the suffix version of this test on the sibling Twilio atlas: a lookalike host's response
  // would have been recorded as one of the vendor's own.
  it("matches the domain at a dot boundary, so a lookalike host is not Hex", () => {
    expect(isFirstPartyHexResponse({ response: { body: { a: 1 }, url: "https://evilhex.tech/api/v1/projects" } })).toBe(
      false,
    );
  });

  it("refuses a response that is not a JSON object at all", () => {
    expect(isFirstPartyHexResponse({ response: { body: null, url: "https://app.hex.tech/login" } })).toBe(false);
  });
});

describe("reading the GraphQL operation name off an observed url", () => {
  it("takes it from the query string, which is where Hex puts it", () => {
    expect(hexGraphqlOperationName({ url: "https://app.hex.tech/graphql?op=OrgDetails" })).toBe("OrgDetails");
  });

  it("answers null for a call that is not GraphQL and for one carrying no operation", () => {
    expect(hexGraphqlOperationName({ url: "https://app.hex.tech/api/v1/projects" })).toBe(null);
    expect(hexGraphqlOperationName({ url: "https://app.hex.tech/graphql" })).toBe(null);
  });
});

describe("deciding whether an observed body may be described at all", () => {
  it("refuses a cell output, a chart image and a thread", () => {
    expect(isHexResultBearing({ url: "https://app.hex.tech/api/v1/cells/abc/output" })).toContain(
      "no customer data locally",
    );
    expect(isHexResultBearing({ url: "https://app.hex.tech/api/v1/cells/abc/image" })).toContain(
      "no customer data locally",
    );
    expect(isHexResultBearing({ url: "https://app.hex.tech/api/v1/threads/abc/messages" })).toContain(
      "no customer data locally",
    );
  });

  it("refuses a GraphQL operation whose name says it returns a computed result", () => {
    expect(isHexResultBearing({ url: "https://app.hex.tech/graphql?op=OutputContentById" })).toContain(
      "a cell's output content",
    );
    expect(isHexResultBearing({ url: "https://app.hex.tech/graphql?op=OrgDetails" })).toBe(null);
  });

  // Over-redaction is the safe error on a data workspace: a shape reader loses nothing it can act on, and
  // the alternative is a sensitive column name in a local file.
  it("refuses a url it cannot parse, rather than letting an unclassifiable body through", () => {
    expect(isHexResultBearing({ url: "not a url" })).toContain("could not be parsed");
  });

  it("allows an ordinary configuration read", () => {
    expect(isHexResultBearing({ url: "https://app.hex.tech/api/v1/projects" })).toBe(null);
  });
});

describe("reducing an observed path segment", () => {
  it("replaces a uuid, a bare number and an opaque handle", () => {
    expect(classifyHexSegment({ segment: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" })).toEqual({
      collapsesWithPrevious: false,
      placeholder: "<uuid>",
    });
    expect(classifyHexSegment({ segment: "12345" })).toEqual({ collapsesWithPrevious: false, placeholder: "<n>" });
    expect(classifyHexSegment({ segment: "proj-a8f3c1d90b2e4a7f" })).toEqual({
      collapsesWithPrevious: false,
      placeholder: "<id>",
    });
  });

  it("keeps an ordinary route word and the kit's own array marker", () => {
    expect(classifyHexSegment({ segment: "context-studio" })).toBe(null);
    expect(classifyHexSegment({ segment: "[]" })).toBe(null);
    expect(classifyHexSegment({ segment: "values[]" })).toBe(null);
  });

  // An allowlist rather than a denylist: a value somebody used as a map KEY matches no shape pattern
  // anyone would have written, which is how the sibling GitHub reduction stored a real email address.
  it("replaces anything that is not a plain identifier, including a value used as a key", () => {
    expect(classifyHexSegment({ segment: "a@example.test" })).toEqual({
      collapsesWithPrevious: false,
      placeholder: "<value>",
    });
  });
});

describe("reducing an observed body to field names", () => {
  it("keeps the names and drops every value, through an array hop", () => {
    expect(
      hexResponseFieldPaths({ body: { pagination: { after: "x" }, values: [{ id: "p1", title: "Growth" }] } }),
    ).toEqual(["pagination", "pagination.after", "values", "values[].id", "values[].title"]);
  });
});
