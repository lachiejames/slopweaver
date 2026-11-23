/*
 * The fixtures more than one ask-lifecycle test file reads: the identity and instant every event kind carries,
 * the captured event most folds start from, a started checklist, the satisfied-elsewhere terminal and a minimal
 * `respond` decision a dispatched event carries. A plain module, not a `*.test.ts`, so no test registers twice.
 * It was split out when the ask-lifecycle suite became one file per behaviour.
 */
import type { StartedChecklist } from "../../../../../live/ask/checklist.js";
import type { AskLifecycleEvent, CapturedEvent } from "../../../../../live/ask/lifecycle.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

/** The `AskIdentity` + `tsIso` fields every event kind carries, with none of `captured`'s own extras. */
export const BASE: { channel: string; messageTs: string; threadTs: string; tsIso: string } = {
  channel: "C1",
  messageTs: "1785000000.000100",
  threadTs: "1785000000.000100",
  tsIso: "2026-08-05T13:26:00.000Z",
};

export const CAPTURED: CapturedEvent = { ...BASE, kind: "captured", surface: "channel", userId: "U_ASKER" };

export const A_CHECKLIST: StartedChecklist = { turnId: "turn-1", workingTs: "1785000000.000150" };

/**
 * The ask that had no non-posting terminal — `C0SYN000012`/`1787540579.950269`, the owner's
 * burst follow-up, whose content the answer at `1787558807.222889` already covered.
 */
export const SATISFIED: AskLifecycleEvent = {
  ...BASE,
  answeredByTs: "1787558807.222889",
  kind: "satisfied-elsewhere",
  reason: "the answer to their question is already standing in this thread",
};

/** A minimal `respond` decision — every `dispatched` event now carries one. */
export const A_DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  truthMode: "none",
  schemaVersion: 1,
  tier: "inline",
};
