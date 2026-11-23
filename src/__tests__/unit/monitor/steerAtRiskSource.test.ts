/**
 * `readSteerAtRisk` over a real temp home: a journal with no steer is never decoded, a steered row whose document is
 * missing is named as a blind spot rather than judged clean, and a `runs/` that will not list is unmeasurable.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSteerAtRisk } from "../../../monitor/steerAtRiskSource.js";
import { stateHomePaths } from "../../../stateHome.js";

const NOW = "2026-10-22T04:01:12.000Z";
const RULING = {
  anchor: "transcript:redacted#owner-turn",
  atIso: "2026-10-22T03:51:30.000Z",
  kind: "ruling",
  ruling: "overriding the previous guidance: post the next cut by 4pm",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "steer-source-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write one run journal of `lines` under `slug`. */
function journal({ slug, lines }: { slug: string; lines: readonly Record<string, unknown>[] }): void {
  const runs = stateHomePaths({ home }).runs;
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, `${slug}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

describe("readSteerAtRisk", () => {
  it("is unmeasurable when the run journals directory will not list", () => {
    const reading = readSteerAtRisk({ home, nowIso: NOW });
    expect(reading.state).toBe("unmeasurable");
    expect(JSON.stringify(reading)).toContain("the run journals directory could not be listed");
  });

  it("is clear over a journal that carries no steer", () => {
    journal({ lines: [RULING], slug: "plain-row" });
    expect(readSteerAtRisk({ home, nowIso: NOW }).state).toBe("clear");
  });

  it("names a steered row whose document is not filed, rather than judging it clean", () => {
    journal({
      lines: [{ ...RULING, explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" } }],
      slug: "steered-row",
    });
    const reading = readSteerAtRisk({ home, nowIso: NOW });
    expect(reading.state).toBe("unmeasurable");
    expect(JSON.stringify(reading)).toContain("steered-row: no document is filed under that slug");
  });
});
