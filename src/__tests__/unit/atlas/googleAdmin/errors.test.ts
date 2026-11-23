import { describe, expect, it } from "vitest";

import { GoogleAdminAtlasErrors } from "../../../../atlas/googleAdmin/errors.js";

describe("GoogleAdminAtlasErrors.publishRefused", () => {
  it("joins several reasons with a semicolon and carries them", () => {
    const error = GoogleAdminAtlasErrors.publishRefused({ reasons: ["token-shaped value", "email address"] });
    expect(error).toEqual({
      code: "PUBLISH_REFUSED",
      message: "the Google Admin generation was refused rather than published: token-shaped value; email address",
      reasons: ["token-shaped value", "email address"],
    });
  });

  it("renders one reason without a separator", () => {
    const error = GoogleAdminAtlasErrors.publishRefused({ reasons: ["token-shaped value"] });
    expect(error).toEqual({
      code: "PUBLISH_REFUSED",
      message: "the Google Admin generation was refused rather than published: token-shaped value",
      reasons: ["token-shaped value"],
    });
  });

  it("ends the message at the colon and space when there are no reasons", () => {
    const error = GoogleAdminAtlasErrors.publishRefused({ reasons: [] });
    expect(error).toEqual({
      code: "PUBLISH_REFUSED",
      message: "the Google Admin generation was refused rather than published: ",
      reasons: [],
    });
  });
});

describe("GoogleAdminAtlasErrors.registryInvalid", () => {
  it("carries the detail and names the regeneration command", () => {
    const error = GoogleAdminAtlasErrors.registryInvalid({ detail: "duplicate surface id" });
    expect(error).toEqual({
      code: "REGISTRY_INVALID",
      detail: "duplicate surface id",
      message:
        "the compiled Google Admin surface registry is not self-consistent: duplicate surface id — regenerate it with yarn tsx tools/generateGoogleAdminSurfaces.ts",
    });
  });

  it("keeps an empty detail verbatim", () => {
    const error = GoogleAdminAtlasErrors.registryInvalid({ detail: "" });
    expect(error).toEqual({
      code: "REGISTRY_INVALID",
      detail: "",
      message:
        "the compiled Google Admin surface registry is not self-consistent:  — regenerate it with yarn tsx tools/generateGoogleAdminSurfaces.ts",
    });
  });
});
