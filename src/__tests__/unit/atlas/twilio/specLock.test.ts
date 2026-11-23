import { describe, expect, it } from "vitest";

import { TWILIO_SPEC_COMMIT, TWILIO_SPEC_PINS, TWILIO_SPEC_TAG } from "../../../../atlas/twilio/generated/specLock.js";

describe("the pinned Twilio definition lock", () => {
  it("pins every published definition, not just the newest of each product", () => {
    expect(TWILIO_SPEC_PINS.length).toBe(60);
    const chat = TWILIO_SPEC_PINS.filter((pin) => pin.product === "chat").map((pin) => pin.version);
    expect([...chat].toSorted()).toEqual(["v1", "v2", "v3"]);
  });

  // `pin.url` is the only address ever fetched and no caller supplies one, so every url has to be pinned
  // at the reviewed tag rather than at a moving branch.
  it("addresses every document at the reviewed tag", () => {
    for (const pin of TWILIO_SPEC_PINS) {
      expect(
        pin.url.startsWith(`https://raw.githubusercontent.com/twilio/twilio-oai/${TWILIO_SPEC_TAG}/spec/json/`),
      ).toBe(true);
    }
  });

  it("records the commit the tag resolved to, because a tag is mutable and a commit is not", () => {
    expect(TWILIO_SPEC_TAG).toBe("2.8.1");
    expect(TWILIO_SPEC_COMMIT).toBe("ef1d81e7b6e49e602530601e913eedc21aedd6da");
  });

  it("gives every pin a full-length digest and a positive census", () => {
    for (const pin of TWILIO_SPEC_PINS) {
      expect(pin.sha256.length).toBe(64);
      expect(pin.byteLength).toBeGreaterThan(0);
      expect(pin.pathCount).toBeGreaterThan(0);
    }
  });

  it("names one id exactly once, so two rows cannot claim the same document", () => {
    expect(new Set(TWILIO_SPEC_PINS.map((pin) => pin.id)).size).toBe(TWILIO_SPEC_PINS.length);
  });

  // The fact a path alone cannot carry: Twilio answers from a different subdomain per product.
  it("records the origin each document's operations answer on", () => {
    const messaging = TWILIO_SPEC_PINS.find((pin) => pin.id === "twilio_messaging_v1")!;
    expect([...messaging.hosts]).toEqual(["https://messaging.twilio.com"]);

    const account = TWILIO_SPEC_PINS.find((pin) => pin.id === "twilio_api_v2010")!;
    expect([...account.hosts]).toEqual(["https://api.twilio.com"]);
  });

  it("records which credential each API requires", () => {
    const account = TWILIO_SPEC_PINS.find((pin) => pin.id === "twilio_api_v2010")!;
    expect([...account.securitySchemes]).toEqual(["accountSid_authToken"]);
  });

  it("parses a product and version out of every stem, including the one carrying no version", () => {
    const organizations = TWILIO_SPEC_PINS.find((pin) => pin.id === "twilio_iam_organizations")!;
    expect(organizations.product).toBe("iam_organizations");
    expect(organizations.version).toBe("unversioned");
  });
});
