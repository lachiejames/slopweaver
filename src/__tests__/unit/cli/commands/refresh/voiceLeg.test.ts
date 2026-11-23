/**
 * The refresh leg that measures the owner's voice register: when it runs, what it prints, and which outcomes fail the run.
 */
import { describe, expect, it } from "vitest";

import { refreshFailureClosingLine } from "../../../../../cli/commands/refresh/failureClosingLine.js";
import {
  type MeasureVoice,
  runRefreshVoiceStep,
  voiceLegVerdict,
} from "../../../../../cli/commands/refresh/voiceLeg.js";
import type { CorpusSource } from "../../../../../corpus/types.js";
import { err, ok } from "../../../../../lib/result.js";
import { measureSlackVoice } from "../../../../../profile/voiceMeasure.js";
import { VoiceMeasureErrors } from "../../../../../profile/voiceMeasureErrors.js";

const NOW = "2026-11-05T05:00:00.000Z";
const OWNER = "U0SYNOWNER1";

/** A measurement of two messages of the owner's, one of them a DM. */
const MEASUREMENT = measureSlackVoice({
  nowIso: NOW,
  ownerUserId: OWNER,
  records: ["C0SYNCHAN01", "D0SYNDMCH01"].map((channel, index) => ({
    author: OWNER,
    container: `slack/${channel}`,
    kind: "message" as const,
    raw: { text: "three words here" },
    refs: [],
    source: "slack" as const,
    sourceId: `${channel}:${String(index)}`,
    text: "three words here",
    tsIso: NOW,
    url: `https://acme.slack.com/archives/${channel}/p${String(index)}`,
  })),
});

const result = ({ source, ok: succeeded }: { source: CorpusSource; ok: boolean }) => ({
  deduped: 0,
  errors: [],
  ok: succeeded,
  projected: 1,
  source,
  warnings: [],
  written: succeeded ? 1 : 0,
});

/** A logger that records each level, and a seam that records each call. */
function deck({ measure }: { measure?: MeasureVoice }): {
  deps: Parameters<typeof runRefreshVoiceStep>[0]["deps"];
  out: string[];
  errors: string[];
  calls: string[];
} {
  const out: string[] = [];
  const errors: string[] = [];
  const calls: string[] = [];
  return {
    calls,
    deps: {
      logger: {
        error: ({ msg }) => errors.push(msg),
        info: () => {},
        out: ({ line }) => out.push(line),
        warn: ({ msg }) => errors.push(msg),
      },
      ...(measure === undefined
        ? {}
        : {
            measureVoice: async (args) => {
              calls.push(`${args.home}@${args.nowIso}`);
              return measure(args);
            },
          }),
      nowDate: () => new Date(NOW),
    },
    errors,
    out,
  };
}

describe("voiceLegVerdict", () => {
  it("prints the cohorts it wrote and fails nothing", () => {
    const verdict = voiceLegVerdict({
      numbersOnly: false,
      outcome: ok({ filesRead: 1, kind: "written", measurement: MEASUREMENT }),
    });
    expect(verdict).toStrictEqual({
      failures: [],
      lines: [{ level: "out", text: "voice: measured their sent Slack — slack/all-sent n=2, slack-dm/aggregate n=1" }],
    });
  });

  it("prints a skip and keeps the exit code", () => {
    const verdict = voiceLegVerdict({
      numbersOnly: false,
      outcome: ok({ kind: "no-store", measurement: MEASUREMENT, message: "no store is selected" }),
    });
    expect(verdict).toStrictEqual({
      failures: [],
      lines: [{ level: "out", text: "voice: nothing measured — no store is selected" }],
    });
  });

  it("prints a missing owner row as a skip, not a failure", () => {
    const verdict = voiceLegVerdict({
      numbersOnly: false,
      outcome: ok({
        kind: "skipped",
        measurement: MEASUREMENT,
        message: "no owner row has been written yet",
        reason: "owner-row-absent",
      }),
    });
    expect(verdict).toStrictEqual({
      failures: [],
      lines: [{ level: "out", text: "voice: nothing measured — no owner row has been written yet" }],
    });
  });

  it("fails on a read or write failure, withholding the reason under --numbers-only", () => {
    const failure = VoiceMeasureErrors.storeFailed({ detail: "connect ECONNREFUSED 127.0.0.1:54322" });
    expect(voiceLegVerdict({ numbersOnly: true, outcome: err(failure) })).toStrictEqual({
      failures: [{ reason: failure.message, source: "slack" }],
      lines: [{ level: "error", text: "voice: [withheld]" }],
    });
  });
});

describe("runRefreshVoiceStep", () => {
  const written: MeasureVoice = async () => ok({ filesRead: 1, kind: "written", measurement: MEASUREMENT });

  it("measures after a Slack ingest that succeeded, under this run's home and clock", async () => {
    const edges = deck({ measure: written });
    const leg = await runRefreshVoiceStep({
      deps: edges.deps,
      home: "/h",
      numbersOnly: false,
      results: [result({ ok: true, source: "slack" })],
    });
    expect(leg.failures).toEqual([]);
    expect(edges.calls).toEqual([`/h@${NOW}`]);
    expect(edges.out).toEqual(["voice: measured their sent Slack — slack/all-sent n=2, slack-dm/aggregate n=1"]);
  });

  it("does not measure when Slack ingest failed, or Slack was not refreshed at all", async () => {
    const edges = deck({ measure: written });
    await runRefreshVoiceStep({
      deps: edges.deps,
      home: "/h",
      numbersOnly: false,
      results: [result({ ok: false, source: "slack" }), result({ ok: true, source: "linear" })],
    });
    expect(edges.calls).toEqual([]);
    expect(edges.out).toEqual([]);
  });

  it("runs no leg when the deck wires no seam", async () => {
    const edges = deck({});
    const leg = await runRefreshVoiceStep({
      deps: edges.deps,
      home: "/h",
      numbersOnly: false,
      results: [result({ ok: true, source: "slack" })],
    });
    expect(leg.failures).toEqual([]);
    expect(edges.out).toEqual([]);
  });

  it("folds a seam that throws into a failure rather than escaping the closing line", async () => {
    const edges = deck({
      measure: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const leg = await runRefreshVoiceStep({
      deps: edges.deps,
      home: "/h",
      numbersOnly: false,
      results: [result({ ok: true, source: "slack" })],
    });
    expect(leg.failures.map((failure) => failure.source)).toEqual(["slack"]);
    expect(edges.errors.join(" ")).toContain("EACCES: permission denied");
  });
});

describe("refreshFailureClosingLine — the voice leg", () => {
  it("names the voice leg between the store and hydration", () => {
    expect(
      refreshFailureClosingLine({
        deriveFailures: [],
        hydrationFailures: [{ lane: "members", reason: "boom" }],
        numbersOnly: false,
        results: [],
        storeFailures: [{ reason: "refused", source: "slack" }],
        voiceFailures: [{ reason: "the voice register could not be written: x", source: "slack" }],
      }),
    ).toBe(
      "refresh failed: store: slack: refused; voice: slack: the voice register could not be written: x; members: boom",
    );
  });
});
