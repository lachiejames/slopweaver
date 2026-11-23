/**
 * Which chair the gate judges, decided off the records before any Claude tab is read — the pure half of
 * `./chairGateRun.ts`.
 *
 * A Codex chair has no Claude transcript and no Fable requirement (AGENTS.md rule 5), so the gate steps aside for it.
 * It still hands its cadence what was MEASURED: the thread id and the instant its record took the chair, which is
 * the floor its loaded canon is judged from (`../../../supervisor/codexChairCadence.ts`). Records too damaged to name
 * the host are read first and step aside with nothing, whatever the caller's environment says, so `CODEX_THREAD_ID`
 * can never turn a damaged record into a judged chair (Codex 4c plan, property 2).
 */
import type { RecordedChair } from "../../../supervisor/recordedChairHost.js";
import { UNRESOLVED_CHAIR_RECORD } from "../../../supervisor/recordedChairHost.js";
import type { SupervisorSessionDetection } from "../../../supervisor/session.js";
import type { ChairGateEvidence } from "./chairGateRun.js";

/** Why the gate does not judge a Codex caller: it has no Fable requirement and spends no Anthropic organisation. */
const CODEX_CALLER_DIAGNOSTIC =
  "this is a Codex-hosted chair, which has no Fable requirement and spends no Anthropic organisation";

/** What the records decide: judge the Claude chair as before, or step aside with this evidence. */
export type RecordedChairDecision =
  | { readonly kind: "claude-gate" }
  | { readonly kind: "step-aside"; readonly stderrLine: string; readonly evidence: ChairGateEvidence };

/**
 * Decide off the strict recorded chair and the caller's own host whether the Claude gate applies.
 *
 * @param recorded the strict recorded chair (`readRecordedChair`)
 * @param caller the visible session running this verb
 * @returns the Claude gate, or the evidence and stderr line to step aside with
 */
export function recordedChairDecision({
  recorded,
  caller,
}: {
  recorded: RecordedChair;
  caller: SupervisorSessionDetection;
}): RecordedChairDecision {
  if (recorded.kind === "unresolved") {
    return {
      stderrLine: UNRESOLVED_CHAIR_RECORD,
      // The cadence line carries the record's own reason, so a damaged pin instant reads as an UNMEASURED floor with
      // its cause rather than a generic skip (Codex c1-02).
      evidence: { kind: "not-read", why: `${UNRESOLVED_CHAIR_RECORD}: ${recorded.why}` },
      kind: "step-aside",
    };
  }
  if (recorded.kind === "session" && recorded.session.host === "codex") {
    return {
      stderrLine: "the recorded chair is a Codex thread, so no Claude tab in the pinned workspace is the chair",
      evidence: {
        canonFloor: { kind: "measured", pinnedAtIso: recorded.pinnedAtIso },
        kind: "codex",
        threadId: recorded.session.id,
      },
      kind: "step-aside",
    };
  }
  if (caller.kind !== "active" || caller.session.host !== "codex") {
    return { kind: "claude-gate" };
  }
  if (recorded.kind === "session") {
    return {
      stderrLine: CODEX_CALLER_DIAGNOSTIC,
      evidence: {
        kind: "not-read",
        why: `this Codex thread is not the chair the records name (Claude Code session ${recorded.session.id})`,
      },
      kind: "step-aside",
    };
  }
  return {
    stderrLine: CODEX_CALLER_DIAGNOSTIC,
    evidence: {
      canonFloor: {
        kind: "unmeasured",
        why: "no supervisor pin or chain link records when this Codex thread took the chair",
      },
      kind: "codex",
      threadId: caller.session.id,
    },
    kind: "step-aside",
  };
}
