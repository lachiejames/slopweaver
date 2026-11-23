/**
 * The workstream band's fold (`site/lib/workstreams.ts`), driven through `readBoard` so every case starts from the
 * `handover list --json` row shape rather than a hand-built `BoardRow`. That shape carries no `tags` yet: `row` adds
 * the agreed list (`src/handover/rowTags.ts`), and a case reading a board as the verb publishes it
 * today drops the key.
 */
import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../components/live/read";
import { FLEET, noStreamLead, otherWaitPills, unclaimedClauses, workstreamsOf } from "../../lib/workstreams";

/** The instant every case is drawn at. */
const NOW = "2026-09-27T12:00:00.000Z";

/** The fixed clock instant, as epoch milliseconds. */
const NOW_MS = Date.parse(NOW);

/** One declared or derived tag, in the shape agreed with seat 395. */
function tag({ key, value, source = "declared" }: { key: string; value: string; source?: string }): {
  key: string;
  value: string;
  source: string;
} {
  return { key, source, value };
}

/**
 * One row with the fields `readBoard` requires, an empty `tags` list in the shape agreed with seat 395, and whatever a
 * case overrides. `handover list --json` publishes no `tags` yet; the cases that read a board that way drop the key.
 */
function row({ slug, over = {} }: { slug: string; over?: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: "planned",
    ownerWait: "not-waiting",
    reason: "runnable now",
    section: "RUN NOW",
    slug,
    status: "planned",
    tags: [],
    ...over,
  };
}

/** The board those rows publish, read the way the console reads it. */
function boardOf({ rows }: { rows: readonly Record<string, unknown>[] }): Board {
  return readBoard({ rows, unresolved: 0 })!;
}

/** The fold over those rows at {@link NOW}. */
function fold({ rows }: { rows: readonly Record<string, unknown>[] }): ReturnType<typeof workstreamsOf> {
  return workstreamsOf({ nowMs: NOW_MS, rows: boardOf({ rows }).rows });
}

describe("readBoard's workstream fields", () => {
  it("reads tags, movedIso, pausedOn, run and blockedBy off a row carrying all of them", () => {
    const board = boardOf({
      rows: [
        row({
          over: {
            blockedBy: ["other-row"],
            movedIso: "2026-09-27T09:45:38.134Z",
            pausedOn: "Rosa",
            run: "active",
            tags: [tag({ key: "workstream", value: "iso" }), tag({ key: "priority", source: "derived", value: "p1" })],
          },
          slug: "a",
        }),
      ],
    });
    expect(board.rows[0].tags).toEqual([
      { key: "workstream", source: "declared", value: "iso" },
      { key: "priority", source: "derived", value: "p1" },
    ]);
    expect(board.rows[0].movedIso).toBe("2026-09-27T09:45:38.134Z");
    expect(board.rows[0].pausedOn).toBe("Rosa");
    expect(board.rows[0].run).toBe("active");
    expect(board.rows[0].blockedBy).toEqual(["other-row"]);
    expect(board.rows[0].tagsRead).toBe("whole");
  });

  it("reads a board publishing none of them as empty and absent, not a refusal", () => {
    const { tags: _published, ...unpublished } = row({ slug: "a" });
    const board = boardOf({ rows: [unpublished] });
    expect(board.rows[0].tags).toEqual([]);
    expect(board.rows[0].tagsRead).toBe("absent");
    expect(board.rows[0].movedIso).toBe(undefined);
    expect(board.rows[0].pausedOn).toBe(undefined);
    expect(board.rows[0].run).toBe(undefined);
    expect(board.rows[0].blockedBy).toEqual([]);
  });

  it("drops a malformed tag member and keeps the rest of the board", () => {
    const board = boardOf({
      rows: [
        row({
          over: {
            tags: [
              { key: "workstream", source: "journalled", value: "bad-source" },
              { key: "workstream", value: 3 },
              "not-a-bag",
              tag({ key: "workstream", value: "kept" }),
            ],
          },
          slug: "a",
        }),
      ],
    });
    expect(board.rows[0].tags).toEqual([{ key: "workstream", source: "declared", value: "kept" }]);
    expect(board.rows[0].tagsRead).toBe("partial");
  });

  it("never reads unrecognisedTags into the fold", () => {
    const folded = fold({
      rows: [row({ over: { unrecognisedTags: [tag({ key: "workstream", value: "ghost" })] }, slug: "a" })],
    });
    expect(folded.workstreams).toEqual([]);
    expect(folded.untagged).toBe(1);
  });
});

