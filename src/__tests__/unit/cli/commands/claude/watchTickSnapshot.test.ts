/**
 * A `claude watch --dry-run` tick reports and writes nothing — the per-plan usage snapshot the running-seat gate
 * reads included — so a report can never move a limited plan's seats from NOT MEASURED to open. The recording half
 * itself is `claude/planUsageSnapshotStore.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readClaudePlanUsageSnapshot } from "../../../../../claude/planUsageSnapshotStore.js";
import { finishWatchTick } from "../../../../../cli/commands/claude/watchTickTail.js";
import { unwrap } from "../../../../../lib/result.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-watch-snapshot-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("finishWatchTick", () => {
  it("records no usage snapshot on a dry run", async () => {
    await finishWatchTick({
      dryRun: true,
      gauges: [
        {
          alias: "plan-one",
          observedAtIso: "2026-11-05T11:50:00.000Z",
          sevenDay: { resetAtIso: "2026-11-08T12:00:00.000Z", status: "allowed", utilization: 0.2 },
        },
      ],
      home,
      nowIso: "2026-11-05T12:00:00.000Z",
      once: true,
      probes: [],
      wantsJson: true,
    });
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
  });
});
