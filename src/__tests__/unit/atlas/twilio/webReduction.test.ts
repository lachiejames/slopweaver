import { describe, expect, it } from "vitest";

import {
  classifyTwilioSegment,
  isFirstPartyTwilioResponse,
  twilioResponseFieldPaths,
} from "../../../../atlas/twilio/webReduction.js";

describe("redacting what the Twilio console returned", () => {
  // Twilio's own universal identifier: two uppercase letters then 32 hex, which matches no sibling atlas's
  // pattern — reducing a Twilio capture with any of theirs would keep every real SID it saw.
  it("redacts a Twilio SID whatever its type prefix", () => {
    expect(classifyTwilioSegment({ segment: `AC${"a".repeat(32)}` })!.placeholder).toBe("<sid>");
    expect(classifyTwilioSegment({ segment: `PN${"0".repeat(32)}` })!.placeholder).toBe("<sid>");
    expect(classifyTwilioSegment({ segment: `MG${"F".repeat(32)}` })!.placeholder).toBe("<sid>");
  });

  // The one value in this product that is both a path segment and personal data.
  it("redacts an E.164 phone number", () => {
    expect(classifyTwilioSegment({ segment: "+61412345678" })!.placeholder).toBe("<phone>");
    expect(classifyTwilioSegment({ segment: "14155552671" })!.placeholder).toBe("<phone>");
  });

  it("redacts a uuid and a bare run of digits", () => {
    expect(classifyTwilioSegment({ segment: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" })!.placeholder).toBe("<uuid>");
    expect(classifyTwilioSegment({ segment: "42" })!.placeholder).toBe("<n>");
  });

  it("keeps a plain identifier, because that is a field name rather than a value", () => {
    expect(classifyTwilioSegment({ segment: "Messages" })).toBe(null);
    expect(classifyTwilioSegment({ segment: "error_code" })).toBe(null);
    expect(classifyTwilioSegment({ segment: "date-sent" })).toBe(null);
  });

  // The allowlist direction: anything that is not identifier-shaped is a value somebody used as a key.
  it("redacts an email used as an object key, which no value pattern anticipates", () => {
    expect(classifyTwilioSegment({ segment: "a@example.test" })!.placeholder).toBe("<value>");
  });

  it("never collapses two adjacent placeholders, because two SIDs are two records", () => {
    expect(classifyTwilioSegment({ segment: `AC${"a".repeat(32)}` })!.collapsesWithPrevious).toBe(false);
    expect(classifyTwilioSegment({ segment: "+61412345678" })!.collapsesWithPrevious).toBe(false);
  });

  it("classifies an empty segment as nothing at all", () => {
    expect(classifyTwilioSegment({ segment: "" })).toBe(null);
  });

  it("records field NAMES from a response and never a value", () => {
    const paths = twilioResponseFieldPaths({
      body: { messages: [{ error_code: 30007, sid: `SM${"a".repeat(32)}`, status: "undelivered" }] },
    });

    expect(paths).toContain("messages[].status");
    expect(paths).toContain("messages[].error_code");
    expect(paths.join(" ")).not.toContain("undelivered");
    expect(paths.join(" ")).not.toContain("30007");
  });

  it("redacts a phone number used as a key inside a body", () => {
    const paths = twilioResponseFieldPaths({ body: { byNumber: { "+61412345678": { status: "ok" } } } });

    expect(paths.join(" ")).not.toContain("61412345678");
  });
});

describe("judging which captured responses Twilio itself answered", () => {
  const body = { meta: { page: 0 } };

  // The defect this predicate replaced: origin-equality against the console admitted only the console's own
  // captured bodies on a real walk, because Twilio answers from thirty-eight origins and one is the console.
  it("records a call to a product subdomain, which the console-origin test dropped", () => {
    expect(
      isFirstPartyTwilioResponse({ response: { body, url: "https://api.twilio.com/2010-04-01/Accounts.json" } }),
    ).toBe(true);
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://messaging.twilio.com/v1/Services" } })).toBe(
      true,
    );
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://taskrouter.twilio.com/v1/Workspaces" } })).toBe(
      true,
    );
  });

  it("records a call to the console's own origin, which is one host among the thirty-eight", () => {
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://console.twilio.com/api/v2/regions" } })).toBe(
      true,
    );
  });

  it("records the registrable domain itself, not only its subdomains", () => {
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://twilio.com/v1/anything" } })).toBe(true);
  });

  // The CodeQL lesson `isSignInWall` already carries (js/incomplete-url-substring-sanitization, alert 40):
  // a suffix test is true of a lookalike, which would record somebody else's response as Twilio's own.
  it("refuses a lookalike host that merely ends in the domain", () => {
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://eviltwilio.com/v1/Accounts" } })).toBe(false);
  });

  it("refuses a third-party beacon, which is what the host test exists to keep out", () => {
    expect(isFirstPartyTwilioResponse({ response: { body, url: "https://api.segment.io/v1/track" } })).toBe(false);
  });

  it("refuses a body that is not a JSON object, whatever answered it", () => {
    expect(isFirstPartyTwilioResponse({ response: { body: null, url: "https://api.twilio.com/v1/Services" } })).toBe(
      false,
    );
    expect(
      isFirstPartyTwilioResponse({ response: { body: undefined, url: "https://api.twilio.com/v1/Services" } }),
    ).toBe(false);
    expect(
      isFirstPartyTwilioResponse({ response: { body: "a bundle", url: "https://api.twilio.com/v1/Services" } }),
    ).toBe(false);
  });

  it("refuses a url it cannot parse", () => {
    expect(isFirstPartyTwilioResponse({ response: { body, url: "not a url" } })).toBe(false);
  });
});
