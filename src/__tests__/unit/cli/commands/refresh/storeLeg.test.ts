import { describe, expect, it } from "vitest";

import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import {
  FULL_REPLAY_SOURCES,
  runRefreshStoreStep,
  runStoreLeg,
  type StoreIngestSource,
  storeLegLine,
  storeLegScope,
  storeLegSources,
} from "../../../../../cli/commands/refresh/storeLeg.js";
import type { SourceIngestJob } from "../../../../../corpus/ingestJob.js";
import type { CorpusSource, ExportWindow } from "../../../../../corpus/types.js";
import { err, ok } from "../../../../../lib/result.js";

const job = ({ source, window }: { source: CorpusSource; window: ExportWindow }): SourceIngestJob => ({
  label: "stub",
  run: async () => ok({ records: [], warnings: [] }),
  source,
  window,
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

const WINDOW: ExportWindow = { since: "2026-09-12T15:31:00.000Z", until: "2026-09-14" };

describe("storeLegScope", () => {
  it("replays chatgpt's compact.jsonl too, since sync receipts on this leg, and every other source's windows", () => {
    expect([...FULL_REPLAY_SOURCES]).toEqual(["chatgpt"]);
    expect(storeLegScope({ source: "chatgpt" })).toBe("full");
    expect(storeLegScope({ source: "slack" })).toBe("windows");
  });
});

describe("storeLegSources", () => {
  it("names every job's source whose bronze write succeeded, in plan order", () => {
    expect(
      storeLegSources({
        jobs: [job({ source: "linear", window: WINDOW }), job({ source: "slack", window: WINDOW })],
        results: [result({ ok: true, source: "linear" }), result({ ok: true, source: "slack" })],
      }),
    ).toEqual(["linear", "slack"]);
  });

  it("skips a source whose bronze write failed, and one that has no result at all", () => {
    expect(
      storeLegSources({
        jobs: [
          job({ source: "linear", window: WINDOW }),
          job({ source: "slack", window: WINDOW }),
          job({ source: "notion", window: WINDOW }),
        ],
        results: [result({ ok: false, source: "linear" }), result({ ok: true, source: "slack" })],
      }),
    ).toEqual(["slack"]);
  });

  it("names a source once even when two jobs share it", () => {
    expect(
      storeLegSources({
        jobs: [job({ source: "github", window: WINDOW }), job({ source: "github", window: WINDOW })],
        results: [result({ ok: true, source: "github" })],
      }),
    ).toEqual(["github"]);
  });

  it("is empty when nothing succeeded", () => {
    expect(storeLegSources({ jobs: [job({ source: "linear", window: WINDOW })], results: [] })).toEqual([]);
  });
});

describe("storeLegLine", () => {
  it("says a source with no window file has nothing to replay, not that it failed", () => {
    expect(storeLegLine({ outcome: { kind: "absent" }, source: "linear" })).toBe(
      "--store: linear: no bronze window file to replay",
    );
  });

  it("reports rows stored against lines read and how many window files carried them", () => {
    expect(
      storeLegLine({
        outcome: {
          files: 4,
          kind: "ingested",
          linesRead: 40,
          omittedBytes: 0,
          omittedFiles: 0,
          refused: 0,
          stored: 38,
        },
        source: "linear",
      }),
    ).toBe("--store: linear: 38 row(s) stored from 40 line(s) across 4 window file(s)");
  });

  it("names the refusals only when there were any", () => {
    expect(
      storeLegLine({
        outcome: {
          files: 1,
          kind: "ingested",
          linesRead: 40,
          omittedBytes: 0,
          omittedFiles: 0,
          refused: 2,
          stored: 38,
        },
        source: "linear",
      }),
    ).toBe("--store: linear: 38 row(s) stored from 40 line(s) across 1 window file(s) · 2 refused");
  });

  it("states the omitted canonical file even on a pass that stored nothing, because it bounds the claim", () => {
    expect(
      storeLegLine({
        outcome: {
          files: 2,
          kind: "ingested",
          linesRead: 0,
          omittedBytes: 6899158625,
          omittedFiles: 1,
          refused: 0,
          stored: 0,
        },
        source: "slack",
      }),
    ).toBe(
      "--store: slack: 0 row(s) stored from 0 line(s) across 2 window file(s) · " +
        "compact.jsonl not replayed (6899158625 bytes)",
    );
  });
});

describe("runStoreLeg", () => {
  const sink = (): { sink: RefreshDeps["logger"]; out: string[]; errors: string[] } => {
    const out: string[] = [];
    const errors: string[] = [];
    return {
      errors,
      out,
      sink: {
        error: ({ msg }) => errors.push(msg),
        info: () => {},
        out: ({ line }) => out.push(line),
        warn: () => {},
      },
    };
  };
  const sources: readonly CorpusSource[] = ["linear", "slack"];

  it("replays every source in order and answers true when all of them landed or had nothing", async () => {
    const captured = sink();
    const asked: CorpusSource[] = [];
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async ({ source }) => {
        asked.push(source);
        return ok(
          source === "slack"
            ? { kind: "absent" }
            : {
                files: 3,
                kind: "ingested",
                linesRead: 3,
                omittedBytes: 0,
                omittedFiles: 0,
                refused: 0,
                stored: 3,
              },
        );
      },
      sink: captured.sink,
      sources,
    });
    expect(reached).toEqual({ failures: [] });
    expect(asked).toEqual(["linear", "slack"]);
    expect(captured.out).toEqual([
      "--store: linear: 3 row(s) stored from 3 line(s) across 3 window file(s)",
      "--store: slack: no bronze window file to replay",
    ]);
  });

  it("keeps going past a source the store refused, prints it in the store's words, and returns every reason", async () => {
    const captured = sink();
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async ({ source }) =>
        source === "linear"
          ? err(["store ingest of linear failed: connection refused", "pool closed"])
          : ok({
              files: 1,
              kind: "ingested",
              linesRead: 1,
              omittedBytes: 0,
              omittedFiles: 0,
              refused: 0,
              stored: 1,
            }),
      sink: captured.sink,
      sources,
    });
    expect(reached).toEqual({
      failures: [
        { reason: "store ingest of linear failed: connection refused", source: "linear" },
        { reason: "pool closed", source: "linear" },
      ],
    });
    expect(captured.errors).toEqual([
      "--store: linear: store ingest of linear failed: connection refused",
      "--store: linear: pool closed",
    ]);
    expect(captured.out).toEqual(["--store: slack: 1 row(s) stored from 1 line(s) across 1 window file(s)"]);
  });

  it("fails on a refused chatgpt row, whose receipt waits on this leg, and only reports one for any other source", async () => {
    const captured = sink();
    const withRefusal = {
      files: 1,
      kind: "ingested" as const,
      linesRead: 10,
      omittedBytes: 0,
      omittedFiles: 0,
      refused: 1,
      stored: 9,
    };
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async () => ok(withRefusal),
      sink: captured.sink,
      sources: ["slack", "chatgpt"],
    });
    expect(reached).toEqual({
      failures: [{ reason: "9 row(s) stored from 10 line(s) across 1 window file(s) · 1 refused", source: "chatgpt" }],
    });
    expect(captured.out).toEqual([
      "--store: slack: 9 row(s) stored from 10 line(s) across 1 window file(s) · 1 refused",
    ]);
    expect(captured.errors).toEqual([
      "--store: chatgpt: 9 row(s) stored from 10 line(s) across 1 window file(s) · 1 refused",
    ]);
    const slackOnly = sink();
    expect(
      await runStoreLeg({
        home: "/home",
        numbersOnly: false,
        ingest: async () => ok(withRefusal),
        sink: slackOnly.sink,
        sources: ["slack"],
      }),
    ).toEqual({ failures: [] });
  });

  it("reports a protect-list withheld source without failing, bar a full-replay one whose receipt waits on it", async () => {
    const captured = sink();
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async () => ok({ kind: "withheld" }),
      sink: captured.sink,
      sources: ["slack", "chatgpt"],
    });
    const said = "not replayed — its bronze is no-access on the owner's protect list (`slopweaver protect list`)";
    expect(reached).toEqual({ failures: [{ reason: said, source: "chatgpt" }] });
    expect(captured.out).toEqual([`--store: slack: ${said}`]);
    expect(captured.errors).toEqual([`--store: chatgpt: ${said}`]);
  });

  it("still fails a replay that failed with no words, on a stated reason", async () => {
    const captured = sink();
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async () => err([]),
      sink: captured.sink,
      sources: ["slack"],
    });
    expect(reached).toEqual({
      failures: [{ reason: "the store replay failed without an error message", source: "slack" }],
    });
    expect(captured.errors).toEqual(["--store: slack: the store replay failed without an error message"]);
  });

  it("still fails a replay whose error list holds only holes or blanks", async () => {
    // One hole and no element: `filter` skips it, so the reason list it yields is empty.
    const holed: string[] = [];
    holed.length = 1;
    for (const reasons of [holed, ["", "  "]]) {
      const captured = sink();
      const reached = await runStoreLeg({
        home: "/home",
        numbersOnly: false,
        ingest: async () => err(reasons),
        sink: captured.sink,
        sources: ["slack"],
      });
      expect(reached).toEqual({
        failures: [{ reason: "the store replay failed without an error message", source: "slack" }],
      });
    }
  });

  it("fails a replay that throws on its own words, and carries on to the next source", async () => {
    const captured = sink();
    const reached = await runStoreLeg({
      home: "/home",
      numbersOnly: false,
      ingest: async ({ source }) => {
        if (source === "slack") {
          throw new Error("the store connection closed mid-replay");
        }
        return ok({ kind: "absent" });
      },
      sink: captured.sink,
      sources: ["slack", "github"],
    });
    expect(reached).toEqual({ failures: [{ reason: "the store connection closed mid-replay", source: "slack" }] });
    expect(captured.errors).toEqual(["--store: slack: the store connection closed mid-replay"]);
    expect(captured.out).toEqual(["--store: github: no bronze window file to replay"]);
  });

  it("reports no failure over no sources at all", async () => {
    const captured = sink();
    expect(
      await runStoreLeg({
        home: "/home",
        numbersOnly: false,
        ingest: async () => ok({ kind: "absent" }),
        sink: captured.sink,
        sources: [],
      }),
    ).toEqual({ failures: [] });
    expect(captured.out).toEqual([]);
  });

  describe("runRefreshStoreStep", () => {
    const planned = {
      home: "/home",
      jobs: [job({ source: "linear", window: WINDOW }), job({ source: "slack", window: WINDOW })],
      numbersOnly: false,
      results: [result({ ok: false, source: "linear" }), result({ ok: true, source: "slack" })],
    };
    const recording = (): { asked: CorpusSource[]; ingest: StoreIngestSource } => {
      const asked: CorpusSource[] = [];
      const ingest: StoreIngestSource = async ({ source }) => {
        asked.push(source);
        return ok({ kind: "absent" });
      };
      return { asked, ingest };
    };

    it("does nothing and fails nothing when --store was not passed", async () => {
      const captured = sink();
      const { asked, ingest } = recording();
      const stored = await runRefreshStoreStep({
        ...planned,
        deps: { logger: captured.sink, storeIngest: ingest },
        store: false,
      });
      expect(stored).toEqual({ failures: [] });
      expect(asked).toEqual([]);
      expect(captured.errors).toEqual([]);
    });

    it("fails the leg, naming no source, when --store was asked for with no seam wired", async () => {
      const captured = sink();
      const stored = await runRefreshStoreStep({ ...planned, deps: { logger: captured.sink }, store: true });
      const reason = "this run has no store seam wired, so nothing can reach the store";
      expect(stored).toEqual({ failures: [{ reason, source: null }] });
      expect(captured.errors).toEqual([`--store: ${reason}`]);
    });

    it("replays only the sources whose bronze write succeeded", async () => {
      const captured = sink();
      const { asked, ingest } = recording();
      const stored = await runRefreshStoreStep({
        ...planned,
        deps: { logger: captured.sink, storeIngest: ingest },
        store: true,
      });
      expect(stored).toEqual({ failures: [] });
      expect(asked).toEqual(["slack"]);
      expect(captured.out).toEqual(["--store: slack: no bronze window file to replay"]);
    });
  });
});
