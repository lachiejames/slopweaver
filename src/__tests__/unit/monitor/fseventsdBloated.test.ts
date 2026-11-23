/**
 * `fseventsd-bloated`: the restart reaches the owner's queue once fseventsd passes 2 GiB, and never while a call is live.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cachePaths } from "../../../cacheHome.js";
import type { CallLeaseSeams } from "../../../desktop/callLeases.js";
import { postingRefusal } from "../../../hand/posting.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import {
  evaluateFseventsdBloated,
  FSEVENTSD_BLOATED,
  FSEVENTSD_RESTART_LINE_BYTES,
  type FseventsdFootprint,
  fseventsdSpec,
  type LiveCallCount,
} from "../../../monitor/fseventsdBloated.js";
import { readFseventsdFootprint, readLiveCalls } from "../../../monitor/fseventsdBloatedSource.js";
import type { MonitorSubject } from "../../../monitor/types.js";

const NO_CALL: LiveCallCount = { kind: "read", live: 0 };
const PID = 97860;
const FSEVENTSD =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd";

/** fseventsd read at `bytes`. */
function at({ bytes }: { bytes: number }): FseventsdFootprint {
  return { bytes, kind: "read", pid: PID };
}

/** The one subject a firing reading carries. */
function subjectOf({ footprint, calls }: { footprint: FseventsdFootprint; calls: LiveCallCount }): MonitorSubject {
  const reading = evaluateFseventsdBloated({ calls, footprint });
  if (reading.state !== "firing") {
    throw new Error(`expected a firing reading, got ${reading.state}`);
  }
  return reading.subjects[0]!;
}

describe("evaluateFseventsdBloated", () => {
  it("fires one byte over the line with no call live, the owner's restart on the pasteboard and keyed by the pid", () => {
    expect(subjectOf({ calls: NO_CALL, footprint: at({ bytes: FSEVENTSD_RESTART_LINE_BYTES + 1 }) })).toStrictEqual({
      footprintBytes: FSEVENTSD_RESTART_LINE_BYTES + 1,
      id: "fseventsd",
      key: "97860",
      label: "2.0 GB",
      literal: "sudo killall fseventsd",
    });
  });

  it("is clear at the line exactly, and under it", () => {
    expect([
      evaluateFseventsdBloated({ calls: NO_CALL, footprint: at({ bytes: FSEVENTSD_RESTART_LINE_BYTES }) }),
      evaluateFseventsdBloated({ calls: NO_CALL, footprint: at({ bytes: 5_652_480 }) }),
    ]).toStrictEqual([
      { monitorId: "fseventsd-bloated", state: "clear" },
      { monitorId: "fseventsd-bloated", state: "clear" },
    ]);
  });

  it("is clear when fseventsd is not running", () => {
    expect(evaluateFseventsdBloated({ calls: NO_CALL, footprint: { kind: "not-running" } })).toStrictEqual({
      monitorId: "fseventsd-bloated",
      state: "clear",
    });
  });

  it("is unmeasurable, never clear, when the footprint could not be read", () => {
    expect(
      evaluateFseventsdBloated({ calls: NO_CALL, footprint: { kind: "unreadable", why: "top failed" } }),
    ).toStrictEqual({
      because: "top failed",
      monitorId: "fseventsd-bloated",
      state: "unmeasurable",
    });
  });

  it("holds the restart while a call is live, since the restart stalls configd and drops the call", () => {
    const reading = evaluateFseventsdBloated({
      calls: { kind: "read", live: 1 },
      footprint: at({ bytes: 10.34 * 1024 ** 3 }),
    });
    expect(reading).toStrictEqual({
      because:
        "fseventsd holds 10.3 GB, and a voice call is live (1 lease(s)) — its restart is held until the call ends",
      monitorId: "fseventsd-bloated",
      state: "unmeasurable",
    });
  });

  it("proposes nothing over the line when whether a call is live could not be read", () => {
    const calls: LiveCallCount = { kind: "unreadable", why: "EACCES" };
    expect(evaluateFseventsdBloated({ calls, footprint: at({ bytes: 3 * 1024 ** 3 }) })).toStrictEqual({
      because:
        "fseventsd holds 3.0 GB, and whether a voice call is live could not be read (EACCES), so its restart is not proposed",
      monitorId: "fseventsd-bloated",
      state: "unmeasurable",
    });
  });

  it("is clear under the line even when the leases could not be read, since nothing is proposed", () => {
    const calls: LiveCallCount = { kind: "unreadable", why: "EACCES" };
    expect(evaluateFseventsdBloated({ calls, footprint: at({ bytes: 1024 }) })).toStrictEqual({
      monitorId: "fseventsd-bloated",
      state: "clear",
    });
  });
});

