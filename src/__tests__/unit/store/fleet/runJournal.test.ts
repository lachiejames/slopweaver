/**
 * The run journal's projection — the parent's derived fold, and the children that make it re-derivable.
 *
 * The journals are built as text here rather than read from a fixture, so a case says in one place what
 * shape it is about. `../../../../handover/ledger.ts`'s real decoder does the parsing either way.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { projectRunJournal } from "../../../../store/fleet/runJournal.js";

const PATH = "/tmp/runs/a-slug.jsonl";

/** One journal, as its lines. */
function journal({ lines }: { lines: readonly Readonly<Record<string, unknown>>[] }): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

describe("projectRunJournal", () => {
  it("folds a started-then-finished journal into a closed run", () => {
    const text = journal({
      lines: [
        { atIso: "2026-09-10T01:00:00.000Z", branch: "a-slug", docHash: "abc123", kind: "started" },
        { atIso: "2026-09-10T02:00:00.000Z", kind: "finished", summary: "landed" },
      ],
    });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "a-slug", text }));

    expect(projected.run.phase).toBe("closed");
    expect(projected.run.branch).toBe("a-slug");
    expect(projected.run.docHash).toBe("abc123");
    expect(projected.run.eventCount).toBe(2);
    expect(projected.run.slug).toBe("a-slug");
    expect(projected.run.sourcePath).toBe(PATH);
    expect(projected.run.firstEventAt.toISOString()).toBe("2026-09-10T01:00:00.000Z");
    expect(projected.run.lastEventAt.toISOString()).toBe("2026-09-10T02:00:00.000Z");
  });

  it("folds a recorded question into waiting-on-owner, which is a legitimate ending", () => {
    const text = journal({
      lines: [
        { atIso: "2026-09-10T01:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
        { atIso: "2026-09-10T01:30:00.000Z", kind: "question", question: "which bucket?" },
      ],
    });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "b", text }));

    expect(projected.run.phase).toBe("waiting-on-owner");
  });

  it("stores every line as a child, numbered so a re-import replaces rather than duplicates", () => {
    const text = journal({
      lines: [
        { atIso: "2026-09-10T01:00:00.000Z", branch: "c", docHash: "h", kind: "started" },
        { atIso: "2026-09-10T01:10:00.000Z", failed: 1, kind: "probed", passed: 2 },
      ],
    });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "c", text }));

    expect(projected.events.length).toBe(2);
    expect(projected.events.map((event) => event.lineNumber)).toEqual([1, 2]);
    expect(projected.events.map((event) => event.kind)).toEqual(["started", "probed"]);
  });

  it("strips kind and atIso from the payload, so neither is stored twice and able to disagree", () => {
    const text = journal({
      lines: [{ atIso: "2026-09-10T01:10:00.000Z", failed: 1, kind: "probed", passed: 2 }],
    });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "d", text }));

    expect(projected.events[0]!.payload).toEqual({ failed: 1, passed: 2 });
    expect(projected.events[0]!.kind).toBe("probed");
    expect(projected.events[0]!.atIso.toISOString()).toBe("2026-09-10T01:10:00.000Z");
  });

  it("reports a truncated final line rather than losing the events before it", () => {
    const text = `${JSON.stringify({ atIso: "2026-09-10T01:00:00.000Z", branch: "e", docHash: "h", kind: "started" })}\n{"atIso":"2026-09-`;

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "e", text }));

    expect(projected.run.eventCount).toBe(1);
    expect(projected.unreadableLines.length).toBe(1);
  });

  it("refuses a journal with no readable event at all", () => {
    const result = projectRunJournal({ path: PATH, slug: "f", text: "{broken\n" });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("any readable event");
  });

  it("leaves branch and docHash NULL on a journal that never recorded them", () => {
    const text = journal({ lines: [{ atIso: "2026-09-10T01:00:00.000Z", kind: "dispatched" }] });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "g", text }));

    expect(projected.run.branch).toBe(null);
    expect(projected.run.docHash).toBe(null);
  });

  it("leaves writerSession NULL on a journal no session ever claimed", () => {
    const text = journal({ lines: [{ atIso: "2026-09-10T01:00:00.000Z", kind: "dispatched" }] });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "h", text }));

    expect(projected.run.writerSession).toBe(null);
  });

  it("stores the launching session as the writer", () => {
    const text = journal({
      lines: [
        { atIso: "2026-09-10T01:00:00.000Z", branch: "i", docHash: "h", kind: "started" },
        { atIso: "2026-09-10T01:05:00.000Z", kind: "launched", pid: 42, sessionId: "s-writer", worktree: "/wt/i" },
      ],
    });

    const projected = unwrap(projectRunJournal({ path: PATH, slug: "i", text }));

    expect(projected.run.writerSession).toBe("s-writer");
  });
});
