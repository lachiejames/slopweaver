/**
 * The pure skip decision behind the courier's prefix cache: a proof stands only while every stat field and the
 * frontier are exactly what it was taken over.
 */
import { describe, expect, it } from "vitest";

import {
  type PrefixProof,
  type PrefixStat,
  prefixStillVerified,
  statUnmoved,
} from "../../../talk/unreadPrefixCache.js";

const STAT: PrefixStat = { ctimeNs: 5_000n, dev: 1n, ino: 42n, mtimeNs: 4_000n, size: 900n };
const FRONTIER = { offset: 600, prefixSha256: "sha256:aa" };
const PROOF: PrefixProof = { ...FRONTIER, stat: STAT };

describe("prefixStillVerified", () => {
  it("skips re-verification when the stat and the frontier are both unchanged", () => {
    expect(prefixStillVerified({ cached: PROOF, frontier: FRONTIER, stat: { ...STAT } })).toBe(true);
  });

  it("re-verifies when this process holds no proof for the file", () => {
    expect(prefixStillVerified({ cached: undefined, frontier: FRONTIER, stat: STAT })).toBe(false);
  });

  it.each([
    ["dev", { dev: 2n }],
    ["ino", { ino: 43n }],
    ["size", { size: 901n }],
    ["mtimeNs", { mtimeNs: 4_001n }],
    ["ctimeNs", { ctimeNs: 5_001n }],
  ] as const)("re-verifies when %s moved", (_field, moved) => {
    expect(prefixStillVerified({ cached: PROOF, frontier: FRONTIER, stat: { ...STAT, ...moved } })).toBe(false);
  });

  it("re-verifies when the frontier advanced, even over an unchanged file", () => {
    expect(
      prefixStillVerified({ cached: PROOF, frontier: { offset: 900, prefixSha256: "sha256:bb" }, stat: STAT }),
    ).toBe(false);
  });

  it("re-verifies when the frontier's hash differs at the same offset", () => {
    expect(
      prefixStillVerified({ cached: PROOF, frontier: { offset: 600, prefixSha256: "sha256:ab" }, stat: STAT }),
    ).toBe(false);
  });
});

describe("statUnmoved — the re-stat a trusted pass takes after reading its tail", () => {
  it("holds for a copy of the same stat", () => {
    expect(statUnmoved({ after: { ...STAT }, before: STAT })).toBe(true);
  });

  it("fails when only ctime moved, as a same-size rewrite with its mtime put back leaves it", () => {
    expect(statUnmoved({ after: { ...STAT, ctimeNs: 5_001n }, before: STAT })).toBe(false);
  });
});
