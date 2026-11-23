import { describe, expect, it } from "vitest";

import { type PollPingDeps, resolvePollPings } from "../../../../../cli/commands/slack/pollPings.js";
import { err, ok } from "../../../../../lib/result.js";
import type { PollArtifact } from "../../../../../outbound/slack/pollForm.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

const POLL: PollArtifact = {
  kind: "poll",
  options: ["yes", "no"],
  question: "Ship it?",
  why: "the freeze starts tomorrow",
};

/** Seams that resolve `engineers` and `alice`, and record every directory read. */
function seams(): { deps: PollPingDeps; groupReads: string[] } {
  const groupReads: string[] = [];
  return {
    deps: {
      resolvePeople: async ({ people }) =>
        ok(new Map(people.filter((p) => p === "alice").map((p): [string, string] => [p, "U0ALICE"]))),
      userGroupIds: async ({ token }) => {
        groupReads.push(token);
        return new Map([["engineers", "S0ENG"]]);
      },
    },
    groupReads,
  };
}

describe("resolvePollPings", () => {
  it("notifies nobody when the poll names no ping, without reading the directory", async () => {
    const { deps, groupReads } = seams();
    expect(await resolvePollPings({ artifact: POLL, deps, home: "/h", token: undefined })).toEqual({ tokens: [] });
    expect(groupReads).toEqual([]);
  });

  it("notifies nobody when the poll's ping list is empty", async () => {
    const { deps } = seams();
    expect(await resolvePollPings({ artifact: { ...POLL, ping: [] }, deps, home: "/h", token: undefined })).toEqual({
      tokens: [],
    });
  });

  it("resolves a broadcast, a group and a person into mention tokens in order", async () => {
    const { deps, groupReads } = seams();
    const artifact: PollArtifact = {
      ...POLL,
      ping: [
        { kind: "broadcast", range: "here" },
        { handle: "engineers", kind: "group" },
        { kind: "person", person: "alice" },
      ],
    };
    expect(await resolvePollPings({ artifact, deps, home: "/h", token: "xoxb-bot" })).toEqual({
      tokens: ["<!here>", "<!subteam^S0ENG|@engineers>", "<@U0ALICE>"],
    });
    expect(groupReads).toEqual(["xoxb-bot"]);
  });

  it("refuses a group ping without a bot token", async () => {
    const { deps } = seams();
    const artifact: PollArtifact = { ...POLL, ping: [{ handle: "engineers", kind: "group" }] };
    expect(await resolvePollPings({ artifact, deps, home: "/h", token: "xoxp-user" })).toEqual({
      errors: ["resolving a `group` ping needs a Slack BOT token (xoxb-…)"],
    });
  });

  it("refuses the whole send when a ping does not resolve", async () => {
    const { deps } = seams();
    const artifact: PollArtifact = { ...POLL, ping: [{ kind: "person", person: "bob" }] };
    expect(await resolvePollPings({ artifact, deps, home: "/h", token: undefined })).toEqual({
      errors: ['cannot resolve the person ping "bob" — nothing was posted'],
    });
  });

  it("refuses the whole send with the roster's own message when the store cannot say who anyone is", async () => {
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" });
    const deps: PollPingDeps = {
      resolvePeople: async () => err(outage),
      userGroupIds: async () => new Map(),
    };
    const artifact: PollArtifact = { ...POLL, ping: [{ kind: "person", person: "alice" }] };
    expect(await resolvePollPings({ artifact, deps, home: "/h", token: undefined })).toEqual({
      errors: [outage.message],
    });
  });
});
