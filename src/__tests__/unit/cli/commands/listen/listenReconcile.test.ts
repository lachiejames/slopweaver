import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { reconcileTick } from "../../../../../cli/commands/listen/listenReconcile.js";
import { readSupervisorEventsFrom } from "../../../../../events/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { appendListenerArmEvent, readListenerArmEvents } from "../../../../../live/listen/supervise/store.js";

const ARMED_A = { armId: "arm-a", atIso: "2026-10-01T10:00:00.000Z", kind: "armed", pid: 111 } as const;
const ARMED_B = { armId: "arm-b", atIso: "2026-10-01T10:05:00.000Z", kind: "armed", pid: 222 } as const;
/** Five minutes after arm-b replaced arm-a, so that replacement sits inside the fifteen-minute re-arm window. */
const NOW_MS = Date.parse("2026-10-01T10:10:00.000Z");

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A home whose arm journal holds arm-a then arm-b with nothing between them, and no arm record on disk. */
function supersededHome(): string {
  const home = mkdtempSync(join(tmpdir(), "listen-reconcile-"));
  homes.push(home);
  appendListenerArmEvent({ event: ARMED_A, home });
  appendListenerArmEvent({ event: ARMED_B, home });
  return home;
}

/** Every path under `root` with its bytes (directories as `null`), sorted, so a whole-tree change is visible. */
function treeSnapshot({ root }: { root: string }): readonly (readonly [string, string | null])[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((relative): readonly [string, string | null] => {
      const path = join(root, relative);
      return [relative, statSync(path).isDirectory() ? null : readFileSync(path, "utf8")];
    });
}

const SUPERSEDED_DEATH = {
  armId: "arm-a",
  atIso: "2026-10-01T10:05:00.000Z",
  discovery: "reconciled",
  kind: "died",
  pid: 111,
  reason: "superseded",
} as const;

describe("reconcileTick", () => {
  it("back-writes the death of an arm a later arm replaced, stamped at the replacement, and reports it", () => {
    const home = supersededHome();

    expect(reconcileTick({ home, nowMs: NOW_MS })).toEqual({
      appended: [SUPERSEDED_DEATH],
      liveness: { state: "unarmed" },
      problems: [],
    });
    expect(unwrap(readListenerArmEvents({ home }))).toEqual([ARMED_A, ARMED_B, SUPERSEDED_DEATH]);
  });

  it("publishes one died event for the back-written death, counting it as death 1 in the re-arm window", () => {
    const home = supersededHome();

    reconcileTick({ home, nowMs: NOW_MS });

    expect(unwrap(readSupervisorEventsFrom({ home })).entries.map(({ event }) => event)).toEqual([
      {
        armId: "arm-a",
        atIso: "2026-10-01T10:05:00.000Z",
        kind: "died",
        pid: 111,
        source: "listener",
        why:
          "the Slack listener arm arm-a (pid 111) ENDED and nothing watched it go — a later arm replaced it with " +
          "no death, disarm or escalation journalled in between. That is death 1 inside the re-arm window; the " +
          "bot is off the air until something arms it.",
      },
    ]);
  });

  it("a second pass over the reconciled journal appends nothing and leaves the home byte-for-byte unchanged", () => {
    const home = supersededHome();
    reconcileTick({ home, nowMs: NOW_MS });
    const before = treeSnapshot({ root: home });

    expect(reconcileTick({ home, nowMs: NOW_MS })).toEqual({
      appended: [],
      liveness: { state: "unarmed" },
      problems: [],
    });
    expect(treeSnapshot({ root: home })).toEqual(before);
  });
});
