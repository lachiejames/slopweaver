/*
 * `highStakesRefusals` from a home with no profile: a send to any channel is refused rather than read as ordinary,
 * reading nothing, while a direct message and an edit of a reply go through.
 */
import { describe, expect, it } from "vitest";

import {
  type HighStakesDeps,
  highStakesEditRefusals,
  highStakesRefusals,
} from "../../../../../../cli/commands/slack/highStakesGate.js";
import { ok } from "../../../../../../lib/result.js";
import { fakeDeps, freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesRefusals from a home with no profile", () => {
  const GAP = "/tmp/empty holds no profile.json, so it cannot say which channels are high-stakes";
  const unlisted = ({ reads }: { reads: string[] }): HighStakesDeps => ({
    ...fakeDeps({ history: { kind: "read", priors: [] }, reads }),
    highStakes: () => ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: GAP }),
  });

  it("refuses a send to any channel, reading nothing", async () => {
    const reads: string[] = [];
    const lines = await highStakesRefusals({
      channel: "C0SYN000003",
      claim: false,
      deps: unlisted({ reads }),
      env: {},
      formKind: "finding",
      home: freshHome(),
      threadTs: "1790603453.723719",
      token: "xoxp-test",
    });
    expect(lines).toEqual([
      `${GAP}: a send to C0SYN000003 is refused rather than read as ordinary, and nothing was posted. ` +
        "Send from the home whose profile.json names `slackHighStakes`, or add that block to this one.",
    ]);
    expect(reads).toEqual([]);
  });

  it.each(["D123", "U0OWNER", "@ada"])("lets a direct message to %s through", async (channel) => {
    const lines = await highStakesRefusals({
      channel,
      claim: false,
      deps: unlisted({ reads: [] }),
      env: {},
      formKind: "update",
      home: freshHome(),
      threadTs: undefined,
      token: "xoxb-test",
    });
    expect(lines).toEqual([]);
  });

  it("refuses an edit of a top-level message in a channel, and lets an edit of a reply through", () => {
    const home = freshHome();
    const deps = unlisted({ reads: [] });
    const top = highStakesEditRefusals({
      channel: "C0OTHER",
      deps,
      env: {},
      existing: { ts: "1790603453.723719" },
      formKind: "update",
      home,
    });
    expect(top[0]).toContain(`${GAP}: a send to C0OTHER is refused`);
    const reply = { threadTs: "1790603453.723719", ts: "1790603499.000100" };
    expect(
      highStakesEditRefusals({ channel: "C0OTHER", deps, env: {}, existing: reply, formKind: "update", home }),
    ).toEqual([]);
  });
});
