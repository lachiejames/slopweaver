/**
 * `machine series`'s shell: `--help`, a bad flag, the human lines and the `--json` window, over fixture seams and
 * a temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MACHINE_SERIES_USAGE, runMachineSeriesWithDeps } from "../../../../../cli/commands/machine/series.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";
import { fixtureDeps, SESSION_ID, TOP_TEXT } from "../../../live/machine/seriesFixtures.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "series-cli-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

/** `slopweaver machine series <tail>`: the tail starts at argv index 4. */
const argvOf = ({ tail }: { tail: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "machine",
  "series",
  ...tail,
];

const nowIso = (): string => "2026-10-17T20:00:01.000Z";

describe("machine series", () => {
  it("prints its usage on --help", async () => {
    const { log, out } = captureLogger();
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--help"] }),
      deps: fixtureDeps().deps,
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([MACHINE_SERIES_USAGE]);
  });

  it("refuses an unknown flag before sampling", async () => {
    const { deps, topCalls } = fixtureDeps();
    const { log, errs } = captureLogger();
    const code = await runMachineSeriesWithDeps({ argv: argvOf({ tail: ["--nope"] }), deps, log, nowIso });
    expect(code).toBe(EXIT_USAGE);
    expect(errs).toEqual(["unknown flag: --nope", MACHINE_SERIES_USAGE]);
    expect(topCalls()).toBe(0);
  });

  it("prints the newest sample's figures and the heaviest other consumers", async () => {
    const { log, out } = captureLogger();
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--home", home] }),
      deps: fixtureDeps().deps,
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      "newest sample 2026-10-17T20:00:01.000Z, 1 kept over the last 60 minutes",
      "CPU: fleet 85.5%, other 132%, of 1500% (15 cores)",
      "load: 1-minute 24.5, hold at 45, 40% idle",
      "memory: 25.2 GB used of 48.0 GB, compressor segments 50%, swap 1.5 of 4 GB",
      "other by CPU: Trajectory 120% over 1 processes",
      "other by CPU: esbuild 10% over 1 processes",
      "other by CPU: kernel_task 2% over 1 processes",
    ]);
  });

  it("dates the hold when the load is over 45 while top reads under the idle floor", async () => {
    const { log, out } = captureLogger();
    const topText = TOP_TEXT.replace("Load Avg: 24.50, 20.10, 18.00", "Load Avg: 50.00, 20.10, 18.00").replace(
      "CPU usage: 40.0% user, 20.0% sys, 40.0% idle",
      "CPU usage: 70.0% user, 20.0% sys, 10.0% idle",
    );
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--home", home] }),
      deps: fixtureDeps({ topText }).deps,
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("load: 1-minute 50, hold at 45, 10% idle");
    expect(out).toContain("held since at least 2026-10-17T20:00:01.000Z, the oldest sample kept");
  });

  it("names no hold for the same load at 40% idle", async () => {
    const { log, out } = captureLogger();
    const topText = TOP_TEXT.replace("Load Avg: 24.50, 20.10, 18.00", "Load Avg: 50.00, 20.10, 18.00");
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--home", home] }),
      deps: fixtureDeps({ topText }).deps,
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("load: 1-minute 50, hold at 45, 40% idle");
    expect(out.some((line) => line.startsWith("held since"))).toBe(false);
  });

  it("prints the whole window as one JSON document on --json", async () => {
    const { log, out } = captureLogger();
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--home", home, "--json"] }),
      deps: fixtureDeps().deps,
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_OK);
    expect(out.length).toBe(1);
    const document = JSON.parse(out[0]!) as {
      observedAtIso: string;
      samples: { sessions: { sessionId: string }[] }[];
    };
    expect(document.observedAtIso).toBe("2026-10-17T20:00:01.000Z");
    expect(document.samples[0]!.sessions.map((session) => session.sessionId)).toEqual([SESSION_ID]);
  });

  it("exits with the failure named when no sample could be taken", async () => {
    const { deps } = fixtureDeps();
    const { log, errs } = captureLogger();
    const code = await runMachineSeriesWithDeps({
      argv: argvOf({ tail: ["--home", home] }),
      deps: { ...deps, top: () => undefined },
      log,
      nowIso,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(errs).toEqual(["machine series: the top read failed, so no sample was taken"]);
  });
});
