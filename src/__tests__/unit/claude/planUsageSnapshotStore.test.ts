/**
 * The per-plan usage snapshot store, over a real temporary home: one owner-only file per plan, replaced only by a
 * strictly newer reading, under a per-plan lock, and never overwritten blind when what is there does not decode.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import {
  claudePlanUsageSnapshotPath,
  readClaudePlanUsageSnapshot,
  recordClaudePlanUsageSnapshot,
  recordPlanUsageSnapshots,
} from "../../../claude/planUsageSnapshotStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const NOW = "2026-11-05T12:00:00.000Z";
const WEEK = { resetAtIso: "2026-11-08T12:00:00.000Z", status: "allowed", utilization: 0.42 } as const;

/** A reading of plan-one at `observedAtIso`. */
function gauge({
  observedAtIso,
  utilization = 0.42,
}: {
  observedAtIso: string;
  utilization?: number;
}): ClaudeAccountGauge {
  return { alias: "plan-one", observedAtIso, sevenDay: { ...WEEK, utilization } };
}

/** Give the owner back full access to `dir` and every directory under it, so a cleanup can list them. */
function restoreOwnerAccess({ dir }: { dir: string }): void {
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      restoreOwnerAccess({ dir: join(dir, entry.name) });
    }
  }
}

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-usage-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("claudePlanUsageSnapshotPath", () => {
  it("keeps one file per plan under the live usage directory", () => {
    expect(unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }))).toBe(
      join(stateHomePaths({ home }).live.claudeUsageSnapshotsDir, "plan-one.json"),
    );
    expect(stateHomePaths({ home: "/tmp/sw-home" }).live.claudeUsageSnapshotsDir).toBe(
      "/tmp/sw-home/live/claude-usage",
    );
  });

  it("refuses an alias that could leave the directory", () => {
    expect(unwrapErr(claudePlanUsageSnapshotPath({ alias: "../escape", home })).code).toBe("PLAN_USAGE_ALIAS_INVALID");
  });
});

