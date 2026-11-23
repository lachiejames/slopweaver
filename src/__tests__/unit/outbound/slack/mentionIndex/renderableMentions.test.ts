import { describe, expect, it } from "vitest";

import { addressableGroups } from "../../../../../outbound/slack/groupIndex.js";
import {
  groupRefusals,
  renderableMentions,
  resolutionSummaryLines,
  resolveMentionKeys,
} from "../../../../../outbound/slack/mentionIndex.js";
import type { MentionGroup } from "../../../../../silver/groupMention.js";
import { NO_OVERRIDES, person, roster } from "./harness.js";

describe("renderableMentions", () => {
  it("flattens to the key → Slack id map the renderer consumes", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })] }),
      freshness: { kind: "fresh" },
      overrides: NO_OVERRIDES,
      people: ["ada-l"],
    });

    expect([...renderableMentions({ resolution }).people]).toEqual([["ada-l", "U_fake_ada"]]);
  });
});

describe("renderableMentions and groupRefusals — the group half rides the same resolution", () => {
  const GROUP: MentionGroup = {
    deleted: false,
    handle: "engineers",
    id: "S_ENGINEERS",
    memberIds: ["U_ONE"],
    name: "Engineering",
  };

  it("carries an addressable group into the renderer's own map, keyed as the run wrote it", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      groupAddresses: addressableGroups({ groups: [GROUP], keys: ["@engineers"] }),
      overrides: NO_OVERRIDES,
      people: [],
    });

    expect([...renderableMentions({ resolution }).groups]).toEqual([["@engineers", "S_ENGINEERS"]]);
    expect(groupRefusals({ resolution })).toEqual([]);
  });

  it("keeps an unaddressable group OUT of that map, and says why", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      groupAddresses: addressableGroups({ groups: [GROUP], keys: ["Engineering"] }),
      overrides: NO_OVERRIDES,
      people: [],
    });

    expect([...renderableMentions({ resolution }).groups]).toEqual([]);
    expect(groupRefusals({ resolution })[0]).toContain("display NAME, not its handle");
  });
});

describe("resolutionSummaryLines — the dry run's count sees every run type", () => {
  const GROUP: MentionGroup = {
    deleted: false,
    handle: "engineers",
    id: "S_ENGINEERS",
    memberIds: ["U_ONE"],
    name: "Engineering",
  };

  const summaryFor = ({ keys }: { keys: readonly string[] }): readonly string[] =>
    resolutionSummaryLines({
      resolution: resolveMentionKeys({
        derived: roster({ people: [] }),
        freshness: { kind: "fresh" },
        groupAddresses: addressableGroups({ groups: [GROUP], keys }),
        overrides: NO_OVERRIDES,
        people: [],
      }),
    });

  it("says nothing about groups when a send addresses none", () => {
    expect(summaryFor({ keys: [] })).toHaveLength(2);
  });

  it("counts the addressable groups against everything requested", () => {
    expect(summaryFor({ keys: ["engineers", "Engineering"] })[1]).toContain("user groups: 1 of 2 addressable");
  });
});