describe("workstreamsOf", () => {
  it("counts open untagged rows and skips done and closed ones", () => {
    const folded = fold({
      rows: [
        row({ slug: "open" }),
        row({ over: { section: "DONE", tags: [tag({ key: "workstream", value: "iso" })] }, slug: "done" }),
        row({ over: { section: "CLOSED — NOT SHIPPED" }, slug: "closed" }),
      ],
    });
    expect(folded).toEqual({ unpublished: 0, unread: 0, untagged: 1, workstreams: [] });
  });

  it("counts a row from a board that publishes no tags as unpublished, never untagged", () => {
    const { tags: _published, ...unpublished } = row({ slug: "no-tags-key" });
    const folded = fold({ rows: [unpublished, row({ slug: "empty-tags" })] });
    expect(folded).toEqual({ unpublished: 1, unread: 0, untagged: 1, workstreams: [] });
  });

  it("counts every row whose published tags did not wholly read as unread, never untagged, even one a tag that did read put in a stream", () => {
    const folded = fold({
      rows: [
        row({ over: { tags: "not-a-list" }, slug: "unlisted" }),
        row({ over: { tags: [{ key: "workstream", value: 3 }] }, slug: "all-dropped" }),
        row({ over: { tags: ["not-a-bag", tag({ key: "workstream", value: "iso" })] }, slug: "half-read" }),
      ],
    });
    expect(folded.unread).toBe(3);
    expect(folded.untagged).toBe(0);
    expect(folded.unpublished).toBe(0);
    expect(folded.workstreams.map((stream) => [stream.name, stream.rowSlugs])).toEqual([["iso", ["half-read"]]]);
  });

  it("puts a row in every workstream it names, with the highest impact and priority", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            tags: [
              tag({ key: "workstream", value: "iso" }),
              tag({ key: "workstream", value: "console" }),
              tag({ key: "impact", value: "medium" }),
              tag({ key: "priority", source: "derived", value: "p2" }),
            ],
          },
          slug: "a",
        }),
        row({
          over: {
            tags: [
              tag({ key: "workstream", value: "iso" }),
              tag({ key: "impact", value: "high" }),
              tag({ key: "priority", source: "derived", value: "p1" }),
            ],
          },
          slug: "b",
        }),
      ],
    });
    expect(folded.workstreams.map((stream) => [stream.name, stream.impact, stream.topPriority, stream.tier])).toEqual([
      ["iso", "high", "p1", "main"],
      ["console", "medium", "p2", "lower"],
    ]);
    expect(folded.workstreams[0].rowSlugs).toEqual(["a", "b"]);
  });

  it("reads a stream with no impact tag as unrated and lower, and a p0 as main", () => {
    const folded = fold({
      rows: [
        row({ over: { tags: [tag({ key: "workstream", value: "quiet" })] }, slug: "a" }),
        row({
          over: {
            tags: [
              tag({ key: "workstream", value: "urgent" }),
              tag({ key: "priority", source: "derived", value: "p0" }),
            ],
          },
          slug: "b",
        }),
      ],
    });
    expect(folded.workstreams.map((stream) => [stream.name, stream.impact, stream.tier, stream.p0Count])).toEqual([
      ["urgent", "unrated", "main", 1],
      ["quiet", "unrated", "lower", 0],
    ]);
  });

  it("splits what waits on the owner from what waits on a person or the fleet, never reading a pause as a row slug", () => {
    const iso = [tag({ key: "workstream", value: "iso" })];
    const folded = fold({
      rows: [
        row({ over: { section: "WAITING ON OWNER", tags: iso }, slug: "asked" }),
        row({
          over: {
            pausedOn: "Rosa",
            reason: "paused on Rosa, since 2026-09-20T01:00:00.000Z — no deadline, never overdue — review",
            section: "PAUSED",
            tags: iso,
          },
          slug: "rosa-review",
        }),
        row({
          over: {
            pausedOn: "the owner",
            reason: "paused on the owner — no deadline, never overdue",
            section: "PAUSED",
            tags: iso,
          },
          slug: "owner-pause",
        }),
        row({
          over: {
            pausedOn: "asked",
            reason: "paused on asked — no deadline, never overdue",
            run: "orphaned",
            section: "PAUSED",
            tags: iso,
          },
          slug: "named-like-a-row",
        }),
        row({ over: { blockedBy: ["asked"], section: "NOT YET", tags: iso }, slug: "blocked" }),
      ],
    });
    const stream = folded.workstreams[0];
    expect(stream.onOwner).toEqual(["asked", "owner-pause"]);
    expect(stream.onOthers).toEqual([
      { kind: "pause", name: "asked", rows: ["named-like-a-row"] },
      { kind: "pause", name: "Rosa", rows: ["rosa-review"] },
      { kind: "blocked", name: FLEET, rows: ["blocked"] },
    ]);
    expect(otherWaitPills({ onOthers: stream.onOthers })).toEqual([
      { n: 2, title: "asked: named-like-a-row\nRosa: rosa-review", words: "paused on asked, Rosa" },
      { n: 1, title: "blocked", words: "blocked on the fleet" },
    ]);
    expect(stream.slipping).toEqual([]);
  });

  it("calls a moving row slipping only on a readable instant past a whole day, and an orphaned run always", () => {
    const iso = [tag({ key: "workstream", value: "iso" })];
    const folded = fold({
      rows: [
        row({ over: { movedIso: "2026-09-26T12:00:00.000Z", section: "IN FLIGHT", tags: iso }, slug: "exactly-a-day" }),
        row({ over: { movedIso: "2026-09-26T11:59:59.999Z", section: "IN FLIGHT", tags: iso }, slug: "past-a-day" }),
        row({ over: { section: "AWAITING SHIP", tags: iso }, slug: "never-moved" }),
        row({ over: { movedIso: "not a date", section: "IN FLIGHT", tags: iso }, slug: "unparseable" }),
        row({ over: { movedIso: "2026-02-30T00:00:00.000Z", section: "IN FLIGHT", tags: iso }, slug: "impossible" }),
        row({ over: { movedIso: "2026-09-01T00:00:00.000Z", section: "RUN NOW", tags: iso }, slug: "not-moving" }),
        row({ over: { run: "orphaned", section: "RUN NOW", tags: iso }, slug: "orphaned" }),
      ],
    });
    expect(folded.workstreams[0].slipping).toEqual(["orphaned", "past-a-day"]);
  });

  it("never counts a row whose dependency is satisfied as blocked", () => {
    const folded = fold({
      rows: [
        row({
          over: { blockedBy: ["dep"], section: "RUN NOW", tags: [tag({ key: "workstream", value: "iso" })] },
          slug: "b",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([]);
  });

  it("never counts a declared draft as blocked, whatever its edges say", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            blockedBy: ["done-dep"],
            reason: "declared draft — queued",
            section: "NOT YET",
            status: "draft",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "draft",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([]);
  });

  it("counts an orphaned row blocked on the fleet as both on the fleet and slipping", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            blockedBy: ["dependency"],
            run: "orphaned",
            section: "NOT YET",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "blocked",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([{ kind: "blocked", name: FLEET, rows: ["blocked"] }]);
    expect(folded.workstreams[0].slipping).toEqual(["blocked"]);
  });

  it("counts a row paused on a person and blocked by a row on the person, never slipping", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            blockedBy: ["dependency"],
            pausedOn: "Tobias",
            reason: "paused on Tobias — no deadline, never overdue",
            run: "orphaned",
            section: "PAUSED",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "both",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([{ kind: "pause", name: "Tobias", rows: ["both"] }]);
    expect(folded.workstreams[0].slipping).toEqual([]);
  });

  it("counts a row paused on the owner and blocked by a row on the owner alone", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            blockedBy: ["dependency"],
            pausedOn: "the owner",
            reason: "paused on the owner — no deadline, never overdue",
            section: "PAUSED",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "both",
        }),
      ],
    });
    expect(folded.workstreams[0].onOwner).toEqual(["both"]);
    expect(folded.workstreams[0].onOthers).toEqual([]);
  });

  it("keeps a pause whose subject reads like the fleet apart from a block, and never slipping", () => {
    const iso = [tag({ key: "workstream", value: "iso" })];
    const folded = fold({
      rows: [
        row({
          over: {
            pausedOn: FLEET,
            reason: "paused on the fleet — no deadline, never overdue",
            run: "orphaned",
            section: "PAUSED",
            tags: iso,
          },
          slug: "x",
        }),
        row({ over: { blockedBy: ["dependency"], section: "NOT YET", tags: iso }, slug: "y" }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([
      { kind: "blocked", name: FLEET, rows: ["y"] },
      { kind: "pause", name: FLEET, rows: ["x"] },
    ]);
    expect(otherWaitPills({ onOthers: folded.workstreams[0].onOthers })).toEqual([
      { n: 1, title: "the fleet: x", words: "paused on the fleet" },
      { n: 1, title: "y", words: "blocked on the fleet" },
    ]);
    expect(folded.workstreams[0].slipping).toEqual([]);
  });

  it("never calls a row waiting on a person slipping", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            pausedOn: "Tobias",
            reason: "paused on Tobias — no deadline, never overdue",
            run: "orphaned",
            section: "PAUSED",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "tobias",
        }),
      ],
    });
    expect(folded.workstreams[0].slipping).toEqual([]);
    expect(folded.workstreams[0].onOthers).toEqual([{ kind: "pause", name: "Tobias", rows: ["tobias"] }]);
  });

  it("keeps a pause subject whole where its reason could not be split back", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            pausedOn: "Othercompany, since merger",
            reason: "paused on Othercompany, since merger, since 2026-09-20 — no deadline, never overdue",
            section: "PAUSED",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "othercompany",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([
      { kind: "pause", name: "Othercompany, since merger", rows: ["othercompany"] },
    ]);
  });

  it("reads a PAUSED row from a board cut before pausedOn as waiting on nobody and never slipping, never parsing its reason", () => {
    const folded = fold({
      rows: [
        row({
          over: {
            reason: "paused on Rosa — no deadline, never overdue",
            run: "orphaned",
            section: "PAUSED",
            tags: [tag({ key: "workstream", value: "iso" })],
          },
          slug: "older",
        }),
      ],
    });
    expect(folded.workstreams[0].onOthers).toEqual([]);
    expect(folded.workstreams[0].onOwner).toEqual([]);
    expect(folded.workstreams[0].slipping).toEqual([]);
  });
});

