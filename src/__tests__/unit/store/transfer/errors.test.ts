/**
 * The transfer domain's error factories: each message says what to do next, and a thrown cause is carried
 * by its own message. Pure.
 */
import { describe, expect, it } from "vitest";

import { StoreTransferErrors } from "../../../../store/transfer/errors.js";

describe("StoreTransferErrors", () => {
  it("tells an unmanifested directory's reader which flag to pass, and a manifested one's which to drop", () => {
    expect(StoreTransferErrors.manifestAbsent({ dir: "/x" }).message).toBe(
      "/x holds no manifest.json; pass --unmanifested to read an export made before manifests",
    );
    expect(StoreTransferErrors.manifestPresent({ dir: "/x" }).code).toBe("MANIFEST_PRESENT");
  });

  it("names the field a part disagrees with its manifest on, with both values", () => {
    const mismatch = StoreTransferErrors.partMismatch({ actual: "3", expected: "2", field: "rows", part: "memories" });
    expect(mismatch.message).toBe("memories: the manifest promises rows 2 and the file holds 3");
  });

  it("carries an Error cause by its message and any other cause as text", () => {
    expect(StoreTransferErrors.writeFailed({ cause: new Error("EACCES"), path: "/x" }).message).toBe(
      "could not write /x: EACCES",
    );
    expect(StoreTransferErrors.sourceUnreadable({ cause: 42, what: "the store" }).message).toBe(
      "the store would not read: 42",
    );
  });

  it("asks for a rerun when a source moved mid-read", () => {
    expect(StoreTransferErrors.sourceMoved({ path: "/x" }).message).toBe(
      "/x changed while it was being read; run the command again",
    );
  });
});
