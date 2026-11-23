import { describe, expect, it } from "vitest";

import { CanvaAtlasErrors } from "../../../../atlas/canva/errors.js";

describe("CanvaAtlasErrors.registryInvalid", () => {
  it("carries the detail and names the regeneration command", () => {
    const error = CanvaAtlasErrors.registryInvalid({ detail: "duplicate surface id" });
    expect(error).toEqual({
      code: "REGISTRY_INVALID",
      detail: "duplicate surface id",
      message:
        "the compiled Canva surface registry is not self-consistent: duplicate surface id — regenerate it with yarn tsx tools/generateCanvaSurfaces.ts --spec-dir <dir>",
    });
  });

  it("keeps an empty detail verbatim", () => {
    const error = CanvaAtlasErrors.registryInvalid({ detail: "" });
    expect(error).toEqual({
      code: "REGISTRY_INVALID",
      detail: "",
      message:
        "the compiled Canva surface registry is not self-consistent:  — regenerate it with yarn tsx tools/generateCanvaSurfaces.ts --spec-dir <dir>",
    });
  });
});

describe("CanvaAtlasErrors.storeUnreadable", () => {
  it("joins several reasons with a semicolon and carries them", () => {
    const error = CanvaAtlasErrors.storeUnreadable({ reasons: ["manifest is newer", "kind file missing"] });
    expect(error).toEqual({
      code: "STORE_UNREADABLE",
      message: "the Canva atlas generation on disk could not be read: manifest is newer; kind file missing",
      reasons: ["manifest is newer", "kind file missing"],
    });
  });

  it("renders one reason without a separator", () => {
    const error = CanvaAtlasErrors.storeUnreadable({ reasons: ["manifest is newer"] });
    expect(error).toEqual({
      code: "STORE_UNREADABLE",
      message: "the Canva atlas generation on disk could not be read: manifest is newer",
      reasons: ["manifest is newer"],
    });
  });

  it("ends the message at the colon and space when there are no reasons", () => {
    const error = CanvaAtlasErrors.storeUnreadable({ reasons: [] });
    expect(error).toEqual({
      code: "STORE_UNREADABLE",
      message: "the Canva atlas generation on disk could not be read: ",
      reasons: [],
    });
  });
});

describe("CanvaAtlasErrors.storeUnwritable", () => {
  it("joins several reasons with a semicolon and carries them", () => {
    const error = CanvaAtlasErrors.storeUnwritable({ reasons: ["EACCES on atlas dir", "disk full"] });
    expect(error).toEqual({
      code: "STORE_UNWRITABLE",
      message: "the Canva atlas store could not be written: EACCES on atlas dir; disk full",
      reasons: ["EACCES on atlas dir", "disk full"],
    });
  });

  it("renders one reason without a separator", () => {
    const error = CanvaAtlasErrors.storeUnwritable({ reasons: ["EACCES on atlas dir"] });
    expect(error).toEqual({
      code: "STORE_UNWRITABLE",
      message: "the Canva atlas store could not be written: EACCES on atlas dir",
      reasons: ["EACCES on atlas dir"],
    });
  });

  it("ends the message at the colon and space when there are no reasons", () => {
    const error = CanvaAtlasErrors.storeUnwritable({ reasons: [] });
    expect(error).toEqual({
      code: "STORE_UNWRITABLE",
      message: "the Canva atlas store could not be written: ",
      reasons: [],
    });
  });
});
