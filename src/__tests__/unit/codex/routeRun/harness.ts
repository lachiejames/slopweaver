/**
 * `codex route` end to end over REAL temp homes — two registered Codex destinations, each with its own
 * rollout log, ranked by the shipped code rather than by a restatement of it.
 *
 * Filesystem round-trips are what testing.md allows a unit test, and they are the point here: the defect
 * this lane holds down is one account's log being read beside another account's register row, which no
 * fixture built from in-memory observations can catch. Each home is a `mkdtempSync` directory removed in
 * `afterEach`, and nothing reads the operator's own `~/.codex`.
 *
 * What the route verb's test files share: the instant and model every case reads under, the homes they mint,
 * and the hook that removes them. Moved here when the verb's one test file was split by behaviour.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

import type { RegisteredPlan } from "../../../../plans/types.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { weeklyLine } from "../../../codexWeeklyLineFixture.js";

export const NOW = "2026-09-22T12:00:00.000Z";
export const MODEL = "gpt-6-astra";

const dirs: string[] = [];

/**
 * A throwaway directory, removed after every test by the hook {@link useRouteRunHomes} registers.
 *
 * @returns the new directory's path
 */
export function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * A Codex home whose newest rollout line reports the given weekly percentage.
 *
 * Built from the real line's shape rather than a hand-invented one, so the parser under test is
 * reading what Codex actually writes. The day directory is the one `recentSessionDayDirs` walks.
 *
 * @returns the new Codex home's path
 */
export function codexHomeAtWeekly({ percent }: { percent: number }): string {
  const codexHome = temp({ prefix: "codex-route-home-" });
  const dayDir = join(codexHome, "sessions", "2026", "09", "22");
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(
    join(dayDir, "rollout-2026-09-22T11-00-00-aaaa.jsonl"),
    `${weeklyLine({ observedIso: "2026-09-22T11:00:00.000Z", percent })}\n`,
    "utf8",
  );
  return codexHome;
}

/**
 * A state home whose register carries exactly `rows`.
 *
 * @returns the new state home's path
 */
function homeWith({ rows }: { rows: readonly Omit<RegisteredPlan, "allowance" | "usageLimitPercent">[] }): string {
  const home = temp({ prefix: "codex-route-state-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

export { homeWith };

/** Register the `afterEach` that removes every directory {@link temp} minted; call it once at module scope. */
export function useRouteRunHomes(): void {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });
}
