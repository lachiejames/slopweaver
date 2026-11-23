/*
 * The pass watch, read directly: it relays and folds every event, a throwing relay loses nothing from the fold,
 * a run of failing early commands trips the abort, a sealed watch folds without judging, and a new turn forgets
 * only the last reported failure.
 */

import { describe, expect, it } from "vitest";
import { armTripwire } from "../../../codex/passWatch.js";
import type { CodexObservedEvent } from "../../../codex/types.js";
import { FakeRuntime } from "./runPass/harness.js";

/**
 * A command that ran and failed, the shape the tripwire counts.
 *
 * @returns an item event carrying that command and exit code
 */
function failedCommand({ index }: { index: number }): CodexObservedEvent {
  return {
    item: { command: `cat missing-${String(index)}.md`, exitCode: 1, itemKind: "command_execution" },
    kind: "item",
  };
}

const ROOTS = { repoRoot: "/repo", startedAtMs: 0, workspaceRoot: "/scratch" };

describe("armTripwire", () => {
  it("relays every event to the caller and folds it", () => {
    const seen: CodexObservedEvent[] = [];
    const watch = armTripwire({ ...ROOTS, onEvent: (event) => seen.push(event), runtime: new FakeRuntime() });

    watch.onEvent({ kind: "thread-started", threadId: "t1" });

    expect(seen).toEqual([{ kind: "thread-started", threadId: "t1" }]);
    expect(watch.activity().threadId).toBe("t1");
    expect(watch.tripped()).toBeUndefined();
  });

  it("still folds an event when the caller's relay throws", () => {
    const watch = armTripwire({
      ...ROOTS,
      onEvent: () => {
        throw new Error("relay broke");
      },
      runtime: new FakeRuntime(),
    });

    watch.onEvent(failedCommand({ index: 1 }));

    expect(watch.activity().commands).toBe(1);
    expect(watch.activity().failedCommands).toBe(1);
  });

  it("aborts once every early command has failed, and says so", () => {
    const watch = armTripwire({ ...ROOTS, onEvent: undefined, runtime: new FakeRuntime() });

    for (const index of [1, 2, 3, 4]) {
      watch.onEvent(failedCommand({ index }));
    }

    expect(watch.abort.signal.aborted).toBe(true);
    expect(watch.tripped()!.verdict).toBe("abort");
  });

  it("keeps folding but never aborts once sealed", () => {
    const watch = armTripwire({ ...ROOTS, onEvent: undefined, runtime: new FakeRuntime() });
    watch.seal();

    for (const index of [1, 2, 3, 4]) {
      watch.onEvent(failedCommand({ index }));
    }

    expect(watch.abort.signal.aborted).toBe(false);
    expect(watch.tripped()).toBeUndefined();
    expect(watch.activity().failedCommands).toBe(4);
  });

  it("forgets only the last reported failure when a new turn begins", () => {
    const watch = armTripwire({ ...ROOTS, onEvent: undefined, runtime: new FakeRuntime() });
    watch.onEvent({ kind: "thread-started", threadId: "t1" });
    watch.onEvent({ kind: "turn-failed", message: "spend cap reached" });

    expect(watch.activity().lastReportedFailure).toBe("spend cap reached");

    watch.beginTurn();

    expect(watch.activity().lastReportedFailure).toBeUndefined();
    expect(watch.activity().threadId).toBe("t1");
  });
});
