/*
 * The fleet assessed from each home's own rollout log and register row: a window whose reset has passed, a reading
 * after the snapshot instant, the least-used destination, a paused row and a cached email.
 */
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assessCodexFleet } from "../../../../codex/fleetAssessment.js";
import { readCodexFleetSnapshot } from "../../../../codex/fleetRead.js";
import { unwrap } from "../../../../lib/result.js";
import { memoryCodexFleetCapPort } from "../../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../../codexLiveFake.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { weeklyLine } from "../../../codexWeeklyLineFixture.js";
import { memoryPlanRegisterPort } from "../../../planRegisterFixture.js";
import { codexHomeAtWeekly, homeWith, MODEL, NOW, temp, useRouteRunHomes } from "./harness.js";

useRouteRunHomes();

describe("assessing the Codex fleet over real homes", () => {
  it("reports a window whose reset passed before the snapshot as unread, never its old percentage", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-reset", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 100 }) }],
    });

    const before = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: "2026-09-27T09:06:39.000Z",
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });
    const after = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: "2026-09-27T09:06:40.000Z",
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(before.rows.map((row) => row.weeklyUsedPercent)).toEqual([100]);
    expect(after.rows.map((row) => row.weeklyUsedPercent)).toEqual([null]);
  });

  it("judges a reading after the snapshot instant by that SAME instant, so the cap behind it still ranks", async () => {
    const codexHome = temp({ prefix: "codex-route-home-" });
    const dayDir = join(codexHome, "sessions", "2026", "09", "22");
    mkdirSync(dayDir, { recursive: true });
    const capped = join(dayDir, "rollout-000.jsonl");
    const dipped = join(dayDir, "rollout-001.jsonl");
    writeFileSync(capped, `${weeklyLine({ observedIso: "2026-09-22T11:59:59.000Z", percent: 100 })}\n`, "utf8");
    writeFileSync(dipped, `${weeklyLine({ observedIso: "2026-09-22T12:00:00.001Z", percent: 97 })}\n`, "utf8");
    utimesSync(capped, new Date("2026-09-22T11:59:59.500Z"), new Date("2026-09-22T11:59:59.500Z"));
    utimesSync(dipped, new Date("2026-09-22T12:00:00.500Z"), new Date("2026-09-22T12:00:00.500Z"));
    const home = homeWith({ rows: [{ alias: "codex-capped", provider: "codex", storeDir: codexHome }] });

    const snapshot = unwrap(
      await readCodexFleetSnapshot({
        fleetCap: memoryCodexFleetCapPort(),
        home,
        nowIso: NOW,
        port: memoryPlanRegisterPort(),
        readLive: liveReaderFrom(),
        signInPort: memoryCodexSignInPort(),
      }),
    );
    const gauge = snapshot.observations[0]!.scan.gauge!;

    // The ranker drops a gauge observed after NOW, so the scan must never have kept the 12:00:00.001Z reading.
    expect(gauge.observedAtIso).toBe("2026-09-22T11:59:59.000Z");
    expect(gauge.windows[0]!.usedPercent).toBe(100);
  });

  it("names the least-used destination, reading each home's OWN log", async () => {
    const busy = codexHomeAtWeekly({ percent: 61 });
    const idle = codexHomeAtWeekly({ percent: 4 });
    const home = homeWith({
      rows: [
        { alias: "codex-busy", provider: "codex", storeDir: busy },
        { alias: "codex-idle", provider: "codex", storeDir: idle },
      ],
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.selection).toEqual({
      destination: { alias: "codex-idle", codexHome: idle },
      kind: "selected",
    });
    // The pairing is the property: each row's percentage came from ITS OWN home, not from whichever log
    // happened to be read first. Swapping the two storeDirs would swap these two numbers.
    expect(assessment.rows.map((row) => [row.alias, row.weeklyUsedPercent])).toEqual([
      ["codex-busy", 61],
      ["codex-idle", 4],
    ]);
    expect(assessment.weeklySpread).toEqual({ kind: "spread", ofDestinations: 2, points: 57, samples: 2 });
  });

  it("keeps a paused row in the report, with the owner's own reason, rather than hiding it", async () => {
    const live = codexHomeAtWeekly({ percent: 50 });
    const home = homeWith({
      rows: [
        {
          alias: "codex-out",
          paused: { reason: "card expired", sinceIso: "2026-09-20T00:00:00.000Z" },
          provider: "codex",
          storeDir: codexHomeAtWeekly({ percent: 1 }),
        },
        { alias: "codex-live", provider: "codex", storeDir: live },
      ],
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.destinations).toBe(2);
    expect(assessment.unpaused).toBe(1);
    // The paused plan is the emptiest and still takes no work — and it is REPORTED, which is the half a
    // fleet picture nobody trusts would have dropped.
    expect(assessment.selection).toEqual({
      destination: { alias: "codex-live", codexHome: live },
      kind: "selected",
    });
    const paused = assessment.rows.find((row) => row.alias === "codex-out")!;
    expect(paused.pausedReason).toBe("card expired");
    expect(paused.pausedSinceIso).toBe("2026-09-20T00:00:00.000Z");
    expect(paused.disposition).toBe("excluded (paused)");
    // An in-fleet plan carries no pause record, so its row reports an explicit null for both pause fields.
    const active = assessment.rows.find((row) => row.alias === "codex-live")!;
    expect(active.pausedReason).toBeNull();
    expect(active.pausedSinceIso).toBeNull();
  });

  it("carries a register row's cached email, and an explicit null for a row that caches none", async () => {
    const home = homeWith({
      rows: [
        {
          alias: "codex-named",
          email: "named@example.com",
          provider: "codex",
          storeDir: codexHomeAtWeekly({ percent: 10 }),
        },
        { alias: "codex-bare", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 20 }) },
      ],
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.rows.map((row) => [row.alias, row.emailCached])).toEqual([
      ["codex-named", "named@example.com"],
      ["codex-bare", null],
    ]);
  });
});
