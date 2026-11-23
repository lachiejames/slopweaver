import { describe, expect, it } from "vitest";
import { digestSchema } from "../../../visualEvidence/captureStages.js";

describe("digestSchema", () => {
  it("accepts a sha256 digest in the one spelling every receipt keys on", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(digestSchema.safeParse(digest).success).toBe(true);
  });

  it("refuses an upper-case, short or unprefixed digest, so two spellings never name one picture", () => {
    expect(digestSchema.safeParse(`sha256:${"A".repeat(64)}`).success).toBe(false);
    expect(digestSchema.safeParse(`sha256:${"a".repeat(63)}`).success).toBe(false);
    expect(digestSchema.safeParse("a".repeat(64)).success).toBe(false);
  });
});
