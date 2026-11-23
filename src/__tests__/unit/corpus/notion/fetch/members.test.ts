/*
 * The Notion member roster: projecting one user into a member row, its email trust and bot flag, and paging
 * `users.list` into rows through the injected `NotionApi` seam.
 */
import { describe, expect, it } from "vitest";
import { fetchNotionMembers, type NotionApi, projectNotionUser } from "../../../../../corpus/notion/fetch.js";
import { unwrap } from "../../../../../lib/result.js";

const NOTION_AT = "2026-07-20T00:00:00.000Z";

describe("projectNotionUser", () => {
  it("captures a person's email (type person) and keeps the raw object", () => {
    const raw = {
      avatar_url: "https://cdn/av.png",
      id: "u1",
      name: "Ada",
      person: { email: "ada@example.com" },
      type: "person",
    };
    const row = projectNotionUser({ fetchedAtIso: NOTION_AT, raw })!;
    expect(row.identity).toEqual({
      email: "ada@example.com",
      emailNormalised: "ada@example.com",
      emailTrust: "trusted",
      name: "Ada",
      nativeId: "u1",
      source: "notion",
    });
    expect(row.profile).toEqual({ avatarUrl: "https://cdn/av.png", bot: false });
    expect(row.raw).toEqual(raw);
  });

  it("captures no email for a bot (and flags it)", () => {
    const row = projectNotionUser({ fetchedAtIso: NOTION_AT, raw: { id: "b1", name: "Bot", type: "bot" } })!;
    expect(row.profile.bot).toBe(true);
    expect(row.identity.emailTrust).toBe("missing");
    expect(row.warnings).toEqual([]);
  });

  it("warns (no guessed email) when the integration lacks the user-email capability", () => {
    const row = projectNotionUser({
      fetchedAtIso: NOTION_AT,
      raw: { id: "u2", name: "Grace", person: {}, type: "person" },
    })!;
    expect(row.identity.emailTrust).toBe("missing");
    expect(row.warnings).toEqual(["no email — the Notion integration lacks the read-user-email capability"]);
  });
});

describe("fetchNotionMembers", () => {
  it("pages users.list into member rows via the injected seam", async () => {
    const api: NotionApi = {
      databases: async () => ({ databases: [], rows: [] }),
      pages: async () => ({ pages: [] }),
      users: async ({ cursor }) =>
        cursor === undefined
          ? {
              nextCursor: "c2",
              results: [{ id: "u1", name: "Ada", person: { email: "ada@example.com" }, type: "person" }],
            }
          : { results: [{ id: "b1", name: "Bot", type: "bot" }] },
    };
    const result = unwrap(await fetchNotionMembers({ api, fetchedAtIso: NOTION_AT }));
    expect(result.rows.map((r) => r.sourceId)).toEqual(["u1", "b1"]);
    expect(result.rows.map((r) => r.identity.email)).toEqual(["ada@example.com", undefined]);
  });
});
