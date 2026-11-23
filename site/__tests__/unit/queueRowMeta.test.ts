/**
 * What a collapsed Queue card says beside its title: which kind of request it is, and its priority
 * only when there is a read on one.
 */
import { describe, expect, it } from "vitest";

import { collapsedPriorityOf, KIND_WORD } from "../../lib/queueRowMeta";

describe("collapsedPriorityOf", () => {
  it("takes the most urgent band among the inherited tags and the ask's own", () => {
    const tags = [
      { key: "priority", value: "p2" },
      { key: "workstream", value: "queue" },
      { key: "priority", value: "p1" },
    ];

    expect(collapsedPriorityOf({ own: "p3", tags })).toBe("p1");
    expect(collapsedPriorityOf({ own: "p0", tags })).toBe("p0");
  });

  it("draws nothing when there is no read on one, or the value is no band", () => {
    expect(collapsedPriorityOf({ own: undefined, tags: [] })).toBeUndefined();
    expect(collapsedPriorityOf({ own: "urgent", tags: [{ key: "priority", value: "high" }] })).toBeUndefined();
  });
});

describe("KIND_WORD", () => {
  it("names an ask as an ask and a held reply as a held reply", () => {
    expect(KIND_WORD.ask).toBe("ask");
    expect(KIND_WORD.draft).toBe("held reply");
    expect(KIND_WORD.post).toBe("draft as you");
  });
});
