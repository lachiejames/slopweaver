import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { stableEntityId, stableGapId } from "../../../../atlas/kit/identity.js";

/** The digest of a canonical string, written out by hand so the expectation does not reuse the encoder under test. */
function digestOf({ canonical }: { canonical: string }): string {
  return createHash("sha1").update(canonical).digest("hex").slice(0, 32);
}

describe("stableEntityId", () => {
  it("hashes the namespace and the key-sorted components, a null component written as ` null`", () => {
    const id = stableEntityId({ components: { id: "abc", label: "", parent: null }, namespace: "vanta:control" });

    expect(id).toBe(digestOf({ canonical: "vanta:control:id=abclabel=parent= null" }));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives one identity whatever order the caller lists the components in", () => {
    const listed = stableEntityId({ components: { id: "abc", label: "", parent: null }, namespace: "vanta:control" });
    const reordered = stableEntityId({
      components: { parent: null, label: "", id: "abc" },
      namespace: "vanta:control",
    });

    expect(reordered).toBe(listed);
  });

  it("orders keys by code unit, so an upper-case key sorts before every lower-case one", () => {
    expect(stableEntityId({ components: { a: "2", B: "1" }, namespace: "ns" })).toBe(
      digestOf({ canonical: "ns:B=1a=2" }),
    );
  });

  it("keeps a null component apart from an empty string", () => {
    const absent = stableEntityId({ components: { parent: null }, namespace: "vanta:control" });
    const empty = stableEntityId({ components: { parent: "" }, namespace: "vanta:control" });

    expect(absent).toBe(digestOf({ canonical: "vanta:control:parent= null" }));
    expect(empty).toBe(digestOf({ canonical: "vanta:control:parent=" }));
    expect(absent).not.toBe(empty);
  });

  it("keeps two atlases holding the same provider id apart by namespace", () => {
    const vanta = stableEntityId({ components: { id: "1" }, namespace: "vanta:control" });
    const jumpcloud = stableEntityId({ components: { id: "1" }, namespace: "jumpcloud:system" });

    expect(vanta).toBe(digestOf({ canonical: "vanta:control:id=1" }));
    expect(jumpcloud).toBe(digestOf({ canonical: "jumpcloud:system:id=1" }));
  });

  it("hashes a tuple with no components as the namespace alone", () => {
    expect(stableEntityId({ components: {}, namespace: "vanta:control" })).toBe(
      digestOf({ canonical: "vanta:control:" }),
    );
  });
});

describe("stableGapId", () => {
  it("hashes the condition and the scope under the gap prefix", () => {
    expect(stableGapId({ condition: "no-owner", scope: "zone/example.com" })).toBe(
      digestOf({ canonical: "gap:no-owner:zone/example.com" }),
    );
  });
});
