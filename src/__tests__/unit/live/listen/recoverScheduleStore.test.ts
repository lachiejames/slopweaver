/**
 * Durable I/O for the scheduled recovery sweep's cadence state — a real temp home, round-tripped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { readRecoverySweepState, writeRecoverySweepState } from "../../../../live/listen/recoverScheduleStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

describe("recoverScheduleStore", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-recovery-sweep-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no state as valid — never swept", () => {
    expect(unwrap(readRecoverySweepState({ home }))).toBeUndefined();
  });

  it("round-trips a written state exactly", () => {
    const written = writeRecoverySweepState({
      home,
      state: { completedThroughTs: "1786600000.000000", nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 },
    });
    expect(unwrap(written).path).toBe(stateHomePaths({ home }).live.slack.recoverySweepJson);

    const read = unwrap(readRecoverySweepState({ home }));
    expect(read).toEqual({
      completedThroughTs: "1786600000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      version: 1,
    });
  });

  it("refuses a corrupt (non-JSON) file rather than treating it as never-swept", () => {
    const path = stateHomePaths({ home }).live.slack.recoverySweepJson;
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    writeFileSync(path, "not json", "utf8");

    const error = unwrapErr(readRecoverySweepState({ home }));
    expect(error.code).toBe("SWEEP_STATE_MALFORMED_JSON");
    expect(error.message).toContain("is not valid JSON");
  });

  it("refuses a well-formed JSON file that does not match the schema", () => {
    const path = stateHomePaths({ home }).live.slack.recoverySweepJson;
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 3 }), "utf8");

    const error = unwrapErr(readRecoverySweepState({ home }));
    expect(error.code).toBe("SWEEP_STATE_UNSUPPORTED_VERSION");
    expect(error.message).toBe("recovery sweep state has unsupported version 3, expected 1 or 2");
  });

  it("overwrites a previous state on a second write", () => {
    writeRecoverySweepState({ home, state: { nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 } });
    writeRecoverySweepState({ home, state: { nextDueAtIso: "2026-08-13T12:10:00.000Z", version: 1 } });

    expect(unwrap(readRecoverySweepState({ home }))).toEqual({
      nextDueAtIso: "2026-08-13T12:10:00.000Z",
      version: 1,
    });
  });

  it("round-trips a V2 state, thread checkpoints included", () => {
    const written = writeRecoverySweepState({
      home,
      state: {
        completedThroughTs: "1786600000.000000",
        nextDueAtIso: "2026-08-13T12:05:00.000Z",
        threadCheckpoints: {
          "C1:1785000000.000100": { cursorTs: "1785000100.000200", lastCheckedAtIso: "2026-08-13T12:00:00.000Z" },
        },
        version: 2,
      },
    });
    expect(unwrap(written).path).toBe(stateHomePaths({ home }).live.slack.recoverySweepJson);

    expect(unwrap(readRecoverySweepState({ home }))).toEqual({
      completedThroughTs: "1786600000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: {
        "C1:1785000000.000100": { cursorTs: "1785000100.000200", lastCheckedAtIso: "2026-08-13T12:00:00.000Z" },
      },
      version: 2,
    });
  });

  it("still reads a V1 file written before this feature shipped", () => {
    const path = stateHomePaths({ home }).live.slack.recoverySweepJson;
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ completedThroughTs: "1786600000.000000", nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 }),
      "utf8",
    );

    expect(unwrap(readRecoverySweepState({ home }))).toEqual({
      completedThroughTs: "1786600000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      version: 1,
    });
  });
});
