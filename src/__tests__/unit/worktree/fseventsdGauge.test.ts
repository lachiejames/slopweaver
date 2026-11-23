/**
 * fseventsd's CPU as a prune brakes on it: read by exact binary path, summed across instances, failed closed on
 * darwin, and judged against two bars so a hold does not flap.
 */
import { describe, expect, it } from "vitest";

import {
  FSEVENTSD_CPU_BAR,
  type FseventsdCpu,
  fseventsdStop,
  gaugeTimeoutMs,
  governorHolds,
  onPlatform,
  parseFseventsdCpu,
} from "../../../worktree/fseventsdGauge.js";

const FSEVENTSD =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd";

const fseventsdAt = ({ cpu }: { cpu: number }): FseventsdCpu => ({ cpu, kind: "read", pids: [97860] });

describe("parseFseventsdCpu", () => {
  it("reads fseventsd by its exact binary path out of a real listing", () => {
    const text = `  581  40.7 /usr/libexec/opendirectoryd\n68857  34.4 ${FSEVENTSD}\n`;
    expect(parseFseventsdCpu({ text })).toEqual({ cpu: 34.4, kind: "read", pids: [68857] });
  });

  it("sums two instances, so two at 15% read as the 30% the machine carries", () => {
    const text = `  100  15.0 ${FSEVENTSD}\n  200  15.0 ${FSEVENTSD}\n`;
    expect(parseFseventsdCpu({ text })).toEqual({ cpu: 30, kind: "read", pids: [100, 200] });
  });

  it("never reads a lookalike name as the daemon", () => {
    const text = `  300  99.0 /tmp/fseventsd\n  301   1.0 /bin/zsh\n`;
    expect(parseFseventsdCpu({ text })).toEqual({ kind: "not-running" });
  });

  it("reads a binary path with spaces in it whole, and skips a line that is not a row", () => {
    const text = `PID %CPU COMM\n  400  12.5 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n  401  20.0 ${FSEVENTSD}\n`;
    expect(parseFseventsdCpu({ text })).toEqual({ cpu: 20, kind: "read", pids: [401] });
  });

  it("calls an empty listing unreadable, never not-running", () => {
    expect(parseFseventsdCpu({ text: "" })).toEqual({
      kind: "unreadable",
      why: "`ps -ax -o pid=,%cpu=,comm=` listed no process at all",
    });
  });
});

describe("onPlatform", () => {
  it("makes a missing row on darwin a failed read, since fseventsd always runs there", () => {
    expect(onPlatform({ fseventsd: { kind: "not-running" }, platform: "darwin" })).toEqual({
      kind: "unreadable",
      why: "no process runs at fseventsd's binary path",
    });
  });

  it("leaves a missing row elsewhere as not running", () => {
    expect(onPlatform({ fseventsd: { kind: "not-running" }, platform: "linux" })).toEqual({ kind: "not-running" });
  });
});

describe("fseventsdStop", () => {
  it("carries on just under the bar", () => {
    expect(fseventsdStop({ bar: FSEVENTSD_CPU_BAR, fseventsd: fseventsdAt({ cpu: 19.9 }) })).toBe(null);
  });

  it("stops at the bar itself", () => {
    expect(fseventsdStop({ bar: FSEVENTSD_CPU_BAR, fseventsd: fseventsdAt({ cpu: 20 }) })).toBe(
      "fseventsd (pid 97860) is at 20.0% CPU, at or above the 20% bar — the rest wait for the next run",
    );
  });

  it("carries on where no fseventsd exists", () => {
    expect(fseventsdStop({ bar: FSEVENTSD_CPU_BAR, fseventsd: { kind: "not-running" } })).toBe(null);
  });

  it("stops on a read it could not make, naming why", () => {
    expect(fseventsdStop({ bar: FSEVENTSD_CPU_BAR, fseventsd: { kind: "unreadable", why: "ps timed out" } })).toBe(
      "fseventsd's CPU could not be read (ps timed out) — the rest wait for the next run",
    );
  });
});

describe("gaugeTimeoutMs", () => {
  it("cuts the listing to the time a delete has left", () => {
    expect(gaugeTimeoutMs({ remainingMs: 1_000 })).toBe(1_000);
  });

  it("keeps its own ten-second cap for a caller with no deadline", () => {
    expect(gaugeTimeoutMs({ remainingMs: Number.POSITIVE_INFINITY })).toBe(10_000);
  });

  it("never hands execFileSync a zero, which it reads as no timeout at all", () => {
    expect(gaugeTimeoutMs({ remainingMs: -5 })).toBe(1);
  });
});

describe("governorHolds", () => {
  it("does not start holding under the upper bar", () => {
    expect(governorHolds({ cpu: 19.9, holding: false })).toBe(false);
  });

  it("starts holding at the upper bar", () => {
    expect(governorHolds({ cpu: 20, holding: false })).toBe(true);
  });

  it("stays held between the bars, so one dip does not release it", () => {
    expect(governorHolds({ cpu: 15, holding: true })).toBe(true);
  });

  it("releases under the lower bar", () => {
    expect(governorHolds({ cpu: 9.9, holding: true })).toBe(false);
  });
});
