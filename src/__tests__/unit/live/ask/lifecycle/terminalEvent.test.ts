/*
 * `terminalAskLifecycleEvent`: which single event kinds end an ask, and which do not. It was split out when the
 * ask-lifecycle suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { type AskLifecycleEvent, terminalAskLifecycleEvent } from "../../../../../live/ask/lifecycle.js";
import { A_DECISION, BASE, CAPTURED, SATISFIED } from "./harness.js";

describe("terminalAskLifecycleEvent", () => {
  it.each(["answered", "triaged-no-response", "withheld", "satisfied-elsewhere"] as const)(
    "names %s as terminal",
    (kind) => {
      let event: AskLifecycleEvent;
      if (kind === "answered") {
        event = { ...BASE, answerTs: "1785000030.000100", kind };
      } else if (kind === "triaged-no-response") {
        event = { ...BASE, kind, reason: "already resolved elsewhere" };
      } else if (kind === "satisfied-elsewhere") {
        event = SATISFIED;
      } else {
        event = { ...BASE, code: "unclear-intent", kind, queueId: "q-1", reason: "ambiguous request" };
      }

      expect(terminalAskLifecycleEvent({ event })).toEqual(event);
    },
  );

  it.each(["captured", "dispatched", "failed", "lease-expired", "checklist-posted"] as const)(
    "does not name %s as terminal",
    (kind) => {
      let event: AskLifecycleEvent;
      if (kind === "captured") {
        event = CAPTURED;
      } else if (kind === "dispatched") {
        event = { ...BASE, decision: A_DECISION, kind, leaseExpiresAt: "2026-08-05T14:00:00.000Z", tier: "inline" };
      } else if (kind === "failed") {
        event = { ...BASE, kind, reason: "turn threw before answering" };
      } else if (kind === "lease-expired") {
        event = { ...BASE, kind };
      } else {
        event = { ...BASE, kind, turnId: "turn-1", workingTs: "1785000000.000900" };
      }

      expect(terminalAskLifecycleEvent({ event })).toBe(undefined);
    },
  );
});
