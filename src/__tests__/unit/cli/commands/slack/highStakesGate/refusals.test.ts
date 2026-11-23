/*
 * `highStakesRefusals` on a top-level send: a first finding card of the day is admitted, a second refused citing the
 * first unless a live second-post grant is held, and a fleet gap, an as-me post or an unreadable list refuses
 * without the channel being read.
 */
import { describe, expect, it } from "vitest";

import { highStakesRefusals } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { err, ok } from "../../../../../../lib/result.js";
import { grantedEnv, grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { fakeDeps, freshHome, PRIOR, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesRefusals", () => {
  it("admits a first finding card of the day, having read the channel by id with the fleet's ids", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "#defects",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [] }, reads }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual(["C0SYN000003:U0OWNER"]);
  });

  it("refuses a second finding card inside the day, citing the first", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [PRIOR] }, reads }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines[0]).toContain(PRIOR.permalink);
  });

  it("lets a live second-post grant through without making the read", async () => {
    const reads: string[] = [];
    const home = freshHome();
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [PRIOR] }, reads }),
      env: grantedEnv({ hatchIds: ["high-stakes-second-post"], home }),
      formKind: "finding",
      home,
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("does not let the retired second-post variable through, so the read is made and the prior cited", async () => {
    const reads: string[] = [];
    const home = freshHome();
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [PRIOR] }, reads }),
      env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_HIGH_STAKES_SECOND_POST: "1" },
      formKind: "finding",
      home,
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines[0]).toContain(PRIOR.permalink);
    expect(reads).toEqual(["C0SYN000003:U0OWNER"]);
  });

  it("refuses a finding card without reading the channel when the profile cannot name the whole fleet", async () => {
    const reads: string[] = [];
    const gap = "profile.json names no `slackBot.ownerUserId`, so the owner's own posts there cannot be counted";
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: {
        ...fakeDeps({ history: { kind: "read", priors: [] }, reads }),
        highStakes: () =>
          ok({
            channels: [{ id: "C0SYN000003", name: "#defects" }],
            fleetGap: gap,
            fleetUserIds: [],
            listGap: undefined,
          }),
      },
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines[0]).toContain(`could not be read (${gap})`);
    expect(reads).toEqual([]);
  });

  it("refuses an as-me post without reading the channel at all", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: fakeDeps({ history: { kind: "read", priors: [] }, reads }),
      env: {},
      formKind: undefined,
      home: freshHome(),
      threadTs: undefined,
      token: "xoxp-test",
    });
    expect(lines[0]).toContain("this is an as-me post to #defects");
    expect(reads).toEqual([]);
  });

  it("refuses, naming the profile, when the high-stakes list cannot be read", async () => {
    const lines = await highStakesRefusals({
      channel: "C1",
      claim: false,
      deps: {
        ...fakeDeps({ history: { kind: "read", priors: [] }, reads: [] }),
        highStakes: () =>
          err({ code: "PROFILE_UNREADABLE", detail: "bad json", message: "the profile at /p is corrupt", path: "/p" }),
      },
      env: {},
      formKind: "update",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines).toEqual([
      "the high-stakes channel list could not be read, so nothing was posted: the profile at /p is corrupt",
    ]);
  });
});
