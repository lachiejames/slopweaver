import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  runSlackTagged,
  type SlackTaggedDeps,
  SlackTaggedLiveErrors,
} from "../../../../../cli/commands/slack/taggedRun.js";
import { SLACK_TAGGED_USAGE } from "../../../../../cli/commands/slack/taggedUsage.js";
import { err, ok } from "../../../../../lib/result.js";
import type { SlackSearchMatch, SlackSearchMessages } from "../../../../../live/slack/searchMessages.js";
import { bronze, CORPUS_NEWEST, HUMAN, hit, NOW, OWNER, taggedHome } from "./taggedFixture.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A home holding one tag in a thread the owner has not spoken in since. */
function homeWithOneTag({ ownerId = OWNER }: { ownerId?: string | null } = {}): string {
  const dir = taggedHome({
    files: [
      [
        bronze({
          author: HUMAN,
          rootTs: "1790001000.000100",
          tags: true,
          ts: "1790001050.000100",
          tsIso: "2026-09-29T00:00:00.000Z",
        }),
      ],
    ],
    ownerId,
  });
  homes.push(dir);
  return dir;
}

/**
 * A search seam answering each query from a fixed table, recording every query it was asked.
 *
 * @param byQueryPrefix the hits for a query starting with each prefix
 * @param asked collects every query
 * @returns the seam
 */
function fakeSearch({
  byQueryPrefix,
  asked,
}: {
  byQueryPrefix: Readonly<Record<string, readonly SlackSearchMatch[]>>;
  asked: string[];
}): SlackSearchMessages {
  return async ({ query }) => {
    asked.push(query);
    const prefix = Object.keys(byQueryPrefix).find((key) => query.startsWith(key))!;
    const matches = byQueryPrefix[prefix]!;
    return ok({ matches, pageCount: 1, total: matches.length });
  };
}

