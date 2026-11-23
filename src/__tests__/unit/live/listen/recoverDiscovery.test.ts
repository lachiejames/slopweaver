/**
 * Where a widened recovery pass LOOKS, derived from the bot token's own membership.
 *
 * The case that matters is the one the hand-carried literal got wrong: a PRIVATE channel the bot is a member
 * of, which no shift's typed list ever named. It is asserted here by the real id from the
 * incident, beside the shapes that must NOT be scanned — a public channel the token can see but has never
 * joined answers `not_in_channel` for every message in it.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi, SlackChannelsPage } from "../../../../corpus/slack/fetch.js";
import type { SlackConversationLane } from "../../../../corpus/slack/lanes.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { discoverRecoveryChannels, RecoveryDiscoveryErrors } from "../../../../live/listen/recoverDiscovery.js";

/** The private channel an earlier widened pass was blind to, by its real workspace id. */
const ACME_BUGS = "C0SYN000011";

/** Every read scope a complete membership walk needs — what the real bot token holds, and the fake default. */
const ALL_DISCOVERY_SCOPES: readonly string[] = ["channels:read", "groups:read", "im:read", "mpim:read"];

/** A Slack read seam serving fixed pages per lane and a fixed scope answer — plain fakes, never mocks. */
function channelsServing({
  pages,
  groupDmPages = [{ channels: [] }],
  scopes = ALL_DISCOVERY_SCOPES,
}: {
  pages: readonly SlackChannelsPage[];
  groupDmPages?: readonly SlackChannelsPage[];
  /** `"unestablished"` is the third state `grantedScopes` reports — Slack answered, and named no scope set. */
  scopes?: readonly string[] | "unestablished";
}): Pick<SlackApi, "grantedScopes" | "listChannels"> {
  const served: Record<SlackConversationLane, number> = { "channels-and-dms": 0, "group-dms": 0 };
  return {
    grantedScopes: async () => (scopes === "unestablished" ? undefined : scopes),
    listChannels: async ({ lane }) => {
      const lanePages = lane === "group-dms" ? groupDmPages : pages;
      const index = served[lane];
      served[lane] += 1;
      const page = lanePages[index];
      if (page === undefined) {
        throw new Error(`fake asked ${lane} for page ${String(index + 1)} but only ${String(lanePages.length)} exist`);
      }
      return page;
    },
  };
}

