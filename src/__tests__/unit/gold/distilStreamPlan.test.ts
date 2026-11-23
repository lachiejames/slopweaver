import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { censusCorpus } from "../../../corpus/corpusCensus.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { latestRecords } from "../../../corpus/latestRecords.js";
import { withRowReader } from "../../../corpus/rowReader.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { DISTIL_PROMPT_FINGERPRINT } from "../../../gold/distil.js";
import { groupForDistil } from "../../../gold/distilGroup.js";
import {
  censusCountsBySource,
  censusRecordsFor,
  materialiseBatch,
  planDistilFromCensus,
} from "../../../gold/distilStreamPlan.js";
import { ok, unwrap } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const message = ({
  n,
  container,
  text = `message ${String(n)} ${"words ".repeat(n % 7)}`,
}: {
  n: number;
  container: string;
  text?: string;
}): CorpusRecord => ({
  container,
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: `${String(n)}.0`,
  text,
  tsIso: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  url: `https://example.test/${container}/${String(n)}`,
});

/**
 * A corpus big enough to cut several batches per container, with edits (a later row per edited identity,
 * some in a LATER window file) and a raw-only tie, so the plan has to collapse before it cuts.
 */
function seedCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "distil-stream-"));
  dirs.push(dir);
  mkdirSync(join(dir, "slack"), { recursive: true });
  mkdirSync(join(dir, "github"), { recursive: true });
  const busy = Array.from({ length: 140 }, (_, n) => message({ container: "C-busy", n }));
  const quiet = Array.from({ length: 12 }, (_, n) => message({ container: "C-quiet", n }));
  const edits = [3, 40, 41, 99].map((n) => ({
    ...message({ container: "C-busy", n, text: `edited ${String(n)}` }),
    tsIso: new Date(Date.UTC(2026, 0, 2, 0, n)).toISOString(),
  }));
  const rawTie = [
    { ...message({ container: "C-quiet", n: 5 }), raw: { a: 1 } },
    { ...message({ container: "C-quiet", n: 5 }), raw: { a: 1, b: "longer" } },
  ];
  const write = ({ path, rows }: { path: string; rows: readonly CorpusRecord[] }): void => {
    writeFileSync(join(dir, path), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  };
  write({ path: "slack/2026-01-01_2026-01-02.jsonl", rows: [...busy, ...quiet, ...edits.slice(0, 2)] });
  write({ path: "slack/2026-01-02_2026-01-03.jsonl", rows: [...edits.slice(2), ...rawTie] });
  write({
    path: "github/2026-01-01_2026-02-01.jsonl",
    rows: [{ ...message({ container: "acme/web", n: 1 }), kind: "pr", source: "github", sourceId: "#1" }],
  });
  return dir;
}

const OPTION_SETS = [
  {},
  { targetPerBatch: 10 },
  { targetPerBatch: 10, topContainersPerSource: 1 },
  { recentOnly: true, targetPerBatch: 25 },
] as const;

describe("planDistilFromCensus — the plan groupForDistil made from a whole-corpus read", () => {
  it.each(OPTION_SETS)("cuts the same batches, in the same order, with the same keys (%o)", (options) => {
    const dir = seedCorpus();
    const expected = groupForDistil({
      promptVersion: DISTIL_PROMPT_FINGERPRINT,
      records: latestRecords({
        records: unwrap(readCorpusDir({ dir, home: dir, projection: "bronze", protection: NO_ENTRIES })).records,
      }),
      ...options,
    });
    const planned = withRowReader({
      run: (reader) => {
        const census = unwrap(
          censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" }),
        );
        return unwrap(
          planDistilFromCensus({ census, promptVersion: DISTIL_PROMPT_FINGERPRINT, reader, ...options }),
        ).map((batch) => unwrap(materialiseBatch({ batch, reader })));
      },
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(planned.map((b) => [b.source, b.container, b.hash])).toEqual(
      expected.map((b) => [b.source, b.container, b.hash]),
    );
    // What the model is handed: the same records, minus the `raw` payload no prompt reads.
    expect(planned.map((b) => b.records)).toEqual(expected.map((b) => b.records.map(({ raw: _raw, ...rest }) => rest)));
  });

  it("cuts more than one batch in the busy container at a small target, so boundaries are exercised", () => {
    const dir = seedCorpus();
    const planned = withRowReader({
      run: (reader) =>
        unwrap(
          planDistilFromCensus({
            census: unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" })),
            promptVersion: DISTIL_PROMPT_FINGERPRINT,
            reader,
            targetPerBatch: 10,
          }),
        ),
    });
    expect(planned.filter((b) => b.container === "C-busy").length).toBeGreaterThan(5);
  });
});

describe("censusRecordsFor and censusCountsBySource", () => {
  it("reads back only the refs the census holds, in ref order", () => {
    const dir = seedCorpus();
    const texts = withRowReader({
      run: (reader) =>
        unwrap(
          censusRecordsFor({
            census: unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" })),
            reader,
            refs: [
              { container: "C-busy", source: "slack", sourceId: "40.0" },
              { container: "C-busy", source: "slack", sourceId: "no-such" },
              { container: "C-quiet", source: "slack", sourceId: "1.0" },
            ],
          }),
        ).map((r) => r.text),
    });
    expect(texts).toEqual(["edited 40", "message 1 words "]);
  });

  it("counts logical records per source", () => {
    const dir = seedCorpus();
    const counts = withRowReader({
      run: (reader) =>
        censusCountsBySource({
          census: unwrap(censusCorpus({ dir, home: dir, protection: NO_ENTRIES, reader, tieProjection: "bronze" })),
        }),
    });
    expect([...counts]).toEqual([
      ["github", 1],
      ["slack", 152],
    ]);
  });
});
