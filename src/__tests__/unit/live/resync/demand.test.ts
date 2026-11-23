/**
 * The demand gate's pure half: a person's mention after the last successful read is the one reason a gated atlas
 * walks. The fixtures are measured hits for `dvuln` (`slopweaver store hits --term dvuln --shape exact --json`):
 * a person's ask, the bot's own earlier post, and a fleet pull request.
 */
import { describe, expect, it } from "vitest";

import { AETHER_ATLAS_DESCRIPTOR } from "../../../../atlas/aether/descriptor.js";
import { atlasDescriptorSchema } from "../../../../atlas/kit/contract.js";
import {
  demandPagingDone,
  demandWords,
  isInstant,
  judgeResyncDemand,
  RESYNC_DEMAND_SOURCES,
  type ResyncDemandHit,
  unusableHit,
  unwantedLine,
} from "../../../../live/resync/demand.js";

const LAST_SUCCESS = "2026-10-04T21:27:13.151Z";
const BOT = "U0SYN000005";

const TOBIAS: ResyncDemandHit = {
  author: "Tobias Wren",
  authorNativeId: "U0SYN000017",
  occurredAt: "2026-10-06T22:03:01Z",
  source: "slack",
  url: "https://acme.slack.com/archives/C0SYN000019/p1791324181655509",
};
const BOT_POST: ResyncDemandHit = {
  author: BOT,
  authorNativeId: BOT,
  occurredAt: "2026-10-06T23:00:00Z",
  source: "slack",
  url: "https://acme.slack.com/archives/C0SYN000001/p1",
};
const FLEET_PR: ResyncDemandHit = {
  author: "octocat",
  authorNativeId: "octocat",
  occurredAt: "2026-10-07T01:00:00Z",
  source: "github",
  url: "https://github.com/lachiejames/slopweaver/pull/1",
};

describe("demandPagingDone", () => {
  // A full page of the fleet's own posts newer than the last read hides whatever is behind it.
  const fullOfBots = Array.from({ length: 2 }, () => BOT_POST);
  const page = { excludedAuthorIds: [BOT], pageSize: 2, sinceIso: LAST_SUCCESS };

  it("reads on past a full page of the fleet's own posts that all postdate the last read", () => {
    expect(demandPagingDone({ ...page, page: fullOfBots })).toBe(false);
  });

  it("stops on a page holding a person's mention, a short page, or one reaching back to the last read", () => {
    const older = { ...BOT_POST, occurredAt: "2026-10-01T00:00:00Z" };
    expect([
      demandPagingDone({ ...page, page: [BOT_POST, TOBIAS] }),
      demandPagingDone({ ...page, page: [BOT_POST] }),
      demandPagingDone({ ...page, page: [BOT_POST, older] }),
    ]).toEqual([true, true, true]);
  });

  it("never stops on age alone for an atlas that has never read", () => {
    expect(demandPagingDone({ ...page, page: fullOfBots, sinceIso: null })).toBe(false);
  });
});

describe("judgeResyncDemand", () => {
  it("finds a person's mention after the last success", () => {
    expect(judgeResyncDemand({ excludedAuthorIds: [BOT], hits: [TOBIAS], sinceIso: LAST_SUCCESS })).toEqual({
      author: "Tobias Wren",
      occurredAt: "2026-10-06T22:03:01Z",
      source: "slack",
      url: TOBIAS.url,
    });
  });

  it("takes the NEWEST qualifying mention, whatever order the hits arrive in", () => {
    const later = { ...TOBIAS, author: "Rosa Lindqvist", occurredAt: "2026-10-07T01:30:00Z", url: "https://x/later" };
    expect(judgeResyncDemand({ excludedAuthorIds: [BOT], hits: [TOBIAS, later], sinceIso: LAST_SUCCESS })!.url).toBe(
      "https://x/later",
    );
  });

  it("finds nothing in the fleet's own posts or its pull requests, though both are newer", () => {
    expect(judgeResyncDemand({ excludedAuthorIds: [BOT], hits: [BOT_POST, FLEET_PR], sinceIso: LAST_SUCCESS })).toBe(
      null,
    );
  });

  it("finds nothing in a fleet Slack post whose id the store resolved into the author, with no native id", () => {
    const resolvedOnly = { ...BOT_POST, author: BOT, authorNativeId: null };
    expect(judgeResyncDemand({ excludedAuthorIds: [BOT], hits: [resolvedOnly], sinceIso: LAST_SUCCESS })).toBe(null);
  });

  it("excludes a fleet Slack id only in Slack, since another source's id can be the same string", () => {
    const linear = { ...TOBIAS, authorNativeId: BOT, source: "linear", url: "https://linear.app/acme/issue/X-1" };
    expect(judgeResyncDemand({ excludedAuthorIds: [BOT], hits: [linear], sinceIso: LAST_SUCCESS })!.url).toBe(
      "https://linear.app/acme/issue/X-1",
    );
  });

  it("finds nothing in a second before the last success — that read already saw it", () => {
    const beforeRead = { ...TOBIAS, occurredAt: "2026-10-04T21:27:12Z" };
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [beforeRead], sinceIso: LAST_SUCCESS })).toBe(null);
  });

  it("counts a mention in the read's own second, which the store reports truncated to that second", () => {
    const sameSecond = { ...TOBIAS, occurredAt: "2026-10-04T21:27:13Z" };
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [sameSecond], sinceIso: LAST_SUCCESS })!.occurredAt).toBe(
      "2026-10-04T21:27:13Z",
    );
  });

  it("counts any mention for an atlas that has never read", () => {
    const old = { ...TOBIAS, occurredAt: "2026-04-09T00:00:00Z" };
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [old], sinceIso: null })!.occurredAt).toBe(
      "2026-04-09T00:00:00Z",
    );
  });

  it("names the native id when the store holds no display name", () => {
    const unnamed = { ...TOBIAS, author: null };
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [unnamed], sinceIso: LAST_SUCCESS })!.author).toBe(
      "U0SYN000017",
    );
  });

  it("finds nothing in a record naming nobody, such as a Notion row an automation wrote", () => {
    const unattributed = {
      ...TOBIAS,
      author: null,
      authorNativeId: null,
      source: "notion",
      url: "https://notion.so/x",
    };
    const blank = { ...unattributed, author: " ", authorNativeId: "" };
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [unattributed, blank], sinceIso: LAST_SUCCESS })).toBe(
      null,
    );
  });

  it("finds nothing in an empty search", () => {
    expect(judgeResyncDemand({ excludedAuthorIds: [], hits: [], sinceIso: LAST_SUCCESS })).toBe(null);
  });
});

