/**
 * The untagged-name hold's effectful edge, driven with plain fakes: which ids it counts as tagged, which it exempts,
 * and that a message naming nobody untagged never asks who is sending or who a DM is with.
 */
import { describe, expect, it } from "vitest";

import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import type { ConversationAnswer } from "../../../../../cli/commands/slack/draftRecordReads.js";
import { untaggedNameHold } from "../../../../../cli/commands/slack/draftUntaggedNames.js";
import { buildMemberIdentity } from "../../../../../corpus/members/email.js";
import type { MemberBronzeRow } from "../../../../../corpus/members/types.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";

/** A Slack member bronze row for one person. */
function memberRow({ name, nativeId }: { name: string; nativeId: string }): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-01T00:00:00.000Z",
    identity: buildMemberIdentity({ handle: name.toLowerCase(), name, nativeId, source: "slack" }),
    profile: {},
    provenance: [],
    raw: {},
    source: "slack",
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

const ROWS = [
  memberRow({ name: "Ada Owner", nativeId: "U0SYNADAOWN" }),
  memberRow({ name: "Jonah Smith", nativeId: "U0JONAH" }),
];

const NO_RESOLUTION: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
};

const JONAH_FINDING =
  '  "jonah" at lines[0].runs[0] is Jonah Smith (U0JONAH): put {"type":"mention","person":"U0JONAH"} where the name ' +
  "is, or reword so it names nobody the message does not tag.";

/** Runs the hold over one line of prose, counting the author and DM reads it makes. */
async function hold({
  prose,
  wireText = prose,
  resolution = NO_RESOLUTION,
  selfId,
  dmUser,
}: {
  prose: string;
  wireText?: string;
  resolution?: MentionResolution;
  selfId?: string;
  dmUser?: string;
}): Promise<{ readonly lines: readonly string[]; readonly reads: readonly string[] }> {
  const reads: string[] = [];
  const lines = await untaggedNameHold({
    deps: { loadMembers: () => ({ rows: ROWS, warnings: [] }) },
    home: "/unused-home",
    message: {
      payload: { form: "plain", text: wireText, unfurl_links: false, unfurl_media: false },
      prepared: {
        plan: { artifact: { kind: "one-card", lines: [{ runs: [{ text: prose, type: "text" }] }] } },
        resolution,
      },
    },
    readInfo: async (): Promise<ConversationAnswer> => {
      reads.push("conversationInfo");
      return { name: undefined, surface: undefined, user: dmUser };
    },
    readSelf: async () => {
      reads.push("whoAmI");
      return { userId: selfId };
    },
  });
  return { lines, reads };
}

describe("untaggedNameHold", () => {
  it("REFUSES prose naming a colleague it does not tag, and says nothing was parked", async () => {
    const seen = await hold({ prose: "jonah approved it already" });
    expect(seen.lines.slice(1)).toEqual([
      JONAH_FINDING,
      "There is deliberately NO escape hatch: tagging them, or not naming them, is always available.",
      NOTHING_PARKED,
    ]);
    expect(seen.reads).toEqual(["whoAmI", "conversationInfo"]);
  });

  it("parks clean prose without asking who is sending or who a DM is with", async () => {
    expect(await hold({ prose: "approved it already" })).toEqual({ lines: [], reads: [] });
  });

  it("counts a tag in the wire text as tagged", async () => {
    const seen = await hold({ prose: "jonah approved it already", wireText: "<@U0JONAH> approved it already" });
    expect(seen).toEqual({ lines: [], reads: [] });
  });

  it("counts a resolved mention as tagged when the wire text drops it", async () => {
    const seen = await hold({
      prose: "jonah approved it already",
      resolution: {
        ...NO_RESOLUTION,
        resolved: new Map([["jonah", { origin: "member" as const, slackId: "U0JONAH" }]]),
      },
    });
    expect(seen).toEqual({ lines: [], reads: [] });
  });

  it("never holds the author naming themselves", async () => {
    const seen = await hold({ prose: "ada will follow up", selfId: "U0SYNADAOWN" });
    expect(seen).toEqual({ lines: [], reads: ["whoAmI", "conversationInfo"] });
  });

  it("never holds the other member of the DM it is going to", async () => {
    const seen = await hold({ dmUser: "U0JONAH", prose: "cheers jonah" });
    expect(seen).toEqual({ lines: [], reads: ["whoAmI", "conversationInfo"] });
  });
});
