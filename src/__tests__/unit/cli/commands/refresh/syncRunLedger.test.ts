import { describe, expect, it } from "vitest";
import {
  parseRefreshOptions,
  type RefreshOptions,
  type RefreshResult,
} from "../../../../../cli/commands/refresh/core.js";
import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import { ingestUnderSyncRun, syncRunOutcomeOf } from "../../../../../cli/commands/refresh/syncRunLedger.js";
import { coverageGap, type SourceIngestJob, type SourceIngestResult } from "../../../../../corpus/ingestJob.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { currentSyncRunObserver } from "../../../../../syncRun/observerScope.js";
import type { SyncRunOutcome, SyncRunRecorder } from "../../../../../syncRun/recorder.js";

const result = (over: Partial<RefreshResult>): RefreshResult => ({
  deduped: 0,
  errors: [],
  ok: true,
  projected: 0,
  source: "github",
  warnings: [],
  written: 0,
  ...over,
});

/** What the ingest itself hands back, every optional of `RefreshResult` present. */
const ingested = (over: Partial<SourceIngestResult>): SourceIngestResult => ({
  deduped: 0,
  errors: [],
  excluded: 0,
  gaps: [],
  notes: [],
  ok: true,
  projected: 0,
  source: "github",
  warnings: [],
  written: 0,
  ...over,
});

const optionsFor = ({ rest }: { rest: readonly string[] }): RefreshOptions => unwrap(parseRefreshOptions({ rest }));

type IngestArgs = Parameters<RefreshDeps["ingestSources"]>[0];

/** A recorder that notes every closing call; its observer is a distinct plain object so a scope can be recognised. */
const fakeRecorder = (): { recorder: SyncRunRecorder; finished: (readonly SyncRunOutcome[])[] } => {
  const finished: (readonly SyncRunOutcome[])[] = [];
  const recorder: SyncRunRecorder = {
    finish: ({ outcomes }) => {
      finished.push(outcomes);
    },
    observer: { commit: () => undefined, progress: () => undefined },
  };
  return { finished, recorder };
};

describe("syncRunOutcomeOf", () => {
  it("carries the counts a result reports and reads omitted optionals as zero", () => {
    const outcome = syncRunOutcomeOf({
      result: result({ deduped: 4, errors: ["boom"], ok: false, source: "slack", warnings: ["w1", "w2"], written: 9 }),
    });
    expect(outcome).toEqual({
      deduped: 4,
      errors: ["boom"],
      excluded: 0,
      gaps: 0,
      ok: false,
      source: "slack",
      warnings: 2,
      written: 9,
    });
  });

  it("counts excluded records and coverage gaps when the result carries them", () => {
    const gap = coverageGap({ message: "C1 not readable" });
    const outcome = syncRunOutcomeOf({ result: result({ excluded: 7, gaps: [gap, gap, gap] }) });
    expect(outcome.excluded).toBe(7);
    expect(outcome.gaps).toBe(3);
  });
});

describe("ingestUnderSyncRun", () => {
  const jobs: readonly SourceIngestJob[] = [];

  it("runs the ingest with no ledger wired, returns its results and passes the bounds through", async () => {
    const calls: IngestArgs[] = [];
    const results = await ingestUnderSyncRun({
      deps: {
        ingestSources: (args) => {
          calls.push(args);
          return Promise.resolve(ok([ingested({ written: 2 })]));
        },
      },
      home: "/fixture-home",
      jobs,
      options: optionsFor({ rest: ["--sample", "3", "--fetch-cap", "10"] }),
    });
    expect(results.map((r) => r.written)).toEqual([2]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.home).toBe("/fixture-home");
    expect(calls[0]!.sample).toBe(3);
    expect(calls[0]!.boundedFetch).toBe(true);
  });

  it("leaves the fetch unbounded when neither flag is given", async () => {
    const calls: IngestArgs[] = [];
    await ingestUnderSyncRun({
      deps: {
        ingestSources: (args) => {
          calls.push(args);
          return Promise.resolve(ok([]));
        },
      },
      home: "/fixture-home",
      jobs,
      options: optionsFor({ rest: [] }),
    });
    expect(calls[0]!.sample).toBeUndefined();
    expect(calls[0]!.boundedFetch).toBeUndefined();
  });

  it("installs the recorder's observer around the ingest and closes the ledger with each outcome", async () => {
    const { finished, recorder } = fakeRecorder();
    let seen: unknown;
    const results = await ingestUnderSyncRun({
      deps: {
        ingestSources: () => {
          seen = currentSyncRunObserver();
          return Promise.resolve(
            ok([ingested({ source: "slack", written: 5 }), ingested({ source: "linear", written: 1 })]),
          );
        },
        openSyncRun: () => recorder,
      },
      home: "/fixture-home",
      jobs,
      options: optionsFor({ rest: [] }),
    });
    expect(seen).toBe(recorder.observer);
    expect(results.map((r) => r.source)).toEqual(["slack", "linear"]);
    expect(finished.map((outcomes) => outcomes.map((o) => `${o.source}:${String(o.written)}`))).toEqual([
      ["slack:5", "linear:1"],
    ]);
  });

  it("reads a failed ingest as every planned source failed, each once, and closes the ledger with them", async () => {
    const { finished, recorder } = fakeRecorder();
    const job = ({ source }: { source: SourceIngestJob["source"] }): SourceIngestJob => ({
      label: "stub",
      run: async () => ok({ records: [], warnings: [] }),
      source,
      window: { since: "2026-10-17T00:00:00.000Z", until: "2026-10-17" },
    });
    const results = await ingestUnderSyncRun({
      deps: { ingestSources: () => Promise.resolve(err(["refused"])), openSyncRun: () => recorder },
      home: "/fixture-home",
      jobs: [job({ source: "slack" }), job({ source: "linear" }), job({ source: "slack" })],
      options: optionsFor({ rest: [] }),
    });
    expect(results).toEqual([
      result({ errors: ["refused"], ok: false, source: "slack" }),
      result({ errors: ["refused"], ok: false, source: "linear" }),
    ]);
    expect(finished.map((outcomes) => outcomes.map((o) => `${o.source}:${String(o.ok)}`))).toEqual([
      ["slack:false", "linear:false"],
    ]);
  });

  it("reads a throwing ingest as every planned source failed with its message, and closes the ledger", async () => {
    const { finished, recorder } = fakeRecorder();
    const results = await ingestUnderSyncRun({
      deps: {
        ingestSources: () => {
          throw new Error("ingest blew up");
        },
        openSyncRun: () => recorder,
      },
      home: "/fixture-home",
      jobs: [
        {
          label: "stub",
          run: async () => ok({ records: [], warnings: [] }),
          source: "slack",
          window: { since: "2026-10-17T00:00:00.000Z", until: "2026-10-17" },
        },
      ],
      options: optionsFor({ rest: [] }),
    });
    expect(results).toEqual([result({ errors: ["ingest blew up"], ok: false, source: "slack" })]);
    expect(finished.map((outcomes) => outcomes.map((o) => `${o.source}:${String(o.ok)}`))).toEqual([["slack:false"]]);
  });
});
