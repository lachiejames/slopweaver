/*
 * The scheduled sweep's classify and finish stages, each driven directly: a candidate is classified against the
 * reply-eligible channels, and the finish persists the watermark and picks the exit code completeness and the
 * captured survivors demand. A real temp home, a plain fake read seam, an injected instant.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyWorkspace } from "../../../../../cli/commands/listen/scheduledClassify.js";
import { finishSweep } from "../../../../../cli/commands/listen/scheduledFinish.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { unwrap } from "../../../../../lib/result.js";
import { recoveryWindow } from "../../../../../live/listen/recoverSchedule.js";
import { readRecoverySweepState } from "../../../../../live/listen/recoverScheduleStore.js";
import { BASE_OPTIONS, BOT, listOnlyC1, NOW_MS } from "./scheduledRecoverFakes.js";

const WINDOW = unwrap(
  recoveryWindow({ bootstrapSinceIso: BASE_OPTIONS.sinceIso, completedThroughTs: undefined, nowMs: NOW_MS }),
);

/** A read seam serving no channels and no messages: a complete, empty scan. */
const EMPTY_API: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
  history: async () => ({ messages: [] }),
  listChannels: async () => ({ channels: [] }),
  replies: async () => ({ messages: [] }),
};

/** A read seam whose only channel, C1, holds one root tagging the bot. */
const TAGGED_API: Pick<SlackApi, "history" | "replies" | "listChannels"> = {
  history: async () => ({ messages: [{ text: `<@${BOT}> help`, ts: "1786400000.000100", user: "U_ASKER" }] }),
  listChannels: listOnlyC1,
  replies: async () => ({ messages: [{ ts: "1786400000.000100", user: "U_ASKER" }] }),
};

describe("scheduled sweep stages", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-scheduled-leaves-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * Classify the window over one read seam, answering only in the channels given.
   *
   * @param api the fake read seam the scan pages
   * @param channels the channels the bot may answer in
   * @returns what `classifyWorkspace` produced
   */
  function classify({
    api,
    channels,
  }: {
    api: Pick<SlackApi, "history" | "replies" | "listChannels">;
    channels: readonly string[];
  }): ReturnType<typeof classifyWorkspace> {
    return classifyWorkspace({
      api,
      botUserId: BOT,
      channels,
      home,
      incidents: BASE_OPTIONS.incidents,
      nowMs: NOW_MS,
      selfBotId: undefined,
      threadCheckpoints: {},
      window: WINDOW,
    });
  }

  it("classifies a tag in an allowed channel as recoverable, on a complete scan", async () => {
    const { classification, report, scan } = await classify({ api: TAGGED_API, channels: ["C1"] });

    expect(scan.complete).toBe(true);
    expect(report.recoverable.map((verdict) => verdict.candidate.rawText)).toEqual([`<@${BOT}> help`]);
    expect(classification.since).toBe(WINDOW.sinceIso);
  });

  it("finds nothing recoverable when the tag sits in a channel the bot may not answer in", async () => {
    const { report } = await classify({ api: TAGGED_API, channels: ["C_OTHER"] });

    expect(report.recoverable).toEqual([]);
  });

  it("persists the window's latest bound and reports an empty complete sweep as expected-empty", async () => {
    const { report, scan } = await classify({ api: EMPTY_API, channels: ["C1"] });

    const code = finishSweep({
      home,
      incidents: scan.incidents,
      migrating: true,
      nowMs: NOW_MS,
      previous: undefined,
      recovered: [],
      report,
      scan,
      strandedCaptured: 0,
      window: WINDOW,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readRecoverySweepState({ home }))).toEqual({
      completedThroughTs: "1786622400.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: {},
      version: 2,
    });
  });

  it("reports work to do when only the stranded lane picked something up", async () => {
    const { report, scan } = await classify({ api: EMPTY_API, channels: ["C1"] });

    const code = finishSweep({
      home,
      incidents: scan.incidents,
      migrating: true,
      nowMs: NOW_MS,
      previous: undefined,
      recovered: [],
      report,
      scan,
      strandedCaptured: 1,
      window: WINDOW,
    });

    expect(code).toBe(EXIT_OK);
  });

  it("reports a partial migrating sweep as an error and writes the missing state back as V1", async () => {
    const { report, scan } = await classify({ api: EMPTY_API, channels: ["C1"] });

    const code = finishSweep({
      home,
      incidents: scan.incidents,
      migrating: true,
      nowMs: NOW_MS,
      previous: undefined,
      recovered: [],
      report,
      scan: { ...scan, complete: false },
      strandedCaptured: 1,
      window: WINDOW,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readRecoverySweepState({ home }))).toEqual({ nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 });
  });
});
