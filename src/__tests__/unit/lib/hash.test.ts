/**
 * The shared content-hash helpers: the tagged `sha256:<hex>` form and the bare hex one.
 */
import { describe, expect, it } from "vitest";

import { sha256Hex, sha256Text } from "../../../lib/hash.js";

describe("sha256Text", () => {
  it("hashes known text to its known sha256 digest", () => {
    expect(sha256Text({ text: "abc" })).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes the empty string to its known digest", () => {
    expect(sha256Text({ text: "" })).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("produces different hashes for different text", () => {
    expect(sha256Text({ text: "one" })).not.toBe(sha256Text({ text: "two" }));
  });

  it("is deterministic for the same text", () => {
    expect(sha256Text({ text: "repeat me" })).toBe(sha256Text({ text: "repeat me" }));
  });
});

describe("sha256Hex", () => {
  it("hashes known text to its bare hex digest, with no tag", () => {
    expect(sha256Hex({ bytes: "abc" })).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes bytes identically to the same text", () => {
    expect(sha256Hex({ bytes: new TextEncoder().encode("abc") })).toBe(sha256Hex({ bytes: "abc" }));
  });
});
