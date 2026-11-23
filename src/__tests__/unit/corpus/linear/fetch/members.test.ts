/**
 * Linear members: one raw user node parsed into a member row, the users lane paged into rows, and a users
 * cursor that repeats instead of advancing.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { fetchLinearMembers, type LinearApi, parseLinearUserNode } from "../../../../../corpus/linear/fetch.js";
import { issuesPage } from "./harness.js";

const LINEAR_AT = "2026-07-20T00:00:00.000Z";

describe("parseLinearUserNode", () => {
  it("keeps id, email, display name, ROLE, timezone, avatar, flags and team keys", () => {
    const node = {
      active: true,
      admin: true,
      avatarUrl: "https://cdn/av.png",
      displayName: "ada",
      email: "ada@example.com",
      guest: false,
      id: "usr_1",
      name: "Ada Lovelace",
      teams: {
        nodes: [
          { id: "t1", key: "ENG", name: "Eng" },
          { id: "t2", key: "PLAT" },
        ],
      },
      timezone: "Australia/Sydney",
      title: "Staff Engineer",
    };
    const row = parseLinearUserNode({ fetchedAtIso: LINEAR_AT, node })!;
    expect(row.identity).toEqual({
      email: "ada@example.com",
      emailNormalised: "ada@example.com",
      emailTrust: "trusted",
      handle: "ada",
      name: "Ada Lovelace",
      nativeId: "usr_1",
      source: "linear",
    });
    // `title` is the addition: nobody's ROLE was captured before, which is a large gap for any
    // "who would know about X" question.
    expect(row.profile).toEqual({
      active: true,
      admin: true,
      avatarUrl: "https://cdn/av.png",
      bot: false,
      teams: ["ENG", "PLAT"],
      timezone: "Australia/Sydney",
      title: "Staff Engineer",
    });
    expect(row.raw).toEqual(node);
  });

  it("marks an archived user inactive and warns when no email", () => {
    const row = parseLinearUserNode({
      fetchedAtIso: LINEAR_AT,
      node: { active: false, displayName: "x", id: "usr_2" },
    })!;
    expect(row.profile.active).toBe(false);
    expect(row.warnings).toEqual(["no email on Linear user"]);
  });
});

describe("fetchLinearMembers", () => {
  it("pages the users lane into member rows via the injected seam", async () => {
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => ({ projects: [] }),
      users: async ({ cursor }) =>
        cursor === undefined
          ? { nextCursor: "c2", nodes: [{ displayName: "ada", email: "ada@example.com", id: "usr_1" }] }
          : { nodes: [{ displayName: "grace", email: "grace@example.com", id: "usr_2" }] },
    };
    const result = unwrap(await fetchLinearMembers({ api, fetchedAtIso: LINEAR_AT }));
    expect(result.rows.map((r) => r.sourceId)).toEqual(["usr_1", "usr_2"]);
    expect(result.rows.map((r) => r.identity.email)).toEqual(["ada@example.com", "grace@example.com"]);
  });
});

describe("fetchLinearMembers cursor safety", () => {
  // This loop was already cursor-only — the CORRECT shape — but it had no cycle guard, so an endpoint that
  // repeats a cursor spun forever. A hang is the one failure a best-effort crawl cannot warn its way out of.
  it("terminates and warns when the users cursor repeats instead of advancing", async () => {
    let calls = 0;
    const api: LinearApi = {
      issues: async () => issuesPage({ identifiers: [] }),
      projects: async () => ({ projects: [] }),
      users: async () => {
        calls += 1;
        return { nextCursor: "loop", nodes: [] };
      },
    };
    const result = unwrap(await fetchLinearMembers({ api, fetchedAtIso: "2026-08-08T00:00:00.000Z" }));
    expect(calls).toBe(2); // the first page, then the repeat that proves the cursor is stuck
    expect(result.warnings).toContain(
      "linear members may be incomplete: the endpoint repeated pagination cursor loop instead of advancing",
    );
  });
});
