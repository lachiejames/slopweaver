import { describe, expect, it } from "vitest";

import { GUARDED_ENDINGS, type GuardedProcess, guardOwnedTab } from "../../../browser/tabGuard.js";

/**
 * A recording stand-in for the process, built by hand rather than with `vi.fn` — a plain fake passed in is
 * a seam, and `testing.md` bans the mock helpers outright.
 */
function recorder(): {
  readonly guarded: GuardedProcess;
  readonly fire: ({ event }: { event: string }) => void;
  readonly listening: () => readonly string[];
  readonly exits: () => readonly number[];
} {
  const handlers = new Map<string, (() => void)[]>();
  const exits: number[] = [];
  // An event nothing has subscribed to has no handlers, exactly as on a real `process`: firing it does nothing,
  // and removing a handler from it removes nothing.
  const subscribed = ({ event }: { event: string }): readonly (() => void)[] => {
    const registered = handlers.get(event);
    if (registered === undefined) {
      return [];
    }
    return registered;
  };
  return {
    exits: () => [...exits],
    fire: ({ event }) => {
      [...subscribed({ event })].forEach((handler) => {
        handler();
      });
    },
    guarded: {
      exit: ({ code }) => {
        exits.push(code);
      },
      off: ({ event, handler }) => {
        const kept = subscribed({ event }).filter((entry) => entry !== handler);
        handlers.set(event, kept);
      },
      on: ({ event, handler }) => {
        handlers.set(event, [...subscribed({ event }), handler]);
      },
    },
    listening: () =>
      [...handlers.entries()]
        .filter((entry) => entry[1].length > 0)
        .map((entry) => entry[0])
        .toSorted(),
  };
}

describe("guardOwnedTab", () => {
  it("registers against exit and both signals", () => {
    const rec = recorder();
    guardOwnedTab({ close: () => undefined, guarded: rec.guarded });

    expect(rec.listening()).toEqual(["SIGINT", "SIGTERM", "exit"]);
  });

  it("closes the tab when the process exits without a release", () => {
    const rec = recorder();
    let closed = 0;
    guardOwnedTab({
      close: () => {
        closed += 1;
      },
      guarded: rec.guarded,
    });

    rec.fire({ event: "exit" });

    expect(closed).toBe(1);
  });

  it("closes the tab on SIGINT and still exits 130, so Ctrl-C is not swallowed", () => {
    const rec = recorder();
    let closed = 0;
    guardOwnedTab({
      close: () => {
        closed += 1;
      },
      guarded: rec.guarded,
    });

    rec.fire({ event: "SIGINT" });

    expect(closed).toBe(1);
    expect(rec.exits()).toEqual([130]);
  });

  it("exits 143 on SIGTERM", () => {
    const rec = recorder();
    guardOwnedTab({ close: () => undefined, guarded: rec.guarded });

    rec.fire({ event: "SIGTERM" });

    expect(rec.exits()).toEqual([143]);
  });

  it("closes at most once across several endings", () => {
    const rec = recorder();
    let closed = 0;
    guardOwnedTab({
      close: () => {
        closed += 1;
      },
      guarded: rec.guarded,
    });

    rec.fire({ event: "SIGINT" });
    rec.fire({ event: "exit" });

    expect(closed).toBe(1);
  });

  it("the disposer unregisters every handler, so a clean release leaves nothing behind", () => {
    const rec = recorder();
    const dispose = guardOwnedTab({ close: () => undefined, guarded: rec.guarded });

    dispose();

    expect(rec.listening()).toEqual([]);
  });

  it("does not close again after a release already closed the tab", () => {
    const rec = recorder();
    let closed = 0;
    const dispose = guardOwnedTab({
      close: () => {
        closed += 1;
      },
      guarded: rec.guarded,
    });

    dispose();
    rec.fire({ event: "exit" });

    expect(closed).toBe(0);
  });

  it("names exit with no code of its own and each signal with the shell's convention", () => {
    expect(GUARDED_ENDINGS.map((ending) => `${ending.event}:${String(ending.code)}`)).toEqual([
      "exit:null",
      "SIGINT:130",
      "SIGTERM:143",
    ]);
  });
});
