import { describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import {
  DEFAULT_ENUMERATE_AT_OR_BELOW,
  parseAroundArgs,
  parseGroupsArgs,
  parseHitsArgs,
  parseOpenArgs,
  parsePeekArgs,
  parseProbeArgs,
} from "../../../cli/commands/store/probeCore.js";
import { aroundLines, groupLines, probeLines } from "../../../cli/commands/store/probeLines.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { ChannelNeighbour } from "../../../store/probe/aroundSlack.js";
import type { AroundPage, RecordPeek } from "../../../store/probe/disclose.js";
import type { ProbeReport } from "../../../store/probe/result.js";

/** A store uuid, so an anchor in these cases is a real address rather than a placeholder word. */
const UUID = "552f2e60-efc6-4b63-bc83-d30039f7abe2";

describe("parseProbeArgs", () => {
  it("takes every keyword as its own subject, which is what a repeated flag could not do", () => {
    const args = unwrap(parseProbeArgs({ rest: ["17000", "decagon", "barten"] }));
    expect(args.subjects).toEqual([
      { kind: "term", term: "17000" },
      { kind: "term", term: "decagon" },
      { kind: "term", term: "barten" },
    ]);
  });

  it("keeps a quoted phrase as ONE keyword", () => {
    const args = unwrap(parseProbeArgs({ rest: ["staging pool"] }));
    expect(args.subjects).toEqual([{ kind: "term", term: "staging pool" }]);
  });

  it("adds the caller's own regex as its own subject, after the keywords", () => {
    const args = unwrap(parseProbeArgs({ rest: ["17000", "--regex", "pull/1[0-9]{4}"] }));
    expect(args.subjects).toEqual([
      { kind: "term", term: "17000" },
      { kind: "regex", pattern: "pull/1[0-9]{4}" },
    ]);
  });

  it("defaults the enumeration cap rather than enumerating everything", () => {
    const args = unwrap(parseProbeArgs({ rest: ["x"] }));
    expect(args.enumerateAtOrBelow).toBe(DEFAULT_ENUMERATE_AT_OR_BELOW);
    expect(args.ids).toBe(10);
  });

  it("refuses a probe with no subject at all", () => {
    const refused = parseProbeArgs({ rest: ["--json"] });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      "name at least one keyword, or a --regex — a probe with no subject counts nothing",
    ]);
  });

  it("refuses a cap that is not a whole number, naming what was given", () => {
    const refused = parseProbeArgs({ rest: ["x", "--enumerate-at-or-below", "lots"] });
    expect(refused.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain(
      "--enumerate-at-or-below must be a whole number",
    );
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(parseProbeArgs({ rest: ["x", "--sauce", "slack"] })) })).toEqual([
      "unknown flag: --sauce",
    ]);
  });
});

describe("parseGroupsArgs", () => {
  it("reads the term, the shape and the facet", () => {
    const args = unwrap(
      parseGroupsArgs({ rest: ["--term", "datadog", "--shape", "wild-both", "--facet", "container"] }),
    );
    expect(args.term).toBe("datadog");
    expect(args.shape).toBe("wild-both");
    expect(args.facet).toBe("container");
    expect(args.limit).toBe(20);
  });

  it("refuses a shape that is not on the ladder, listing the seven", () => {
    const refused = parseGroupsArgs({ rest: ["--term", "x", "--shape", "fuzzy", "--facet", "source"] });
    expect(refused.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain('no shape named "fuzzy"');
  });

  it("refuses a facet the store cannot group by", () => {
    const refused = parseGroupsArgs({ rest: ["--term", "x", "--shape", "exact", "--facet", "mood"] });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      "--facet must be one of source, kind, container, author",
    ]);
  });

  it("reports every refusal at once rather than only the first", () => {
    const refused = parseGroupsArgs({ rest: ["--shape", "fuzzy", "--facet", "mood"] });
    expect(storeCommandErrorLines({ error: refused._unsafeUnwrapErr() })).toHaveLength(3);
  });
});

describe("parseHitsArgs", () => {
  it("defaults the page and its offset", () => {
    const args = unwrap(parseHitsArgs({ rest: ["--term", "barten", "--shape", "exact"] }));
    expect(args.limit).toBe(25);
    expect(args.offset).toBe(0);
    expect(args.source).toBe(undefined);
  });

  it("reads an explicit page", () => {
    const args = unwrap(
      parseHitsArgs({ rest: ["--term", "barten", "--shape", "exact", "--limit", "5", "--offset", "10"] }),
    );
    expect(args.limit).toBe(5);
    expect(args.offset).toBe(10);
  });
});

