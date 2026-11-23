/**
 * The one reduction of a blocked page to the origin the ask log stores — a path or query can carry a token, so only
 * the bare HTTPS origin is ever written or accepted back.
 */
import { describe, expect, it } from "vitest";

import { isSignInOrigin, signInOriginOf } from "../../../../live/ask/signInOrigin.js";

describe("signInOriginOf", () => {
  it("reduces an HTTPS page to its bare origin, dropping the path and query", () => {
    expect(signInOriginOf({ url: "https://admin.google.com/ac/users?token=x#y" })).toBe("https://admin.google.com");
  });

  it("refuses an HTTP page and a value that is not a URL", () => {
    expect([signInOriginOf({ url: "http://admin.google.com" }), signInOriginOf({ url: "admin" })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("isSignInOrigin", () => {
  it("accepts only an exact bare HTTPS origin", () => {
    expect(
      ["https://admin.google.com", "https://admin.google.com/", "https://admin.google.com/ac", "http://x.com"].map(
        (value) => isSignInOrigin({ value }),
      ),
    ).toEqual([true, false, false, false]);
  });
});
