/*
 * The fleet read under a caller's deadline: no rollout log opened for the quota decision, the skipped-scan key only
 * then, the live batch asked to finish early, a store outage answered as an Err, and when a cap record is filed.
 */
import { describe, expect, it } from "vitest";

import { assessCodexFleet } from "../../../../codex/fleetAssessment.js";
import { readCodexFleetCapRecord } from "../../../../codex/fleetCapPort.js";
import { readCodexFleetSnapshot } from "../../../../codex/fleetRead.js";
import { renderCodexFleet } from "../../../../codex/fleetRender.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { memoryCodexFleetCapPort } from "../../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../../codexLiveFake.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../planRegisterFixture.js";
import { codexHomeAtWeekly, homeWith, MODEL, NOW, useRouteRunHomes } from "./harness.js";

useRouteRunHomes();

describe("reading the fleet under a caller's deadline", () => {
  const DEADLINE_AT_MS = 1_790_000_016_000;

  // The quota read's one-file tail walks the session directories to find that file, so under a deadline
  // the rollout log is not opened for the quota decision either. Its witness is a log carrying a refusal: read
  // without a deadline it refuses, and under one the same store does not.
  it("opens no rollout log for the quota decision under a deadline", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-capped-log", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 100 }) }],
    });
    const refusing = async ({ deadlineAtMs }: { deadlineAtMs?: number }): Promise<readonly boolean[]> =>
      unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ).observations.map((observation) => observation.quota.refuse);

    expect(await refusing({})).toEqual([true]);
    expect(await refusing({ deadlineAtMs: DEADLINE_AT_MS })).toEqual([false]);
  });

  // `--json` serialises the whole assessment, so a field present on every row would change the
  // no-deadline document too. The key is absent unless a scan was skipped.
  it("adds the skipped-scan key to a row only under a deadline", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-json", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 40 }) }],
    });
    const rowKeys = async ({ deadlineAtMs }: { deadlineAtMs?: number }): Promise<readonly boolean[]> =>
      assessCodexFleet({
        requestedModel: MODEL,
        snapshot: unwrap(
          await readCodexFleetSnapshot({
            fleetCap: memoryCodexFleetCapPort(),
            ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
            home,
            nowIso: NOW,
            port: memoryPlanRegisterPort(),
            readLive: liveReaderFrom(),
            signInPort: memoryCodexSignInPort(),
          }),
        ),
      }).rows.map((row) => Object.keys(row).includes("scanSkippedReason"));

    expect(await rowKeys({})).toEqual([false]);
    expect(await rowKeys({ deadlineAtMs: DEADLINE_AT_MS })).toEqual([true]);
  });

  it("files the fleet-cap record from a read with no deadline", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-whole", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 40 }) }],
    });
    const fleetCap = memoryCodexFleetCapPort();
    await readCodexFleetSnapshot({
      fleetCap,
      home,
      nowIso: NOW,
      port: memoryPlanRegisterPort(),
      readLive: liveReaderFrom(),
      signInPort: memoryCodexSignInPort(),
    });

    expect((await readCodexFleetCapRecord({ home, port: fleetCap })).kind).toBe("record");
  });

  it("answers the store outage as an Err, never an empty fleet, and reads no live account nor files a cap record", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-unseen", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 40 }) }],
    });
    const asked: string[][] = [];
    const fakeLive = liveReaderFrom();
    const fleetCap = memoryCodexFleetCapPort();

    const read = await readCodexFleetSnapshot({
      fleetCap,
      home,
      nowIso: NOW,
      port: unavailablePlanRegisterPort(),
      readLive: (input) => {
        asked.push([...input.codexHomes]);
        return fakeLive(input);
      },
      signInPort: memoryCodexSignInPort(),
    });

    expect(unwrapErr(read).code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(asked).toEqual([]);
    expect((await readCodexFleetCapRecord({ home, port: fleetCap })).kind).toBe("absent");
  });

  // A rollout scan carries no deadline of its own, so under one it never runs and the live batch is the
  // meter. A batch the deadline shortened reads `unreadable` like a broken store, so the cap record is
  // keyed on the deadline, never on what it cut.
  it("asks the live batch to finish before the answer reserve, runs no scan, says so on every row, and files no cap record", async () => {
    const home = homeWith({
      rows: [
        { alias: "codex-first", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 40 }) },
        { alias: "codex-second", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 70 }) },
      ],
    });
    const asked: (number | undefined)[] = [];
    const fakeLive = liveReaderFrom();
    const fleetCap = memoryCodexFleetCapPort();
    const lines = renderCodexFleet({
      full: true,
      assessment: assessCodexFleet({
        requestedModel: MODEL,
        snapshot: unwrap(
          await readCodexFleetSnapshot({
            fleetCap,
            deadlineAtMs: DEADLINE_AT_MS,
            home,
            nowIso: NOW,
            port: memoryPlanRegisterPort(),
            readLive: (input) => {
              asked.push(input.deadlineAtMs);
              return fakeLive(input);
            },
            signInPort: memoryCodexSignInPort(),
          }),
        ),
      }),
    });

    expect(asked).toEqual([DEADLINE_AT_MS - 2_000]);
    expect(lines.filter((line) => line.includes(" · no cached email · "))).toEqual([
      expect.stringMatching(
        / · no cached email · rollout scan not run: under a caller's deadline the live read is the meter$/u,
      ),
      expect.stringMatching(
        / · no cached email · rollout scan not run: under a caller's deadline the live read is the meter$/u,
      ),
    ]);
    expect(lines.filter((line) => line.startsWith("  codex-second — "))).toEqual([
      "  codex-second — week unread, none reading, no dated reading",
    ]);
    expect((await readCodexFleetCapRecord({ home, port: fleetCap })).kind).toBe("absent");
  });
});
