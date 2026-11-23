/**
 * `parseLinearUserNode`: one raw Linear `users` node to a member row. A full node's whole row is pinned, `name`
 * falls back to `displayName`, `active` is read rather than inferred (`false` stays `false`, absent stays
 * absent), a node with no email keeps the member and carries the one literal warning, and an id-less or
 * non-record node is dropped.
 */
import { describe, expect, it } from "vitest";

import { parseLinearUserNode } from "../../../../corpus/linear/fetchMembers.js";

const FETCHED_AT = "2026-10-13T09:00:00.000Z";

describe("parseLinearUserNode", () => {
  it("projects a node carrying every field it reads into the whole member row", () => {
    const node = {
      active: true,
      admin: true,
      avatarUrl: "https://avatars.example/u1.png",
      displayName: "ada",
      email: "Ada@Example.com",
      guest: true,
      id: "u1",
      name: "Ada Lovelace",
      teams: { nodes: [{ key: "OPS" }, { key: "ENG" }, { key: "ENG" }] },
      timezone: "Australia/Sydney",
      title: "Staff Engineer",
    };

    expect(parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node })).toEqual({
      fetchedAtIso: FETCHED_AT,
      identity: {
        email: "Ada@Example.com",
        emailNormalised: "ada@example.com",
        emailTrust: "trusted",
        handle: "ada",
        name: "Ada Lovelace",
        nativeId: "u1",
        source: "linear",
      },
      profile: {
        active: true,
        admin: true,
        avatarUrl: "https://avatars.example/u1.png",
        bot: false,
        guest: true,
        teams: ["ENG", "OPS"],
        timezone: "Australia/Sydney",
        title: "Staff Engineer",
      },
      provenance: ["linear.users"],
      raw: node,
      source: "linear",
      sourceId: "u1",
      version: 1,
      warnings: [],
    });
  });

  it("falls back to displayName for the name when the node carries no name", () => {
    const row = parseLinearUserNode({
      fetchedAtIso: FETCHED_AT,
      node: { displayName: "grace", email: "grace@example.com", id: "u2" },
    });

    expect(row!.identity).toEqual({
      email: "grace@example.com",
      emailNormalised: "grace@example.com",
      emailTrust: "trusted",
      handle: "grace",
      name: "grace",
      nativeId: "u2",
      source: "linear",
    });
  });

  it("keeps active false as false, and leaves an absent active out of the profile", () => {
    const inactive = parseLinearUserNode({
      fetchedAtIso: FETCHED_AT,
      node: { active: false, email: "x@example.com", id: "u3" },
    });
    const unstated = parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node: { email: "y@example.com", id: "u4" } });

    expect(inactive!.profile).toEqual({ active: false, bot: false });
    expect(unstated!.profile).toEqual({ bot: false });
  });

  it("keeps an email-less member with missing trust and the literal no-email warning", () => {
    const row = parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node: { id: "u5", name: "No Mail" } });

    expect(row!.sourceId).toBe("u5");
    expect(row!.identity).toEqual({ emailTrust: "missing", name: "No Mail", nativeId: "u5", source: "linear" });
    expect(row!.warnings).toEqual(["no email on Linear user"]);
  });

  it("drops a node with no id, an empty id, and a non-record node", () => {
    expect(parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node: { email: "z@example.com", name: "Z" } })).toBe(
      undefined,
    );
    expect(parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node: { id: "", name: "Z" } })).toBe(undefined);
    expect(parseLinearUserNode({ fetchedAtIso: FETCHED_AT, node: "u6" })).toBe(undefined);
  });
});
