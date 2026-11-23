import { describe, expect, it } from "vitest";

import { isGoogleAdminSignInUrl } from "../../../../atlas/googleAdmin/browserPages.js";

describe("isGoogleAdminSignInUrl — any Google accounts page is the owner's sign-in", () => {
  it.each([
    ["https://accounts.google.com/v3/signin/identifier?continue=x", true],
    ["https://accounts.google.com/v2/challenge/pwd", true],
    ["https://accounts.google.com/ServiceLogin?service=CPanel", true],
    ["https://admin.google.com/ac/home", false],
    ["https://admin.google.com/ac/billing/subscriptions", false],
    ["https://accounts.google.com.evil.example/v3/signin", false],
    ["not a url", false],
  ])("%s → %s", (finalUrl, expected) => {
    expect(isGoogleAdminSignInUrl({ finalUrl })).toBe(expected);
  });
});
