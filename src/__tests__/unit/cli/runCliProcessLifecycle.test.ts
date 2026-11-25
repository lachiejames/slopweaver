/**
 * `runCliProcess` closes every TypeScript client exactly once, after the verb and its pending effects and before
 * the drain and the exit — whether the verb answered zero, answered non-zero or threw. The close lives at the
 * process boundary and never in `main` (`src/lib/tsLifecycle.ts`), so the ORDER is the property under test.
 */
import { describe, expect, it } from "vitest";

import { runCliProcess } from "../../../cli/main.js";
import { trackEffect } from "../../../lib/pendingEffects.js";

/** Run the shell over one injected verb, recording every lifecycle step in order. */
async function lifecycleOf({ run }: { run: (events: string[]) => Promise<number> }): Promise<readonly string[]> {
  const events: string[] = [];
  await runCliProcess({
    argv: ["node", "cli", "probe", "verb"],
    close: () => {
      events.push("close");
    },
    drain: () => {
      events.push("drain");
      return Promise.resolve();
    },
    exit: (code) => {
      events.push(`exit:${String(code)}`);
    },
    run: () => run(events),
  });
  return events;
}

describe("runCliProcess closes TypeScript once, between the verb and the drain", () => {
  it("on a verb that succeeds", async () => {
    const events = await lifecycleOf({
      run: (log) => {
        log.push("main");
        return Promise.resolve(0);
      },
    });

    expect(events).toEqual(["main", "close", "drain", "exit:0"]);
  });

  it("on a verb that answers a non-zero code, which it exits with", async () => {
    const events = await lifecycleOf({
      run: (log) => {
        log.push("main");
        return Promise.resolve(19);
      },
    });

    expect(events).toEqual(["main", "close", "drain", "exit:19"]);
  });

  it("on a verb that answers 256, exiting 1 rather than the 0 a process status would read it as", async () => {
    const events = await lifecycleOf({
      run: (log) => {
        log.push("main");
        return Promise.resolve(256);
      },
    });

    expect(events).toEqual(["main", "close", "drain", "exit:1"]);
  });

  it("on a verb that answers a negative or fractional code, exiting 1", async () => {
    const negative = await lifecycleOf({ run: () => Promise.resolve(-1) });
    const fractional = await lifecycleOf({ run: () => Promise.resolve(2.5) });

    expect([negative, fractional]).toEqual([
      ["close", "drain", "exit:1"],
      ["close", "drain", "exit:1"],
    ]);
  });

  it("on a verb that throws, exiting 1", async () => {
    const events = await lifecycleOf({
      run: (log) => {
        log.push("main");
        return Promise.reject(new Error("boom"));
      },
    });

    expect(events).toEqual(["main", "close", "drain", "exit:1"]);
  });

  it("on a restart: closes, drains, restarts, and never runs the verb in the stale process", async () => {
    const events: string[] = [];
    await runCliProcess({
      argv: ["node", "cli", "probe", "verb"],
      close: () => {
        events.push("close");
      },
      drain: () => {
        events.push("drain");
        return Promise.resolve();
      },
      exit: (code) => {
        events.push(`exit:${String(code)}`);
      },
      guard: () => Promise.resolve({ disposition: "restart", lines: ["restarting"] }),
      // A real restart never returns; one that does could not attempt the exec, and the process exits 1.
      restart: () => {
        events.push("restart");
        return "could not restart";
      },
      run: () => {
        events.push("main");
        return Promise.resolve(0);
      },
    });

    expect(events).toEqual(["close", "drain", "restart", "drain", "exit:1"]);
  });

  it("on a source restart: closes, drains, restarts on THAT checkout's source, and never runs the verb here", async () => {
    const events: string[] = [];
    await runCliProcess({
      argv: ["node", "cli", "probe", "verb"],
      close: () => {
        events.push("close");
      },
      drain: () => {
        events.push("drain");
        return Promise.resolve();
      },
      exit: (code) => {
        events.push(`exit:${String(code)}`);
      },
      guard: () => Promise.resolve({ disposition: "source", lines: ["behind"], source: { root: "/w/seat" } }),
      restart: () => {
        events.push("restart");
        return "could not restart";
      },
      // A real source restart never returns; one that does could not attempt the exec, and the process exits 1.
      source: ({ root }) => {
        events.push(`source:${root}`);
        return "could not restart on source";
      },
      run: () => {
        events.push("main");
        return Promise.resolve(0);
      },
    });

    expect(events).toEqual(["close", "drain", "source:/w/seat", "drain", "exit:1"]);
  });

  it("on a refusal: closes, drains and exits 1, running neither the verb nor a restart", async () => {
    const events: string[] = [];
    await runCliProcess({
      argv: ["node", "cli", "probe", "verb"],
      close: () => {
        events.push("close");
      },
      drain: () => {
        events.push("drain");
        return Promise.resolve();
      },
      exit: (code) => {
        events.push(`exit:${String(code)}`);
      },
      guard: () => Promise.resolve({ disposition: "refuse", lines: ["refused"] }),
      restart: () => {
        events.push("restart");
        return "could not restart";
      },
      run: () => {
        events.push("main");
        return Promise.resolve(0);
      },
    });

    expect(events).toEqual(["close", "drain", "exit:1"]);
  });

  it("only after a pending effect the verb started has settled", async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ran: () => void = () => undefined;
    const verbRan = new Promise<void>((resolve) => {
      ran = resolve;
    });

    const done = runCliProcess({
      argv: ["node", "cli", "probe", "verb"],
      close: () => {
        events.push("close");
      },
      drain: () => {
        events.push("drain");
        return Promise.resolve();
      },
      exit: (code) => {
        events.push(`exit:${String(code)}`);
      },
      run: () => {
        events.push("main");
        trackEffect({ effect: held.then(() => void events.push("effect")) });
        ran();
        return Promise.resolve(0);
      },
    });

    await verbRan;
    await Promise.resolve();
    expect(events).toEqual(["main"]);

    release();
    await done;
    expect(events).toEqual(["main", "effect", "close", "drain", "exit:0"]);
  });
});
