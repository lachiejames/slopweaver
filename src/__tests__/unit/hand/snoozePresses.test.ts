import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NoteMarker, readNoteMarkers } from "../../../hand/note/markers.js";
import { pendingSnoozeRecords, recordSnoozePresses } from "../../../hand/snoozePresses.js";
import { recordSnooze, snoozeOf } from "../../../hand/snoozeStore.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

let home = "";
let markerDir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "presses-"));
  markerDir = stateHomePaths({ home }).handNoteDismiss;
  mkdirSync(markerDir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Leave one marker in the directory with the stamp the note writes, and read the directory back.
 *
 * @param name the marker's file name
 * @param stamp what the marker carries
 * @returns every marker now in the directory
 */
function mark({ name, stamp }: { name: string; stamp: string }): readonly NoteMarker[] {
  writeFileSync(join(markerDir, name), `${stamp}\n`);
  return unwrap(readNoteMarkers({ markerDir }));
}

describe("pendingSnoozeRecords", () => {
  it("reads every readable press into the record a reconcile would write, writing nothing", () => {
    mark({ name: "sign-in.snooze-1h", stamp: "2026-10-04T02:00:00.000Z" });
    mark({ name: "garbled.snooze-1h", stamp: "not an instant" });
    const markers = mark({ name: "approve.done", stamp: "2026-10-04T02:00:00.000Z" });
    expect(pendingSnoozeRecords({ snoozes: markers })).toEqual([
      { choice: "1h", id: "sign-in", pressedIso: "2026-10-04T02:00:00.000Z", untilIso: "2026-10-04T03:00:00.000Z" },
    ]);
    expect(unwrap(snoozeOf({ home, id: "sign-in" }))).toBe(undefined);
  });
});

describe("recordSnoozePresses", () => {
  it("writes only a step's latest press when it carries several, and consumes every one", () => {
    mark({ name: "sign-in.snooze-3h", stamp: "2026-10-04T01:00:00.000Z" });
    const markers = mark({ name: "sign-in.snooze-1h", stamp: "2026-10-04T02:00:00.000Z" });
    const pass = recordSnoozePresses({ home, open: new Set(["sign-in"]), prune: true, snoozes: markers });
    expect(pass.snoozed).toEqual([
      { choice: "1h", id: "sign-in", pressedIso: "2026-10-04T02:00:00.000Z", untilIso: "2026-10-04T03:00:00.000Z" },
    ]);
    expect(pass.consumed.map((marker) => marker.path).toSorted()).toEqual([
      join(markerDir, "sign-in.snooze-1h"),
      join(markerDir, "sign-in.snooze-3h"),
    ]);
    expect(pass.problems).toEqual([]);
    expect(unwrap(snoozeOf({ home, id: "sign-in" }))!.untilIso).toBe("2026-10-04T03:00:00.000Z");
  });

  it("leaves a stored record that is newer than the press standing, and still consumes the press", () => {
    unwrap(
      recordSnooze({
        home,
        record: {
          choice: "3h",
          id: "sign-in",
          pressedIso: "2026-10-04T05:00:00.000Z",
          untilIso: "2026-10-04T08:00:00.000Z",
        },
      }),
    );
    const markers = mark({ name: "sign-in.snooze-1h", stamp: "2026-10-04T02:00:00.000Z" });
    const pass = recordSnoozePresses({ home, open: new Set(["sign-in"]), prune: true, snoozes: markers });
    expect(pass.snoozed).toEqual([]);
    expect(pass.consumed.map((marker) => marker.id)).toEqual(["sign-in"]);
    expect(unwrap(snoozeOf({ home, id: "sign-in" }))!.untilIso).toBe("2026-10-04T08:00:00.000Z");
  });

  it("names a press whose instant will not read and consumes it, so the step comes back rather than staying away", () => {
    const markers = mark({ name: "sign-in.snooze-3h", stamp: "" });
    const pass = recordSnoozePresses({ home, open: new Set(["sign-in"]), prune: true, snoozes: markers });
    expect(pass.snoozed).toEqual([]);
    expect(pass.consumed.map((marker) => marker.id)).toEqual(["sign-in"]);
    expect(pass.problems.map((problem) => problem.code)).toEqual(["INVALID_SNOOZE"]);
    expect(unwrap(snoozeOf({ home, id: "sign-in" }))).toBeUndefined();
  });

  it("passes over a Done or Later marker, which is not its to consume", () => {
    mark({ name: "sign-in.done", stamp: "2026-10-04T02:00:00.000Z" });
    const markers = mark({ name: "other.later", stamp: "2026-10-04T02:00:00.000Z" });
    expect(markers.map((marker) => marker.answer)).toEqual(["later", "done"]);
    const pass = recordSnoozePresses({ home, open: new Set(["sign-in"]), prune: true, snoozes: markers });
    expect(pass).toEqual({ consumed: [], problems: [], snoozed: [] });
  });
});
