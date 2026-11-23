/*
 * The `redispatched` event: it round-trips through the log line, refuses a line with no stranded state or no
 * reason, becomes the fold's state and its spend record, survives what follows it, and is never terminal. It was
 * split out when the ask-lifecycle suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  type AskLifecycleEvent,
  askLifecycleEventLine,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
  terminalAskLifecycleEvent,
} from "../../../../../live/ask/lifecycle.js";
import { BASE, CAPTURED } from "./harness.js";

describe("the redispatched event", () => {
  const STRANDED: AskLifecycleEvent = {
    ...BASE,
    kind: "dispatch-failed",
    reason: "nothing ran",
    tsIso: "2026-08-05T13:30:00.000Z",
  };
  const REDISPATCHED: AskLifecycleEvent = {
    ...BASE,
    kind: "redispatched",
    reason: "stranded for 60m",
    strandedAs: "dispatch-failed",
    tsIso: "2026-08-05T14:30:00.000Z",
  };

  it("round-trips through the log line", () => {
    const parsed = parseAskLifecycleLog({ text: askLifecycleEventLine({ event: REDISPATCHED }) });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([REDISPATCHED]);
  });

  it("refuses a line whose strandedAs is not a stranded state", () => {
    const line = JSON.stringify({ ...REDISPATCHED, schemaVersion: 1, strandedAs: "answered" });

    expect(parseAskLifecycleLog({ text: line })).toEqual({ events: [], unreadable: [1] });
  });

  it("refuses a line carrying no reason", () => {
    const line = JSON.stringify({ ...BASE, kind: "redispatched", schemaVersion: 1, strandedAs: "failed" });

    expect(parseAskLifecycleLog({ text: line })).toEqual({ events: [], unreadable: [1] });
  });

  it("becomes the fold's state and its spend record", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, STRANDED, REDISPATCHED] }).get(
      askLifecycleKey({ askIdentity: CAPTURED }),
    );

    expect(entry?.state).toBe("redispatched");
    expect(entry?.redispatched).toEqual(REDISPATCHED);
  });

  it("survives the re-capture, dispatch and strand that follow it", () => {
    const again: AskLifecycleEvent = { ...STRANDED, tsIso: "2026-08-05T16:00:00.000Z" };
    const entry = foldAskLifecycle({
      events: [CAPTURED, STRANDED, REDISPATCHED, CAPTURED, again],
    }).get(askLifecycleKey({ askIdentity: CAPTURED }));

    expect(entry?.state).toBe("dispatch-failed");
    expect(entry?.redispatched).toEqual(REDISPATCHED);
  });

  it("is absent on an ask that has never been picked up again", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, STRANDED] }).get(askLifecycleKey({ askIdentity: CAPTURED }));

    expect(entry?.redispatched).toBe(undefined);
    expect(entry?.surface).toBe("channel");
  });

  it("is never a terminal event", () => {
    expect(terminalAskLifecycleEvent({ event: REDISPATCHED })).toBe(undefined);
  });
});
