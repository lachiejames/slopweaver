import { describe, expect, it } from "vitest";

import { readBrazeCollection } from "../../../../atlas/braze/collection.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const COLLECTION = JSON.stringify({
  info: { name: "Braze Endpoints" },
  item: [
    {
      item: [
        {
          item: [
            {
              name: "List catalogs",
              request: {
                header: [{ key: "Authorization", value: "Bearer {{api_key}}" }, { key: "Content-Type" }],
                method: "GET",
                url: { raw: "https://{{instance_url}}/catalogs?page=1" },
              },
            },
          ],
          name: "Synchronous",
        },
      ],
      name: "Catalogs",
    },
    {
      name: "Update subscription (V2)",
      request: { method: "POST", url: { raw: "https://{{instance_url}} /v2/subscription/status/set" } },
    },
    {
      name: "Update subscription (V2) again",
      request: {
        body: { raw: '{ "subscription_group_id": "x", "subscription_state": "subscribed" }' },
        method: "POST",
        url: { raw: "https://{{instance_url}}/v2/subscription/status/set" },
      },
    },
    {
      name: "Track users",
      request: { body: { raw: "{ not json," }, method: "POST", url: "https://{{instance_url}}/users/track" },
    },
  ],
});

describe("readBrazeCollection", () => {
  it("walks nested folders and records the folder path outermost first", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const catalogs = surface.rows.find((row) => row.providerId === "GET /catalogs");
    expect(catalogs?.folders).toEqual(["Catalogs", "Synchronous"]);
  });

  it("counts requests and distinct operations separately", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    expect(surface.requestCount).toBe(4);
    expect(surface.rows.length).toBe(3);
  });

  it("reports the duplicate rather than dropping it silently, first occurrence winning", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    expect(surface.duplicates).toEqual([
      { name: "Update subscription (V2) again", providerId: "POST /v2/subscription/status/set" },
    ]);
  });

  it("records the malformed address the broken copy published", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const row = surface.rows.find((entry) => entry.providerId === "POST /v2/subscription/status/set");
    expect(row?.pathDefect).toBe("carries whitespace inside the address, so the URL as published does not resolve");
  });

  it("keeps header NAMES and never a header value", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const catalogs = surface.rows.find((row) => row.providerId === "GET /catalogs");
    expect(catalogs?.headers).toEqual(["Authorization", "Content-Type"]);
  });

  it("reads query parameter names out of the raw URL", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const catalogs = surface.rows.find((row) => row.providerId === "GET /catalogs");
    expect(catalogs?.queryParams).toEqual(["page"]);
    expect(catalogs?.pathShape).toBe("/catalogs");
  });

  it("reads top-level request body field names when the example parses", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const row = surface.rows.find((entry) => entry.providerId === "POST /v2/subscription/status/set");
    expect(row?.requestBodyFields).toEqual([]);
  });

  it("keeps an operation whose hand-written example body does not parse", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    const track = surface.rows.find((row) => row.providerId === "POST /users/track");
    expect(track?.requestBodyFields).toEqual([]);
    expect(track?.method).toBe("POST");
  });

  it("accepts a URL written as a plain string as well as an object", () => {
    const surface = unwrap(readBrazeCollection({ text: COLLECTION }));
    expect(surface.rows.some((row) => row.providerId === "POST /users/track")).toBe(true);
  });

  it("refuses a document that is not JSON", () => {
    const result = readBrazeCollection({ text: "not json" });
    expect(unwrapErr(result)[0]).toBe("the Braze Postman collection is not valid JSON");
  });

  it("refuses a document declaring no item array", () => {
    const result = readBrazeCollection({ text: JSON.stringify({ info: {} }) });
    expect(unwrapErr(result)).toEqual([
      "the Braze Postman collection declares no `item` array, so it carries no requests to read",
    ]);
  });

  it("refuses a document whose items carry no readable request", () => {
    const result = readBrazeCollection({ text: JSON.stringify({ item: [{ name: "empty" }] }) });
    expect(unwrapErr(result)).toEqual([
      "the Braze Postman collection declares no readable request at all, so nothing was published",
    ]);
  });
});