describe("isInstant", () => {
  it("passes a parseable time and the never-read null, and refuses a string that is not a time", () => {
    expect([
      isInstant({ iso: LAST_SUCCESS }),
      isInstant({ iso: "2026-10-06T22:03:01Z" }),
      isInstant({ iso: null }),
      isInstant({ iso: "not-a-date" }),
      isInstant({ iso: "" }),
    ]).toEqual([true, true, true, false, false]);
  });
});

describe("unusableHit", () => {
  it("names a hit whose time does not parse, or that carries no link, and passes a page of usable ones", () => {
    expect([
      unusableHit({ hits: [TOBIAS, { ...TOBIAS, occurredAt: "garbage" }] }),
      unusableHit({ hits: [TOBIAS, { ...TOBIAS, url: " " }] }),
      unusableHit({ hits: [TOBIAS, BOT_POST] }),
      unusableHit({ hits: [] }),
    ]).toEqual([
      `the corpus store returned ${TOBIAS.url} with a time that does not parse (garbage)`,
      "the corpus store returned a slack record of 2026-10-06T22:03:01Z with no link",
      null,
      null,
    ]);
  });
});

describe("the demand words", () => {
  it("names who, where and when", () => {
    expect(
      demandWords({
        record: { author: "Tobias Wren", occurredAt: "2026-10-06T22:03:01Z", source: "slack", url: TOBIAS.url },
      }),
    ).toBe("Tobias Wren in slack at 2026-10-06T22:03:01Z");
  });

  it("says what was searched, since when, and that nothing walked", () => {
    expect(unwantedLine({ sinceIso: LAST_SUCCESS, terms: ["aether", "dvuln"] })).toBe(
      `NOTHING TO DO · no person has named aether or dvuln in ${RESYNC_DEMAND_SOURCES.join(", ")} since its last read ` +
        `at ${LAST_SUCCESS}, so nothing walked and no sign-in was asked for`,
    );
  });

  it("searches only where people talk — never the fleet's pull requests or this repository's own scan", () => {
    const sources: readonly string[] = RESYNC_DEMAND_SOURCES;
    expect([sources.includes("github"), sources.includes("self"), sources.includes("slack")]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("the resyncDemand descriptor field", () => {
  it("is declared by Aether, with its terms", () => {
    expect(AETHER_ATLAS_DESCRIPTOR.resyncDemand!.terms).toEqual(["aether", "dvuln"]);
    expect(atlasDescriptorSchema.safeParse(AETHER_ATLAS_DESCRIPTOR).success).toBe(true);
  });

  it("refuses an empty term list, which would gate the atlas on nothing", () => {
    const parsed = atlasDescriptorSchema.safeParse({
      ...AETHER_ATLAS_DESCRIPTOR,
      resyncDemand: { because: "x", terms: [] },
    });
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["resyncDemand.terms"]);
  });

  it("refuses a key it does not declare", () => {
    const parsed = atlasDescriptorSchema.safeParse({
      ...AETHER_ATLAS_DESCRIPTOR,
      resyncDemand: { because: "x", sources: ["github"], terms: ["aether"] },
    });
    expect(parsed.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });
});
