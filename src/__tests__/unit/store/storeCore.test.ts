/**
 * The `store` verb's parsers and rendered lines, none of which need a database.
 *
 * The property under test throughout is the one the owner asked for in the words "never a blind grep,
 * fail loudly, fast feedback": a misspelled filter is a NAMED refusal carrying the real vocabulary, not an
 * empty result set. An empty result and a typo are indistinguishable to a reader, and only one of them is
 * a fact about the corpus — so the refusal has to happen before a connection is opened, which is exactly
 * what makes it testable here.
 *
 * The facet-denominator case is a regression pin rather than a hypothetical. MEASURED on a
 * store holding 1,000 Slack records, `store facets --facet container --limit 8` printed its top group at
 * `33.4%` because the first version divided by the sum of the eight groups it had been handed. The true
 * share was 14.2%, and nothing in the output said the denominator was a page.
 */
import { describe, expect, it } from "vitest";

import {
  detailLines,
  facetLines,
  listLines,
  parseStoreDetailArgs,
  parseStoreFacetArgs,
  parseStoreIngestArgs,
  parseStoreReadArgs,
  storeTail,
  vocabularyLines,
} from "../../../cli/commands/store/core.js";
import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import { exclusionLines, ingestLines } from "../../../cli/commands/store/ingestLines.js";
import { parseStoreStatusArgs } from "../../../cli/commands/store/statusCore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_LIST_LIMIT } from "../../../store/query.js";
import type { ContentRow } from "../../../store/schema/content.js";

/** A stored row carrying only what a renderer reads. */
const row = (over: Partial<ContentRow> = {}): ContentRow =>
  ({
    authorId: null,
    body: "hello there\nsecond line",
    containerId: null,
    createdAt: new Date("2026-09-05T11:59:13.000Z"),
    dataClass: null,
    id: "00000000-0000-0000-0000-000000000000",
    kind: "message",
    metadata: {},
    occurredAt: new Date("2026-09-05T11:59:13.000Z"),
    searchable: null,
    source: "slack",
    sourceId: "C1:1.2",
    title: null,
    url: "https://example.test/1",
    visibility: "public",
    ...over,
  }) as unknown as ContentRow;

describe("the flag tail", () => {
  it("skips a spoken verb", () => {
    expect(storeTail({ argv: ["node", "cli", "store", "query", "--source", "slack"] })).toEqual(["--source", "slack"]);
  });

  it("keeps a flag that follows the bare noun", () => {
    expect(storeTail({ argv: ["node", "cli", "store", "--json"] })).toEqual(["--json"]);
  });
});

describe("a query is validated against the store's own vocabulary", () => {
  it("accepts a real source", () => {
    expect(unwrap(parseStoreReadArgs({ rest: ["--source", "slack"] })).query.source).toBe("slack");
  });

  it("refuses a misspelled source by name rather than answering with no rows", () => {
    const refused = storeCommandErrorLines({ error: unwrapErr(parseStoreReadArgs({ rest: ["--source", "slak"] })) });
    expect(refused[0]).toContain("source");
    expect(refused.join("\n")).toContain("sources: github, slack, linear, notion, self, gmail, calendar");
  });

  it("refuses a kind the corpus has no word for", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreReadArgs({ rest: ["--kind", "email"] })) }).join("\n"),
    ).toContain("kind");
  });

  it("refuses a since that is not an instant", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreReadArgs({ rest: ["--since", "yesterday"] })) }).join("\n"),
    ).toContain("since");
  });

  it("refuses a limit that is not a whole number", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(parseStoreReadArgs({ rest: ["--limit", "lots"] })) })[0]).toBe(
      '--limit takes a whole number, not "lots"',
    );
  });

  it("refuses a limit past the page ceiling", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreReadArgs({ rest: ["--limit", "5000"] })) }).join("\n"),
    ).toContain("limit");
  });

  it("defaults the page rather than returning the whole store", () => {
    expect(unwrap(parseStoreReadArgs({ rest: [] })).query.limit).toBe(DEFAULT_LIST_LIMIT);
  });

  it("names every wrong flag at once, not the first", () => {
    const refused = storeCommandErrorLines({
      error: unwrapErr(parseStoreReadArgs({ rest: ["--limit", "no", "--offset", "nope"] })),
    });
    expect(refused).toEqual(['--limit takes a whole number, not "no"', '--offset takes a whole number, not "nope"']);
  });
});

