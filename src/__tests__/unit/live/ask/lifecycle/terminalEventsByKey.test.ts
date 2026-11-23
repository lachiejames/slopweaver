/*
 * `terminalAskEventsByKey`: the terminal event recorded per ask, keyed the way the fold is, monotonic under a
 * later re-capture and keeping the last terminal when several were recorded. It was split out when the
 * ask-lifecycle suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  type AskLifecycleEvent,
  askLifecycleKey,
  type CapturedEvent,
  terminalAskEventsByKey,
} from "../../../../../live/ask/lifecycle.js";
import { BASE, CAPTURED } from "./harness.js";

describe("terminalAskEventsByKey", () => {
  it("is empty when no event is terminal", () => {
    expect(terminalAskEventsByKey({ events: [CAPTURED] }).size).toBe(0);
  });

  it("records a terminal event, keyed the same way the fold is", () => {
    const answered: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };

    const map = terminalAskEventsByKey({ events: [CAPTURED, answered] });

    expect(map.get(askLifecycleKey({ askIdentity: CAPTURED }))).toEqual(answered);
  });

  it("is MONOTONIC — a later captured event does not remove an already-terminal key", () => {
    const answered: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };
    const recaptured: AskLifecycleEvent = { ...CAPTURED, tsIso: "2026-08-05T13:40:00.000Z" };

    const map = terminalAskEventsByKey({ events: [CAPTURED, answered, recaptured] });

    expect(map.get(askLifecycleKey({ askIdentity: CAPTURED }))).toEqual(answered);
  });

  it("keeps the LAST terminal event when more than one was recorded for the same key", () => {
    const triaged: AskLifecycleEvent = { ...BASE, kind: "triaged-no-response", reason: "first pass" };
    const withheld: AskLifecycleEvent = {
      ...BASE,
      code: "unclear-intent",
      kind: "withheld",
      queueId: "q-1",
      reason: "second pass",
    };

    const map = terminalAskEventsByKey({ events: [CAPTURED, triaged, withheld] });

    expect(map.get(askLifecycleKey({ askIdentity: CAPTURED }))).toEqual(withheld);
  });

  it("keeps two asks sharing a thread as separate entries", () => {
    const second: CapturedEvent = { ...CAPTURED, messageTs: "1785000000.000200" };
    const answeredFirst: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };
    const answeredSecond: AskLifecycleEvent = {
      ...BASE,
      answerTs: "1785000040.000100",
      kind: "answered",
      messageTs: "1785000000.000200",
    };

    const map = terminalAskEventsByKey({ events: [CAPTURED, second, answeredFirst, answeredSecond] });

    expect(map.size).toBe(2);
    expect(map.get(askLifecycleKey({ askIdentity: CAPTURED }))).toEqual(answeredFirst);
    expect(map.get(askLifecycleKey({ askIdentity: second }))).toEqual(answeredSecond);
  });
});
