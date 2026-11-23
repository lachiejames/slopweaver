import { describe, expect, it } from "vitest";

import type { TwilioMethodApiDetail } from "../../../../atlas/twilio/model.js";
import { foldTwilioOperations, projectTwilioApis, projectTwilioMethods } from "../../../../atlas/twilio/projection.js";
import type { TwilioSpecPin } from "../../../../atlas/twilio/specPin.js";
import type { TwilioSpecSurface } from "../../../../atlas/twilio/specSurface.js";

const AT = "2026-09-05T00:00:00.000Z";

/** A pin, with only what a test varies overridden. */
function pin(over: Partial<TwilioSpecPin> = {}): TwilioSpecPin {
  return {
    byteLength: 10,
    hosts: ["https://messaging.twilio.com"],
    id: "twilio_messaging_v1",
    operationCount: 1,
    pathCount: 1,
    product: "messaging",
    securitySchemes: ["accountSid_authToken"],
    sha256: "a".repeat(64),
    title: "Twilio - Messaging",
    url: "https://raw.githubusercontent.com/twilio/twilio-oai/2.8.1/spec/json/twilio_messaging_v1.json",
    version: "v1",
    ...over,
  };
}

/** One compiled surface holding one operation, with only what a test varies overridden. */
function surface({
  specId,
  parameters = ["PageSize"],
  responseFields = ["sid"],
}: {
  specId: string;
  parameters?: readonly string[];
  responseFields?: readonly string[];
}): TwilioSpecSurface {
  return {
    hosts: ["https://messaging.twilio.com"],
    operations: [
      {
        disposition: "entity",
        excludedBecause: null,
        host: "https://messaging.twilio.com",
        method: "GET",
        mountName: "services",
        parameters: [...parameters],
        parent: "/Accounts/{Sid}",
        path: "/v1/Services",
        pathType: "list",
        responseFields: [...responseFields],
        securitySchemes: ["accountSid_authToken"],
      },
    ],
    pathCount: 1,
    securitySchemes: ["accountSid_authToken"],
    specId,
    title: "Twilio - Messaging",
  };
}

/** The api-channel detail one projected method entity carries. */
function detailOf({ entity }: { entity: { channels: { api: { detail: unknown } | null } } }): TwilioMethodApiDetail {
  return entity.channels.api!.detail as TwilioMethodApiDetail;
}

describe("projecting Twilio's published definitions", () => {
  it("gives each pinned document an api entity carrying its hosts and credential", () => {
    const projected = projectTwilioApis({ at: AT, pins: [pin()] });

    expect(projected.length).toBe(1);
    expect(projected[0]!.kind).toBe("api");
    expect(projected[0]!.providerId).toBe("twilio_messaging_v1");
    expect(projected[0]!.channels.browser).toBe(null);
    expect(projected[0]!.channels.api!.source!.deepLink).toBe(pin().url);
    expect(projected[0]!.channels.api!.source!.deepLinkStatus).toBe("provider-provided");
  });

  // Two documents declaring the same operation is one endpoint, not two, and `specs` is what records that.
  it("folds one operation declared by two documents into one entity naming both", () => {
    const folded = foldTwilioOperations({
      pins: [pin(), pin({ id: "twilio_ip_messaging_v1", product: "ip_messaging" })],
      surfaces: [surface({ specId: "twilio_messaging_v1" }), surface({ specId: "twilio_ip_messaging_v1" })],
    });
    const projected = projectTwilioMethods({ at: AT, folded });

    expect(projected.length).toBe(1);
    expect([...detailOf({ entity: projected[0]! }).specs]).toEqual(["twilio_ip_messaging_v1", "twilio_messaging_v1"]);
  });

  it("widens parameters and response fields across the documents declaring one operation", () => {
    const folded = foldTwilioOperations({
      pins: [pin(), pin({ id: "twilio_ip_messaging_v1" })],
      surfaces: [
        surface({ parameters: ["PageSize"], responseFields: ["sid"], specId: "twilio_messaging_v1" }),
        surface({ parameters: ["Page"], responseFields: ["date_created"], specId: "twilio_ip_messaging_v1" }),
      ],
    });
    const detail = detailOf({ entity: projectTwilioMethods({ at: AT, folded })[0]! });

    expect([...detail.parameters]).toEqual(["Page", "PageSize"]);
    expect([...detail.responseFields]).toEqual(["date_created", "sid"]);
  });

  it("carries the host and Twilio's own path extensions onto the entity", () => {
    const folded = foldTwilioOperations({ pins: [pin()], surfaces: [surface({ specId: "twilio_messaging_v1" })] });
    const detail = detailOf({ entity: projectTwilioMethods({ at: AT, folded })[0]! });

    expect(detail.host).toBe("https://messaging.twilio.com");
    expect(detail.product).toBe("messaging");
    expect(detail.pathType).toBe("list");
    expect(detail.parent).toBe("/Accounts/{Sid}");
    expect(detail.mountName).toBe("services");
  });

  it("keys the entity on method and path and leaves the browser channel empty", () => {
    const folded = foldTwilioOperations({ pins: [pin()], surfaces: [surface({ specId: "twilio_messaging_v1" })] });
    const projected = projectTwilioMethods({ at: AT, folded });

    expect(projected[0]!.providerId).toBe("GET /v1/Services");
    expect(projected[0]!.channels.browser).toBe(null);
  });

  it("marks an operation with no refusal reason observational", () => {
    const folded = foldTwilioOperations({ pins: [pin()], surfaces: [surface({ specId: "twilio_messaging_v1" })] });
    const detail = detailOf({ entity: projectTwilioMethods({ at: AT, folded })[0]! });

    expect(detail.observational).toBe(true);
    expect(detail.excludedBecause).toBe(null);
  });

  // Null rather than a placeholder string: "no pin claims this document" is a fact, and an invented
  // "unknown" is that fact written so it reads like a product Twilio has.
  it("leaves an operation's product null when no pin claims its document", () => {
    const folded = foldTwilioOperations({ pins: [], surfaces: [surface({ specId: "twilio_orphan_v1" })] });
    const detail = detailOf({ entity: projectTwilioMethods({ at: AT, folded })[0]! });

    expect(detail.product).toBe(null);
    expect(projectTwilioMethods({ at: AT, folded })[0]!.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });
});