describe("recordClaudePlanUsageSnapshot and readClaudePlanUsageSnapshot", () => {
  it("reads a plan nothing has gauged as no snapshot, not an error", () => {
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
  });

  it("records a reading and reads exactly it back, owner-only", () => {
    const outcome = recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
      home,
      now: () => NOW,
    });
    expect(unwrap(outcome)).toBe("recorded");
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toStrictEqual({
      alias: "plan-one",
      observedAtIso: "2026-11-05T11:50:00.000Z",
      sevenDay: WEEK,
    });
    const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(stateHomePaths({ home }).live.claudeUsageSnapshotsDir).mode & 0o777).toBe(0o700);
  });

  it("publishes an owner-readable snapshot under a umask that strips owner-read", () => {
    mkdirSync(stateHomePaths({ home }).live.claudeUsageSnapshotsDir, { mode: 0o700, recursive: true });
    const previous = process.umask(0o400);
    try {
      const outcome = recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: () => NOW,
      });
      expect(unwrap(outcome)).toBe("recorded");
    } finally {
      process.umask(previous);
      // The umask also stripped read from every directory the lock created, which the cleanup must list.
      restoreOwnerAccess({ dir: home });
    }
    const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))!.observedAtIso).toBe(
      "2026-11-05T11:50:00.000Z",
    );
  });

  it("replaces an older reading with a newer one", () => {
    recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:00:00.000Z" }),
      home,
      now: () => NOW,
    });
    const newer = recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z", utilization: 0.5 }),
      home,
      now: () => NOW,
    });
    expect(unwrap(newer)).toBe("recorded");
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))!.sevenDay.utilization).toBe(0.5);
  });

  it.each(["2026-11-05T11:50:00.000Z", "2026-11-05T11:00:00.000Z"])(
    "keeps the recorded reading over one observed at %s, bytes and mtime untouched",
    (observedAtIso) => {
      recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: () => NOW,
      });
      const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
      utimesSync(path, 1_700_000_000, 1_700_000_000);
      const before = readFileSync(path, "utf8");
      const kept = recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso, utilization: 0.9 }),
        home,
        now: () => NOW,
      });
      expect(unwrap(kept)).toBe("kept-newer");
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(statSync(path).mtimeMs).toBe(1_700_000_000_000);
    },
  );

  it.each([
    ["corrupt JSON", "{not json"],
    ["JSON of the wrong shape", '{"alias":"plan-one"}\n'],
  ])("reads %s as unreadable and refuses to overwrite it blind", (_label, contents) => {
    const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
    mkdirSync(stateHomePaths({ home }).live.claudeUsageSnapshotsDir, { recursive: true });
    writeFileSync(path, contents);
    expect(unwrapErr(readClaudePlanUsageSnapshot({ alias: "plan-one", home })).code).toBe(
      "PLAN_USAGE_SNAPSHOT_UNREADABLE",
    );
    const refused = recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
      home,
      now: () => NOW,
    });
    expect(unwrapErr(refused).code).toBe("PLAN_USAGE_SNAPSHOT_UNREADABLE");
    expect(readFileSync(path, "utf8")).toBe(contents);
  });

  it("refuses a reading whose own instant does not parse", () => {
    const refused = recordClaudePlanUsageSnapshot({ gauge: gauge({ observedAtIso: "later" }), home, now: () => NOW });
    expect(unwrapErr(refused).code).toBe("PLAN_USAGE_SNAPSHOT_WRITE_FAILED");
  });

  it.each([
    ["a reset instant that does not parse", { ...WEEK, resetAtIso: "soon" }],
    ["a negative utilization", { ...WEEK, utilization: -0.1 }],
  ])("refuses a reading with %s and writes nothing a reader would refuse", (_label, sevenDay) => {
    const refused = recordClaudePlanUsageSnapshot({
      gauge: { alias: "plan-one", observedAtIso: "2026-11-05T11:50:00.000Z", sevenDay },
      home,
      now: () => NOW,
    });
    expect(unwrapErr(refused).code).toBe("PLAN_USAGE_SNAPSHOT_WRITE_FAILED");
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
  });

  it("reports a held lock as the typed lock error and writes nothing", () => {
    const held = unwrap(acquireOperationLock({ home, key: "claude-usage-snapshot:plan-one", nowIso: NOW }));
    try {
      const refused = recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: () => NOW,
      });
      expect(unwrapErr(refused).code).toBe("PLAN_USAGE_SNAPSHOT_LOCK_UNAVAILABLE");
      expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
    } finally {
      held.release();
    }
  });
});