describe("the fseventsd-bloated card", () => {
  it("asks the owner to restart it, not during a call, in a card the register and the posting form accept", () => {
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: FSEVENTSD_BLOATED,
        nowIso: "2026-10-07T05:00:00.000Z",
        postedBy: "supervisor",
        subject: subjectOf({ calls: NO_CALL, footprint: at({ bytes: 10.34 * 1024 ** 3 }) }),
      }),
    );
    expect([step.id, step.what, step.literal, step.where]).toStrictEqual([
      "mon-fsev-97860",
      "Restart fseventsd in your terminal when no call is on — it holds 10.3 GB and slows every hook",
      "sudo killall fseventsd",
      "Your own terminal, never during a call — the restart stalls configd about a minute while fseventsd rebuilds",
    ]);
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("reads the relief and the binary path from the watched daemons, never a second copy", () => {
    expect(fseventsdSpec()).toStrictEqual({ comm: FSEVENTSD, label: "fseventsd", relief: "sudo killall fseventsd" });
  });
});

describe("readFseventsdFootprint", () => {
  const TOP = ["Load Avg: 36.02, 36.51, 33.43", "PID    MEM", "97860  10G", ""].join("\n");

  it("finds fseventsd by its exact binary path and reads its footprint off `top`", () => {
    const asked: number[][] = [];
    const footprint = readFseventsdFootprint({
      seams: {
        comms: () => [
          { comm: "/sbin/launchd", pid: 1 },
          { comm: FSEVENTSD, pid: PID },
          { comm: "/tmp/fseventsd", pid: 4242 },
        ],
        watchedTopReport: ({ pids }) => {
          asked.push([...pids]);
          return TOP;
        },
      },
    });
    expect([footprint, asked]).toStrictEqual([{ bytes: 10 * 1024 ** 3, kind: "read", pid: PID }, [[PID]]]);
  });

  it("reads not running when no process carries the binary path, a lookalike name included", () => {
    expect(
      readFseventsdFootprint({
        seams: { comms: () => [{ comm: "/tmp/fseventsd", pid: 4242 }], watchedTopReport: () => TOP },
      }),
    ).toStrictEqual({ kind: "not-running" });
  });

  it("reads unreadable, never not running, on an empty process table", () => {
    expect(readFseventsdFootprint({ seams: { comms: () => [], watchedTopReport: () => TOP } })).toStrictEqual({
      kind: "unreadable",
      why: "`ps -ax -o pid=,comm=` listed no process at all",
    });
  });

  it("reads unreadable when `top` fails or prints no row for the pid", () => {
    const comms = (): readonly { comm: string; pid: number }[] => [{ comm: FSEVENTSD, pid: PID }];
    expect([
      readFseventsdFootprint({ seams: { comms, watchedTopReport: () => undefined } }),
      readFseventsdFootprint({ seams: { comms, watchedTopReport: () => "PID MEM\n1 4K\n" } }),
    ]).toStrictEqual([
      { kind: "unreadable", why: "`top` over fseventsd's pid 97860 failed" },
      { kind: "unreadable", why: "`top` printed no footprint for fseventsd's pid 97860" },
    ]);
  });
});

describe("readLiveCalls", () => {
  const HOLD = join(cachePaths().docsSite, "slopweaver-1a2b3c4d.hold");

  it("counts only the leases still live at now, across a lapsed one", () => {
    const seams: CallLeaseSeams = {
      names: ({ path }) => (path.endsWith("calls") ? ["live.json", "lapsed.json"] : ["slopweaver-1a2b3c4d.hold"]),
      readText: ({ path }) => (path.endsWith("live.json") ? '{"untilMs":2000}' : '{"untilMs":500}'),
    };
    expect(readLiveCalls({ home: "/home", nowMs: 1000, seams })).toStrictEqual({ kind: "read", live: 1 });
  });

  it("reads a listing that failed for any reason but absence as unreadable, never as no call", () => {
    const seams: CallLeaseSeams = {
      names: ({ path }) => {
        if (path === `${HOLD}/calls`) {
          throw Object.assign(new Error("EACCES: refused"), { code: "EACCES" });
        }
        return path.endsWith("calls") ? [] : ["slopweaver-1a2b3c4d.hold"];
      },
      readText: () => "",
    };
    expect(readLiveCalls({ home: "/home", nowMs: 1000, seams })).toStrictEqual({
      kind: "unreadable",
      why: `could not read the voice call leases at ${HOLD}/calls: EACCES: refused`,
    });
  });
});
