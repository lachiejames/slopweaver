import { describe, expect, it } from "vitest";
import { planChannelMembership } from "../../../../corpus/slack/membershipPlan.js";
import { projectChannelRow, projectUsergroupRow, projectWorkspaceRow } from "../../../../corpus/slack/structureRows.js";
import { fetchSlackStructures, type SlackStructuresApi } from "../../../../corpus/slack/structures.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-07-20T00:00:00.000Z";

describe("projectWorkspaceRow", () => {
  it("projects the workspace + enterprise fields", () => {
    const row = projectWorkspaceRow({
      auth: { enterprise_id: "E1", enterprise_name: "Acme Grid" },
      fetchedAtIso: AT,
      team: { domain: "acme", id: "T1", name: "Acme" },
    })!;
    expect(row.sourceId).toBe("T1");
    expect(row.identity.url).toBe("https://acme.slack.com");
    expect(row.attrs).toEqual({ enterpriseId: "E1", enterpriseName: "Acme Grid" });
  });
});

describe("projectChannelRow", () => {
  it("captures topic/purpose/flags + member relations when membership was fetched", () => {
    const row = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: ["U1", "U2"],
      membershipFetched: true,
      raw: { id: "C1", is_private: false, name: "general", purpose: { value: "chat" }, topic: { value: "hi" } },
    })!;
    expect(row.attrs).toMatchObject({ archived: false, private: false, purpose: "chat", topic: "hi" });
    expect(row.relations).toEqual([
      { targetId: "slack:U1", targetKind: "person", targetSource: "person", type: "member" },
      { targetId: "slack:U2", targetKind: "person", targetSource: "person", type: "member" },
    ]);
    expect(row.warnings).toEqual([]);
  });

  it("records isMember, which decides whether this channel's history can be read at all", () => {
    const row = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: false,
      raw: { id: "C3", is_member: true, name: "joined" },
    })!;

    expect(row.attrs["isMember"]).toBe(true);
  });

  it("reads a channel Slack sent WITHOUT is_member as NOT a member, never as probably-yes", () => {
    // The direction of the guess is the whole point: defaulting to true would send a caller at a channel it
    // cannot open, and a failing `conversations.history` would be the first anyone heard of it.
    const absent = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: false,
      raw: { id: "C4", name: "unknown-membership" },
    })!;
    const explicit = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: false,
      raw: { id: "C5", is_member: false, name: "not-joined" },
    })!;

    expect(absent.attrs["isMember"]).toBe(false);
    expect(explicit.attrs["isMember"]).toBe(false);
  });

  it("warns (not silently empty) when membership was NOT fetched", () => {
    const row = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: false,
      raw: { id: "C2", name: "random" },
    })!;
    expect(row.relations).toEqual([]);
    expect(row.warnings).toEqual(["membership not fetched (archived or past the membership cap)"]);
  });
});

describe("projectUsergroupRow", () => {
  it("projects a usergroup with its inline members", () => {
    const row = projectUsergroupRow({
      fetchedAtIso: AT,
      raw: { handle: "eng", id: "S1", name: "Engineers", users: ["U1"] },
    })!;
    expect(row.identity.slug).toBe("eng");
    expect(row.relations).toEqual([
      { targetId: "slack:U1", targetKind: "person", targetSource: "person", type: "member" },
    ]);
  });
});

describe("planChannelMembership", () => {
  it("skips archived channels and caps active ones, logging the skip", () => {
    const plan = planChannelMembership({
      cap: 1,
      channels: [{ id: "C1" }, { id: "C2" }, { id: "C3", is_archived: true }],
      lane: "channels",
    });
    expect(plan.entries.map((e) => [e.id, e.fetchMembership])).toEqual([
      ["C1", true],
      ["C2", false],
      ["C3", false],
    ]);
    expect(plan.warnings).toEqual([
      "slack: channel-membership cap 1 applied to the channel lane — 1 active channel(s) not resolved",
    ]);
  });
});

/**
 * A fake Slack structure seam over one seeded page PER LANE. Lane-aware because the hydration walks the
 * channel lane and the group-DM lane separately — Slack returns no `mpim` row while `public_channel` is in
 * the same `types` list, so a lane-blind fake would serve the channels twice and prove nothing.
 */
function fakeApi(): SlackStructuresApi {
  return {
    authTest: async () => ({ enterprise_id: "E1" }),
    channelMembers: async ({ channel }) => {
      if (channel === "C1") {
        return ["U1", "U2"];
      }
      if (channel === "C_MPIM") {
        return ["U1", "U3", "U4"];
      }
      return [];
    },
    listChannels: async ({ lane }) => {
      if (lane === "group-dms") {
        return { channels: [{ id: "C_MPIM", is_mpim: true, name: "mpdm-ada--grace--alan-1" }] };
      }
      return {
        channels: [
          { id: "C1", name: "general" },
          { id: "C2", is_archived: true, name: "old" },
        ],
      };
    },
    listUsergroups: async () => [{ handle: "eng", id: "S1", name: "Engineers", users: ["U1"] }],
    teamInfo: async () => ({ domain: "acme", id: "T1", name: "Acme" }),
  };
}

