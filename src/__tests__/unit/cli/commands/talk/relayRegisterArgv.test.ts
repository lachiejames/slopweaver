/** `relayRegisterArgv`: the row one relayed turn becomes, stating the page's workspace or none, and its checkout. */
import { describe, expect, it } from "vitest";

import { relayRegisterArgv } from "../../../../../cli/commands/talk/relayRegisterArgv.js";

const draft = { anchor: "talk:turn-1", ask: "Ship the fix", slug: "talk-turn-1" };

describe("relayRegisterArgv", () => {
  it("states the workspace the page resolved, between the anchor and the board directory", () => {
    const argv = relayRegisterArgv({
      dir: "/board",
      draft,
      home: "/h",
      priority: "p1",
      repo: undefined,
      workspace: { because: "the owner said it on the self console, over no card", workspace: "self" },
    });
    expect(argv).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      "Ship the fix",
      "--priority",
      "p1",
      "--dispatch",
      "--slug",
      "talk-turn-1",
      "--anchor",
      "talk:turn-1",
      "--workspace",
      "self",
      "--workspace-because",
      "the owner said it on the self console, over no card",
      "--dir",
      "/board",
      "--home",
      "/h",
    ]);
  });

  it("opens the row's ask on the channel lead, so the summary carries the steer", () => {
    const lead = "CHANNEL: the owner moved sd-359bafb2 to #dev-alerts";
    const argv = relayRegisterArgv({
      dir: "/board",
      draft,
      home: "/h",
      lead,
      priority: "p1",
      repo: undefined,
      workspace: undefined,
    });
    expect(argv[argv.indexOf("--ask") + 1]).toBe(`${lead}\n\nShip the fix`);
  });

  it("states no workspace when the page could not place the relay", () => {
    const argv = relayRegisterArgv({
      dir: "/board",
      draft,
      home: "/h",
      priority: "p1",
      repo: undefined,
      workspace: undefined,
    });
    expect(argv.includes("--workspace")).toBe(false);
    expect(argv.slice(-6)).toEqual(["--anchor", "talk:turn-1", "--dir", "/board", "--home", "/h"]);
  });

  it("names the checkout right after the anchor, so cmux spawn can seat the row", () => {
    const argv = relayRegisterArgv({
      dir: "/board",
      draft,
      home: "/h",
      priority: "p1",
      repo: "/declared/slopweaver",
      workspace: undefined,
    });
    expect(argv.slice(-8)).toEqual([
      "--anchor",
      "talk:turn-1",
      "--repo",
      "/declared/slopweaver",
      "--dir",
      "/board",
      "--home",
      "/h",
    ]);
  });

  it("names no checkout for a relay born as an answer to an ask", () => {
    const argv = relayRegisterArgv({
      dir: "/board",
      draft,
      home: "/h",
      priority: "p1",
      repo: undefined,
      workspace: undefined,
    });
    expect(argv.includes("--repo")).toBe(false);
  });
});
