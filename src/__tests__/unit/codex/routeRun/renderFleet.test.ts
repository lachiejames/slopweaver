/*
 * The fleet as `codex route` prints it: every registered destination with the chosen one first, and a reopened
 * window's reset dropped with its percentage.
 */
import { describe, expect, it } from "vitest";

import { assessCodexFleet } from "../../../../codex/fleetAssessment.js";
import { readCodexFleetSnapshot } from "../../../../codex/fleetRead.js";
import { renderCodexFleet } from "../../../../codex/fleetRender.js";
import { unwrap } from "../../../../lib/result.js";
import { memoryCodexFleetCapPort } from "../../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../../codexLiveFake.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryPlanRegisterPort } from "../../../planRegisterFixture.js";
import { codexHomeAtWeekly, homeWith, MODEL, NOW, useRouteRunHomes } from "./harness.js";

useRouteRunHomes();

describe("rendering the fleet", () => {
  it("prints every registered destination, the chosen one first", async () => {
    const home = homeWith({
      rows: [
        { alias: "codex-busy", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 61 }) },
        { alias: "codex-idle", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 4 }) },
      ],
    });
    const lines = renderCodexFleet({
      full: true,
      assessment: assessCodexFleet({
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
      }),
    });

    expect(lines[0]).toContain("codex route: codex-idle");
    expect(lines.join("\n")).toContain("2 destination(s), 2 unpaused, 0 refusing");
    expect(lines.join("\n")).toContain("codex-busy");
    expect(lines.join("\n")).toContain("week 61%");
  });

  it("drops a reopened window's reset with its percentage, never printing a past reset as the next one", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-reset", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 100 }) }],
    });
    const render = async ({ nowIso }: { nowIso: string }): Promise<readonly string[]> =>
      renderCodexFleet({
        full: true,
        assessment: assessCodexFleet({
          requestedModel: MODEL,
          snapshot: unwrap(
            await readCodexFleetSnapshot({
              fleetCap: memoryCodexFleetCapPort(),
              home,
              nowIso,
              port: memoryPlanRegisterPort(),
              readLive: liveReaderFrom(),
              signInPort: memoryCodexSignInPort(),
            }),
          ),
        }),
      }).filter((line) => line.startsWith("  codex-reset — "));

    expect(await render({ nowIso: "2026-09-27T09:06:39.000Z" })).toEqual([
      "  codex-reset — week 100% (resets 2026-09-27T09:06:40.000Z), rollout reading, read 425199s ago",
    ]);
    expect(await render({ nowIso: "2026-09-27T09:06:40.000Z" })).toEqual([
      "  codex-reset — week unread, rollout reading, read 425200s ago",
    ]);
  });
});