/** Plain fakes for every edge, recording what was written. */
function fakes({ liveFor }: { liveFor: SlackTaggedDeps["liveFor"] }): {
  deps: SlackTaggedDeps;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      clockIso: () => NOW,
      defaultHome: () => "/nonexistent/slopweaver-tagged-default",
      liveFor,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

const NO_LIVE: SlackTaggedDeps["liveFor"] = async () => err(SlackTaggedLiveErrors.tokenMissing());

describe("runSlackTagged", () => {
  it("prints its usage on --help and reads nothing", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    expect(await runSlackTagged({ deps: edges.deps, rest: ["--help"] })).toBe(0);
    expect(edges.out).toStrictEqual([SLACK_TAGGED_USAGE]);
  });

  it("refuses a window wider than 30 days and a --now that is not an instant, as a usage error", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    expect(await runSlackTagged({ deps: edges.deps, rest: ["--days", "31", "--now", "yesterday"] })).toBe(2);
    expect(edges.diagnostics.slice(0, 2)).toStrictEqual([
      "slack tagged: --days must be at most 30, got 31",
      'slack tagged: --now must be an ISO 8601 instant, got "yesterday"',
    ]);
  });

  it("lists the corpus tag and exits 0 under --corpus-only when the corpus reaches --now, asking no live seam", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const code = await runSlackTagged({
      deps: edges.deps,
      rest: ["--corpus-only", "--now", CORPUS_NEWEST, "--home", homeWithOneTag()],
    });
    expect(code).toBe(0);
    expect(edges.out[0]).toBe(
      "slack tagged: 1 tag(s) of you by a person in the last 7 day(s), newest first (1 with no later word from you, each up to the instant its row names)",
    );
    expect(edges.out[1]).toContain("no later word from you in the thread up to 2026-09-29T12:00:00.000Z");
    expect(edges.out).toContain(
      "  - the live search was skipped (--corpus-only), so a tag newer than the corpus is not listed, and a reply of yours newer than it is not seen",
    );
  });

  it("exits 1 as incomplete under --corpus-only when the corpus stops short of now, still listing its tag", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--corpus-only", "--home", homeWithOneTag()] });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: INCOMPLETE — 1 tag(s)");
  });

  it("is unavailable and exits 1 under --corpus-only when the home holds no Slack corpus, never an empty all-clear", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const empty = taggedHome({ files: [] });
    homes.push(empty);
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--corpus-only", "--home", empty] });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: UNAVAILABLE");
    expect(edges.out).toContain("  - this home holds no Slack corpus, so nothing was read");
  });

  it("exits 1 as incomplete when the corpus carries no watermark, so how far it reaches is unknown", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const unmarked = taggedHome({
      files: [[bronze({ author: HUMAN, tags: true, ts: "1790001050.000100", tsIso: "2026-09-29T00:00:00.000Z" })]],
      watermark: null,
    });
    homes.push(unmarked);
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--corpus-only", "--home", unmarked] });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: INCOMPLETE — 1 tag(s)");
  });

  it("exits 1 as incomplete when the home holds no Slack members index, so a bot cannot be told from a person", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const bare = taggedHome({
      files: [[bronze({ author: HUMAN, tags: true, ts: "1790001050.000100", tsIso: "2026-09-29T00:00:00.000Z" })]],
      members: false,
    });
    homes.push(bare);
    const code = await runSlackTagged({
      deps: edges.deps,
      rest: ["--corpus-only", "--now", CORPUS_NEWEST, "--home", bare],
    });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: INCOMPLETE — 1 tag(s)");
    expect(edges.out).toContain(
      "  - this home holds no Slack members index, so a bot's or an app's tag may be listed as a person's",
    );
  });

  it("exits 1 under --corpus-only when a future pooled watermark hides the tail since the last channel crawl", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const ahead = taggedHome({
      channelReach: { C0CHAN1: "2026-09-29T09:00:00.000Z" },
      files: [[bronze({ author: HUMAN, tags: true, ts: "1790001050.000100", tsIso: "2026-09-29T00:00:00.000Z" })]],
      watermark: "2026-10-01",
    });
    homes.push(ahead);
    const code = await runSlackTagged({
      deps: edges.deps,
      rest: ["--corpus-only", "--now", "2026-09-29T20:00:00.000Z", "--home", ahead],
    });
    expect(code).toBe(1);
    expect(edges.out).toContain(
      "  - nothing after 2026-09-29T09:00:00.000Z was read — the corpus stops there and the live search did not run — so a tag after it is not listed",
    );
  });

  it("still lists the corpus tag but exits 1 when the live leg has no user token", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--home", homeWithOneTag()] });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: INCOMPLETE — 1 tag(s)");
    expect(edges.out).toContain(
      "  - the live search did not run: no Slack user token in the store — `slopweaver secrets status`",
    );
  });

  it("merges the live tail: a hit the corpus holds is one row, a newer one is added, the owner's live reply answers it", async () => {
    const asked: string[] = [];
    const search = fakeSearch({
      asked,
      byQueryPrefix: {
        "<@": [
          hit({
            rootTs: "1790001000.000100",
            ts: "1790001050.000100",
            tsIso: "2026-09-29T00:00:00.000Z",
            userId: HUMAN,
          }),
          hit({ channelId: "C0CHAN2", ts: "1790090000.000100", tsIso: "2026-09-29T20:00:00.000Z", userId: HUMAN }),
        ],
        "from:": [
          hit({
            channelId: "C0CHAN2",
            rootTs: "1790090000.000100",
            tags: false,
            ts: "1790090500.000100",
            tsIso: "2026-09-29T21:00:00.000Z",
            userId: OWNER,
          }),
        ],
      },
    });
    const edges = fakes({ liveFor: async () => ok(search) });
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--json", "--home", homeWithOneTag()] });
    expect(code).toBe(0);
    expect(asked).toStrictEqual([`<@${OWNER}> after:2026-09-22`, `from:<@${OWNER}> after:2026-09-22`]);
    const document = JSON.parse(edges.out.join("\n")) as {
      rows: { source: string; answered: boolean | null; channelId: string }[];
    };
    expect(document.rows.map((row) => [row.channelId, row.source, row.answered])).toStrictEqual([
      ["C0CHAN2", "live", true],
      ["C0CHAN1", "both", false],
    ]);
  });

  it("is unavailable and exits 1 when the profile declares no owner", async () => {
    const edges = fakes({ liveFor: NO_LIVE });
    const code = await runSlackTagged({ deps: edges.deps, rest: ["--home", homeWithOneTag({ ownerId: null })] });
    expect(code).toBe(1);
    expect(edges.out[0]).toContain("slack tagged: UNAVAILABLE");
  });
});
