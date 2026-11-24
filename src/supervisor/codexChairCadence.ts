/**
 * A Codex chair's hand-off cadence — one slice of the host-neutral chair.
 *
 * The one reason a Codex chair is judged on is the provider-neutral one: its loaded canon gone stale
 * (`./chairCanon.ts` — at least 36 hours old AND changed on `origin/main` since, never either alone). Its floor is the
 * instant its pin or chain link took the chair, which can only be later than the thread's own start, so it delays a
 * stale verdict and never brings one early.
 *
 * The Claude chair's other reasons are Claude constructs and are NOT translated: the plan-window and Fable-spread
 * reasons read a Claude plan off its boot credential, `claude-code-behind` compares Claude Code versions, and
 * `auto-compacted` counts a Claude transcript's automatic boundaries. A Codex chair's plan budget would need its
 * thread bound to one captured Codex ceiling and that ceiling's alert threshold captured with the tick, its CLI
 * freshness a reader comparing the running CLI with a fresh seat's, and its auto-compactions a rollout record that
 * says what triggered a compaction — a rollout's `{"type":"compacted"}` item does not (`../context/profileDelivery.ts`).
 * None exists, so each is named UNMEASURED on every verdict rather than read as clean.
 */
import type { ChairCadenceRoute, ChairCadenceVerdict } from "./chairCadence.js";
import { type ChairCanonReading, judgeChairCanon } from "./chairCanon.js";

/** Why a Codex chair's plan budget is not judged. */
export const CODEX_CHAIR_BUDGET_UNMEASURED =
  "its plan budget is UNMEASURED — the thread is not bound to one captured Codex ceiling and its alert threshold";

/** Why a Codex chair's CLI freshness is not judged. */
export const CODEX_CHAIR_CLI_UNMEASURED =
  "its Codex CLI freshness is UNMEASURED — no reader compares the running thread's CLI with a fresh seat's";

/** Why a Codex chair's auto-compactions are not judged: its rollout does not say what triggered a compaction. */
export const CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED =
  "its auto-compactions are UNMEASURED — a Codex rollout's compaction record does not say whether it was automatic";

/**
 * Judge a Codex chair's cadence: hand off on stale canon, and name what a Codex chair cannot yet be judged on.
 *
 * @param threadId the Codex thread holding the chair, named in each note
 * @param canon the chair's canon reading from its recorded floor
 * @param nowIso the tick's own instant, which the chair's age is measured to
 * @param route which plan the tick's gauge says routing picks, carried onto a hand-off
 * @returns stay or hand-off, each with the notes on what could not be measured
 */
export function judgeCodexChairCadence({
  threadId,
  canon,
  nowIso,
  route,
}: {
  threadId: string;
  canon: ChairCanonReading;
  nowIso: string;
  route: ChairCadenceRoute;
}): ChairCadenceVerdict {
  const judged = judgeChairCanon({ canon, nowIso, sessionId: threadId });
  const notes = [
    ...(judged.note === undefined ? [] : [judged.note]),
    `Codex thread ${threadId}: ${CODEX_CHAIR_BUDGET_UNMEASURED}`,
    `Codex thread ${threadId}: ${CODEX_CHAIR_CLI_UNMEASURED}`,
    `Codex thread ${threadId}: ${CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED}`,
  ];
  if (judged.reason === undefined) {
    return { kind: "stay", notes };
  }
  return { kind: "hand-off", notes, reasons: [judged.reason], route };
}