// The search rungs start human-only and widen.
describe("the bot scope on the search rungs", () => {
  it("is human-only by default on all three", () => {
    expect(unwrap(parseProbeArgs({ rest: ["x"] })).includeBots).toBe(false);
    expect(
      unwrap(parseGroupsArgs({ rest: ["--term", "x", "--shape", "exact", "--facet", "source"] })).includeBots,
    ).toBe(false);
    expect(unwrap(parseHitsArgs({ rest: ["--term", "x", "--shape", "exact"] })).includeBots).toBe(false);
  });

  it("widens on --include-bots", () => {
    expect(unwrap(parseProbeArgs({ rest: ["x", "--include-bots"] })).includeBots).toBe(true);
    expect(unwrap(parseHitsArgs({ rest: ["--term", "x", "--shape", "exact", "--include-bots"] })).includeBots).toBe(
      true,
    );
  });

  it("accepts --exclude-bots as the default's own spelling", () => {
    expect(unwrap(parseProbeArgs({ rest: ["x", "--exclude-bots"] })).includeBots).toBe(false);
  });

  it("refuses both at once rather than picking one", () => {
    const refused = parseProbeArgs({ rest: ["x", "--include-bots", "--exclude-bots"] });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      "--include-bots and --exclude-bots contradict each other — human-only is the default, so pass --include-bots alone to widen",
    ]);
  });

  it("refuses both at once on groups alongside every other refusal", () => {
    const refused = parseGroupsArgs({
      rest: ["--shape", "exact", "--facet", "source", "--include-bots", "--exclude-bots"],
    });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      "--term is required",
      "--include-bots and --exclude-bots contradict each other — human-only is the default, so pass --include-bots alone to widen",
    ]);
  });
});

/** A one-subject probe report whose widest set held `botsHidden` bot rows the default left out. */
const probeReport = ({ botsHidden, includeBots }: { botsHidden: number; includeBots: boolean }): ProbeReport => ({
  elapsedMs: 7,
  enumerateAtOrBelow: 40,
  includeBots,
  rows: [
    {
      botsHidden,
      cells: [{ bySource: [{ rows: 3, source: "slack" }], ids: null, indexed: true, rows: 3, shape: "exact" }],
      elapsedMs: 7,
      kind: "term",
      subject: "renovate",
    },
  ],
  source: null,
});

describe("probeLines' bot accounting", () => {
  it("says how many bot rows the default left out, and how to widen", () => {
    const lines = probeLines({ report: probeReport({ botsHidden: 412, includeBots: false }) });
    expect(lines.filter((line) => line.startsWith("  bots:"))).toEqual([
      "  bots: 412 bot-authored row(s) in the wild-both set not counted — widen with --include-bots",
    ]);
    expect(lines.at(-1)).toBe("probed the whole store (human authors only) in 7 ms");
  });

  it("prints no bots line when the default hid nothing", () => {
    const lines = probeLines({ report: probeReport({ botsHidden: 0, includeBots: false }) });
    expect(lines.filter((line) => line.startsWith("  bots:"))).toEqual([]);
  });

  it("names a widened probe in its footer", () => {
    const lines = probeLines({ report: probeReport({ botsHidden: 0, includeBots: true }) });
    expect(lines.at(-1)).toBe("probed the whole store (every author, bots included) in 7 ms");
  });
});

describe("groupLines' footer", () => {
  it("says the groups are human-only and how to widen", () => {
    const lines = groupLines({ facet: "container", groups: [{ rows: 5, value: "release" }], includeBots: false });
    expect(lines.at(-1)).toBe("1 container group(s) over 5 listed row(s) — human authors only; --include-bots widens");
  });
});

describe("parsePeekArgs", () => {
  it("splits a comma-separated id list and trims each one", () => {
    const args = unwrap(parsePeekArgs({ rest: ["--id", "aaa, bbb ,ccc"] }));
    expect(args.ids).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("carries the match the window is centred on", () => {
    const args = unwrap(parsePeekArgs({ rest: ["--id", "aaa", "--match", "17000"] }));
    expect(args.match).toBe("17000");
  });

  it("defaults the window width", () => {
    expect(unwrap(parsePeekArgs({ rest: ["--id", "aaa"] })).chars).toBe(320);
  });

  it("refuses with no ids at all", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(parsePeekArgs({ rest: ["--match", "x"] })) })).toEqual([
      "--id is required — one record id, or several separated by commas",
    ]);
  });

  it("refuses an id list that is only commas", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(parsePeekArgs({ rest: ["--id", ",, ,"] })) })).toEqual([
      "--id named no record",
    ]);
  });
});

describe("parseOpenArgs", () => {
  it("takes the same id list", () => {
    expect(unwrap(parseOpenArgs({ rest: ["--id", "aaa,bbb"] })).ids).toEqual(["aaa", "bbb"]);
  });
});

