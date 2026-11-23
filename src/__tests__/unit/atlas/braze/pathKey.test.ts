import { describe, expect, it } from "vitest";

import { brazeOperationProviderId, brazePathDefect, brazePathKey } from "../../../../atlas/braze/pathKey.js";

describe("brazePathKey", () => {
  it("strips the collection's host variable so both channels land on one key", () => {
    expect(brazePathKey({ path: "https://{{instance_url}}/catalogs" })).toBe("/catalogs");
  });

  it("drops a query string, which is how the reference's own scim block is spelled", () => {
    expect(brazePathKey({ path: 'scim/v2/Users?filter=userName eq "user@test.com"' })).toBe("/scim/v2/Users");
  });

  it("removes internal whitespace, so the collection's broken copy matches its correct one", () => {
    expect(brazePathKey({ path: "https://{{instance_url}} /v2/subscription/status/set" })).toBe(
      "/v2/subscription/status/set",
    );
    expect(brazePathKey({ path: "https://{{instance_url}}/v2/subscription/status/set" })).toBe(
      "/v2/subscription/status/set",
    );
  });

  it("collapses parameter names so a renamed placeholder cannot split one operation into two", () => {
    expect(brazePathKey({ path: "/catalogs/{catalog_name}/items/{item_id}" })).toBe("/catalogs/{}/items/{}");
    expect(brazePathKey({ path: "/catalogs/{name}/items/{id}" })).toBe("/catalogs/{}/items/{}");
  });

  it("drops a trailing slash but keeps a genuinely different path", () => {
    expect(brazePathKey({ path: "/templates/email/translations/" })).toBe("/templates/email/translations");
    expect(brazePathKey({ path: "/templates/translations/email" })).toBe("/templates/translations/email");
  });

  it("roots a path the source wrote without a leading slash", () => {
    expect(brazePathKey({ path: "scim/v2/Users" })).toBe("/scim/v2/Users");
  });

  it("answers the root for a path that normalises away entirely", () => {
    expect(brazePathKey({ path: "https://{{instance_url}}/" })).toBe("/");
  });
});

describe("brazeOperationProviderId", () => {
  it("upper-cases the method and joins it to the normalised path", () => {
    expect(brazeOperationProviderId({ method: "get", path: "https://{{instance_url}}/catalogs" })).toBe(
      "GET /catalogs",
    );
  });

  it("gives the same id to the two spellings of one operation", () => {
    const fromDocs = brazeOperationProviderId({ method: "POST", path: "/v2/subscription/status/set" });
    const fromCollection = brazeOperationProviderId({
      method: "POST",
      path: "https://{{instance_url}} /v2/subscription/status/set",
    });
    expect(fromDocs).toBe(fromCollection);
  });
});

describe("brazePathDefect", () => {
  it("calls a query string a defect in an address-only declaration", () => {
    expect(brazePathDefect({ form: "declaration", path: 'scim/v2/Users?filter=userName eq "x"' })).toBe(
      "carries a query string in the block that is supposed to declare the endpoint address alone",
    );
  });

  it("accepts a query string in a request URL, which is what a Postman request legitimately has", () => {
    expect(
      brazePathDefect({ form: "request", path: "https://{{instance_url}}/campaigns/data_series?campaign_id=x" }),
    ).toBe(null);
  });

  it("calls internal whitespace a defect in either form", () => {
    expect(brazePathDefect({ form: "request", path: "https://{{instance_url}} /v2/subscription/status/set" })).toBe(
      "carries whitespace inside the address, so the URL as published does not resolve",
    );
    expect(brazePathDefect({ form: "declaration", path: "/v2 /subscription" })).toBe(
      "carries whitespace inside the address, so the URL as published does not resolve",
    );
  });

  it("finds nothing wrong with an ordinary declared path", () => {
    expect(brazePathDefect({ form: "declaration", path: "/catalogs/{catalog_name}/items" })).toBe(null);
  });
});