describe("recordClaudePlanUsageSnapshot under a contested lease", () => {
  it("dates the lease by its clock as the lease is taken, never by an instant fixed before the call", () => {
    const leasedAt: string[] = [];
    let reads = 0;
    const clock = (): string => {
      reads += 1;
      return reads === 1 ? "2026-11-05T12:30:00.000Z" : "2026-11-05T12:31:00.000Z";
    };
    const watching: typeof acquireOperationLock = (args) => {
      leasedAt.push(args.nowIso);
      return acquireOperationLock(args);
    };
    unwrap(
      recordClaudePlanUsageSnapshot({
        acquire: watching,
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: clock,
      }),
    );
    expect(leasedAt).toStrictEqual(["2026-11-05T12:30:00.000Z"]);
  });

  it.each(["2026-11-05T12:44:00.000Z", "2026-11-05T12:59:00.000Z"])(
    "writes nothing when its lease has aged to %s before the write, still unclaimed, since a takeover may follow at once",
    (writeAtIso) => {
      let reads = 0;
      const clock = (): string => {
        reads += 1;
        return reads === 1 ? "2026-11-05T12:30:00.000Z" : writeAtIso;
      };
      const refused = recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: clock,
      });
      expect(unwrapErr(refused).message).toBe(
        "plan-one's usage snapshot was not recorded: its lock is held (this writer's lease aged past its write deadline, so another writer may take it over mid-write)",
      );
      expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
    },
  );

  it("still writes a second inside the write deadline", () => {
    let reads = 0;
    const clock = (): string => {
      reads += 1;
      return reads === 1 ? "2026-11-05T12:30:00.000Z" : "2026-11-05T12:43:59.999Z";
    };
    const recorded = recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
      home,
      now: clock,
    });
    expect(unwrap(recorded)).toBe("recorded");
  });

  it("writes nothing when its lease was taken over before the write, so a stale writer cannot land last", () => {
    // A REAL takeover: this writer's lease is taken, then another writer judging it an hour later takes it over.
    const takenOver: typeof acquireOperationLock = (args) => {
      const own = acquireOperationLock(args);
      unwrap(acquireOperationLock({ ...args, nowIso: "2026-11-05T13:00:00.000Z" }));
      return own;
    };
    const refused = recordClaudePlanUsageSnapshot({
      acquire: takenOver,
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
      home,
      now: () => NOW,
    });
    expect(unwrapErr(refused).message).toBe(
      "plan-one's usage snapshot was not recorded: its lock is held (another writer took the lease over while this one compared)",
    );
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))).toBeUndefined();
  });

  it("writes only its own plan's file, leaving another plan's undecodable file untouched", () => {
    const other = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-two", home }));
    mkdirSync(stateHomePaths({ home }).live.claudeUsageSnapshotsDir, { recursive: true });
    writeFileSync(other, "{not json");
    const recorded = recordClaudePlanUsageSnapshot({
      gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
      home,
      now: () => NOW,
    });
    expect(unwrap(recorded)).toBe("recorded");
    expect(readFileSync(other, "utf8")).toBe("{not json");
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))!.alias).toBe("plan-one");
  });

  it("refuses an alias that would name a file outside the directory, writing nothing", () => {
    const refused = recordClaudePlanUsageSnapshot({
      gauge: { alias: "../escape", observedAtIso: "2026-11-05T11:50:00.000Z", sevenDay: WEEK },
      home,
      now: () => NOW,
    });
    expect(unwrapErr(refused).code).toBe("PLAN_USAGE_ALIAS_INVALID");
    expect(existsSync(join(home, "live", "escape.json"))).toBe(false);
  });
});

describe("recordClaudePlanUsageSnapshot beside a standing seat pass", () => {
  it("dates the snapshot a second past a pass dated ahead of the wall clock, as one written before a clock step back is", () => {
    const passes = stateHomePaths({ home }).live.seatPassDir;
    mkdirSync(passes, { recursive: true });
    const passAt = Math.floor(Date.now() / 1000) + 3600;
    writeFileSync(join(passes, "session-a"), "4242\tThu Nov  5 01:00:00 2026\tplan-one\t1\t2\n");
    utimesSync(join(passes, "session-a"), passAt, passAt);
    unwrap(
      recordClaudePlanUsageSnapshot({
        gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        home,
        now: () => NOW,
      }),
    );
    const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
    expect(statSync(path).mtimeMs).toBe((passAt + 1) * 1000);
  });

  it("leaves the snapshot future-dated when the passes cannot be listed, so every limited pass misses", () => {
    const passes = stateHomePaths({ home }).live.seatPassDir;
    mkdirSync(passes, { recursive: true });
    chmodSync(passes, 0o000);
    try {
      unwrap(
        recordClaudePlanUsageSnapshot({
          gauge: gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
          home,
          now: () => NOW,
        }),
      );
    } finally {
      chmodSync(passes, 0o700);
    }
    const path = unwrap(claudePlanUsageSnapshotPath({ alias: "plan-one", home }));
    expect(statSync(path).mtimeMs).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });
});

describe("recordPlanUsageSnapshots", () => {
  it("records every reading and returns only what failed", () => {
    const problems = recordPlanUsageSnapshots({
      gauges: [
        gauge({ observedAtIso: "2026-11-05T11:50:00.000Z" }),
        { alias: "../escape", observedAtIso: "2026-11-05T11:50:00.000Z", sevenDay: WEEK },
      ],
      home,
      now: () => NOW,
    });
    expect(problems.map((problem) => problem.code)).toStrictEqual(["PLAN_USAGE_ALIAS_INVALID"]);
    expect(unwrap(readClaudePlanUsageSnapshot({ alias: "plan-one", home }))!.observedAtIso).toBe(
      "2026-11-05T11:50:00.000Z",
    );
  });

  it("records nothing and reports nothing for no readings", () => {
    expect(recordPlanUsageSnapshots({ gauges: [], home, now: () => NOW })).toStrictEqual([]);
  });
});