// The routing brief appends `--home <graded dir>` to every store command it grades, so a store
// verb that refused the flag printed as AVAILABLE and then refused on `unknown flag` before opening anything.
describe("every verb that opens the store takes --home, because the brief appends it", () => {
  it("carries the home through query, facets, detail, ingest and status", () => {
    expect(unwrap(parseStoreReadArgs({ rest: ["--home", "/tmp/home-b"] })).home).toBe("/tmp/home-b");
    expect(unwrap(parseStoreFacetArgs({ rest: ["--home", "/tmp/home-b"] })).home).toBe("/tmp/home-b");
    expect(
      unwrap(parseStoreDetailArgs({ rest: ["--source", "slack", "--id", "x", "--home", "/tmp/home-b"] })).home,
    ).toBe("/tmp/home-b");
    expect(
      unwrap(parseStoreIngestArgs({ rest: ["--source", "slack", "--limit", "5", "--home", "/tmp/home-b"] })).home,
    ).toBe("/tmp/home-b");
    expect(unwrap(parseStoreStatusArgs({ rest: ["--home", "/tmp/home-b"] })).home).toBe("/tmp/home-b");
  });

  it("omits the field rather than setting it undefined when no home is named", () => {
    expect(Object.keys(unwrap(parseStoreStatusArgs({ rest: [] }))).toSorted()).toEqual(["check", "json", "scope"]);
    expect("home" in unwrap(parseStoreReadArgs({ rest: [] }))).toBe(false);
  });
});

describe("a facet is a closed list, not any column name", () => {
  it("defaults to grouping by source", () => {
    expect(unwrap(parseStoreFacetArgs({ rest: [] })).facet).toBe("source");
  });

  it("accepts each column the store indexes", () => {
    expect(unwrap(parseStoreFacetArgs({ rest: ["--facet", "container"] })).facet).toBe("container");
    expect(unwrap(parseStoreFacetArgs({ rest: ["--facet", "day"] })).facet).toBe("day");
  });

  it("refuses a facet over an unindexed column, which would be a scan behind an ordinary-looking flag", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(parseStoreFacetArgs({ rest: ["--facet", "body"] })) })[0]).toBe(
      'no facet named "body"',
    );
  });
});

describe("detail needs both halves of the identity pair", () => {
  it("takes the source and the platform's own id", () => {
    const args = unwrap(parseStoreDetailArgs({ rest: ["--source", "slack", "--id", "C1:1.2"] }));
    expect(args.source).toBe("slack");
    expect(args.sourceId).toBe("C1:1.2");
  });

  it("refuses with only one half, naming the half it wants", () => {
    expect(unwrapErr(parseStoreDetailArgs({ rest: ["--source", "slack"] }))[0]).toContain("--id");
  });
});

describe("ingest requires its ceiling", () => {
  it("takes a file and a limit", () => {
    const args = unwrap(parseStoreIngestArgs({ rest: ["--file", "a.jsonl", "--limit", "1000"] }));
    expect(args.file).toBe("a.jsonl");
    expect(args.limit).toBe(1000);
  });

  it("refuses without a limit, so nobody reaches the unbounded shape by omission", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreIngestArgs({ rest: ["--file", "a.jsonl"] })) })[0],
    ).toContain("--limit is required");
  });

  it("refuses without a file", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(parseStoreIngestArgs({ rest: ["--limit", "10"] })) })[0],
    ).toContain("--file");
  });

  it("starts at the file's first byte when no --from is named, and resumes at the one that is", () => {
    expect(unwrap(parseStoreIngestArgs({ rest: ["--file", "a.jsonl", "--limit", "10"] })).from).toBe(0);
    expect(unwrap(parseStoreIngestArgs({ rest: ["--file", "a.jsonl", "--limit", "10", "--from", "8385"] })).from).toBe(
      8385,
    );
  });

  it("refuses a --from that is not a byte offset", () => {
    expect(
      storeCommandErrorLines({
        error: unwrapErr(parseStoreIngestArgs({ rest: ["--file", "a.jsonl", "--limit", "10", "--from", "end"] })),
      })[0],
    ).toBe('--from takes a whole number, not "end"');
  });
});

