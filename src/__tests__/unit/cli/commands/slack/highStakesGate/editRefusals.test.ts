/*
 * `highStakesEditRefusals`: re-rendering a top-level message in a high-stakes channel is judged as the post it
 * would be, while an edit of a reply, or of a message in any other channel, goes through.
 */
import { describe, expect, it } from "vitest";

import { highStakesEditRefusals } from "../../../../../../cli/commands/slack/highStakesGate.js";
import { ok } from "../../../../../../lib/result.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("highStakesEditRefusals", () => {
  const deps = {
    highStakes: () =>
      ok({
        channels: [{ id: "C0SYN000003", name: "#defects" }],
        fleetGap: undefined,
        fleetUserIds: [],
        listGap: undefined,
      }),
  };

  it("refuses re-rendering a top-level message in a high-stakes channel as an update card", () => {
    const lines = highStakesEditRefusals({
      channel: "C0SYN000003",
      deps,
      env: {},
      existing: { ts: "1790603453.723719" },
      formKind: "update",
      home: freshHome(),
    });
    expect(lines[0]).toContain("this is a `update` card to #defects");
  });

  it("refuses an as-me edit of a thread parent, whose thread_ts is its own ts", () => {
    const lines = highStakesEditRefusals({
      channel: "defects",
      deps,
      env: {},
      existing: { threadTs: "1790603453.723719", ts: "1790603453.723719" },
      formKind: undefined,
      home: freshHome(),
    });
    expect(lines[0]).toContain("this is an as-me post to #defects");
  });

  it("lets an edit of a reply, or of a message in any other channel, through", () => {
    const home = freshHome();
    const reply = { threadTs: "1790603453.723719", ts: "1790603499.000100" };
    expect(
      highStakesEditRefusals({ channel: "C0SYN000003", deps, env: {}, existing: reply, formKind: undefined, home }),
    ).toEqual([]);
    expect(
      highStakesEditRefusals({
        channel: "C0OTHER",
        deps,
        env: {},
        existing: { ts: "1790603453.723719" },
        formKind: "update",
        home,
      }),
    ).toEqual([]);
  });
});
