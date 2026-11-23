/**
 * A ledger write never changes the act: a launch through the recording decorator returns unchanged, and says what the
 * ledger lost, whatever its ledger does — throws, throws a value whose string form throws, rejects asynchronously,
 * rejects from another realm, rejects with its own `catch` shadowed, or fails its warning sink too.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { ok, unwrap } from "../../../lib/result.js";
import { recordingSessionLauncher, type SessionLedgerDeps } from "../../../sessionHarness/recordingHarness.js";
import { collectingLedger, hostileLedger, NOW, OPENED, SPEC, scriptedLauncher } from "./recordingLedgerFixtures.js";

describe("recordingSessionLauncher — a ledger that fails", () => {
  it("warns when the ledger cannot be written and returns the launch unchanged", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({ failWith: "EACCES: the disk said no" });
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (EACCES: the disk said no) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("returns the launch unchanged, and warns, when the ledger clock throws", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger, warnings } = collectingLedger({ clockFails: "clock failed" });
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (clock failed) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("returns the launch unchanged, and still warns, when the ledger throws a value whose string form throws", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = hostileLedger();
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: a `message` GETTER answering a rejecting promise. The thrown
  // value's own code is never run, so a getter answering a Symbol or a rejecting promise is named, never read.
  it("warns without running a thrown Error's message getter, whatever it would answer", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    let getterRuns = 0;
    const answers = [(): unknown => Symbol("hostile"), (): unknown => Promise.reject(new Error("nested rejection"))];
    const results = [];
    for (const answer of answers) {
      const hostile = new Error("replaced below");
      Object.defineProperty(hostile, "message", {
        get: () => {
          getterRuns += 1;
          return answer();
        },
      });
      const append = (): never => {
        throw hostile;
      };
      const recorder = recordingSessionLauncher({ implementation: "cmux", launcher, ledger: { ...ledger, append } });
      results.push(unwrap(await recorder.open({ spec: SPEC })));
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(results).toEqual([OPENED, OPENED]);
    expect(getterRuns).toBe(0);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: an Error whose own DATA `message` is a rejected promise.
  it("warns and settles a rejected promise an Error keeps as its own message", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const append = (): never => {
      const thrown = new Error("placeholder");
      Object.defineProperty(thrown, "message", { value: Promise.reject(new Error("nested")) });
      throw thrown;
    };
    const recorder = recordingSessionLauncher({ implementation: "cmux", launcher, ledger: { ...ledger, append } });
    const launched = await recorder.open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(unwrap(launched)).toEqual(OPENED);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("names a primitive a ledger throws by its own string form", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const thrown: unknown[] = [Symbol("sym"), 42, undefined];
    for (const value of thrown) {
      const append = (): never => {
        // oxlint-disable-next-line only-throw-error -- the hostile value under test
        throw value;
      };
      await recordingSessionLauncher({ implementation: "cmux", launcher, ledger: { ...ledger, append } }).open({
        spec: SPEC,
      });
    }

    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (Symbol(sym)) — the act itself went through; the ledger is missing this row",
      "session ledger: could not record the open for a-doc (42) — the act itself went through; the ledger is missing this row",
      "session ledger: could not record the open for a-doc (undefined) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("warns, rather than leaving a rejection unhandled, when an async ledger append rejects", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const warnings: string[] = [];
    const ledger: SessionLedgerDeps = {
      append: async () => {
        await Promise.resolve();
        throw new Error("ENOSPC");
      },
      nowIso: () => NOW,
      openSessionKey: () => "a-doc",
      warn: ({ message }) => {
        warnings.push(message);
      },
    };
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("warns when the ledger append returns a rejecting thenable that is not this realm's Promise", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    let foreign: unknown;
    const launched = await recordingSessionLauncher({
      implementation: "cmux",
      launcher,
      ledger: {
        ...ledger,
        append: () => {
          foreign = runInNewContext("Promise.reject('ENOSPC')");
          return foreign;
        },
      },
    }).open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    expect(foreign instanceof Promise).toBe(false);
    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("warns when the ledger append returns a rejecting native promise whose own catch is shadowed", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const launched = await recordingSessionLauncher({
      implementation: "cmux",
      launcher,
      ledger: {
        ...ledger,
        append: () => {
          const rejected = Promise.reject(new Error("ENOSPC"));
          Object.defineProperty(rejected, "catch", { value: undefined });
          return rejected;
        },
      },
    }).open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: a clock answering a rejecting promise past its type.
  it("warns, writes no row and leaves no rejection unhandled when the ledger clock answers a rejecting promise", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const launched = await recordingSessionLauncher({
      implementation: "cmux",
      launcher,
      ledger: { ...ledger, nowIso: () => Promise.reject(new Error("clock failed")) as unknown as string },
    }).open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(unwrap(launched)).toEqual(OPENED);
    expect(events).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (the ledger answered a object, not a timestamp) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: a member that is a getter answering a rejecting promise.
  it("warns once and leaves no rejection unhandled when ledger members are getters answering rejecting promises", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const clockGetter = Object.defineProperty({ ...ledger }, "nowIso", {
      get: () => Promise.reject(new Error("clock rejection")),
    });
    const sinkGetter = Object.defineProperty(
      { ...ledger, append: (): never => Promise.reject(new Error("ENOSPC")) as never },
      "warn",
      { get: () => Promise.reject(new Error("sink rejection")) },
    );
    const results = [];
    for (const hostile of [clockGetter, sinkGetter]) {
      results.push(
        unwrap(
          await recordingSessionLauncher({ implementation: "cmux", launcher, ledger: hostile }).open({ spec: SPEC }),
        ),
      );
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(results).toEqual([OPENED, OPENED]);
    expect(events).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (the ledger's nowIso is a object, not a function) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: a member that THROWS a rejecting promise, or rejects with one.
  it("warns and leaves no rejection unhandled when ledger members throw or reject with a rejecting promise", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const thrownByClock: SessionLedgerDeps = {
      ...ledger,
      nowIso: () => {
        // oxlint-disable-next-line only-throw-error -- the hostile value under test
        throw Promise.reject(new Error("clock failed"));
      },
    };
    const rejectedWithByAppend: SessionLedgerDeps = {
      ...ledger,
      // oxlint-disable-next-line prefer-promise-reject-errors -- a promise as the rejection reason is the case under test
      append: () => Promise.reject(Promise.reject(new Error("ENOSPC"))),
      warn: () => {
        // oxlint-disable-next-line only-throw-error -- the hostile value under test
        throw Promise.reject(new Error("EPIPE"));
      },
    };
    const results = [];
    for (const hostile of [thrownByClock, rejectedWithByAppend]) {
      const recorder = recordingSessionLauncher({ implementation: "cmux", launcher, ledger: hostile });
      results.push(unwrap(await recorder.open({ spec: SPEC })));
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(results).toEqual([OPENED, OPENED]);
    expect(events).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: an append answering a promise rejected with ITSELF, which an
  // unbounded absorb chases forever, starving the loop so nothing after it (a timer, the act) ever runs.
  it("warns once and lets the loop move on when the ledger append answers a promise rejected with itself", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    let rejectCycle: (reason: unknown) => void = () => undefined;
    const cycle = new Promise((_resolve, reject) => {
      rejectCycle = reject;
    });
    rejectCycle(cycle);
    const recorder = recordingSessionLauncher({
      implementation: "cmux",
      launcher,
      ledger: { ...ledger, append: () => cycle },
    });
    const launched = await recorder.open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (a thrown value that could not be read as text) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: another realm's rejected promise with its own `then` shadowed,
  // which `await` takes for a plain value, missing the rejection.
  it("warns, leaving no rejection unhandled, when the append answers a foreign promise whose then is shadowed", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const append = (): unknown => {
      const foreign: unknown = runInNewContext("Promise.reject('ENOSPC')");
      // oxlint-disable-next-line unicorn/no-thenable -- shadowing `then` away is the hostile value under test
      Object.defineProperty(foreign, "then", { value: undefined });
      return foreign;
    };
    const recorder = recordingSessionLauncher({ implementation: "cmux", launcher, ledger: { ...ledger, append } });
    const launched = await recorder.open({ spec: SPEC });
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(unwrap(launched)).toEqual(OPENED);
    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  // Counterexample: a `then` that is a rejected promise rather than a function,
  // which `await` reads and drops; and a thenable fulfilling with a rejected promise, which must still warn.
  it("settles what an answered object keeps as then, and warns on a thenable fulfilling with a rejection", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger, warnings } = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const answers = [
      // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
      (): unknown => ({ then: Promise.reject(new Error("lost")) }),
      (): unknown => ({
        // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
        then: ((fulfil) => {
          fulfil(Promise.reject(new Error("ENOSPC")));
        }) satisfies ConstructorParameters<typeof Promise>[0],
      }),
    ];
    for (const append of answers) {
      const recorder = recordingSessionLauncher({ implementation: "cmux", launcher, ledger: { ...ledger, append } });
      await recorder.open({ spec: SPEC });
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("returns the launch unchanged when the warning sink throws too", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { ledger } = collectingLedger({ failWith: "ENOSPC", warnFails: "EPIPE" });
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(OPENED);
  });
});
