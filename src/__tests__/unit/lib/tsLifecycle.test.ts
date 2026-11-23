import { afterEach, describe, expect, it } from "vitest";

import { closeTypeScript, lazyTypeScriptClient, registerTypeScriptCloser } from "../../../lib/tsLifecycle.js";

/** What a failed close threw, caught so it can be asserted on. */
function caughtClose(): unknown {
  try {
    closeTypeScript();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

// Isolation only: the seams register their own closers when this file imports nothing of theirs, but a case
// that leaves one behind must not leak it into the next. Every assertion below performs its own close.
afterEach(() => {
  closeTypeScript();
});

describe("closeTypeScript", () => {
  it("runs a closer registered twice exactly once, and a second close runs nothing", () => {
    const events: string[] = [];
    const close = (): void => {
      events.push("close");
    };
    registerTypeScriptCloser({ close });
    registerTypeScriptCloser({ close });

    closeTypeScript();
    closeTypeScript();

    expect(events).toEqual(["close"]);
  });

  it("runs nothing for a registration removed, however often it is removed", () => {
    const events: string[] = [];
    const deregister = registerTypeScriptCloser({
      close: () => {
        events.push("close");
      },
    });
    deregister();
    deregister();

    closeTypeScript();

    expect(events).toEqual([]);
  });

  it("runs every closer past a failing one and throws the failures together, in order", () => {
    const events: string[] = [];
    const first = new Error("first");
    const last = new Error("last");
    registerTypeScriptCloser({
      close: () => {
        throw first;
      },
    });
    registerTypeScriptCloser({
      close: () => {
        events.push("middle");
      },
    });
    registerTypeScriptCloser({
      close: () => {
        throw last;
      },
    });

    const thrown = caughtClose() as AggregateError;

    expect(events).toEqual(["middle"]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.message).toBe("2 TypeScript client closer(s) failed");
    expect(thrown.errors).toEqual([first, last]);
    expect(thrown.errors[0]).toBe(first);
    expect(thrown.errors[1]).toBe(last);
  });

  it("clears the registry even when a closer threw, so neither reruns and a fresh one runs alone", () => {
    const events: string[] = [];
    registerTypeScriptCloser({
      close: () => {
        events.push("failing");
        throw new Error("boom");
      },
    });
    expect(caughtClose()).toBeInstanceOf(AggregateError);

    closeTypeScript();
    registerTypeScriptCloser({
      close: () => {
        events.push("fresh");
      },
    });
    closeTypeScript();

    expect(events).toEqual(["failing", "fresh"]);
  });
});

describe("lazyTypeScriptClient", () => {
  /** A client that records its own opening and closing under a serial number. */
  function recordingOpen({ events }: { events: string[] }): () => { close: () => void; serial: number } {
    let opened = 0;
    return () => {
      opened += 1;
      const serial = opened;
      events.push(`open ${String(serial)}`);
      return {
        close: () => {
          events.push(`close ${String(serial)}`);
        },
        serial,
      };
    };
  }

  it("opens nothing until first called, then answers one client until it is closed", () => {
    const events: string[] = [];
    const client = lazyTypeScriptClient({ open: recordingOpen({ events }) });
    expect(events).toEqual([]);

    const first = client();
    const second = client();

    expect(first.serial).toBe(1);
    expect(second).toBe(first);
    expect(events).toEqual(["open 1"]);
  });

  it("closes the client with closeTypeScript and opens a fresh one on the next call", () => {
    const events: string[] = [];
    const client = lazyTypeScriptClient({ open: recordingOpen({ events }) });
    client();

    closeTypeScript();
    const reopened = client();
    closeTypeScript();

    expect(reopened.serial).toBe(2);
    expect(events).toEqual(["open 1", "close 1", "open 2", "close 2"]);
  });
});
