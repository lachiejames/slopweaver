/**
 * The turn lane's one high-stakes check, at `turn brief`. The reads are plain fakes recorded into `reads`, so "no
 * Slack read was made" rests on a list a stray call would lengthen.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HighStakesDeps } from "../../../../../cli/commands/slack/highStakesGate.js";
import { turnBriefHighStakesRefusals } from "../../../../../cli/commands/turn/briefHighStakes.js";
import { ok, type Result } from "../../../../../lib/result.js";
import type { ThreadAnchor } from "../../../../../outbound/slack/highStakesChannel.js";
import { type HighStakesConfig, type ProfileReadError, readHighStakesConfig } from "../../../../../profileStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "brief-high-stakes-"));
  fixtureDirs.push(dir);
  return dir;
}

const BUGS: HighStakesConfig = {
  channels: [{ id: "C0SYN000003", name: "#defects" }],
  fleetGap: undefined,
  fleetUserIds: ["U0OWNER"],
  listGap: undefined,
};

function fakeDeps({
  reads,
  anchor,
  config = ok(BUGS),
}: {
  reads: string[];
  anchor: ThreadAnchor;
  config?: Result<HighStakesConfig, ProfileReadError>;
}): HighStakesDeps {
  return {
    channelClaim: ({ channel, take }) => {
      reads.push(`${take ? "take" : "peek"} ${channel}`);
      return { kind: "free" };
    },
    fleetHistory: async ({ channel }) => {
      reads.push(`history ${channel}`);
      return { kind: "read", priors: [] };
    },
    highStakes: () => config,
    releaseChannelClaim: ({ channel }) => {
      reads.push(`release ${channel}`);
    },
    threadAnchor: async ({ channel, threadTs }) => {
      reads.push(`anchor ${channel}:${threadTs}`);
      return anchor;
    },
  };
}

describe("turnBriefHighStakesRefusals", () => {
  it("admits a brief whose thread Slack confirms in a high-stakes channel", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYN000003",
      deps: fakeDeps({ anchor: { kind: "present" }, reads }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: "xoxb-test",
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual(["anchor C0SYN000003:1790603453.723719"]);
  });

  it("refuses a thread naming no message there as the undefended top-level post it would become", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYN000003",
      deps: fakeDeps({ anchor: { kind: "absent" }, reads }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.7237",
      token: "xoxb-test",
    });
    expect(lines[0]).toBe(
      "--thread-ts 1790603453.7237 in #defects names no top-level message there, so this send is judged as a top-level post",
    );
    expect(lines[1]).toContain("this is a `answer` card to #defects");
    expect(reads).toEqual(["anchor C0SYN000003:1790603453.7237"]);
  });

  it("refuses a thread whose read failed, naming why", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "#defects",
      deps: fakeDeps({ anchor: { kind: "unread", reason: "ratelimited" }, reads }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: "xoxb-test",
    });
    expect(lines[0]).toBe(
      "--thread-ts 1790603453.723719 in #defects could not be read (ratelimited), so this send is judged as a top-level post",
    );
  });

  it("refuses a high-stakes channel with no stored bot token, making no read", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYN000003",
      deps: fakeDeps({ anchor: { kind: "present" }, reads }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: undefined,
    });
    expect(lines).toEqual([
      "turn brief: #defects is a high-stakes channel and no Slack bot token is stored, so thread 1790603453.723719 " +
        "cannot be confirmed as a real message there and nothing was written",
    ]);
    expect(reads).toEqual([]);
  });

  it("gates nothing in a channel the profile does not name, making no read", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYNGENERAL1",
      deps: fakeDeps({ anchor: { kind: "absent" }, reads }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: undefined,
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("gates nothing when the home holds no profile, since a turn posts top-level nowhere by itself", async () => {
    const reads: string[] = [];
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYN000003",
      deps: fakeDeps({
        anchor: { kind: "absent" },
        config: ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: "no profile.json" }),
        reads,
      }),
      env: {},
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: "xoxb-test",
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("refuses when the profile cannot be read, since it cannot say which channels are high-stakes", async () => {
    const reads: string[] = [];
    const home = freshHome();
    writeFileSync(stateHomePaths({ home }).profileJson, "{ not json");
    const lines = await turnBriefHighStakesRefusals({
      channel: "C0SYN000003",
      deps: fakeDeps({ anchor: { kind: "present" }, config: readHighStakesConfig({ home }), reads }),
      env: {},
      home,
      threadTs: "1790603453.723719",
      token: "xoxb-test",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("the high-stakes channel list could not be read, so nothing was posted: the profile at");
    expect(reads).toEqual([]);
  });
});
