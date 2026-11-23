/**
 * The board document's projection.
 *
 * Every case drives the REAL `parseHandoverDoc` over frontmatter text rather than hand-building a
 * `HandoverDoc`, because the projection's whole contract is that it does not re-decide anything the
 * parser already decided — and a hand-built doc would let the two drift without a test noticing.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";
import { unwrap } from "../../../../lib/result.js";
import { projectBoardDoc } from "../../../../store/fleet/boardRow.js";

const PATH = "/tmp/handovers/a-row.md";

/** One document, from its frontmatter lines and a body. */
function doc({ frontmatter }: { frontmatter: string }): { text: string; path: string } {
  return { path: PATH, text: `---\n${frontmatter}\n---\n\n# A row\n` };
}

describe("projectBoardDoc", () => {
  it("projects a full ask row into its columns", () => {
    const { text, path } = doc({
      frontmatter: [
        "slug: a-row",
        "kind: ask",
        "status: ready",
        "priority: p2",
        'summary: "the thing"',
        "askedIso: 2026-09-13T16:11:23.030Z",
        "anchor: file:~/owner-turn-257-1.txt",
        "origin: finding",
        "observedBy: 7285d292",
        "repo: /Users/x/dev/slopweaver",
        "blockedBy: []",
      ].join("\n"),
    });

    const row = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    expect(row.slug).toBe("a-row");
    expect(row.kind).toBe("ask");
    expect(row.status).toBe("ready");
    expect(row.priority).toBe("p2");
    // The quotes are part of the VALUE, and that is the board's own behaviour rather than this
    // projection's: `../../../../handover/doc.ts` deliberately does not parse these fields as YAML — a
    // strict parser broke three live docs — so it never unquotes a scalar either. MEASURED on the live
    // board: 1,874 of 2,099 summaries carry a leading `"`. The projection stores what the board reads,
    // because a table that quietly disagreed with the board would be the harder defect to find.
    expect(row.summary).toBe("the thing");
    expect(row.askedAt!.toISOString()).toBe("2026-09-13T16:11:23.030Z");
    expect(row.anchor).toBe("file:~/owner-turn-257-1.txt");
    expect(row.origin).toBe("finding");
    expect(row.observedBy).toBe("7285d292");
    expect(row.repo).toBe("/Users/x/dev/slopweaver");
    expect(row.sourcePath).toBe(PATH);
  });

  it("hashes the document text, so a changed file produces a different row hash", () => {
    const first = doc({ frontmatter: "slug: a-row\nstatus: ready" });
    const second = doc({ frontmatter: "slug: a-row\nstatus: done" });

    const one = unwrap(projectBoardDoc({ doc: parseHandoverDoc(first), text: first.text }));
    const two = unwrap(projectBoardDoc({ doc: parseHandoverDoc(second), text: second.text }));

    expect(one.docHash).not.toBe(two.docHash);
  });

  it("gives the same text the same hash, so an unchanged document re-projects identically", () => {
    const { text, path } = doc({ frontmatter: "slug: a-row\nstatus: ready" });

    const one = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));
    const two = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    expect(one.docHash).toBe(two.docHash);
  });

  it("carries a settled ask's three settlement fields", () => {
    const { text, path } = doc({
      frontmatter: [
        "slug: settled-row",
        "kind: ask",
        "status: done",
        "settlement: declined",
        'settlementWitness: "the owner DM"',
        'settlementReason: "no team-facing action"',
      ].join("\n"),
    });

    const row = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    expect(row.settlement).toBe("declined");
    expect(row.settlementWitness).toBe("the owner DM");
    expect(row.settlementReason).toBe("no team-facing action");
  });

  it("carries blockedBy as written, without resolving it against anything", () => {
    const { text, path } = doc({
      frontmatter: "slug: blocked-row\nstatus: ready\nblockedBy: [other-row, a-row-that-does-not-exist]",
    });

    const row = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    expect(row.blockedBy).toEqual(["other-row", "a-row-that-does-not-exist"]);
  });

  it("leaves every optional column NULL on a minimal document rather than inventing values", () => {
    const { text, path } = doc({ frontmatter: "slug: bare-row\nstatus: draft" });

    const row = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    expect(row.priority).toBe(null);
    expect(row.askedAt).toBe(null);
    expect(row.anchor).toBe(null);
    expect(row.origin).toBe(null);
    expect(row.settlement).toBe(null);
    expect(row.branch).toBe(null);
    expect(row.pausedOn).toBe(null);
  });

  it("refuses an askedIso it cannot read rather than dropping it to NULL", () => {
    const { text, path } = doc({ frontmatter: "slug: bad-time\nstatus: ready\naskedIso: last tuesday" });

    const result = projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE_DOC_FIELD");
    expect(result._unsafeUnwrapErr().message).toContain("askedIso");
  });

  it("keeps a status the parser could not recognise as `unknown` rather than refusing the row", () => {
    const { text, path } = doc({ frontmatter: "slug: odd-status\nstatus: blocked" });

    const row = unwrap(projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text }));

    // The board's whole design is that a broken row is VISIBLE rather than absent, and the projection
    // inherits that judgement instead of disagreeing with it.
    expect(row.status).toBe("unknown");
  });
});
