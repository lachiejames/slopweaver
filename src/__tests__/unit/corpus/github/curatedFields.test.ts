import { describe, expect, it } from "vitest";

import { authorLoginOf, releaseNameOf, strOrEmpty } from "../../../../corpus/github/curatedFields.js";

describe("strOrEmpty", () => {
  it("keeps a string and reads anything else as the empty string", () => {
    expect(strOrEmpty({ value: "body text" })).toBe("body text");
    expect(strOrEmpty({ value: undefined })).toBe("");
    expect(strOrEmpty({ value: 42 })).toBe("");
  });
});

describe("authorLoginOf", () => {
  it("reads the login off an author object, and nothing off a missing or login-less one", () => {
    expect(authorLoginOf({ value: { login: "octocat" } })).toBe("octocat");
    expect(authorLoginOf({ value: { name: "Octo Cat" } })).toBeUndefined();
    expect(authorLoginOf({ value: null })).toBeUndefined();
  });
});

describe("releaseNameOf", () => {
  it("keeps the release's own name", () => {
    expect(releaseNameOf({ name: "Spring release", tag: "v2.0.0" })).toBe("Spring release");
  });

  it("labels a release published without a name by its tag", () => {
    expect(releaseNameOf({ name: null, tag: "v2.0.0" })).toBe("v2.0.0");
  });
});
