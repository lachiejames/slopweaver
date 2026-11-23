import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyAndCompile } from "../../../../atlas/twilio/specFetch.js";
import type { TwilioSpecPin } from "../../../../atlas/twilio/specPin.js";

/** The smallest document this reader compiles, so a digest test is about the digest. */
const text = JSON.stringify({
  info: { title: "Twilio - Test" },
  paths: {
    "/v1/Things": {
      get: {
        responses: {
          "200": {
            content: { "application/json": { schema: { properties: { sid: { type: "string" } }, type: "object" } } },
          },
        },
      },
    },
  },
  servers: [{ url: "https://test.twilio.com" }],
});

/** A pin matching the document above, unless a test moves a field. */
function pin(over: Partial<TwilioSpecPin> = {}): TwilioSpecPin {
  return {
    byteLength: Buffer.byteLength(text),
    hosts: ["https://test.twilio.com"],
    id: "twilio_test_v1",
    operationCount: 1,
    pathCount: 1,
    product: "test",
    securitySchemes: [],
    sha256: createHash("sha256").update(text).digest("hex"),
    title: "Twilio - Test",
    url: "https://raw.githubusercontent.com/twilio/twilio-oai/2.8.1/spec/json/twilio_test_v1.json",
    version: "v1",
    ...over,
  };
}

describe("verifying and compiling one pinned Twilio definition", () => {
  it("reports no drift when the bytes are exactly the ones that were reviewed", () => {
    const compiled = verifyAndCompile({ pin: pin(), text });

    expect(compiled.isOk()).toBe(true);
    expect(compiled._unsafeUnwrap().drift).toBe(null);
    expect(compiled._unsafeUnwrap().surface.operations.length).toBe(1);
  });

  // The design decision `errors.ts` carries: refusing on a digest makes the atlas unbuildable the day the
  // vendor ships, so a moved document is COMPILED and recorded.
  it("compiles a document whose bytes have moved and records the movement", () => {
    const compiled = verifyAndCompile({ pin: pin({ byteLength: 1, sha256: "0".repeat(64) }), text });

    expect(compiled.isOk()).toBe(true);
    const value = compiled._unsafeUnwrap();
    expect(value.surface.operations.length).toBe(1);
    expect(value.drift!.expectedSha256).toBe("0".repeat(64));
    expect(value.drift!.actualByteLength).toBe(Buffer.byteLength(text));
    expect(value.drift!.expectedByteLength).toBe(1);
  });

  it("refuses a body that is not JSON at all, naming the document", () => {
    const compiled = verifyAndCompile({ pin: pin(), text: "<html>404</html>" });

    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr().code).toBe("SPEC_UNPARSABLE");
    expect(compiled._unsafeUnwrapErr().specId).toBe("twilio_test_v1");
  });

  it("refuses JSON that is not a definition this reader can compile", () => {
    const compiled = verifyAndCompile({ pin: pin(), text: JSON.stringify({ info: { title: "x" } }) });

    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr().message).toContain("could not be compiled into operations");
  });
});
