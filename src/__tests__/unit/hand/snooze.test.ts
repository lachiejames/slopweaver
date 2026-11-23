import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { noteStanding } from "../../../hand/note/raise.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import {
  isSnoozeChoice,
  SNOOZE_MARKER_SUFFIXES,
  snoozeActive,
  snoozeChoiceLabel,
  snoozeChoiceOfSuffix,
  snoozeUntil,
} from "../../../hand/snooze.js";
import {
  activeSnoozes,
  pruneSnoozes,
  readSnoozes,
  recordSnooze,
  snoozeOf,
  snoozeStoreDir,
} from "../../../hand/snoozeStore.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

/** 15:01 in Melbourne, AEST (+10). */
const PRESSED = "2026-09-19T05:01:07.803Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "snooze-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function step(): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gcloud-signin",
        postedBy: "workspace:129",
        postedIso: "2026-09-19T04:35:44.113Z",
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
      },
    }),
  );
}

/**
 * Write one snooze marker exactly where the panel writes it.
 *
 * @param suffix the marker's suffix, `snooze-1h` and the like
 * @param stamp the bytes the panel wrote: the press instant
 */
function snoozeMarker({ suffix, stamp }: { suffix: string; stamp: string }): string {
  const markerDir = stateHomePaths({ home }).handNoteDismiss;
  mkdirSync(markerDir, { recursive: true });
  const path = join(markerDir, `gcloud-signin.${suffix}`);
  writeFileSync(path, stamp);
  return path;
}

describe("what each snooze answer means", () => {
  it("counts an hour and three hours from the press, never from whenever a reconcile ran", () => {
    expect(unwrap(snoozeUntil({ choice: "1h", id: "x", pressedIso: PRESSED }))).toBe("2026-09-19T06:01:07.803Z");
    expect(unwrap(snoozeUntil({ choice: "3h", id: "x", pressedIso: PRESSED }))).toBe("2026-09-19T08:01:07.803Z");
  });

  it("reads Tomorrow as 09:00 Melbourne on the next calendar day", () => {
    expect(unwrap(snoozeUntil({ choice: "tomorrow", id: "x", pressedIso: PRESSED }))).toBe("2026-09-19T23:00:00.000Z");
  });

  it("reads Tomorrow from a press just after local midnight as the NEXT morning, not eight hours on", () => {
    // 00:30 the next day in Melbourne.
    expect(unwrap(snoozeUntil({ choice: "tomorrow", id: "x", pressedIso: "2026-09-19T14:30:00.000Z" }))).toBe(
      "2026-09-20T23:00:00.000Z",
    );
  });

  it("lands Tomorrow on the right side of the spring-forward night (AEST to AEDT)", () => {
    // 20:00 the evening before under +10; 09:00 the next morning is under +11.
    expect(unwrap(snoozeUntil({ choice: "tomorrow", id: "x", pressedIso: "2026-10-03T10:00:00.000Z" }))).toBe(
      "2026-10-03T22:00:00.000Z",
    );
  });

  it("refuses a press instant that is not a date, naming the step", () => {
    const error = unwrapErr(snoozeUntil({ choice: "1h", id: "gcloud-signin", pressedIso: "" }));
    expect(error.code).toBe("INVALID_SNOOZE");
    expect(error.message).toBe(
      'the snooze on gcloud-signin has no wake time this register can trust: press instant "" is not a date',
    );
  });

  it("knows its own marker suffixes, and nothing else", () => {
    expect(SNOOZE_MARKER_SUFFIXES).toEqual(["snooze-1h", "snooze-3h", "snooze-tomorrow"]);
    expect(snoozeChoiceOfSuffix({ suffix: "snooze-3h" })).toBe("3h");
    expect(snoozeChoiceOfSuffix({ suffix: "snooze-forever" })).toBe(undefined);
    expect(snoozeChoiceOfSuffix({ suffix: "later" })).toBe(undefined);
    expect(isSnoozeChoice("tomorrow")).toBe(true);
    expect(isSnoozeChoice("1d")).toBe(false);
    expect(snoozeChoiceLabel({ choice: "1h" })).toBe("1 hour");
  });

  it("holds until the wake instant and not a millisecond past it", () => {
    const untilIso = "2026-09-19T06:01:07.803Z";
    expect(snoozeActive({ nowIso: "2026-09-19T06:01:07.802Z", untilIso })).toBe(true);
    expect(snoozeActive({ nowIso: untilIso, untilIso })).toBe(false);
  });
});