describe("a facet table's percentages are of the MATCHING rows, never of the page", () => {
  const counts = [
    { rows: 142, value: "slack/c-busiest" },
    { rows: 83, value: "slack/c-second" },
  ];

  it("divides by the true total, so a truncated table does not inflate every share", () => {
    expect(facetLines({ counts, facet: "container", total: 1000 })[0]).toContain("14.2%");
  });

  it("says the table is truncated, and by how much", () => {
    const lines = facetLines({ counts, facet: "container", total: 1000 });
    expect(lines[lines.length - 1]).toBe(
      "2 largest container value(s), covering 225 of 1000 matching row(s) — raise --limit for the rest",
    );
  });

  it("says so plainly when the table covers everything", () => {
    const lines = facetLines({ counts, facet: "container", total: 225 });
    expect(lines[lines.length - 1]).toBe("2 container value(s) over all 225 matching row(s)");
  });

  it("says there is nothing to group rather than dividing by zero", () => {
    expect(facetLines({ counts: [], facet: "kind", total: 0 })).toEqual(["no rows to group by kind"]);
  });
});

describe("an empty result reads as an answer, not as an absence of one", () => {
  it("says the filter is the reason, and how many rows the filter itself matched", () => {
    expect(listLines({ rows: [], total: 0 })[0]).toBe(
      "no rows match — the store holds 0 matching row(s), so this filter is the reason",
    );
  });

  it("shows a title when the row has one", () => {
    expect(listLines({ rows: [row({ title: "#random message" })], total: 1 })[0]).toContain("#random message");
  });

  it("falls back to the body's first line when it has none", () => {
    expect(listLines({ rows: [row()], total: 1 })[0]).toContain("hello there");
    expect(listLines({ rows: [row()], total: 1 })[0]).not.toContain("second line");
  });
});

describe("a detail read that finds nothing says which pair it looked for", () => {
  it("names the source and the id", () => {
    expect(detailLines({ detail: null, source: "slack", sourceId: "C9:9.9" })[0]).toBe(
      "no slack row carries the id C9:9.9 — the store has never held one, or it was never ingested",
    );
  });

  it("shows a source's own columns when the row has them, and skips the ones it does not carry", () => {
    const lines = detailLines({
      detail: {
        author: "U1",
        container: "slack/C1",
        row: row(),
        sourceRow: { botId: null, channelId: "C1", contentId: "x", replyCount: 4, source: "slack" },
      },
      source: "slack",
      sourceId: "C1:1.2",
    });
    expect(lines).toContain("channelId  C1");
    expect(lines).toContain("replyCount 4");
    expect(lines.some((line) => line.startsWith("botId"))).toBe(false);
    expect(lines.some((line) => line.startsWith("contentId"))).toBe(false);
  });

  it("shows the resolved container and author when it finds one", () => {
    const lines = detailLines({
      detail: { author: "U1", container: "slack/C1", row: row(), sourceRow: null },
      source: "slack",
      sourceId: "C1:1.2",
    });
    expect(lines).toContain("container: slack/C1");
    expect(lines).toContain("author:    U1");
  });
});

