/**
 * The thread edge's derivation — the pure half of turning a reply into a relation.
 *
 * Every id below is a REAL one, copied out of the live store rather than invented, because
 * the whole failure this function exists to avoid is a rule that looks right against a made-up shape. The
 * two that matter most are here as their own cases: Linear's `project:<uuid>` and GitHub's `#<n>:state`,
 * both of which a "text before the first colon" rule turns into a parent that is a word rather than a row.
 *
 * Each source's case asserts the exact parent id, never that one merely exists — a suite that only
 * asserted `null` for parentless rows would pass on a function that always returned null.
 */
import { describe, expect, it } from "vitest";

import { edgeLines } from "../../../cli/commands/store/edges.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap } from "../../../lib/result.js";
import { parentSourceId } from "../../../store/parentSourceId.js";
import { projectRecord } from "../../../store/project.js";
import { parseStoreQuery, type StoreQuery, threadAnchorConflict } from "../../../store/query.js";

/** Derive a parent with no Linear nesting, which is every source but one. */
const parentOf = ({ source, sourceId }: { source: string; sourceId: string }): string | null =>
  parentSourceId({ parentComment: null, source, sourceId });

/** The validated query for an input the schema accepts. */
const valid = (input: Record<string, unknown>): StoreQuery => {
  const parsed = parseStoreQuery({ input });
  if ("errors" in parsed) {
    throw new Error(parsed.errors.join("; "));
  }
  return parsed.query;
};

describe("a reply names its parent through its own stored id", () => {
  it("takes a slack reply to the message that started the thread", () => {
    expect(parentOf({ source: "slack", sourceId: "C0SYN000022:1769484566.012569:reply:1769486212.184959" })).toBe(
      "C0SYN000022:1769484566.012569",
    );
  });

  it("takes a slack file to the message that carries it", () => {
    expect(parentOf({ source: "slack", sourceId: "C0SYN000029:1755476202.666279:file:F09B4HHAH97" })).toBe(
      "C0SYN000029:1755476202.666279",
    );
  });

  it("takes a github comment to its pull request", () => {
    expect(parentOf({ source: "github", sourceId: "acme/acme-admin#15358:comment:20" })).toBe("acme/acme-admin#15358");
  });

  it("takes a github review to its pull request", () => {
    expect(parentOf({ source: "github", sourceId: "acme/acme-admin#4261:review:2" })).toBe("acme/acme-admin#4261");
  });

  it("takes a linear comment to its issue", () => {
    expect(parentOf({ source: "linear", sourceId: "SUP-9564:comment:00000000-0000-4000-8000-000000000001" })).toBe(
      "SUP-9564",
    );
  });

  it("takes a notion comment to its page", () => {
    expect(
      parentOf({
        source: "notion",
        sourceId: "page:00000000-0000-4000-8000-000000000010:comment:1c000000-0000-8013-9f96-001d8253b862",
      }),
    ).toBe("page:00000000-0000-4000-8000-000000000010");
  });
});

describe("a later chunk names chunk zero, not a bare id no row carries", () => {
  it("points a notion page chunk at its own chunk zero", () => {
    expect(parentOf({ source: "notion", sourceId: "page:29a00000-0000-80f9-9e90-f211b73d6002:chunk:19" })).toBe(
      "page:29a00000-0000-80f9-9e90-f211b73d6002:chunk:0",
    );
  });

  it("points a slack huddle chunk at its own chunk zero", () => {
    expect(parentOf({ source: "slack", sourceId: "huddle:F0BJ99U3U1W:chunk:6" })).toBe("huddle:F0BJ99U3U1W:chunk:0");
  });

  it("gives chunk zero no parent of its own", () => {
    expect(parentOf({ source: "notion", sourceId: "page:29a00000-0000-80f9-9e90-f211b73d6002:chunk:0" })).toBe(null);
  });
});

describe("a linear comment's nesting comes from the attribute, because no id encodes it", () => {
  it("points a nested comment at its parent comment on the same issue", () => {
    expect(
      parentSourceId({
        parentComment: "00000000-0000-4000-8000-000000000002",
        source: "linear",
        sourceId: "FFFF-4078:comment:00000000-0000-4000-8000-000000000003",
      }),
    ).toBe("FFFF-4078:comment:00000000-0000-4000-8000-000000000002");
  });

  it("falls back to the issue when the attribute names the comment itself", () => {
    expect(
      parentSourceId({
        parentComment: "00000000-0000-4000-8000-000000000003",
        source: "linear",
        sourceId: "FFFF-4078:comment:00000000-0000-4000-8000-000000000003",
      }),
    ).toBe("FFFF-4078");
  });

  it("ignores the attribute on a source whose nesting is not Linear's", () => {
    expect(
      parentSourceId({
        parentComment: "00000000-0000-4000-8000-000000000002",
        source: "github",
        sourceId: "acme/acme-admin#15358:comment:20",
      }),
    ).toBe("acme/acme-admin#15358");
  });
});

describe("a row that starts its own thread claims no parent", () => {
  it("gives a slack message none", () => {
    expect(parentOf({ source: "slack", sourceId: "C0SYN000041:1785309838.972419" })).toBe(null);
  });

  it("gives a github issue none", () => {
    expect(parentOf({ source: "github", sourceId: "slopweaver/slopweaver#38" })).toBe(null);
  });

  it("gives a linear issue none", () => {
    expect(parentOf({ source: "linear", sourceId: "FFFF-4078" })).toBe(null);
  });

  it("gives an unchunked notion page none", () => {
    expect(parentOf({ source: "notion", sourceId: "page:39600000-0000-8097-91b5-c51f306725dd" })).toBe(null);
  });

  it("gives a source with no rules none, however its id is punctuated", () => {
    expect(parentOf({ source: "self", sourceId: "work-console-state/notes.md#10.0:slack-fold" })).toBe(null);
    expect(parentOf({ source: "gmail", sourceId: "19fef9f333f76583" })).toBe(null);
  });
});

