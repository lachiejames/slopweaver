/**
 * `writeSeriesPayload` — the `{ "series": [...] }` file `datadog produce` writes and `datadog submit --series FILE`
 * reads. A round trip through a throwaway directory: what is under test is the bytes on disk.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SubmittedSeries } from "../../../datadog/seriesPayload.js";
import { writeSeriesPayload } from "../../../datadog/seriesPayloadFile.js";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A fresh directory, removed after the test. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "series-payload-"));
  dirs.push(dir);
  return dir;
}

const GAUGE: SubmittedSeries = { metric: "acme.delivery.open", points: [[1, 465]], tags: ["team:all"], type: "gauge" };
const COUNT: SubmittedSeries = {
  interval: 86_400,
  metric: "acme.delivery.merged",
  points: [[1, 147]],
  tags: ["team:all"],
  type: "count",
};

describe("writeSeriesPayload", () => {
  it("writes every series in order, gauges and counts alike, creating the directory it lands in", () => {
    const out = join(freshDir(), "nested", "day.json");
    writeSeriesPayload({ out, series: [GAUGE, COUNT] });
    expect(readFileSync(out, "utf8")).toBe(
      '{"series":[' +
        '{"metric":"acme.delivery.open","points":[[1,465]],"tags":["team:all"],"type":"gauge"},' +
        '{"interval":86400,"metric":"acme.delivery.merged","points":[[1,147]],"tags":["team:all"],"type":"count"}' +
        "]}\n",
    );
  });

  it("writes an empty series list as a well-formed document", () => {
    const out = join(freshDir(), "empty.json");
    writeSeriesPayload({ out, series: [] });
    expect(readFileSync(out, "utf8")).toBe('{"series":[]}\n');
  });
});