describe("discoverRecoveryChannels", () => {
  it("finds the JOINED PRIVATE channel a hand-typed list omitted, and drops the public one it never joined", async () => {
    const api = channelsServing({
      pages: [
        {
          channels: [
            { id: "C_JOINED_PUBLIC", is_member: true, name: "platform" },
            { id: "C_VISIBLE_ONLY", is_member: false, name: "random" },
            { id: ACME_BUGS, is_member: true, is_private: true, name: "acme-bugs" },
            { id: "D_OWNER", is_im: true },
          ],
        },
      ],
    });

    const discovered = unwrap(await discoverRecoveryChannels({ api }));

    expect(discovered.map((channel) => channel.id)).toEqual(["C_JOINED_PUBLIC", ACME_BUGS, "D_OWNER"]);
  });

  it("keeps a DM with no isMember field at all — a DM has no membership concept to report", async () => {
    const api = channelsServing({ pages: [{ channels: [{ id: "D_ONE", is_im: true }] }] });

    expect(unwrap(await discoverRecoveryChannels({ api })).map((channel) => channel.id)).toEqual(["D_ONE"]);
  });

  it("walks the group-DM lane too, so an MPIM the bot is in is scanned", async () => {
    const api = channelsServing({
      groupDmPages: [{ channels: [{ id: "C_MPIM", is_member: true, is_mpim: true }] }],
      pages: [{ channels: [{ id: "C_JOINED_PUBLIC", is_member: true }] }],
    });

    expect(unwrap(await discoverRecoveryChannels({ api })).map((channel) => channel.id)).toEqual([
      "C_JOINED_PUBLIC",
      "C_MPIM",
    ]);
  });

  it("collapses a conversation listed by two lanes to one target, keeping discovery order", async () => {
    const api = channelsServing({
      groupDmPages: [{ channels: [{ id: "C_MPIM", is_member: true, is_mpim: true }] }],
      pages: [
        {
          channels: [
            { id: "C_MPIM", is_member: true, is_mpim: true },
            { id: "C_OTHER", is_member: true },
          ],
        },
      ],
    });

    expect(unwrap(await discoverRecoveryChannels({ api })).map((channel) => channel.id)).toEqual(["C_MPIM", "C_OTHER"]);
  });

  it("is complete-or-nothing: a lane that fails late returns the error and NO usable prefix", async () => {
    const api = channelsServing({
      pages: [
        { channels: [{ id: "C_JOINED_PUBLIC", is_member: true }], nextCursor: "same" },
        { channels: [{ id: ACME_BUGS, is_member: true }], nextCursor: "same" },
      ],
    });

    const result = await discoverRecoveryChannels({ api });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("DISCOVERY_WALK_FAILED");
    expect(unwrapErr(result).message).toContain("did not complete");
  });

  it("refuses a walk that succeeded and named nothing the bot may act in, rather than answering []", async () => {
    // The counterexample: an ok([]) makes every downstream count zero, and zero scanned of zero
    // requested with no failures is arithmetically a COMPLETE pass — exit 3 over a workspace nobody read.
    const api = channelsServing({
      pages: [
        {
          channels: [
            { id: "C_VISIBLE_ONLY", is_member: false },
            { id: "C_ALSO_SEEN_ONLY", is_member: false },
          ],
        },
      ],
    });

    const result = await discoverRecoveryChannels({ api });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(RecoveryDiscoveryErrors.foundNothing({ discovered: 2 }));
    expect(unwrapErr(result).message).toContain("returned 2 conversation(s) and none it may act in");
  });

  it("keeps a joined PRIVATE channel whose row omits is_member, beside a survivor that would mask it", async () => {
    // The third counterexample. Slack lists a private channel only to a token that is IN it, so an
    // absent flag there is an anomaly rather than a non-member — and dropping it while another conversation
    // survived left the pass looking complete over the one class this flag exists to reach.
    const api = channelsServing({
      pages: [
        {
          channels: [
            { id: "C_PUBLIC", is_member: true },
            { id: ACME_BUGS, is_private: true },
          ],
        },
      ],
    });

    expect(unwrap(await discoverRecoveryChannels({ api })).map((channel) => channel.id)).toEqual([
      "C_PUBLIC",
      ACME_BUGS,
    ]);
  });

  it("refuses a genuinely empty walk with the same code, counting the nothing it was handed", async () => {
    const api = channelsServing({ pages: [{ channels: [] }] });

    const result = await discoverRecoveryChannels({ api });

    expect(unwrapErr(result).code).toBe("DISCOVERY_FOUND_NOTHING");
    expect(unwrapErr(result).message).toContain("returned 0 conversation(s)");
  });

  it("refuses a token without groups:read, whose scope-filtered walk is NON-empty and looks complete", async () => {
    // The second counterexample, and the one the union cannot reach: the private channel was never
    // typed, so nothing downstream could restore it. The walk exhausts cleanly, returns the public channel
    // and the DM, and Slack reports no error — so only the token's own scope answer can tell this apart
    // from a workspace with no private channels in it.
    const api = channelsServing({
      pages: [
        {
          channels: [
            { id: "C_JOINED_PUBLIC", is_member: true },
            { id: "D_OWNER", is_im: true },
          ],
        },
      ],
      scopes: ["channels:read", "im:read", "mpim:read"],
    });

    const result = await discoverRecoveryChannels({ api });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(RecoveryDiscoveryErrors.scopesMissing({ missing: ["groups:read"] }));
    expect(unwrapErr(result).message).toContain("does not hold groups:read");
  });

  it("names every missing read scope at once, so one re-install fixes the whole walk", async () => {
    const api = channelsServing({ pages: [{ channels: [] }], scopes: ["channels:read"] });

    expect(unwrapErr(await discoverRecoveryChannels({ api })).message).toContain(
      "does not hold groups:read, im:read, mpim:read",
    );
  });

  it("refuses when the scope set could not be established at all, rather than reading it as held", async () => {
    const api = channelsServing({ pages: [{ channels: [] }], scopes: "unestablished" });

    const result = await discoverRecoveryChannels({ api });

    expect(unwrapErr(result)).toEqual(RecoveryDiscoveryErrors.scopesUnverified());
    expect(unwrapErr(result).message).toContain("could not be established");
  });

  it("never walks a lane at all once the preflight has refused — the pages fake would throw if asked", async () => {
    // Falsifiable witness: `pages: []` makes any listChannels call throw, so this passing proves the walk
    // was skipped rather than merely that its result was discarded.
    const api = channelsServing({ pages: [], scopes: ["channels:read"] });

    expect(unwrapErr(await discoverRecoveryChannels({ api })).code).toBe("DISCOVERY_SCOPES_MISSING");
  });
});
