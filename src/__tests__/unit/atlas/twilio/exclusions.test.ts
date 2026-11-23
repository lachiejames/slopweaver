import { describe, expect, it } from "vitest";

import { isTwilioObservational, twilioExclusionFor } from "../../../../atlas/twilio/exclusions.js";

describe("which Twilio operations this atlas may call", () => {
  it("calls a GET and nothing else", () => {
    expect(isTwilioObservational({ method: "GET" })).toBe(true);
    expect(isTwilioObservational({ method: "POST" })).toBe(false);
    expect(isTwilioObservational({ method: "PUT" })).toBe(false);
    expect(isTwilioObservational({ method: "PATCH" })).toBe(false);
    expect(isTwilioObservational({ method: "DELETE" })).toBe(false);
  });

  it("gives a GET no refusal reason at all", () => {
    expect(twilioExclusionFor({ method: "GET" })).toBe(null);
  });

  // The measured reason a read-through-POST exemption is NOT taken here: the read-shaped POSTs and the
  // ones that spend a one-time code share no marker to key a rule on.
  it("refuses a POST on the grounds that the same verb reads and writes", () => {
    expect(twilioExclusionFor({ method: "POST" })).toContain("no naming convention");
  });

  it("names destruction as the reason a DELETE is refused", () => {
    expect(twilioExclusionFor({ method: "DELETE" })).toContain("destroy the ground truth it maps");
  });

  it("refuses PUT and PATCH by naming the method that would change a record", () => {
    expect(twilioExclusionFor({ method: "PUT" })).toBe(
      "PUT changes a record in this account — this atlas only ever reads",
    );
    expect(twilioExclusionFor({ method: "PATCH" })).toBe(
      "PATCH changes a record in this account — this atlas only ever reads",
    );
  });
});
