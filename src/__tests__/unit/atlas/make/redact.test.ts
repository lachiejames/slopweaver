/** Unit: stripping the Make API token from text this door does not author. */
import { describe, expect, it } from "vitest";

import { redactMakeToken, redactMakeTokenDeep } from "../../../../atlas/make/redact.js";

describe("redactMakeToken", () => {
  it("replaces every echo of the token in a provider's failure text with the secret's name", () => {
    const text = '401 Unauthorized: {"detail":"SECRET-TOKEN is invalid","token":"SECRET-TOKEN"}';
    expect(text).toContain("SECRET-TOKEN");
    expect(redactMakeToken({ text, token: "SECRET-TOKEN" })).toBe(
      '401 Unauthorized: {"detail":"[make-api-token] is invalid","token":"[make-api-token]"}',
    );
  });

  it("leaves text alone when the token is empty, rather than splicing a marker between every character", () => {
    expect(redactMakeToken({ text: "403 Forbidden", token: "" })).toBe("403 Forbidden");
  });
});

describe("redactMakeTokenDeep", () => {
  it("strips the token from an allowlisted field a Make user typed it into, at any depth, keeping the shape", () => {
    const body = {
      pg: { limit: 100 },
      scenarios: [{ description: "uses SECRET-TOKEN for auth", id: 7, isActive: true, tags: ["SECRET-TOKEN"] }],
    };
    expect(JSON.stringify(body)).toContain("SECRET-TOKEN");
    expect(redactMakeTokenDeep({ token: "SECRET-TOKEN", value: body })).toStrictEqual({
      pg: { limit: 100 },
      scenarios: [{ description: "uses [make-api-token] for auth", id: 7, isActive: true, tags: ["[make-api-token]"] }],
    });
  });

  it("passes a body with no token in it through unchanged", () => {
    expect(redactMakeTokenDeep({ token: "SECRET-TOKEN", value: [1, null, "plain", { a: false }] })).toStrictEqual([
      1,
      null,
      "plain",
      { a: false },
    ]);
  });
});