describe("parseAroundArgs", () => {
  it("defaults to the conversation — the thread AND the channel around it, which is what the search verb promises", () => {
    const args = unwrap(parseAroundArgs({ rest: ["--id", UUID] }));
    expect(args.mode).toBe("conversation");
    expect(args.before).toBe(5);
    expect(args.after).toBe(5);
    expect(args.address).toEqual({ id: UUID, kind: "uuid" });
  });

  it("takes a Slack message link as the anchor, so a detective pastes what a human copies", () => {
    const link = "https://acme.slack.com/archives/C0SYN000002/p1773811363025049";
    expect(unwrap(parseAroundArgs({ rest: ["--id", link] })).address).toEqual({
      channelId: "C0SYN000002",
      kind: "slack",
      messageTs: "1773811363.025049",
    });
  });

  it("takes the thread alone when the caller asks for it", () => {
    expect(unwrap(parseAroundArgs({ rest: ["--id", UUID, "--mode", "thread"] })).mode).toBe("thread");
  });

  it("takes the container walk when the caller asks for it", () => {
    expect(unwrap(parseAroundArgs({ rest: ["--id", UUID, "--mode", "container"] })).mode).toBe("container");
  });

  it("refuses a mode it has no walk for", () => {
    const refused = parseAroundArgs({ rest: ["--id", UUID, "--mode", "sideways"] });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      'no mode named "sideways" — --mode takes conversation, thread, container',
    ]);
  });

  it("refuses an anchor that addresses nothing, rather than querying for a row that cannot exist", () => {
    const refused = parseAroundArgs({ rest: ["--id", "aaa"] });
    expect(refused.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: refused._unsafeUnwrapErr() })[0]).toContain("is not a record uuid");
  });

  it("refuses without an anchor", () => {
    const refused = parseAroundArgs({ rest: ["--mode", "thread"] });
    expect(storeCommandErrorLines({ error: unwrapErr(refused) })).toEqual([
      "--id is required — give a record uuid, a <channel>:<ts> id, or a Slack message link",
    ]);
  });
});

/** One channel neighbour, as `channelWindow` hands it back. */
const neighbour = (over: Partial<ChannelNeighbour> = {}): ChannelNeighbour => ({
  author: "John Smith",
  authorNativeId: "U0JK",
  bodyChars: 20,
  container: "release",
  excerpt: "staging :lock:",
  from: 1,
  id: "n-1",
  isAnchorThread: false,
  kind: "message",
  occurredAt: "2026-03-18T05:22:43Z",
  replyCount: 0,
  source: "slack",
  sourceId: "C0SYN000002:1773784810.008629",
  title: null,
  url: "https://acme.slack.com/archives/C0SYN000002/p1773784810008629",
  ...over,
});

/** The anchor's own record, as the thread band hands it back. */
const ANCHOR: RecordPeek = neighbour({ excerpt: "release going out", id: UUID });

/** One around page, defaulted to the single-record conversation the tests vary from. */
const page = (over: Partial<AroundPage> = {}): AroundPage => ({
  anchor: ANCHOR,
  channel: [],
  limitations: [],
  mode: "conversation",
  records: [ANCHOR],
  ...over,
});

describe("aroundLines", () => {
  it("prints the thread and the channel as two labelled bands, never one merged list", () => {
    const lines = aroundLines({
      page: page({
        channel: [neighbour({ id: "n-1" }), neighbour({ id: "n-2", isAnchorThread: true, replyCount: 2 })],
      }),
    });
    expect(lines[2]).toBe("── the thread it sits in — 1 record(s), oldest first");
    expect(lines.filter((line) => line.startsWith("── the channel around it"))).toEqual([
      "── the channel around it — 2 top-level message(s), oldest first",
    ]);
  });

  it("marks the anchor in the thread and its own root in the channel, so the join is visible", () => {
    const lines = aroundLines({
      page: page({ channel: [neighbour({ id: "n-1" }), neighbour({ id: "n-2", isAnchorThread: true })] }),
    });
    expect(lines.filter((line) => line.startsWith("-> ")).length).toBe(1);
    expect(lines.filter((line) => line.startsWith("** ")).length).toBe(1);
  });

  it("carries Slack's own reply affordance, and prints nothing for a message with none", () => {
    const lines = aroundLines({
      page: page({
        channel: [
          neighbour({ id: "a", replyCount: 0 }),
          neighbour({ id: "b", replyCount: 1 }),
          neighbour({ id: "c", replyCount: 7 }),
        ],
      }),
    });
    expect(lines.filter((line) => line.includes("(1 reply)")).length).toBe(1);
    expect(lines.filter((line) => line.includes("(7 replies)")).length).toBe(1);
    expect(lines.filter((line) => line.includes("(0 replies)"))).toEqual([]);
  });

  it("prints no channel header at all when the read had no channel band", () => {
    const lines = aroundLines({ page: page({ mode: "thread" }) });
    expect(lines.filter((line) => line.startsWith("── the channel around it"))).toEqual([]);
    expect(lines[2]).toBe("── its thread — 1 record(s), oldest first");
  });

  it("prints every limitation the read reported, so an absence is stated rather than inferred", () => {
    const lines = aroundLines({ page: page({ limitations: ["a reply the sync has not reached is not here"] }) });
    expect(lines.at(-1)).toBe("note: a reply the sync has not reached is not here");
  });
});
