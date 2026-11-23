/**
 * The as-me draft register's log, end to end through its own file: a parked row round-trips owner-readable only,
 * a line it cannot read is passed over by name rather than hiding every draft, and a row such a line names is
 * never drawn held.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent, readSlackDraftLines, slackDraftLogPath } from "../../../../../admit/slackDraftStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import {
  foldSlackDraftLog,
  parseSlackDraftLog,
  skippedDraftNote,
  skippedLinesTouching,
} from "../../../../../outbound/slack/draftLog.js";
import { slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import { draft } from "./fixtures.js";

const HOMES: string[] = [];

afterEach(() => {
  for (const home of HOMES.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, minted inside this file's own sandbox root. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-draft-"));
  HOMES.push(home);
  return home;
}

describe("the register's log", () => {
  it("round-trips a parked draft through the real file, owner-readable only", () => {
    const home = newHome();
    const parked = draft();
    expect(
      unwrap(
        appendSlackDraftEvent({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso }, home }),
      ),
    ).toBe(true);
    const { events } = parseSlackDraftLog({ lines: readSlackDraftLines({ home }) });
    expect(events.length).toBe(1);
    expect(foldSlackDrafts({ events })[0]!.draft.why).toBe("the entry-group question for the launch channel");
    expect(foldSlackDrafts({ events })[0]!.state).toBe("held");
    expect(statSync(slackDraftLogPath({ home })).mode & 0o777).toBe(0o600);
    expect(readFileSync(slackDraftLogPath({ home }), "utf8")).toContain('"schemaVersion":1');
  });

  it("answers no lines at all for a home that has never parked one", () => {
    expect(readSlackDraftLines({ home: newHome() })).toEqual([]);
    expect(parseSlackDraftLog({ lines: [] })).toEqual({ events: [], skipped: [] });
  });

  it("passes over a line it cannot read by name, and still reads every other draft", () => {
    const parked = draft();
    const lines = [
      slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
      String.raw`{"kind":"parked","id":"sd-2"}`,
      "",
    ];
    const log = parseSlackDraftLog({ lines });
    expect(log.skipped).toEqual([{ id: "sd-2", kind: "parked", line: 2 }]);
    expect(foldSlackDraftLog({ log }).map((item) => [item.id, item.state])).toEqual([["sd-11111111", "held"]]);
  });

  it("passes over a draft shape and a kind it does not know, names both, and still reads every draft it can", () => {
    const parked = draft();
    const thread = JSON.stringify({
      draft: { ...draft({ over: { id: "sd-e7511638" } }), shape: "scheduled", threadTs: "1790145643.664469" },
      id: "sd-e7511638",
      kind: "parked",
      schemaVersion: 1,
      tsIso: "2026-09-28T13:59:46.985Z",
    });
    const edited = JSON.stringify({ id: parked.id, kind: "edited", schemaVersion: 1, tsIso: "2026-09-28T14:00:00Z" });
    const log = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        thread,
        edited,
      ],
    });
    expect(foldSlackDrafts({ events: log.events }).map((item) => item.id)).toEqual(["sd-11111111"]);
    // The `edited` line may have spent sd-11111111, so the rows a reader is shown leave it out rather than call it held.
    expect(foldSlackDraftLog({ log })).toEqual([]);
    expect(
      foldSlackDraftLog({ log: { ...log, skipped: log.skipped.slice(0, 1) } }).map((item) => [item.id, item.state]),
    ).toEqual([["sd-11111111", "held"]]);
    expect(log.skipped).toEqual([
      { id: "sd-e7511638", kind: "parked", line: 2 },
      { id: "sd-11111111", kind: "edited", line: 3 },
    ]);
    expect(skippedDraftNote({ skipped: log.skipped })).toBe(
      "2 lines of the as-me draft register this version cannot read passed over, with every draft they name: " +
        "line 2 (parked sd-e7511638), line 3 (edited sd-11111111)",
    );
  });

  it("says nothing when no line was passed over", () => {
    expect(skippedDraftNote({ skipped: [] })).toBe(undefined);
  });

  it("hides a row a release or drop it cannot read names, since showing it would call a spent row held", () => {
    const parked = draft();
    const first = slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } });
    const unreadable = [
      JSON.stringify({ id: parked.id, kind: "dropped", tsIso: "2026-09-28T14:00:00Z" }),
      JSON.stringify({ channel: "C0ISO", id: parked.id, kind: "released", tsIso: "2026-09-28T14:00:00Z" }),
    ];
    expect(unreadable.length).toBeGreaterThan(0);
    const read = unreadable.map((line) => {
      const log = parseSlackDraftLog({ lines: [first, line] });
      return {
        shown: foldSlackDraftLog({ log }).length,
        touching: skippedLinesTouching({ id: parked.id, log }).length,
      };
    });
    expect(read).toEqual(unreadable.map(() => ({ shown: 0, touching: 1 })));
  });

  it("names a line that is not JSON as naming no draft, and counts it against every row a release could touch", () => {
    const parked = draft();
    const log = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        "{not json",
        JSON.stringify({ id: "sd-other", kind: "edited" }),
      ],
    });
    expect(log.skipped).toEqual([
      { id: undefined, kind: undefined, line: 2 },
      { id: "sd-other", kind: "edited", line: 3 },
    ]);
    expect(foldSlackDraftLog({ log }).map((item) => item.id)).toEqual(["sd-11111111"]);
    expect(skippedLinesTouching({ id: parked.id, log })).toEqual([{ id: undefined, kind: undefined, line: 2 }]);
    expect(skippedDraftNote({ skipped: skippedLinesTouching({ id: parked.id, log }) })).toBe(
      "1 line of the as-me draft register this version cannot read passed over, with every draft they name: " +
        "line 2 (names no draft)",
    );
  });

  it("hides the row a release cut off mid-write names, since that release may have spent it", () => {
    const parked = draft();
    const release = slackDraftEventLine({
      event: {
        channel: "C0ISO",
        id: parked.id,
        kind: "released",
        ts: "1758500000.1",
        tsIso: "2026-09-23T01:00:00.000Z",
      },
    });
    const log = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        release.slice(0, 60),
        `{"id":"sd-aaaaaaaa","draft":{"id":"sd-bbbbbbbb"`,
      ],
    });
    expect(log.skipped).toEqual([
      { id: "sd-11111111", kind: undefined, line: 2 },
      { id: undefined, kind: undefined, line: 3 },
    ]);
    expect(foldSlackDraftLog({ log })).toEqual([]);
  });

  it("folds a release onto its own row and leaves an orphan release out entirely", () => {
    const parked = draft();
    const { events } = parseSlackDraftLog({
      lines: [
        slackDraftEventLine({ event: { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso } }),
        slackDraftEventLine({
          event: {
            channel: "C0ISO",
            id: parked.id,
            kind: "released",
            ts: "1758500000.1",
            tsIso: "2026-09-23T01:00:00.000Z",
          },
        }),
        slackDraftEventLine({
          event: {
            channel: "C0ISO",
            id: "sd-unknown",
            kind: "released",
            ts: "1758500001.1",
            tsIso: "2026-09-23T01:01:00.000Z",
          },
        }),
        "",
      ],
    });
    const items = foldSlackDrafts({ events });
    expect(items.length).toBe(1);
    expect(items[0]!.state).toBe("released");
    expect(items[0]!.outcome).toBe("C0ISO 1758500000.1");
    expect(items[0]!.resolvedIso).toBe("2026-09-23T01:00:00.000Z");
  });
});