describe("the band's no-stream wording", () => {
  it("says no open row carries a workstream tag only when every open row's tags read whole", () => {
    const folded = fold({ rows: [row({ slug: "a" }), row({ slug: "b" })] });
    expect(noStreamLead({ folded })).toBe("no open row carries a workstream tag yet");
    expect(unclaimedClauses({ folded })).toEqual(["2 open rows untagged"]);
  });

  it("says no open row publishes tags when none published a tags field", () => {
    const { tags: _published, ...unpublished } = row({ slug: "no-tags-key" });
    const folded = fold({ rows: [unpublished] });
    expect(noStreamLead({ folded })).toBe("no open row publishes tags yet");
    expect(unclaimedClauses({ folded })).toEqual(["1 whose board row publishes no tags"]);
  });

  it("claims nothing about tags a row published but the fold could not read", () => {
    const folded = fold({ rows: [row({ over: { tags: "workstream=iso" }, slug: "unreadable" }), row({ slug: "b" })] });
    expect(noStreamLead({ folded })).toBe("no workstream read yet");
    expect(unclaimedClauses({ folded })).toEqual(["1 open rows untagged", "1 whose tags did not wholly read"]);
  });

  it("claims nothing about untagged rows beside rows whose board publishes no tags", () => {
    const { tags: _published, ...unpublished } = row({ slug: "no-tags-key" });
    const folded = fold({ rows: [unpublished, row({ slug: "empty-tags" })] });
    expect(noStreamLead({ folded })).toBe("no workstream read yet");
  });
});
