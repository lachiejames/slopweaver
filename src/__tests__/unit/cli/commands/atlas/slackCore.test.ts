import { describe, expect, it } from "vitest";

import type { AtlasChannel, SlackAtlas } from "../../../../../atlas/slack.js";
import { renderAtlasSlack } from "../../../../../cli/commands/atlas/slackCore.js";

/** One private channel this account has not joined — each case below names it, or not. */
function privateChannel({ id, name }: { id: string; name: string | undefined }): AtlasChannel {
  return {
    coverage: { kind: "never-read" },
    id,
    isArchived: false,
    isMember: false,
    isPrivate: true,
    name,
    readable: false,
    unreadableReason: "private and not a member",
  };
}

/** An atlas holding exactly the channels given, all of them unreadable, with no huddle ingested. */
function atlasOf({ channels }: { channels: readonly AtlasChannel[] }): SlackAtlas {
  return {
    channels,
    counts: {
      everRead: 0,
      membershipKnown: channels.length,
      neverReadArchived: 0,
      neverReadJoined: 0,
      readable: 0,
      readableNeverRead: 0,
      total: channels.length,
      unreadable: channels.length,
    },
    huddles: {
      earliestIso: undefined,
      latestIso: undefined,
      total: 0,
      withTranscript: 0,
      withWords: 0,
      withoutTranscript: 0,
    },
  };
}

describe("renderAtlasSlack — the --unreadable list", () => {
  it("ends a channel's row with its name, and with (unnamed) when the capture recorded none", () => {
    const text = renderAtlasSlack({
      atlas: atlasOf({
        channels: [
          privateChannel({ id: "C0NAMED", name: "ops-private" }),
          privateChannel({ id: "C0BARE", name: undefined }),
        ],
      }),
      options: { neverRead: false, unreadable: true },
      shortfall: [],
    });
    const rows = text.split("\n").filter((line) => line.startsWith("  C0"));
    expect(rows).toEqual([
      `  ${"C0NAMED".padEnd(12)} ${"unreadable".padEnd(12)} ${"never read".padEnd(24)} ops-private`,
      `  ${"C0BARE".padEnd(12)} ${"unreadable".padEnd(12)} ${"never read".padEnd(24)} (unnamed)`,
    ]);
  });
});