describe("an ingest report leads with what it refused", () => {
  const report = {
    bytesRead: 18753994,
    containersSeen: 117,
    elapsedMs: 1841,
    duplicatesCollapsed: 0,
    linesRead: 5498,
    reachedEnd: true,
    resumeByteOffset: 18753994,
    slices: 1,
    authorsResolved: 232,
    authorsUnresolved: 0,
    recordsStored: 5498,
    recordsExcluded: 0,
    recordsRescued: 0,
    deferralOverflow: 0,
    refusals: [],
    refusalsCounted: 0,
  };

  it("reports the rate as well as the count", () => {
    expect(ingestLines({ file: "a.jsonl", report })[0]).toBe(
      "wrote 5498 row version(s) from a.jsonl in 1841 ms (2986/s)",
    );
  });

  it("says nothing about refusals when there were none", () => {
    expect(ingestLines({ file: "a.jsonl", report }).join("\n")).not.toContain("REFUSED");
  });

  it("says nothing about collapsed duplicates when the slice held none", () => {
    expect(ingestLines({ file: "a.jsonl", report }).join("\n")).not.toContain("collapsed");
  });

  it("says how many repeated ids it collapsed, which is a fact about bronze rather than about the run", () => {
    expect(ingestLines({ file: "a.jsonl", report: { ...report, duplicatesCollapsed: 66 } })).toContain(
      "66 repeated (source, id) line(s) collapsed to their latest capture",
    );
  });

  it("reports resolved and unresolved authors apart, and says where an unresolved one is kept", () => {
    expect(ingestLines({ file: "a.jsonl", report: { ...report, authorsResolved: 2, authorsUnresolved: 4 } })).toContain(
      "authors: 2 resolved to a person, 4 kept on author_native_id only (a bot, or nobody the directory holds yet — store identity points them later)",
    );
  });

  it("groups a thousand identical refusals into one line with a count and an example", () => {
    const refusals = Array.from({ length: 3 }, (_unused, at) => ({
      code: "ROW_REFUSED" as const,
      message: "m",
      reason: 'the store has no column for source "gold"',
      source: "gold",
      sourceId: `g${String(at)}`,
    }));
    const lines = ingestLines({ file: "a.jsonl", report: { ...report, refusals, refusalsCounted: 3 } });
    expect(lines).toContain('  3x  the store has no column for source "gold"  (e.g. gold g0)');
  });
});

describe("the vocabularies a refusal prints", () => {
  it("prints all four, so the fix is in the refusal rather than in the source", () => {
    expect(vocabularyLines().length).toBe(4);
  });

  it("names huddle and transcript, the kinds a hand-written enum had missed", () => {
    expect(vocabularyLines()[1]).toContain("huddle");
    expect(vocabularyLines()[1]).toContain("transcript");
  });
});

describe("exclusionLines", () => {
  /** The three counters, with only the one a case cares about moved. */
  const quiet = { deferralOverflow: 0, recordsExcluded: 0, recordsRescued: 0 };

  it("says nothing at all when no record was excluded", () => {
    // Silent on purpose: a line reading "excluded 0" on every ordinary ingest teaches a reader to stop
    // looking at it, and this is precisely the line that must still be read on the run where it fires.
    expect(exclusionLines({ report: quiet })).toStrictEqual([]);
  });

  it("reports what the denylist dropped and what rule D put back, on one line", () => {
    expect(exclusionLines({ report: { ...quiet, recordsExcluded: 1000020, recordsRescued: 42 } })[0]).toBe(
      "excluded 1000020 record(s) by the sync denylist, 42 kept by rule D (a human replied in the thread)",
    );
  });

  it("speaks up when the rule-D hold overflowed, because policy was relaxed", () => {
    const lines = exclusionLines({ report: { ...quiet, deferralOverflow: 7, recordsExcluded: 5 } });
    expect(lines[1]).toContain("7 candidate(s) were ADMITTED because the rule-D hold was full");
  });

  it("prints even when everything was rescued and nothing dropped", () => {
    expect(exclusionLines({ report: { ...quiet, recordsRescued: 3 } }).length).toBe(1);
  });
});