describe("the colon-prefixed ids that a first-colon rule would break", () => {
  it("gives a linear project no parent, rather than the bare word 'project'", () => {
    expect(parentOf({ source: "linear", sourceId: "project:00000000-0000-4000-8000-000000000004" })).toBe(null);
  });

  it("gives a linear initiative, document, update, milestone and need no parent either", () => {
    expect(parentOf({ source: "linear", sourceId: "initiative:00000000-0000-4000-8000-000000000005" })).toBe(null);
    expect(parentOf({ source: "linear", sourceId: "document:00000000-0000-4000-8000-000000000006" })).toBe(null);
    expect(parentOf({ source: "linear", sourceId: "projectUpdate:00000000-0000-4000-8000-000000000007" })).toBe(null);
    expect(parentOf({ source: "linear", sourceId: "milestone:00000000-0000-4000-8000-000000000008" })).toBe(null);
    expect(parentOf({ source: "linear", sourceId: "need:00000000-0000-4000-8000-000000000009" })).toBe(null);
  });

  it("gives a github pull request no parent, rather than its own number", () => {
    expect(parentOf({ source: "github", sourceId: "acme/acme-admin#11660:state" })).toBe(null);
  });

  it("gives a github release and a codeowners file no parent", () => {
    expect(parentOf({ source: "github", sourceId: "acme/acme-adminrelease:pr-screenshots-mx-2382" })).toBe(null);
    expect(parentOf({ source: "github", sourceId: "codeowners:.github/CODEOWNERS" })).toBe(null);
  });

  it("gives a notion database and a slack canvas no parent", () => {
    expect(parentOf({ source: "notion", sourceId: "database:00000000-0000-4000-8000-000000000011" })).toBe(null);
    expect(parentOf({ source: "slack", sourceId: "canvas:F0BKSHTFL11" })).toBe(null);
  });
});

describe("a thread anchor is refused without the source that makes it unique", () => {
  it("refuses --thread alone, naming what is missing", () => {
    const refusal = threadAnchorConflict({ query: valid({ thread: "C1:1000000000.000001" }) });
    expect(refusal.length).toBe(1);
    expect(refusal[0]).toContain("--source");
  });

  it("accepts the pair", () => {
    expect(threadAnchorConflict({ query: valid({ source: "slack", thread: "C1:1000000000.000001" }) })).toEqual([]);
  });

  it("says nothing about a query naming no thread at all", () => {
    expect(threadAnchorConflict({ query: valid({ source: "slack" }) })).toEqual([]);
  });
});

describe("the pass reports what it left outstanding, not only what it did", () => {
  it("names the dangling remainder as re-resolvable rather than as a failure", () => {
    const lines = edgeLines({
      report: { dangling: 36121, edgesResolved: 760140, keysWritten: 796261, rowsScanned: 1219817, totalEdges: 796261 },
    });
    expect(lines[0]).toBe("scanned 1219817 row(s); wrote 796261 parent key(s)");
    expect(lines[1]).toBe("resolved 760140 edge(s) this pass");
    expect(lines[2]).toBe(
      "store now holds 796261 edge(s): 760140 pointing at a row, 36121 naming a parent this store does not hold yet",
    );
    expect(lines[3]).toContain("next ingest of that parent resolves it here");
  });

  it("says nothing is outstanding when every edge resolved", () => {
    const lines = edgeLines({
      report: { dangling: 0, edgesResolved: 4, keysWritten: 4, rowsScanned: 10, totalEdges: 4 },
    });
    expect(lines[3]).toBe("nothing outstanding");
  });

  it("still reports the scan when a pass resolved nothing", () => {
    const lines = edgeLines({
      report: { dangling: 0, edgesResolved: 0, keysWritten: 0, rowsScanned: 1219817, totalEdges: 796261 },
    });
    expect(lines[0]).toBe("scanned 1219817 row(s); wrote 0 parent key(s)");
    expect(lines[1]).toBe("resolved 0 edge(s) this pass");
  });
});

describe("the derivation's own input survives in the row, because the backfill re-reads it", () => {
  /** A Linear comment as bronze hands it over, carrying the nesting attribute and nothing else novel. */
  const nested = (): CorpusRecord => ({
    attrs: { parentComment: "00000000-0000-4000-8000-000000000002" },
    container: "linear/ENGX",
    kind: "comment",
    refs: [],
    source: "linear",
    sourceId: "FFFF-4078:comment:00000000-0000-4000-8000-000000000003",
    text: "a reply to a comment",
    tsIso: "2026-09-05T11:59:13.000Z",
    url: "https://linear.app/acme/issue/FFFF-4078",
  });

  it("derives the nested parent at projection time", () => {
    expect(unwrap(projectRecord({ record: nested() })).content.parentSourceId).toBe(
      "FFFF-4078:comment:00000000-0000-4000-8000-000000000002",
    );
  });

  it("leaves parentComment in metadata rather than claiming it into the derived column", () => {
    const projected = unwrap(projectRecord({ record: nested() }));
    expect(projected.content.metadata["attrs"]).toEqual({ parentComment: "00000000-0000-4000-8000-000000000002" });
  });

  it("derives the same key a second time from what the row kept, not from bronze", () => {
    const stored = unwrap(projectRecord({ record: nested() })).content;
    const attrs = stored.metadata["attrs"] as Record<string, unknown>;
    expect(
      parentSourceId({
        parentComment: String(attrs["parentComment"]),
        source: stored.source,
        sourceId: stored.sourceId,
      }),
    ).toBe(stored.parentSourceId);
  });
});
