import { describe, expect, it } from "vitest";

import { SliceStoreErrors } from "../../../corpus/sliceStore.errors.js";

describe("SliceStoreErrors", () => {
  it("builds SLICE_NOT_FOUND naming the capture command for the missing slice", () => {
    expect(SliceStoreErrors.notFound({ name: "q3-baseline" })).toEqual({
      code: "SLICE_NOT_FOUND",
      message:
        "no slice named `q3-baseline` — capture one first: slopweaver slice capture --name q3-baseline --root <dir>",
      name: "q3-baseline",
    });
  });

  it("builds SLICE_UNREADABLE rendering the cause and refusing to read as absent", () => {
    expect(SliceStoreErrors.unreadable({ cause: new Error("EACCES"), name: "q3-baseline" })).toEqual({
      code: "SLICE_UNREADABLE",
      message:
        "slice `q3-baseline` could not be read (Error: EACCES) — this is NOT the same as it being absent, and it must not be treated as one",
      name: "q3-baseline",
    });
  });

  it("builds SLICE_INVALID_JSON", () => {
    expect(SliceStoreErrors.invalidJson({ name: "q3-baseline" })).toEqual({
      code: "SLICE_INVALID_JSON",
      message: "slice `q3-baseline` is not valid JSON — refusing to treat a corrupt pin as a missing one",
      name: "q3-baseline",
    });
  });

  it("builds SLICE_MISSING_FIELDS", () => {
    expect(SliceStoreErrors.missingFields({ name: "q3-baseline" })).toEqual({
      code: "SLICE_MISSING_FIELDS",
      message: "slice `q3-baseline` is missing required fields — refusing to compare against a partial pin",
      name: "q3-baseline",
    });
  });

  it("builds SLICE_INVALID_NAME naming the allowed alphabet", () => {
    expect(SliceStoreErrors.invalidName({ name: "Bad Name" })).toEqual({
      code: "SLICE_INVALID_NAME",
      message: "`Bad Name` is not a usable slice name — lower-case letters, digits and hyphens only",
      name: "Bad Name",
    });
  });

  it("builds SLICE_ALREADY_EXISTS pointing at --overwrite", () => {
    expect(SliceStoreErrors.alreadyExists({ name: "q3-baseline" })).toEqual({
      code: "SLICE_ALREADY_EXISTS",
      message:
        "slice `q3-baseline` already has a pin on disk — re-capturing would discard the baseline every later run compares against. Pass --overwrite if that is what you want.",
      name: "q3-baseline",
    });
  });

  it("builds SLICE_WRITE_FAILED rendering the cause", () => {
    expect(SliceStoreErrors.writeFailed({ cause: new Error("ENOSPC"), name: "q3-baseline" })).toEqual({
      code: "SLICE_WRITE_FAILED",
      message: "could not write slice `q3-baseline`: Error: ENOSPC",
      name: "q3-baseline",
    });
  });

  it("renders a non-Error cause through String", () => {
    expect(SliceStoreErrors.writeFailed({ cause: "disk full", name: "x" }).message).toBe(
      "could not write slice `x`: disk full",
    );
  });
});
