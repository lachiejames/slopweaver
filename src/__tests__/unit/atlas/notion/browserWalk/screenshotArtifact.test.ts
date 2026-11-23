/*
 * How `notionScreenshotArtifact` addresses a proof screenshot: by the digest of its own bytes, with its length
 * and the kit's reserved kind.
 */
import { describe, expect, it } from "vitest";

import { notionScreenshotArtifact } from "../../../../../atlas/notion/browserWalk.js";

describe("notionScreenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes, so a proof cannot be swapped", () => {
    const ref = notionScreenshotArtifact({ bytes: new Uint8Array([1, 2, 3]) });
    expect(ref.relativePath).toBe(`artifacts/pages/${ref.sha256}.png`);
  });

  it("records the byte length it saw", () => {
    expect(notionScreenshotArtifact({ bytes: new Uint8Array([1, 2, 3]) }).byteLength).toBe(3);
  });

  it("declares the kind the kit reserves for a proof screenshot", () => {
    expect(notionScreenshotArtifact({ bytes: new Uint8Array([1]) }).kind).toBe("page-png");
  });

  it("gives the same bytes the same address twice", () => {
    const left = notionScreenshotArtifact({ bytes: new Uint8Array([9, 9]) });
    const right = notionScreenshotArtifact({ bytes: new Uint8Array([9, 9]) });
    expect(left.sha256).toBe(right.sha256);
  });
});
