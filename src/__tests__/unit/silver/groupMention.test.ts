import { describe, expect, it } from "vitest";

import {
  type GroupLookup,
  groupLookupLines,
  lookupGroup,
  type MentionGroup,
  normaliseGroupToken,
} from "../../../silver/groupMention.js";

/** The resolved arm, or a throw — so an assertion never has to carry a conditional (testing.md). */
function resolved({ lookup }: { lookup: GroupLookup }): Extract<GroupLookup, { kind: "resolved" }> {
  if (lookup.kind !== "resolved") {
    throw new Error(`expected a resolved group, got ${lookup.kind}`);
  }
  return lookup;
}

/** The ambiguous arm, or a throw, for the same reason. */
function ambiguous({ lookup }: { lookup: GroupLookup }): Extract<GroupLookup, { kind: "ambiguous" }> {
  if (lookup.kind !== "ambiguous") {
    throw new Error(`expected an ambiguous group, got ${lookup.kind}`);
  }
  return lookup;
}

const PIONEERS: MentionGroup = {
  deleted: false,
  handle: "pioneers-all",
  id: "S0SYN000001",
  memberIds: ["U1", "U2"],
  name: "Pioneers",
};
const ENGINEERS: MentionGroup = { deleted: false, handle: "eng", id: "S2", memberIds: [], name: "Engineering" };

describe("normaliseGroupToken", () => {
  it("drops a leading @ and lowercases", () => {
    expect(normaliseGroupToken({ token: " @Pioneers-All " })).toBe("pioneers-all");
  });

  it("answers an empty string for a token carrying nothing", () => {
    expect(normaliseGroupToken({ token: "  " })).toBe("");
  });
});

describe("lookupGroup", () => {
  it("resolves a handle, with or without the @", () => {
    const lookup = resolved({ lookup: lookupGroup({ groups: [PIONEERS, ENGINEERS], token: "@pioneers-all" }) });
    expect(lookup.group.id).toBe("S0SYN000001");
    expect(lookup.matchedOn).toBe("handle");
  });

  it("resolves a bare S… id", () => {
    expect(resolved({ lookup: lookupGroup({ groups: [PIONEERS], token: "S0SYN000001" }) }).matchedOn).toBe("id");
  });

  it("resolves a group NAME when no handle answers", () => {
    expect(resolved({ lookup: lookupGroup({ groups: [PIONEERS], token: "Pioneers" }) }).matchedOn).toBe("name");
  });

  it("prefers a handle match over a name match at a lower tier", () => {
    const collide: MentionGroup = { deleted: false, handle: "x", id: "S3", memberIds: [], name: "pioneers-all" };
    const lookup = resolved({ lookup: lookupGroup({ groups: [PIONEERS, collide], token: "pioneers-all" }) });
    expect(lookup.group.id).toBe("S0SYN000001");
  });

  it("refuses rather than picking when two groups answer at the same strength", () => {
    const twin: MentionGroup = { deleted: false, handle: "eng", id: "S9", memberIds: [], name: "Other" };
    expect(ambiguous({ lookup: lookupGroup({ groups: [ENGINEERS, twin], token: "eng" }) }).groups.length).toBe(2);
  });

  it("resolves a DISABLED group, because its mentions live forever", () => {
    const gone: MentionGroup = { deleted: true, handle: "gone", id: "S4", memberIds: [], name: "Gone" };
    expect(lookupGroup({ groups: [gone], token: "gone" }).kind).toBe("resolved");
  });

  it("answers unknown for a token no group matches", () => {
    expect(lookupGroup({ groups: [PIONEERS], token: "nobody" }).kind).toBe("unknown");
  });

  it("answers unknown for an empty token rather than matching a group with an empty handle", () => {
    const blank: MentionGroup = { deleted: false, handle: "", id: "S5", memberIds: [], name: "" };
    expect(lookupGroup({ groups: [blank], token: "@" }).kind).toBe("unknown");
  });
});

describe("groupLookupLines", () => {
  it("names the id and the mention markup, which is what a caller actually needs", () => {
    const lines = groupLookupLines({ lookup: lookupGroup({ groups: [PIONEERS], token: "pioneers-all" }), token: "x" });
    expect(lines[0]).toBe("@pioneers-all — Pioneers");
    expect(lines[1]).toBe("  slack usergroup S0SYN000001, 2 member(s), matched on handle");
    expect(lines[2]).toBe("  mention it as <!subteam^S0SYN000001>");
  });

  it("marks a disabled group as disabled", () => {
    const gone: MentionGroup = { deleted: true, handle: "gone", id: "S4", memberIds: [], name: "Gone" };
    expect(groupLookupLines({ lookup: lookupGroup({ groups: [gone], token: "gone" }), token: "gone" })[0]).toBe(
      "@gone — Gone [disabled]",
    );
  });

  it("prints nothing at all for unknown, so another layer may still answer", () => {
    expect(groupLookupLines({ lookup: { kind: "unknown" }, token: "x" })).toEqual([]);
  });

  it("lists every candidate for an ambiguity, so a human can choose", () => {
    const twin: MentionGroup = { deleted: false, handle: "eng", id: "S9", memberIds: [], name: "Other" };
    const lines = groupLookupLines({ lookup: lookupGroup({ groups: [ENGINEERS, twin], token: "eng" }), token: "eng" });
    expect(lines[0]).toBe(
      'cannot resolve "eng": 2 user groups answer to it at the same strength, and picking one is not this layer\'s call:',
    );
    expect(lines[3]).toBe("  address one of them by its S… id.");
  });
});

describe("a group whose capture carried no handle", () => {
  const nameless: MentionGroup = { deleted: false, handle: undefined, id: "S7", memberIds: [], name: undefined };

  it("matches nothing but its own id, rather than answering an empty token", () => {
    expect(lookupGroup({ groups: [nameless], token: "" }).kind).toBe("unknown");
    expect(resolved({ lookup: lookupGroup({ groups: [nameless], token: "S7" }) }).matchedOn).toBe("id");
  });

  it("is named by its id rather than by a bare @, which would read as a resolution that found nothing", () => {
    const lines = groupLookupLines({ lookup: lookupGroup({ groups: [nameless], token: "S7" }), token: "S7" });
    expect(lines[0]).toBe("S7");
  });
});
