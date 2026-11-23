/**
 * How the page-walk engine addresses a screenshot: by the digest of its own bytes, with its length and kind
 * recorded, under the path each atlas builds for itself.
 */
import { describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../../atlas/kit/pageScreenshot.js";

describe("screenshotArtifact", () => {
  it("addresses a screenshot by the digest of its own bytes, so the same picture is the same artifact", () => {
    const path = ({ sha256 }: { sha256: string }): string => sha256;
    const one = screenshotArtifact({ artifactPathFor: path, bytes: new Uint8Array([1, 2, 3]) });
    const two = screenshotArtifact({ artifactPathFor: path, bytes: new Uint8Array([1, 2, 3]) });
    expect(one.sha256).toBe(two.sha256);
  });

  it("records the byte length, so a half-written file is detectable", () => {
    const ref = screenshotArtifact({ artifactPathFor: ({ sha256 }) => sha256, bytes: new Uint8Array([1, 2, 3]) });
    expect(ref.byteLength).toBe(3);
  });

  it("declares the artifact a page screenshot", () => {
    const ref = screenshotArtifact({ artifactPathFor: ({ sha256 }) => sha256, bytes: new Uint8Array([1]) });
    expect(ref.kind).toBe("page-png");
  });

  it("hands the caller's own path builder the digest, so each atlas keeps its own layout", () => {
    const ref = screenshotArtifact({ artifactPathFor: ({ sha256 }) => `pics/${sha256}`, bytes: new Uint8Array([1]) });
    expect(ref.relativePath.startsWith("pics/")).toBe(true);
  });
});
