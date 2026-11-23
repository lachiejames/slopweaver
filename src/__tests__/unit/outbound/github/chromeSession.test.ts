import { describe, expect, it } from "vitest";

import { loginFromStorageState } from "../../../../outbound/github/chromeSession.js";

describe("loginFromStorageState", () => {
  it("answers the dotcom_user value from among unrelated cookies", () => {
    const json = JSON.stringify({
      cookies: [
        { name: "logged_in", value: "yes" },
        { name: "dotcom_user", value: "octo-person" },
        { name: "_gh_sess", value: "opaque" },
      ],
      origins: [],
    });

    expect(loginFromStorageState({ json })).toBe("octo-person");
  });

  it("answers undefined when the cookies member is not an array", () => {
    expect(loginFromStorageState({ json: JSON.stringify({ cookies: { name: "dotcom_user" } }) })).toBe(undefined);
  });

  it("answers undefined for a document that is not JSON", () => {
    expect(loginFromStorageState({ json: "{ cookies: [" })).toBe(undefined);
  });

  it("answers undefined when the dotcom_user cookie's value is not a string", () => {
    expect(loginFromStorageState({ json: JSON.stringify({ cookies: [{ name: "dotcom_user", value: 42 }] }) })).toBe(
      undefined,
    );
  });
});
