import { describe, expect, it } from "vitest";

import {
  readTwilioSpecSurface,
  TWILIO_FIELD_DEPTH,
  twilioMethodProviderId,
} from "../../../../atlas/twilio/specSurface.js";
import { unwrap } from "../../../../lib/result.js";

/** One document in the shape Twilio really publishes: doc-level server, per-path override, x-twilio. */
const document = {
  components: {
    schemas: {
      "messaging.v1.service": {
        properties: {
          account_sid: { type: "string" },
          date_created: { format: "date-time", type: "string" },
          sid: { type: "string" },
        },
        type: "object",
      },
    },
  },
  info: { title: "Twilio - Messaging" },
  openapi: "3.0.1",
  paths: {
    "/v1/Services": {
      "x-twilio": { mountName: "services", parent: "/Accounts/{Sid}", pathType: "list" },
      get: {
        operationId: "ListService",
        parameters: [
          { in: "query", name: "PageSize" },
          { in: "query", name: "Page" },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    meta: { properties: { key: { type: "string" }, page: { type: "integer" } }, type: "object" },
                    services: { items: { $ref: "#/components/schemas/messaging.v1.service" }, type: "array" },
                  },
                  type: "object",
                },
              },
            },
          },
        },
        security: [{ accountSid_authToken: [] }],
      },
      post: {
        operationId: "CreateService",
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                properties: { FriendlyName: { type: "string" }, InboundRequestUrl: { type: "string" } },
                type: "object",
              },
            },
          },
        },
        responses: {
          "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/messaging.v1.service" } } } },
        },
      },
      servers: [{ url: "https://messaging.twilio.com" }],
    },
  },
  security: [{ accountSid_authToken: [] }],
  servers: [{ url: "https://api.twilio.com" }],
};

describe("reading one pinned Twilio definition", () => {
  it("records the per-path server rather than the document's own", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));

    expect(surface.hosts).toEqual(["https://messaging.twilio.com"]);
    expect(surface.operations[0]!.host).toBe("https://messaging.twilio.com");
  });

  // Twilio's writes take form bodies, so a reader that took `parameters` alone would answer that there is
  // no way to set a service's friendly name.
  it("collects request-body properties as parameters alongside the declared ones", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));
    const created = surface.operations.find((operation) => operation.method === "POST")!;

    expect([...created.parameters]).toEqual(["FriendlyName", "InboundRequestUrl"]);
  });

  it("keeps the query parameters of a GET, sorted", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));
    const listed = surface.operations.find((operation) => operation.method === "GET")!;

    expect([...listed.parameters]).toEqual(["Page", "PageSize"]);
  });

  // An array hop is transparent, so a list endpoint's records are reached rather than the budget being
  // spent arriving at them.
  it("walks through the array to the record's own fields", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));
    const listed = surface.operations.find((operation) => operation.method === "GET")!;

    expect([...listed.responseFields]).toEqual([
      "meta",
      "meta.key",
      "meta.page",
      "services",
      "services[].account_sid",
      "services[].date_created",
      "services[].sid",
    ]);
  });

  it("carries Twilio's own path extensions onto every operation on the path", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));

    expect(surface.operations[0]!.pathType).toBe("list");
    expect(surface.operations[0]!.parent).toBe("/Accounts/{Sid}");
    expect(surface.operations[0]!.mountName).toBe("services");
  });

  it("records which credential each operation requires", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));

    expect(surface.securitySchemes).toEqual(["accountSid_authToken"]);
    expect([...surface.operations[0]!.securitySchemes]).toEqual(["accountSid_authToken"]);
  });

  it("falls back to the document's own security when an operation declares none", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));
    const created = surface.operations.find((operation) => operation.method === "POST")!;

    expect([...created.securitySchemes]).toEqual(["accountSid_authToken"]);
  });

  it("takes the title Twilio writes and counts the paths", () => {
    const surface = unwrap(readTwilioSpecSurface({ document, specId: "twilio_messaging_v1" }));

    expect(surface.title).toBe("Twilio - Messaging");
    expect(surface.pathCount).toBe(1);
  });

  // The depth cap is what makes a self-referential schema terminate: `TWILIO_FIELD_DEPTH` nesting steps
  // past the top level and no further, so the walk bottoms out rather than following the cycle forever.
  it("terminates on a schema that references itself rather than looping", () => {
    const cyclic = {
      components: {
        schemas: { node: { properties: { child: { $ref: "#/components/schemas/node" } }, type: "object" } },
      },
      info: { title: "Twilio - Cyclic" },
      paths: {
        "/v1/Nodes": {
          get: {
            responses: {
              "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/node" } } } },
            },
          },
        },
      },
    };

    const surface = unwrap(readTwilioSpecSurface({ document: cyclic, specId: "twilio_cyclic_v1" }));

    expect([...surface.operations[0]!.responseFields]).toEqual(["child", "child.child", "child.child.child"]);
  });

  // A document declaring no server has no host, and says null rather than an empty string that reads like
  // an origin somebody could send a request to.
  it("records no response field and no host for an operation declaring neither", () => {
    const empty = {
      info: { title: "Twilio - Empty" },
      paths: { "/v1/Things/{Sid}": { delete: { responses: { "204": { description: "deleted" } } } } },
    };

    const surface = unwrap(readTwilioSpecSurface({ document: empty, specId: "twilio_empty_v1" }));

    expect([...surface.operations[0]!.responseFields]).toEqual([]);
    expect(surface.operations[0]!.host).toBe(null);
  });

  it("refuses a document declaring no paths rather than reporting an empty surface", () => {
    const result = readTwilioSpecSurface({ document: { info: { title: "x" } }, specId: "twilio_broken_v1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("declares no `paths` object");
  });

  it("refuses something that is not a JSON object at all", () => {
    const result = readTwilioSpecSurface({ document: "not a document", specId: "twilio_broken_v1" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("is not a JSON object");
  });

  it("keys an operation on its method and path, byte-exactly", () => {
    expect(twilioMethodProviderId({ method: "GET", path: "/v1/Services" })).toBe("GET /v1/Services");
  });

  it("caps nesting at the declared depth", () => {
    expect(TWILIO_FIELD_DEPTH).toBe(2);
  });
});