describe("fetchSlackStructures", () => {
  it("hydrates workspace + channels (membership for active only) + usergroups", async () => {
    const result = unwrap(await fetchSlackStructures({ api: fakeApi(), fetchedAtIso: AT, membershipCap: 50 }));
    expect(result.rows.map((r) => r.kind).toSorted()).toEqual(["channel", "channel", "channel", "org", "usergroup"]);
    const general = result.rows.find((r) => r.sourceId === "C1")!;
    expect(general.relations).toHaveLength(2);
    const archived = result.rows.find((r) => r.sourceId === "C2")!;
    expect(archived.warnings).toEqual(["membership not fetched (archived or past the membership cap)"]);
  });

  it("carries a group DM's membership — the audience answer a message crawl alone cannot give", async () => {
    const result = unwrap(await fetchSlackStructures({ api: fakeApi(), fetchedAtIso: AT, membershipCap: 50 }));
    const groupDm = result.rows.find((r) => r.sourceId === "C_MPIM")!;
    expect(groupDm.relations).toHaveLength(3);
    expect(groupDm.attrs["membershipResolved"]).toBe(true);
  });

  it("spends the membership cap PER LANE, so the channel lane cannot starve the group-DM lane", async () => {
    // `cap: 1` is entirely consumed by C1 in the channel lane. Shared across both lanes — which is how a
    // single budget spent in discovery order behaves — C_MPIM is past it and the audience answer is lost
    // under a flag, exactly the shape the read lane's per-lane `maxItems` exists to prevent.
    const result = unwrap(await fetchSlackStructures({ api: fakeApi(), fetchedAtIso: AT, membershipCap: 1 }));
    const groupDm = result.rows.find((r) => r.sourceId === "C_MPIM")!;
    expect(groupDm.attrs["membershipResolved"]).toBe(true);
    expect(groupDm.relations).toHaveLength(3);
    const general = result.rows.find((r) => r.sourceId === "C1")!;
    expect(general.attrs["membershipResolved"]).toBe(true);
    // Nothing active was skipped in either lane at a per-lane cap of 1, so neither lane warns.
    expect(result.warnings).toEqual([]);
  });

  it("stops a repeated discovery cursor and SAYS the tail is missing, rather than spinning on it", async () => {
    // Slack's cursor is the only termination signal `conversations.list` gives, so a server-side loop would
    // accumulate the same page forever. This seam re-serves one cursor twice.
    let served = 0;
    const api: SlackStructuresApi = {
      ...fakeApi(),
      listChannels: async ({ lane }) => {
        if (lane === "group-dms") {
          return { channels: [{ id: "C_MPIM", is_mpim: true }] };
        }
        served += 1;
        return { channels: [{ id: `C${String(served)}` }], nextCursor: "stuck" };
      },
    };
    const result = unwrap(await fetchSlackStructures({ api, fetchedAtIso: AT }));
    expect(served).toBe(2);
    expect(result.warnings).toEqual([
      "slack channel structure discovery: repeated pagination cursor — stopped at 2 row(s), the tail is missing",
    ]);
    // The group-DM lane still ran: one lane's stuck cursor does not cost the other its walk.
    expect(result.rows.find((r) => r.sourceId === "C_MPIM")!.attrs["membershipResolved"]).toBe(true);
  });

  it("names the LANE when a cap does skip something, so one count cannot hide a whole class", async () => {
    const api: SlackStructuresApi = {
      ...fakeApi(),
      listChannels: async ({ lane }) => {
        if (lane === "group-dms") {
          return {
            channels: [
              { id: "C_MPIM", is_mpim: true },
              { id: "C_MPIM2", is_mpim: true },
            ],
          };
        }
        return { channels: [{ id: "C1" }] };
      },
    };
    const result = unwrap(await fetchSlackStructures({ api, fetchedAtIso: AT, membershipCap: 1 }));
    expect(result.warnings).toEqual([
      "slack: channel-membership cap 1 applied to the group DM lane — 1 active group DM(s) not resolved",
    ]);
  });
});

describe("membershipResolved — the attribute that separates 'never asked' from 'nobody'", () => {
  it("marks a channel whose membership was fetched and came back empty", () => {
    const row = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: true,
      raw: { id: "C9", name: "genuinely-empty" },
    })!;
    expect(row.attrs["membershipResolved"]).toBe(true);
    expect(row.relations).toEqual([]);
  });

  it("marks a channel nobody asked about, which carries the identical empty relations", () => {
    const row = projectChannelRow({
      fetchedAtIso: AT,
      memberIds: [],
      membershipFetched: false,
      raw: { id: "C10", name: "never-asked" },
    })!;
    expect(row.attrs["membershipResolved"]).toBe(false);
    expect(row.relations).toEqual([]);
  });
});

describe("planChannelMembership — no cap by default", () => {
  it("resolves every active channel when no cap is given", () => {
    const plan = planChannelMembership({
      channels: [{ id: "C1" }, { id: "C2" }, { id: "C3" }, { id: "C4", is_archived: true }],
      lane: "channels",
    });
    expect(plan.entries.map((e) => [e.id, e.fetchMembership])).toEqual([
      ["C1", true],
      ["C2", true],
      ["C3", true],
      ["C4", false],
    ]);
  });

  it("stays silent at the default, because nothing active was skipped", () => {
    expect(planChannelMembership({ channels: [{ id: "C1" }, { id: "C2" }], lane: "channels" }).warnings).toEqual([]);
  });

  it("still warns, naming the number, when a caller re-imposes one", () => {
    expect(
      planChannelMembership({ cap: 1, channels: [{ id: "C1" }, { id: "C2" }], lane: "channels" }).warnings,
    ).toEqual(["slack: channel-membership cap 1 applied to the channel lane — 1 active channel(s) not resolved"]);
  });

  it("asks about every active channel end to end when the caller passes no cap", async () => {
    const result = unwrap(await fetchSlackStructures({ api: fakeApi(), fetchedAtIso: AT }));
    const general = result.rows.find((r) => r.sourceId === "C1")!;
    expect(general.attrs["membershipResolved"]).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
