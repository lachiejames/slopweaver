/**
 * The local cache of opened Datadog events, in an explicit temp home: an empty fetch creates nothing on disk,
 * fetched records read back exactly, only the ids asked for come back, a re-fetched id answers with its
 * NEWEST line, and blank, malformed and schema-invalid lines are skipped without costing the valid ones.
 */
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cacheRecords, readCachedRecords } from "../../../../datadog/detective/hitsCache.js";
import type { DatadogRecord } from "../../../../datadog/detective/record.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "datadog-hits-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One cached event, distinguished by id and text. */
function record({ id, text }: { id: string; text: string }): DatadogRecord {
  return {
    attributes: { http: { status_code: 502 } },
    env: "prod",
    family: "log",
    id,
    link: `https://app.datadoghq.com/logs?event=${id}`,
    occurredAtIso: "2026-10-01T03:04:05.000Z",
    service: "api",
    status: "error",
    text,
  };
}

describe("cacheRecords", () => {
  it("writes nothing at all for an empty fetch", () => {
    cacheRecords({ home, records: [] });

    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });
});

describe("readCachedRecords", () => {
  it("reads every cached record back exactly", () => {
    cacheRecords({
      home,
      records: [record({ id: "dd:log:A", text: "first" }), record({ id: "dd:log:B", text: "second" })],
    });

    expect([...readCachedRecords({ home, ids: ["dd:log:A", "dd:log:B"] }).entries()]).toEqual([
      [
        "dd:log:A",
        {
          attributes: { http: { status_code: 502 } },
          env: "prod",
          family: "log",
          id: "dd:log:A",
          link: "https://app.datadoghq.com/logs?event=dd:log:A",
          occurredAtIso: "2026-10-01T03:04:05.000Z",
          service: "api",
          status: "error",
          text: "first",
        },
      ],
      [
        "dd:log:B",
        {
          attributes: { http: { status_code: 502 } },
          env: "prod",
          family: "log",
          id: "dd:log:B",
          link: "https://app.datadoghq.com/logs?event=dd:log:B",
          occurredAtIso: "2026-10-01T03:04:05.000Z",
          service: "api",
          status: "error",
          text: "second",
        },
      ],
    ]);
  });

  it("returns only the ids asked for, and nothing for an empty ask or an empty home", () => {
    expect(readCachedRecords({ home, ids: ["dd:log:A"] }).size).toBe(0);

    cacheRecords({ home, records: [record({ id: "dd:log:A", text: "a" }), record({ id: "dd:log:B", text: "b" })] });

    expect([...readCachedRecords({ home, ids: ["dd:log:B", "dd:log:Z"] }).keys()]).toEqual(["dd:log:B"]);
    expect(readCachedRecords({ home, ids: [] }).size).toBe(0);
  });

  it("answers a re-fetched id with its newest line", () => {
    cacheRecords({ home, records: [record({ id: "dd:log:A", text: "first read" })] });
    cacheRecords({ home, records: [record({ id: "dd:log:A", text: "second read" })] });

    expect([...readCachedRecords({ home, ids: ["dd:log:A"] }).values()].map((found) => found.text)).toEqual([
      "second read",
    ]);
  });

  it("skips blank, malformed and schema-invalid lines and keeps every valid one", () => {
    cacheRecords({ home, records: [record({ id: "dd:log:A", text: "a" })] });
    const path = join(home, "datadog", "hits.jsonl");
    expect(existsSync(path)).toBe(true);
    appendFileSync(path, '\n   \n{not json\n{"id":"dd:log:B","family":"trace"}\n', "utf8");
    cacheRecords({ home, records: [record({ id: "dd:log:C", text: "c" })] });

    expect([...readCachedRecords({ home, ids: ["dd:log:A", "dd:log:B", "dd:log:C"] }).keys()]).toEqual([
      "dd:log:A",
      "dd:log:C",
    ]);
  });
});
