/*
 * `dripMentionedPeople`: each mentioned person once in first-appearance order, a one-card post the same way, a
 * plain body's raw `<@U…>` ids, and nothing from a bare name, a channel ref or a broadcast.
 */
import { describe, expect, it } from "vitest";

import { dripMentionedPeople } from "../../../../../../cli/commands/slack/dripMentions.js";
import type { DripArtifact, OneCardArtifact } from "../../../../../../outbound/artifact/types.js";

describe("dripMentionedPeople", () => {
  it("lists each mentioned person once, in first-appearance order", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [
        { runs: [{ person: "zoe", type: "mention" }] },
        { runs: [{ person: "ada", type: "mention" }] },
        { runs: [{ person: "zoe", type: "mention" }] },
      ],
    };

    expect(dripMentionedPeople({ artifact })).toEqual(["zoe", "ada"]);
  });

  it("lists a one-card post's mentions the same way, because `lines` is only a different structure", () => {
    const artifact: OneCardArtifact = {
      kind: "one-card",
      lines: [{ runs: [{ person: "zoe", type: "mention" }] }, { runs: [{ person: "zoe", type: "mention" }] }],
    };

    expect(dripMentionedPeople({ artifact })).toEqual(["zoe"]);
  });

  it("reads a plain body's raw `<@U…>` ids, which used to be reported as no mentions at all", () => {
    expect(dripMentionedPeople({ artifact: { kind: "plain", text: "<@U0ADA> and <@U0ZOE> hi" } })).toEqual([
      "U0ADA",
      "U0ZOE",
    ]);
  });

  it("reads the id out of the `<@U…|label>` spelling rather than the label", () => {
    expect(dripMentionedPeople({ artifact: { kind: "plain", text: "thanks <@U0ADA|ada>" } })).toEqual(["U0ADA"]);
  });

  it("still finds nothing in a bare NAME — guessing who `@ada` is stays out of scope", () => {
    expect(dripMentionedPeople({ artifact: { kind: "plain", text: "thanks @ada and Ada Lovelace" } })).toEqual([]);
  });

  it("ignores a channel ref and a broadcast, neither of which names a person to resolve", () => {
    expect(dripMentionedPeople({ artifact: { kind: "plain", text: "<!here> in <#C0DEV> please" } })).toEqual([]);
  });
});
