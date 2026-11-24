/**
 * The compactor's sweep of the staged files a KILLED earlier run left beside the canonical file: the pure
 * selection over an injected liveness probe, and the real `compactSource` against a temp-dir home, where a
 * dead writer's staged file is removed and a live one's is left exactly as it was.
 *
 * The incident it holds down: two scheduled runs killed at a supervisor's foreground bound left
 * `compact.jsonl.48591.<uuid>.tmp` and `compact.jsonl.17469.<uuid>.tmp`, 20.4 GB, which nothing removed.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compactSource } from "../../../corpus/compact.js";
import { orphanStagingFiles } from "../../../corpus/compactOrphanTemps.js";
import { bronzeSourceDir } from "../../../corpus/corpusPaths.js";
import { serialiseRecord } from "../../../corpus/recordSerialisation.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok, unwrap } from "../../../lib/result.js";
import { NO_PROTECTION } from "../../noProtection.js";

const DEAD_PID = 48591;
const LIVE_PID = 17469;
const UUID = "de55880e-0d92-48ad-b311-ef2080298ec0";

/** Reads only {@link LIVE_PID} as running — a plain fake, never the process table. */
const onlyLiveRuns = ({ pid }: { pid: number }): boolean => pid === LIVE_PID;

describe("orphanStagingFiles", () => {
  it("selects a staged write of the target whose writer is dead, and nothing else", () => {
    const entries = [
      { bytes: 7, name: `compact.jsonl.${String(DEAD_PID)}.${UUID}.tmp` },
      { bytes: 5, name: `compact.jsonl.${String(LIVE_PID)}.${UUID}.tmp` },
      { bytes: 3, name: "compact.jsonl" },
      { bytes: 2, name: "2026-09-24_2026-09-26.jsonl" },
      { bytes: 1, name: `2026-09-24_2026-09-26.jsonl.${String(DEAD_PID)}.${UUID}.tmp` },
      { bytes: 1, name: "compact.jsonl.tmp" },
    ];
    expect(orphanStagingFiles({ entries, isAlive: onlyLiveRuns, target: "compact.jsonl" })).toStrictEqual([
      { bytes: 7, name: `compact.jsonl.${String(DEAD_PID)}.${UUID}.tmp` },
    ]);
  });

  it("selects nothing from an empty directory", () => {
    expect(orphanStagingFiles({ entries: [], isAlive: onlyLiveRuns, target: "compact.jsonl" })).toStrictEqual([]);
  });
});

describe("compactSource — sweeping a dead writer's staged file", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-compact-sweep-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const record: CorpusRecord = {
    container: "slack/C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "C1:1.0",
    text: "hello",
    tsIso: "2026-09-24T00:00:00.000Z",
    url: "https://example.test/1",
  };

  /** Lay down one window file plus a dead and a live writer's staged file beside the canonical path. */
  function seed(): { readonly dir: string; readonly dead: string; readonly live: string } {
    const dir = bronzeSourceDir({ home, source: "slack" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-09-24_2026-09-26.jsonl"), `${serialiseRecord({ record })}\n`, "utf8");
    const dead = `compact.jsonl.${String(DEAD_PID)}.${UUID}.tmp`;
    const live = `compact.jsonl.${String(LIVE_PID)}.${UUID}.tmp`;
    writeFileSync(join(dir, dead), "partial-write-of-a-killed-run", "utf8");
    writeFileSync(join(dir, live), "in-flight", "utf8");
    return { dead, dir, live };
  }

  it("removes the dead writer's file, keeps the live one, and reports the bytes apart from the measure", () => {
    const { dir, dead, live } = seed();
    const plan = unwrap(compactSource({ home, isAlive: onlyLiveRuns, protection: NO_PROTECTION, source: "slack" }));
    expect(plan.orphanTemps).toStrictEqual({ bytes: 29, failures: [], removed: 1 });
    expect(existsSync(join(dir, dead))).toBe(false);
    expect(existsSync(join(dir, live))).toBe(true);
    expect(plan.before.files).toBe(1);
    expect(plan.after.records).toBe(1);
    expect(readdirSync(dir).toSorted()).toStrictEqual(["compact.jsonl", live]);
  });

  it("sweeps even a source with no window file left to compact", () => {
    const dir = bronzeSourceDir({ home, source: "slack" });
    mkdirSync(dir, { recursive: true });
    const dead = `compact.jsonl.${String(DEAD_PID)}.${UUID}.tmp`;
    writeFileSync(join(dir, dead), "partial", "utf8");
    const plan = unwrap(compactSource({ home, isAlive: onlyLiveRuns, protection: NO_PROTECTION, source: "slack" }));
    expect(plan.orphanTemps).toStrictEqual({ bytes: 7, failures: [], removed: 1 });
    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it("keeps a dead writer's file the owner's list protects, naming it, and still compacts the source", () => {
    const { dir, dead } = seed();
    const path = join(dir, dead);
    const entry = { addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only" as const, path, why: "kept" };
    const plan = unwrap(compactSource({ home, isAlive: onlyLiveRuns, protection: () => ok([entry]), source: "slack" }));
    expect(plan.orphanTemps).toStrictEqual({
      bytes: 0,
      failures: [
        `refusing to compact slack: it would write to ${path}, which the owner's protect list marks read-only at ` +
          `${path} (kept)`,
      ],
      removed: 0,
    });
    expect(existsSync(path)).toBe(true);
    expect(plan.after.records).toBe(1);
  });

  it("reports nothing swept for a source that was never ingested", () => {
    const plan = unwrap(compactSource({ home, isAlive: onlyLiveRuns, protection: NO_PROTECTION, source: "slack" }));
    expect(plan.orphanTemps).toStrictEqual({ bytes: 0, failures: [], removed: 0 });
  });
});
