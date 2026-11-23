/**
 * The restore-attempt ledger — the one piece of state the restore needs, and the reason a send that never
 * takes escalates to the handoff instead of repeating every tick forever.
 *
 * Every case writes into its own `mkdtempSync` home and removes it, per `.claude/rules/testing.md`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chairRestoreAttemptsPath,
  countChairRestoreAttempts,
  recordChairRestoreAttempt,
} from "../../../supervisor/chairRestoreStore.js";

/** One throwaway `$SLOPWEAVER_HOME` per test. */
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "chair-restore-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("countChairRestoreAttempts", () => {
  it("reads a home that has never seen a trip as zero attempts", () => {
    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(0);
  });

  it("counts only the rows that carry the exact key", () => {
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:00:00.000Z", workspaceId: "WS" });
    recordChairRestoreAttempt({ home, key: "s1@t2", nowIso: "2026-09-19T05:10:00.000Z", workspaceId: "WS" });
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:20:00.000Z", workspaceId: "WS" });

    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(2);
    expect(countChairRestoreAttempts({ home, key: "s1@t2" })).toBe(1);
    expect(countChairRestoreAttempts({ home, key: "s2@t1" })).toBe(0);
  });

  it("does not count a row whose key merely CONTAINS the one asked for", () => {
    recordChairRestoreAttempt({ home, key: "s1@t1-later", nowIso: "2026-09-19T05:00:00.000Z", workspaceId: "WS" });

    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(0);
  });

  it("skips an unreadable row rather than failing the whole count", () => {
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:00:00.000Z", workspaceId: "WS" });
    const path = chairRestoreAttemptsPath({ home });
    writeFileSync(path, `${'{"key":"s1@t1"'}\n${JSON.stringify({ key: "s1@t1", workspaceId: "WS" })}\n`, "utf8");

    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(1);
  });
});

describe("recordChairRestoreAttempt", () => {
  it("writes the key, the workspace and the instant, one row per send", () => {
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:00:00.000Z", workspaceId: "WS-PINNED" });

    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(1);
    expect(chairRestoreAttemptsPath({ home })).toBe(
      join(home, "ledgers", "supervisor", "chair-restore-attempts.jsonl"),
    );
  });

  it("appends rather than replacing, so two ticks cannot lose each other's attempt", () => {
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:00:00.000Z", workspaceId: "WS" });
    recordChairRestoreAttempt({ home, key: "s1@t1", nowIso: "2026-09-19T05:05:00.000Z", workspaceId: "WS" });

    expect(countChairRestoreAttempts({ home, key: "s1@t1" })).toBe(2);
  });
});