describe("the snooze store", () => {
  const record = {
    choice: "1h",
    id: "gcloud-signin",
    pressedIso: PRESSED,
    untilIso: "2026-09-19T06:01:07.803Z",
  } as const;

  it("round-trips a record, and reads an absent store as none", () => {
    expect(readSnoozes({ home })).toEqual({ problems: [], records: [], unreadable: [] });
    unwrap(recordSnooze({ home, record }));
    expect(readSnoozes({ home })).toEqual({ problems: [], records: [record], unreadable: [] });
    expect(unwrap(snoozeOf({ home, id: "gcloud-signin" }))).toEqual(record);
    expect(unwrap(snoozeOf({ home, id: "other" }))).toBe(undefined);
  });

  it("names a torn record rather than reading it as not snoozed", () => {
    mkdirSync(snoozeStoreDir({ home }), { recursive: true });
    writeFileSync(join(snoozeStoreDir({ home }), "gcloud-signin.json"), '{"id":"gcloud-signin","choice":"1d"}');
    const read = readSnoozes({ home });
    expect(read.records).toEqual([]);
    expect(read.problems.map((problem) => problem.code)).toEqual(["SNOOZE_STORE"]);
    expect(read.problems[0]!.message).toContain('"1d" is not a snooze choice');
    expect(read.unreadable).toEqual(["gcloud-signin"]);
  });

  it("names a dangling record link as unreadable, by the step its entry is for", () => {
    mkdirSync(snoozeStoreDir({ home }), { recursive: true });
    symlinkSync(join(home, "nowhere.json"), join(snoozeStoreDir({ home }), "gcloud-signin.json"));
    const read = readSnoozes({ home });
    expect(read.records).toEqual([]);
    expect(read.unreadable).toEqual(["gcloud-signin"]);
    expect(read.problems.map((problem) => problem.code)).toEqual(["SNOOZE_STORE"]);
  });

  it("refuses a record naming another step than its file, rather than waking the wrong one", () => {
    mkdirSync(snoozeStoreDir({ home }), { recursive: true });
    writeFileSync(join(snoozeStoreDir({ home }), "a.json"), JSON.stringify({ ...record, id: "b" }));
    const read = readSnoozes({ home });
    expect(read.records).toEqual([]);
    expect(read.problems[0]!.message).toContain('the record names step "b", not the one its file is for');
  });

  it("keeps only the snoozes still holding at an instant", () => {
    const active = activeSnoozes({ nowIso: "2026-09-19T06:00:00.000Z", records: [record] });
    expect([...active.keys()]).toEqual(["gcloud-signin"]);
    expect([...activeSnoozes({ nowIso: "2026-09-19T07:00:00.000Z", records: [record] }).keys()]).toEqual([]);
  });

  it("prunes a record whose step is no longer open", () => {
    unwrap(recordSnooze({ home, record }));
    expect(pruneSnoozes({ home, open: new Set(["gcloud-signin"]) })).toEqual([]);
    expect(readSnoozes({ home }).records).toEqual([record]);
    expect(pruneSnoozes({ home, open: new Set() })).toEqual([]);
    expect(readSnoozes({ home }).records).toEqual([]);
  });
});

describe("a snooze marker, reconciled", () => {
  it("records the snooze from the marker's own press instant and consumes the marker, writing no row", async () => {
    unwrap(await appendHandRow({ home, nowIso: PRESSED, row: { kind: "posted", step: step() } }));
    const path = snoozeMarker({ stamp: `${PRESSED}\n`, suffix: "snooze-3h" });
    const outcome = unwrap(
      reconcileHandSteps({ bySession: "workspace:129", home, nowIso: "2026-09-19T07:00:00.000Z" }),
    );
    expect(outcome.snoozed).toEqual([
      { choice: "3h", id: "gcloud-signin", pressedIso: PRESSED, untilIso: "2026-09-19T08:01:07.803Z" },
    ]);
    expect(outcome.settled).toEqual([]);
    expect(outcome.deferred).toEqual([]);
    expect(outcome.unrecordedSnoozes).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["gcloud-signin"]);
  });

  it("consumes a snooze on a step no longer open and keeps no record of it", () => {
    const path = snoozeMarker({ stamp: `${PRESSED}\n`, suffix: "snooze-1h" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: PRESSED }));
    expect(outcome.snoozed).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(readSnoozes({ home }).records).toEqual([]);
  });

  it("consumes a press whose instant will not read, so the step comes BACK, and names why", async () => {
    unwrap(await appendHandRow({ home, nowIso: PRESSED, row: { kind: "posted", step: step() } }));
    const path = snoozeMarker({ stamp: "", suffix: "snooze-1h" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: PRESSED }));
    expect(outcome.snoozed).toEqual([]);
    expect(outcome.unrecordedSnoozes.map((problem) => problem.code)).toEqual(["INVALID_SNOOZE"]);
    expect(existsSync(path)).toBe(false);
  });

  it("keeps the marker when the store will not take the record, so the note still reads put down", async () => {
    unwrap(await appendHandRow({ home, nowIso: PRESSED, row: { kind: "posted", step: step() } }));
    const path = snoozeMarker({ stamp: `${PRESSED}\n`, suffix: "snooze-1h" });
    writeFileSync(snoozeStoreDir({ home }), "not a directory");
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: PRESSED }));
    expect(outcome.unrecordedSnoozes.map((problem) => problem.code)).toEqual(["SNOOZE_STORE"]);
    expect(existsSync(path)).toBe(true);
    expect(unwrap(noteStanding({ clock: () => PRESSED, home, id: "gcloud-signin" }))).toBe("dismissed");
  });
});

describe("where a snoozed note stands", () => {
  it("reads put down while the snooze holds, and absent once it lapses, so a re-raise brings it back", () => {
    unwrap(
      recordSnooze({
        home,
        record: { choice: "1h", id: "gcloud-signin", pressedIso: PRESSED, untilIso: "2026-09-19T06:01:07.803Z" },
      }),
    );
    expect(unwrap(noteStanding({ clock: () => "2026-09-19T06:00:00.000Z", home, id: "gcloud-signin" }))).toBe(
      "dismissed",
    );
    expect(unwrap(noteStanding({ clock: () => "2026-09-19T06:01:07.803Z", home, id: "gcloud-signin" }))).toBe("absent");
  });
});
