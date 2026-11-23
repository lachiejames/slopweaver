import { describe, expect, it } from "vitest";

import {
  MARKER_LAUNCHED,
  markerAbandoned,
  pruneTriggerCommand,
  pruneTriggerMarker,
  staleTriggerMarkers,
  thresholdPruneOwed,
  WORKTREE_PRUNE_TRIGGER_FREE_GB,
} from "../../../worktree/pruneTrigger.js";

/** The KiB `df -k` reports for exactly `gb` decimal GB. */
const kibFor = ({ gb }: { gb: number }): number => (gb * 1_000_000_000) / 1024;

describe("thresholdPruneOwed", () => {
  it("holds the owner's floor at 100 GB", () => {
    expect(WORKTREE_PRUNE_TRIGGER_FREE_GB).toBe(100);
  });

  it("is owed at the 49 GB the fleet held on", () => {
    expect(thresholdPruneOwed({ availableKib: kibFor({ gb: 49 }) })).toBe(true);
  });

  it("is owed one KiB under the floor, where the printed one-decimal figure already reads 100.0", () => {
    expect(thresholdPruneOwed({ availableKib: kibFor({ gb: 100 }) - 1 })).toBe(true);
  });

  it("is not owed at exactly the floor, nor above it", () => {
    expect(thresholdPruneOwed({ availableKib: kibFor({ gb: 100 }) })).toBe(false);
    expect(thresholdPruneOwed({ availableKib: kibFor({ gb: 300 }) })).toBe(false);
  });

  it("is never owed for an unread disk", () => {
    expect(thresholdPruneOwed({ availableKib: undefined })).toBe(false);
  });

  it("honours a floor the caller passes", () => {
    expect(thresholdPruneOwed({ availableKib: kibFor({ gb: 49 }), floorGb: 40 })).toBe(false);
  });
});

describe("pruneTriggerMarker", () => {
  const at = ({ iso }: { iso: string }): number => Date.parse(iso);

  it("names a schedule marker by its wall-clock hour", () => {
    expect(pruneTriggerMarker({ cause: "schedule", nowMs: at({ iso: "2026-10-11T22:00:00.000Z" }) })).toBe(
      "schedule-2026-10-11T22-00-00Z",
    );
    expect(pruneTriggerMarker({ cause: "schedule", nowMs: at({ iso: "2026-10-11T22:59:59.999Z" }) })).toBe(
      "schedule-2026-10-11T22-00-00Z",
    );
    expect(pruneTriggerMarker({ cause: "schedule", nowMs: at({ iso: "2026-10-11T23:00:00.000Z" }) })).toBe(
      "schedule-2026-10-11T23-00-00Z",
    );
  });

  it("names a threshold marker by its ten-minute window", () => {
    expect(pruneTriggerMarker({ cause: "threshold", nowMs: at({ iso: "2026-10-11T22:49:59.000Z" }) })).toBe(
      "threshold-2026-10-11T22-40-00Z",
    );
    expect(pruneTriggerMarker({ cause: "threshold", nowMs: at({ iso: "2026-10-11T22:50:00.000Z" }) })).toBe(
      "threshold-2026-10-11T22-50-00Z",
    );
  });
});

describe("staleTriggerMarkers", () => {
  it("returns the same cause's passed windows, oldest first, keeping the one just before and any foreign file", () => {
    expect(
      staleTriggerMarkers({
        current: "schedule-2026-10-11T23-00-00Z",
        names: [
          "schedule-2026-10-11T22-00-00Z",
          "schedule-2026-10-11T20-00-00Z",
          "schedule-2026-10-11T21-00-00Z",
          "schedule-2026-10-11T23-00-00Z",
          "README",
        ],
      }),
    ).toEqual(["schedule-2026-10-11T20-00-00Z", "schedule-2026-10-11T21-00-00Z"]);
  });

  it("keeps the previous window, which a caller from just before the boundary may still be claiming", () => {
    expect(
      staleTriggerMarkers({
        current: "schedule-2026-10-11T23-00-00Z",
        names: ["schedule-2026-10-11T22-00-00Z", "schedule-2026-10-11T23-00-00Z"],
      }),
    ).toEqual([]);
  });

  it("never deletes the other cause's marker, whose window may still be live", () => {
    const names = [
      "schedule-2026-10-11T21-00-00Z",
      "schedule-2026-10-11T22-00-00Z",
      "threshold-2026-10-11T22-30-00Z",
      "threshold-2026-10-11T22-40-00Z",
      "threshold-2026-10-11T22-50-00Z",
    ];
    expect(staleTriggerMarkers({ current: "threshold-2026-10-11T22-50-00Z", names })).toEqual([
      "threshold-2026-10-11T22-30-00Z",
    ]);
    expect(staleTriggerMarkers({ current: "schedule-2026-10-11T23-00-00Z", names })).toEqual([
      "schedule-2026-10-11T21-00-00Z",
    ]);
  });

  it("leaves a later window's marker alone, so a skewed clock cannot reopen it", () => {
    expect(
      staleTriggerMarkers({
        current: "threshold-2026-10-11T22-50-00Z",
        names: ["threshold-2026-10-11T23-00-00Z", "threshold-2026-10-11T22-50-00Z"],
      }),
    ).toEqual([]);
  });

  it("returns nothing for an empty directory", () => {
    expect(staleTriggerMarkers({ current: "schedule-2026-10-11T23-00-00Z", names: [] })).toEqual([]);
  });
});

describe("markerAbandoned", () => {
  const nowMs = Date.parse("2026-10-11T22:51:50.000Z");

  it("reads an unconfirmed marker older than a minute as abandoned", () => {
    expect(markerAbandoned({ content: "", mtimeMs: nowMs - 61_000, nowMs, regularFile: true })).toBe(true);
  });

  it("leaves an unconfirmed marker inside its minute alone, since its claimer may still be launching", () => {
    expect(markerAbandoned({ content: "", mtimeMs: nowMs - 60_000, nowMs, regularFile: true })).toBe(false);
  });

  it("never reads a launched marker as abandoned, however old", () => {
    const content = MARKER_LAUNCHED;
    expect(markerAbandoned({ content, mtimeMs: nowMs - 3_600_000, nowMs, regularFile: true })).toBe(false);
  });

  it("reads a path that is not a regular file as abandoned at once, since no claim wrote it", () => {
    expect(markerAbandoned({ content: "", mtimeMs: nowMs, nowMs, regularFile: false })).toBe(true);
  });

  it("reads a fresh file holding anything but the launched word as abandoned at once", () => {
    expect(markerAbandoned({ content: "x", mtimeMs: nowMs, nowMs, regularFile: true })).toBe(true);
    expect(markerAbandoned({ content: "launched\n", mtimeMs: nowMs, nowMs, regularFile: true })).toBe(true);
  });
});

describe("pruneTriggerCommand", () => {
  it("runs the prune itself below the floor, past any stamped slot or held row", () => {
    expect(pruneTriggerCommand({ cause: "threshold" })).toEqual(["worktree", "prune", "--apply", "--if-idle"]);
  });

  it("runs the hourly row's own firing on the schedule, so the slot ledger records it once", () => {
    expect(pruneTriggerCommand({ cause: "schedule" })).toEqual(["automation", "run-due", "--recipe", "worktree-prune"]);
  });
});
