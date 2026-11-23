/**
 * The two reductions that turn a value into something safe to keep.
 *
 * Both exist because refusing to read the field would have cost the atlas the question rather than
 * protecting anything, so what is tested is that the useful half survives and the dangerous half does not.
 */
import { describe, expect, it } from "vitest";

import { deployKeyFingerprint, reduceWebhookDestination } from "../../../../atlas/github/privacy.js";

describe("reduceWebhookDestination", () => {
  it("keeps the origin, which answers where our activity goes", () => {
    expect(reduceWebhookDestination({ url: "https://hooks.example.test/services/abc" }).origin).toBe(
      "https://hooks.example.test",
    );
  });

  it("keeps NO part of the path, because a path token can look exactly like a route word", () => {
    const url = "https://hooks.example.test/hook/lowercasebearer";
    const reduced = reduceWebhookDestination({ url });
    expect(reduced.pathDigest).toHaveLength(64);
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(url).toContain("lowercasebearer");
    expect(JSON.stringify(reduced)).not.toContain("lowercasebearer");
  });

  it("keeps two hooks at one destination joinable, which is what the digest is for", () => {
    const first = reduceWebhookDestination({ url: "https://hooks.example.test/api/github/events" });
    const second = reduceWebhookDestination({ url: "https://hooks.example.test/api/github/events" });
    expect(first.pathDigest).toBe(second.pathDigest);
  });

  it("distinguishes two different destinations on one host", () => {
    expect(reduceWebhookDestination({ url: "https://hooks.example.test/a" }).pathDigest).not.toBe(
      reduceWebhookDestination({ url: "https://hooks.example.test/b" }).pathDigest,
    );
  });

  it("covers the query too, where a credential just as often hides", () => {
    expect(reduceWebhookDestination({ url: "https://hooks.example.test/a?token=secret" }).pathDigest).not.toBe(
      reduceWebhookDestination({ url: "https://hooks.example.test/a" }).pathDigest,
    );
  });

  it("drops user-info, which is the other place a credential hides in a URL", () => {
    const reduced = reduceWebhookDestination({ url: "https://user:secret@hooks.example.test/x" });
    expect(reduced.origin).toBe("https://hooks.example.test");
    expect(JSON.stringify(reduced)).not.toContain("secret");
  });

  it("reports nulls for a destination that is not a URL", () => {
    expect(reduceWebhookDestination({ url: "not a url" })).toEqual({ origin: null, pathDigest: null });
  });

  it("reports nulls when GitHub returned no destination at all", () => {
    expect(reduceWebhookDestination({ url: null })).toEqual({ origin: null, pathDigest: null });
  });
});

describe("deployKeyFingerprint", () => {
  it("produces a stable digest, so one key reused across repositories is joinable", () => {
    const first = deployKeyFingerprint({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterial" });
    const second = deployKeyFingerprint({ key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterial" });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it("produces a different digest for a different key", () => {
    expect(deployKeyFingerprint({ key: "ssh-ed25519 AAAA-one" })).not.toBe(
      deployKeyFingerprint({ key: "ssh-ed25519 AAAA-two" }),
    );
  });

  it("returns null when there is no key material to digest", () => {
    expect(deployKeyFingerprint({ key: null })).toBe(null);
  });

  it("returns null for whitespace, which is not key material", () => {
    expect(deployKeyFingerprint({ key: "   " })).toBe(null);
  });
});
