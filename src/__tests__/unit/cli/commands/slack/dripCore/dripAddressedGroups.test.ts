/*
 * `dripAddressedGroups`: each typed group run once and in order, a raw subteam reference's id out of the plain
 * escape hatch, and nothing from a message that addresses only people.
 */
import { describe, expect, it } from "vitest";

import { dripAddressedGroups } from "../../../../../../cli/commands/slack/dripMentions.js";
import type { DripArtifact } from "../../../../../../outbound/artifact/types.js";

describe("dripAddressedGroups", () => {
  it("collects a typed group run out of every message, each once, in order", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [
        { runs: [{ handle: "engineers", type: "group" }] },
        {
          runs: [
            { handle: "doctors", type: "group" },
            { handle: "engineers", type: "group" },
          ],
        },
      ],
    };

    expect(dripAddressedGroups({ artifact })).toEqual(["engineers", "doctors"]);
  });

  it("collects the S… id out of a raw subteam reference in the plain escape hatch", () => {
    expect(dripAddressedGroups({ artifact: { kind: "plain", text: "ask <!subteam^S01|@engineers>" } })).toEqual([
      "S01",
    ]);
  });

  it("collects nothing from a message that addresses only people", () => {
    expect(dripAddressedGroups({ artifact: { kind: "plain", text: "thanks <@U0ADA>" } })).toEqual([]);
  });
});
