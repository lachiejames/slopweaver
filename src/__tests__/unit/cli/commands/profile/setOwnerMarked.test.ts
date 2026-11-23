import { describe, expect, it } from "vitest";

import { ownerMarkLines } from "../../../../../cli/commands/profile/setOwnerMarked.js";
import { err, ok } from "../../../../../lib/result.js";

describe("ownerMarkLines", () => {
  it("names the lock's holder and nothing else when another write holds the lock", () => {
    expect(ownerMarkLines({ marked: { kind: "locked", reason: "held by pid 42" } })).toEqual([
      "profile set: refused, because another profile write holds the owner-write lock; run it again once that one finishes (held by pid 42)",
    ]);
  });

  it("names every home that could not take a mark, then every mark left standing", () => {
    const lines = ownerMarkLines({
      marked: { failed: ["/h/one", "/h/two"], kept: ["/h/one/profile/owner-written"], kind: "refused" },
    });

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("because /h/one cannot take the owner-written mark");
    expect(lines[1]).toContain("because /h/two cannot take the owner-written mark");
    expect(lines[2]).toContain("the owner-written mark at /h/one/profile/owner-written stays");
  });

  it("says only which marks a failed write kept, never a refusal", () => {
    const lines = ownerMarkLines({
      marked: { kept: ["/h/profile/owner-written"], kind: "attempted", result: err("store said no") },
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("the owner-written mark at /h/profile/owner-written stays although the write failed");
  });

  it("says nothing for a write that landed and kept no stray mark", () => {
    expect(ownerMarkLines({ marked: { kept: [], kind: "attempted", result: ok(3) } })).toEqual([]);
  });
});
