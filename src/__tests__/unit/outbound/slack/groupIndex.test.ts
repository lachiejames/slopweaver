import { describe, expect, it } from "vitest";

import {
  addressableGroup,
  addressableGroups,
  type GroupAddress,
  groupAddressRefusals,
} from "../../../../outbound/slack/groupIndex.js";
import type { MentionGroup } from "../../../../silver/groupMention.js";

/** The addressable arm, or a throw — so an assertion never has to carry a conditional (testing.md). */
function addressable({ address }: { address: GroupAddress }): Extract<GroupAddress, { kind: "addressable" }> {
  if (address.kind !== "addressable") {
    throw new Error(`expected an addressable group, got ${address.kind}`);
  }
  return address;
}

const group = (over: Partial<MentionGroup> = {}): MentionGroup => ({
  deleted: false,
  handle: "engineers",
  id: "S_ENGINEERS",
  memberIds: ["U_ONE", "U_TWO"],
  name: "Engineering",
  ...over,
});

const LIVE = group();
const DISABLED = group({ deleted: true, handle: "old-guard", id: "S_OLD" });
const EMPTY = group({ handle: "ghosts", id: "S_GHOSTS", memberIds: [] });
const NAMELESS = group({ handle: undefined, id: "S_NO_HANDLE", name: undefined });

describe("addressableGroup — who may actually be reached", () => {
  it("addresses a live group by its handle", () => {
    const address = addressable({
      address: addressableGroups({ groups: [LIVE], keys: ["engineers"] }).get("engineers")!,
    });
    expect(address.group.id).toBe("S_ENGINEERS");
    expect(address.handle).toBe("engineers");
  });

  it("addresses a live group by its @handle and by its S… id, at the same target", () => {
    const byAt = addressableGroups({ groups: [LIVE], keys: ["@engineers", "S_ENGINEERS"] });
    expect(addressable({ address: byAt.get("@engineers")! }).group.id).toBe("S_ENGINEERS");
    expect(addressable({ address: byAt.get("S_ENGINEERS")! }).group.id).toBe("S_ENGINEERS");
  });

  it("falls back to the id as the rendered handle when the capture carried none", () => {
    expect(
      addressable({ address: addressableGroups({ groups: [NAMELESS], keys: ["S_NO_HANDLE"] }).get("S_NO_HANDLE")! })
        .handle,
    ).toBe("S_NO_HANDLE");
  });

  it("REFUSES a disabled group, which renders perfectly and notifies nobody", () => {
    const address = addressableGroups({ groups: [DISABLED], keys: ["old-guard"] }).get("old-guard")!;
    expect(address.kind).toBe("unreachable");
    expect(groupAddressRefusals({ address, key: "old-guard" })[0]).toContain("Slack has DISABLED that group");
  });

  it("REFUSES an empty group for the same reason, naming the member count", () => {
    const address = addressableGroups({ groups: [EMPTY], keys: ["ghosts"] }).get("ghosts")!;
    expect(address.kind).toBe("unreachable");
    const lines = groupAddressRefusals({ address, key: "ghosts" });
    expect(lines[0]).toContain("that group has no members");
    expect(lines[1]).toContain("0 member(s)");
  });

  it("REFUSES a display-NAME match and names the handle to use instead", () => {
    const address = addressableGroups({ groups: [LIVE], keys: ["Engineering"] }).get("Engineering")!;
    expect(address.kind).toBe("name-only");
    const lines = groupAddressRefusals({ address, key: "Engineering" });
    expect(lines[0]).toContain("that is a group's display NAME, not its handle");
    expect(lines[1]).toContain("@engineers");
  });

  it("REFUSES two groups answering to one token rather than picking", () => {
    const twin = group({ id: "S_OTHER" });
    const address = addressableGroups({ groups: [LIVE, twin], keys: ["engineers"] }).get("engineers")!;
    expect(address.kind).toBe("ambiguous");
    expect(groupAddressRefusals({ address, key: "engineers" })).toHaveLength(4);
  });

  it("REFUSES an unknown handle, and says where groups come from", () => {
    const address = addressableGroups({ groups: [LIVE], keys: ["nope"] }).get("nope")!;
    expect(address.kind).toBe("unknown");
    expect(groupAddressRefusals({ address, key: "nope" })[0]).toContain("no Slack user group has that handle");
  });

  it("keeps a token that normalises to nothing rather than dropping it silently", () => {
    const addresses = addressableGroups({ groups: [LIVE], keys: ["@"] });
    expect(addresses.get("@")!.kind).toBe("unknown");
  });

  it("resolves each DISTINCT token once", () => {
    expect(addressableGroups({ groups: [LIVE], keys: ["engineers", "engineers"] }).size).toBe(1);
  });

  it("says nothing at all about a group it will address", () => {
    expect(
      groupAddressRefusals({
        address: addressableGroup({ lookup: { group: LIVE, kind: "resolved", matchedOn: "handle" } }),
        key: "engineers",
      }),
    ).toEqual([]);
  });
});
