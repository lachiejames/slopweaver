/**
 * What the Codex rollout-log reader's test files share: two hand-written rollout lines, and the throwaway
 * `CODEX_HOME` directories the fixture files mint and remove. Moved here when the reader's one test file was
 * split by behaviour.
 *
 * The `*_LINE` constants in this file and in `parseRolloutLine.test.ts` are HAND-WRITTEN, and the header they once
 * carried claimed otherwise — that they were "the exact structures captured live". They were not:
 * every one of them nests `rate_limits` inside `info`, a layout no line on this machine has ever used, and they
 * were typed from `quotaLog.ts`'s own doc comment. That is why this suite passed for a month while the module it
 * tests matched 0 of 80,935 real events. They are kept, because tolerating the nested layout is now a deliberate
 * property (see {@link rateLimitsOf}) and these are the only fixtures that exercise it — but the claim about
 * their provenance is gone, and the REAL lines they failed to stand in for live in
 * `src/__tests__/codexRolloutLines.ts` and are exercised in `realRolloutLines.test.ts` and its siblings here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

export const CREDITS_OUT_LINE = JSON.stringify({
  payload: {
    error: { codex_error_info: "usage_limit_exceeded", message: "Your workspace is out of credits." },
    turn_id: "t1",
    type: "task_complete",
  },
  timestamp: "2026-08-14T04:01:14.586Z",
  type: "event_msg",
});

export const HEALTHY_LINE = JSON.stringify({
  payload: {
    info: {
      rate_limits: {
        credits: { balance: null, has_credits: true, unlimited: false },
        primary: { resets_at: 1787012719, used_percent: 45.0, window_minutes: 10_080 },
        rate_limit_reached_type: null,
      },
    },
    type: "token_count",
  },
  timestamp: "2026-08-14T06:00:00.000Z",
  type: "event_msg",
});

const tempDirs: string[] = [];

/**
 * A throwaway Codex home, removed after the case by the hook {@link useTempCodexHomes} registers.
 *
 * @returns the new directory's path
 */
export function tempCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "quota-log-test-"));
  tempDirs.push(dir);
  return dir;
}

/** Register the `afterEach` that removes every Codex home {@link tempCodexHome} minted; call it once at module scope. */
export function useTempCodexHomes(): void {
  afterEach(() => {
    tempDirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });
}
