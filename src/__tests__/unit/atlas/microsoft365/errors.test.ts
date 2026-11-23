import { describe, expect, it } from "vitest";

import { Microsoft365AtlasErrors, microsoft365AtlasErrorLines } from "../../../../atlas/microsoft365/errors.js";

describe("Microsoft365AtlasErrors", () => {
  it("renders an unparseable specification with its cause", () => {
    const error = Microsoft365AtlasErrors.specUnparseable({ cause: new Error("bad indentation") });
    expect(error.code).toBe("SPEC_UNPARSEABLE");
    expect(error.message).toBe("the pinned Microsoft Graph specification could not be parsed: bad indentation");
  });

  it("renders the two shape refusals", () => {
    expect(Microsoft365AtlasErrors.specNotMapping()).toEqual({
      code: "SPEC_NOT_MAPPING",
      message: "the pinned Microsoft Graph specification is not a YAML mapping",
    });
    expect(Microsoft365AtlasErrors.specWithoutPaths()).toEqual({
      code: "SPEC_WITHOUT_PATHS",
      message: "the pinned Microsoft Graph specification declares no `paths` section",
    });
  });

  it("carries a digest mismatch as two lines, the expected digest and commit filled from the pin", () => {
    const error = Microsoft365AtlasErrors.digestMismatch({ got: "abc" });
    expect(error.code).toBe("DIGEST_MISMATCH");
    expect(microsoft365AtlasErrorLines({ error })).toEqual([
      "the pinned Microsoft Graph specification did not hash to its pin: got abc, expected 6e3a4c9bab98c7c759742769fae115e8c50241674ffc99d834d223ab93c91889",
      "the pin addresses an immutable commit (de1a61e44c3794b8818cf6455b0fb089d0e5e1c9), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached",
    ]);
    expect(error.message).toBe(
      "the pinned Microsoft Graph specification did not hash to its pin: got abc, expected 6e3a4c9bab98c7c759742769fae115e8c50241674ffc99d834d223ab93c91889; the pin addresses an immutable commit (de1a61e44c3794b8818cf6455b0fb089d0e5e1c9), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached",
    );
  });

  it("names a byte-length mismatch against the pinned length", () => {
    const error = Microsoft365AtlasErrors.byteLengthMismatch({ got: 9 });
    expect(error.code).toBe("BYTE_LENGTH_MISMATCH");
    expect(microsoft365AtlasErrorLines({ error })).toEqual([
      "the pinned Microsoft Graph specification is 9 bytes, expected 44146442",
    ]);
  });

  it("carries a refused fetch as the status line and the fixed-address line", () => {
    const error = Microsoft365AtlasErrors.fetchRefused({ status: 503 });
    expect(error.code).toBe("FETCH_REFUSED");
    expect(microsoft365AtlasErrorLines({ error })).toEqual([
      "fetching the pinned Microsoft Graph specification returned HTTP 503",
      "the address is fixed at https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/de1a61e44c3794b8818cf6455b0fb089d0e5e1c9/openapi/v1.0/openapi.yaml and is not configurable",
    ]);
  });

  it("renders a failed fetch whose cause is not an Error", () => {
    const error = Microsoft365AtlasErrors.fetchFailed({ cause: "boom" });
    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("fetching the pinned Microsoft Graph specification failed: boom");
  });

  it("names the cache path it could not write", () => {
    const error = Microsoft365AtlasErrors.cacheUnwritable({ cause: new Error("ENOSPC"), path: "/x/graph.yaml" });
    expect(error.code).toBe("CACHE_UNWRITABLE");
    expect(microsoft365AtlasErrorLines({ error })).toEqual([
      "the pinned Microsoft Graph specification could not be cached at /x/graph.yaml: ENOSPC",
    ]);
  });

  it("carries unknown roots as the count line and the fixed instruction", () => {
    const error = Microsoft365AtlasErrors.rootsUnknown({ unknownRoots: ["a", "b"] });
    expect(error.code).toBe("ROOTS_UNKNOWN");
    expect(microsoft365AtlasErrorLines({ error })).toEqual([
      "the pinned specification declares 2 resource root(s) this build does not: a, b",
      "nothing was published — a new root is Microsoft adding a workload, which is exactly the unknown unknown this atlas exists to surface. Add it to MICROSOFT365_KINDS and to stateHome.ts, then run again",
    ]);
  });
});
