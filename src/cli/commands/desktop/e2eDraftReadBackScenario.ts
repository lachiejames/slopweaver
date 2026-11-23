/**
 * `draft-read-back`'s drive: a draft dictated in the owner's register and asked to be read back, the shape a call
 * once answered by speaking AS the owner (`src/talk/quotedDraftLines.ts`).
 *
 * It asks for no long task. Drafting two lines may finish in seconds, so the session-details tray is never required
 * to show work: a fast, correct read-back routed through the long task's drive failed `long-task-missing`, or spent the
 * whole cap waiting for work it never saw. The leg proves the owner's last turn the
 * dictated one and the voice's rows after it quoting ONE draft body that carries every `DRAFT_READ_BACK_WORDS`, read again once
 * the rows settle, then keeps the call up until the final rows hold still, so the read-back reaches the call file;
 * whether the voice said that quote in its own register, never the owner's, is judged off that file afterwards. Only live
 * rows past the ones on screen at go-live count (`src/desktop/e2eDraftReadBackRows.ts`), that baseline what one read
 * straight after go-live saw on the page (a row rendered after its snapshot is new): a failed one, or one that saw a row still
 * being heard (it would settle later and read as new), fails the leg, never taken as none nor read again, so no row
 * standing at go-live passes it. The cap is a hard
 * cut: a read still running at it is cut off and its rows unseen, and none starts once it is spent.
 */
import { draftTurnAndAnswer } from "../../../desktop/e2eDraftReadBackRows.js";
import { untilTranscriptStill } from "./e2eCallAnswerSettle.js";
import { goLiveBaseline, liveRows, until, withinCap } from "./e2eCallPage.js";
import { nothingYet, type Scenario, startLive } from "./e2eCallScenarios.js";
import type { VoiceView } from "./e2eCallView.js";

/**
 * `draft-read-back`: a live call hears the dictated draft, the voice quotes a draft back after the owner's turn, and the call
 * stays up until the transcript holds still.
 *
 * @returns what the call showed, for the judge
 */
export const draftReadBack: Scenario = async ({ session, step }) => {
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  return { ...nothingYet({ view }), ...(await readDraftBack({ capMs: step.capMs, view })), live: true };
};

/**
 * Read a live call's draft read-back off its voice window: the go-live baseline, then the owner's dictated turn and the
 * voice's quoted draft after it (`draftTurnAndAnswer`), judged again on the rows once they hold still, all within one
 * cap.
 *
 * @param view the live voice window
 * @param capMs the most the whole read may take, from the moment it starts
 * @returns the owner's turn, and whether the voice quoted the draft back after it, both false when the page never gave a
 *   baseline
 */
export async function readDraftBack({ view, capMs: legCapMs }: { view: VoiceView; capMs: number }): Promise<{
  readonly ownerTurn: boolean;
  readonly voiceAnswer: boolean;
}> {
  // The monotonic clock, never the wall clock a backward adjustment moves.
  const deadline = performance.now() + legCapMs;
  const baseline = await goLiveBaseline({ capMs: legCapMs, view });
  if (baseline === undefined) {
    // A page that never answered has no go-live rows to set aside, so nothing after them can be proven the owner's turn.
    return { ownerTurn: false, voiceAnswer: false };
  }
  const polled = { answer: { ownerTurn: false, voiceAnswer: false }, cut: false };
  const capMs = deadline - performance.now();
  if (capMs <= 0) {
    // `until` reads once before it checks its deadline, so a spent cap polls nothing.
    return polled.answer;
  }
  /** Whether the cap has come: the cut-off fired, or the clock reached it, its own instant spent. */
  const spent = (): boolean => polled.cut || performance.now() >= deadline;
  await withinCap({
    capMs,
    run: async () => {
      await until({
        capMs,
        test: async () => {
          // The cap's timer never cancels this loop, so it checks before it reads.
          if (spent()) {
            return true;
          }
          const rows = await liveRows({ view });
          // A read returning past the cap is unseen, even one that beat the cap's timer.
          if (spent()) {
            return true;
          }
          polled.answer = draftTurnAndAnswer({ baseline, rows });
          return polled.answer.voiceAnswer;
        },
      });
    },
  });
  polled.cut = true;
  // Taken now: a read the cap cut off may still land later, and must not change the verdict after it.
  const seen = polled.answer;
  if (!seen.voiceAnswer) {
    return seen;
  }
  const settled = await untilTranscriptStill({ capMs: deadline - performance.now(), deadline, view });
  // Judged again on the settled rows, the last the settle read by the cap and never a read past it: an owner turn
  // arriving while they settled is the last row, not the voice's.
  if (settled === undefined) {
    return seen;
  }
  return draftTurnAndAnswer({ baseline, rows: settled });
}
