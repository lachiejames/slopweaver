/**
 * What the `codex gauge` and `codex signin` test files share: the empty Codex homes they mint and the hook that
 * removes them, and the real weekly-exhausted line re-dated so a September copy reads a window still open.
 * Moved here when the verbs' one test file was split by describe.
 *
 * Filesystem round-trips are what testing.md allows a unit test: each home is a `mkdtempSync` directory removed
 * in `afterEach`, and nothing reads the operator's own `~/.codex`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { REAL_WEEKLY_EXHAUSTED_LINE } from "../../../codexRolloutLines.js";

const tempDirs: string[] = [];

/**
 * A Codex home that exists and holds nothing, so a read finds no rollout file and no auth.
 *
 * @returns the new Codex home's path, removed after every test by the hook {@link useGaugeRunHomes} registers
 */
export function emptyCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-gauge-run-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Register the `afterEach` that unsets `CODEX_HOME` and removes every home {@link emptyCodexHome} minted; call it
 * once at module scope.
 */
export function useGaugeRunHomes(): void {
  afterEach(() => {
    delete process.env["CODEX_HOME"];
    tempDirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });
}

/**
 * The real weekly-exhausted line with its reset moved to a later instant, so a copy re-dated to match reads
 * a window still OPEN when it was read — the real line's own July reset would make every such copy a reading
 * of an already-reset window, which the gauge rightly ignores.
 */
export const OPEN_WEEKLY_EXHAUSTED_LINE = REAL_WEEKLY_EXHAUSTED_LINE.replace("1784998696", "1790500000");

/**
 * A two-window reading — the weekly one still open beside a five-hour one — observed at
 * `observedIso`. Built from the real line's shape; `~/.codex` holds 3,270 real readings carrying a 300-minute
 * window (`../../../../codex/gauge.ts`'s header).
 *
 * @returns the rollout line, as Codex writes it
 */
export function twoWindowLine({
  fiveHour,
  fiveHourResetSeconds,
  observedIso,
  weekly,
}: {
  fiveHour: number;
  fiveHourResetSeconds: number;
  observedIso: string;
  weekly: number;
}): string {
  return OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", observedIso)
    .replace('"used_percent":100.0', `"used_percent":${String(weekly)}.0`)
    .replace(
      '"secondary":null',
      `"secondary":{"used_percent":${String(fiveHour)}.0,"window_minutes":300,"resets_at":${String(fiveHourResetSeconds)}}`,
    );
}

/** A five-hour reset still ahead of every reading built with it. */
export const FIVE_HOUR_OPEN_RESET = 1_790_172_000;
/** A five-hour reset already passed when the reading was taken. */
export const FIVE_HOUR_PASSED_RESET = 1_790_160_300;
