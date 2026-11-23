/**
 * Keeping a long task's call up after its answer, so the whole answer and a correction owed after it reach the call file
 * before the hang-up. Hanging up on the answer's first row cut a call at "I read the
 * configuration but", before the voice said who writes the briefing.
 *
 * **Best effort, never proof.** The page shows only FINAL rows (`src/desktop/e2eCallRows.ts`'s `E2E_LIVE_ROWS`), so a correction still
 * being spoken is invisible here, and a correction may start late: its grounding post is allowed 10s
 * (`site/components/voice/planCallClient.ts`) and it stays owed up to 15s (`site/lib/talkPlanCompletionCorrection.ts`)
 * Whether a correction was owed and said is read off the call file afterwards, never off this.
 */
import { type E2eRow, sameRows } from "../../../desktop/e2eCallRows.js";
import { liveRows, until, withinCap } from "./e2eCallPage.js";
import type { VoiceView } from "./e2eCallView.js";

/** How long the final rows must hold still: past the 15s a correction stays owed, and room to begin saying it. */
const ANSWER_STILL_MS = 20_000;

/**
 * Keep the call up until its final rows have not changed for {@link ANSWER_STILL_MS}, or the cap. Never past the cap
 * and never a verdict of its own: a read that hangs is cut off at the cap, and one that throws ends the wait, because
 * the answer was already seen and judged before this runs.
 *
 * @param view the voice window
 * @param capMs the most it waits
 * @param deadline the caller's own cap instant, in `performance.now()`'s clock, never moved later: re-based from a
 *   remaining duration, a pause between the caller's subtraction and this call stretched the cap
 * @returns the last rows it read by the cap, `undefined` when no read finished: a caller judging the settled rows
 *   takes these rather than reading again past the cap. A cap already spent reads
 *   nothing, since `until` reads once before it checks its deadline
 */
export async function untilTranscriptStill({
  view,
  capMs,
  deadline,
}: {
  view: VoiceView;
  capMs: number;
  deadline?: number;
}): Promise<readonly E2eRow[] | undefined> {
  let cutAt = performance.now() + capMs;
  if (deadline !== undefined && deadline < cutAt) {
    cutAt = deadline;
  }
  const remaining = cutAt - performance.now();
  if (remaining <= 0) {
    return undefined;
  }
  const seen: { state: StillnessState; cut: boolean } = {
    cut: false,
    state: { changedAt: performance.now(), last: undefined },
  };
  await withinCap({ capMs: remaining, run: async () => settle({ capMs: remaining, deadline: cutAt, seen, view }) });
  // The loop the cut-off left running reads nothing more.
  seen.cut = true;
  return seen.state.last;
}

/** What one read of the final rows leaves behind: the rows last seen, and when they last changed. */
export interface StillnessState {
  readonly last: readonly E2eRow[] | undefined;
  readonly changedAt: number;
}

/**
 * Fold one read of the final rows into the stillness state: a first read or a changed one restarts the clock, an
 * unchanged one keeps it, and the rows are still once they have held for {@link ANSWER_STILL_MS}.
 *
 * @param state the rows last seen and when they last changed
 * @param rows this read's final rows
 * @param now this read's instant, in the same clock as `changedAt`
 * @returns the next state, and whether the rows have held still long enough
 */
export function stillnessStep({ state, rows, now }: { state: StillnessState; rows: readonly E2eRow[]; now: number }): {
  readonly state: StillnessState;
  readonly still: boolean;
} {
  const changed = state.last === undefined || !sameRows({ after: rows, before: state.last });
  const next = changed ? { changedAt: now, last: rows } : state;
  return { state: next, still: now - next.changedAt >= ANSWER_STILL_MS };
}

/**
 * Poll the final rows until they have held still for {@link ANSWER_STILL_MS}.
 *
 * @param view the voice window
 * @param capMs the most `until` polls for
 * @param deadline the cap's instant, in `performance.now()`'s clock: a read returning past it is never folded in
 * @param seen where each read's state is left, so the rows last read outlive a cap that cuts this off, and whether the
 *   cut-off has fired
 */
async function settle({
  view,
  capMs,
  deadline,
  seen,
}: {
  view: VoiceView;
  capMs: number;
  deadline: number;
  seen: { state: StillnessState; readonly cut: boolean };
}): Promise<void> {
  // Read through a call so a check after the `await` is not narrowed by the one before it: the caller sets `cut`
  // while the read is in flight.
  const cutOff = (): boolean => seen.cut;
  await until({
    capMs,
    test: async () => {
      // The instant is taken AFTER the read returns: taken before it, a slow read's own wait counted towards the 20s
      // and a changed read could be called still 500ms later.
      // The cap's timer never cancels this loop, so it checks the clock before it reads.
      if (cutOff() || performance.now() >= deadline) {
        return true;
      }
      const rows = await liveRows({ view });
      const now = performance.now();
      // A read returning past the cap is unseen, even one that beat the cap's timer.
      if (cutOff() || now >= deadline) {
        return true;
      }
      const step = stillnessStep({ now, rows, state: seen.state });
      seen.state = step.state;
      return step.still;
    },
  });
}
