/**
 * Settling what an untrusted dependency hands over: a thrown value is named without running any of its code, and a
 * rejection is handed to the caller once — whether it arrives as a native promise, a foreign one with `then` shadowed,
 * a thenable, or a promise rejected with itself — and never left unhandled.
 */
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { absorb, describeThrown, settleQuietly } from "../../../sessionHarness/untrustedSettle.js";

/** A promise rejected with `reason` as it is — a non-Error reason, or a promise, is the hostile value under test. */
function rejectedWith({ reason }: { reason: unknown }): Promise<never> {
  // oxlint-disable-next-line prefer-promise-reject-errors -- a non-Error rejection reason is the case under test
  return Promise.reject(reason);
}

/** A thenable's `then`, typed as the Promise executor it is called like, so its callbacks inherit their shape. */
type Executor = ConstructorParameters<typeof Promise>[0];

/** Run `body`, let the loop turn, and answer every rejection Node saw go unhandled meanwhile. */
async function unhandledDuring({ body }: { body: () => void }): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  body();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  process.off("unhandledRejection", onUnhandled);
  return unhandled;
}

describe("describeThrown", () => {
  it("names a string, a primitive and an Error's own message as themselves", () => {
    const named = [new Error("ENOSPC"), "EPIPE", 42, Symbol("sym"), undefined].map((error) =>
      describeThrown({ error }),
    );

    expect(named).toEqual(["ENOSPC", "EPIPE", "42", "Symbol(sym)", "undefined"]);
  });

  // Counterexample: an Error of another realm fails `instanceof Error`.
  it("reads an Error of another realm by its own message, settling one kept as a rejected promise", async () => {
    let named: unknown[] = [];
    const unhandled = await unhandledDuring({
      body: () => {
        const foreign: unknown = runInNewContext("new Error('EACCES')");
        const rejecting: unknown = runInNewContext(
          "const e = new Error('x'); Object.defineProperty(e, 'message', { value: Promise.reject('nested') }); e",
        );
        named = [describeThrown({ error: foreign }), describeThrown({ error: rejecting })];
      },
    });

    expect(named).toEqual(["EACCES", "a thrown value that could not be read as text"]);
    expect(unhandled).toEqual([]);
  });

  it("names, without running it, an object whose text would need its own code", () => {
    let runs = 0;
    const hostile = new Error("placeholder");
    Object.defineProperty(hostile, "message", {
      get: () => {
        runs += 1;
        return "never read";
      },
    });
    const coercing = {
      toString: (): string => {
        runs += 1;
        return "never read";
      },
    };

    expect([describeThrown({ error: hostile }), describeThrown({ error: coercing })]).toEqual([
      "a thrown value that could not be read as text",
      "a thrown value that could not be read as text",
    ]);
    expect(runs).toBe(0);
  });
});

describe("settleQuietly", () => {
  it("hands each kind of rejection to the caller once, leaving none unhandled", async () => {
    const reasons: unknown[] = [];
    const onRejected: (reason: unknown) => void = (reason) => {
      reasons.push(reason);
    };
    const unhandled = await unhandledDuring({
      body: () => {
        settleQuietly({ onRejected, returned: rejectedWith({ reason: "native" }) });
        const foreign: unknown = runInNewContext("Promise.reject('foreign')");
        // oxlint-disable-next-line unicorn/no-thenable -- shadowing `then` away is the hostile value under test
        Object.defineProperty(foreign, "then", { value: undefined });
        settleQuietly({ onRejected, returned: foreign });
        settleQuietly({
          onRejected,
          // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
          returned: { then: ((_, reject) => reject("thenable")) satisfies Executor },
        });
        settleQuietly({ onRejected, returned: "a plain value" });
      },
    });

    expect(unhandled).toEqual([]);
    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual(expect.arrayContaining(["foreign", "native", "thenable"]));
  });

  // Counterexample: the FIRST callback decides, so a thenable that fulfils and then
  // throws, or then rejects, has fulfilled; one that rejects and then fulfils has rejected, once.
  it("lets a thenable's first callback decide, whatever it does after", async () => {
    const reasons: unknown[] = [];
    const onRejected: (reason: unknown) => void = (reason) => {
      reasons.push(reason);
    };
    const thenables: Executor[] = [
      (fulfil) => {
        fulfil(undefined);
        throw new Error("after fulfil");
      },
      (fulfil, reject) => {
        fulfil(undefined);
        reject(rejectedWith({ reason: "after fulfil" }));
      },
      (fulfil, reject) => {
        reject("first");
        fulfil(undefined);
        reject("second");
      },
    ];
    const unhandled = await unhandledDuring({
      body: () => {
        for (const then of thenables) {
          // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
          settleQuietly({ onRejected, returned: { then } });
        }
      },
    });

    expect(unhandled).toEqual([]);
    expect(reasons).toEqual(["first"]);
  });

  // Counterexample: a hostile species makes `then` throw before it attaches.
  it("observes a rejected promise whose constructor or species breaks the promise `then` builds", async () => {
    const reasons: unknown[] = [];
    const brokenSpecies = rejectedWith({ reason: "species" });
    Object.defineProperty(brokenSpecies, "constructor", {
      configurable: true,
      value: { [Symbol.species]: function BrokenSpecies(): void {} },
    });
    const throwingConstructor = rejectedWith({ reason: "constructor getter" });
    Object.defineProperty(throwingConstructor, "constructor", {
      configurable: true,
      get: (): never => {
        throw new Error("constructor read");
      },
    });
    // Counterexample: a rejected promise kept as the constructor `then` reads. The
    // constructor is pinned first, so it is never read at all: the getter that would hand one over never runs.
    let constructorReads = 0;
    const rejectedConstructor = rejectedWith({ reason: "rejected" });
    Object.defineProperty(rejectedConstructor, "constructor", {
      configurable: true,
      get: (): unknown => {
        constructorReads += 1;
        return rejectedWith({ reason: "constructor leaked" });
      },
    });
    const unhandled = await unhandledDuring({
      body: () => {
        for (const returned of [brokenSpecies, throwingConstructor, rejectedConstructor]) {
          settleQuietly({
            onRejected: (reason) => {
              reasons.push(reason);
            },
            returned,
          });
        }
      },
    });

    expect(unhandled).toEqual([]);
    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual(expect.arrayContaining(["constructor getter", "rejected", "species"]));
    expect(constructorReads).toBe(0);
  });

  // Counterexample: a real promise FULFILLED with a rejected one, whose `then` was
  // hidden while it resolved, has settled as a rejection — as a thenable fulfilling with one has.
  it("hands over the rejection of a rejected promise a real promise fulfilled with", async () => {
    const nested = rejectedWith({ reason: "ENOSPC" });
    // oxlint-disable-next-line unicorn/no-thenable -- hiding `then` is the hostile value under test
    Object.defineProperty(nested, "then", { configurable: true, value: undefined });
    const reasons: unknown[] = [];
    const unhandled = await unhandledDuring({
      body: () => {
        // Resolved synchronously, so `outer` is FULFILLED with `nested` before `then` is restored.
        const outer = new Promise((resolve) => {
          resolve(nested);
        });
        Reflect.deleteProperty(nested, "then");
        settleQuietly({
          onRejected: (reason) => {
            reasons.push(reason);
          },
          returned: outer,
        });
      },
    });

    expect(unhandled).toEqual([]);
    expect(reasons).toEqual(["ENOSPC"]);
  });

  it("lets the loop move on past a promise rejected with itself", async () => {
    let rejectCycle: (reason: unknown) => void = () => undefined;
    const cycle = new Promise((_resolve, reject) => {
      rejectCycle = reject;
    });
    rejectCycle(cycle);
    const reasons: unknown[] = [];
    const unhandled = await unhandledDuring({
      body: () => {
        settleQuietly({
          onRejected: (reason) => {
            reasons.push(reason);
          },
          returned: cycle,
        });
      },
    });

    expect(unhandled).toEqual([]);
    expect(reasons).toEqual([cycle]);
  });
});

describe("absorb", () => {
  it("settles a rejected promise however deep it sits in what was handed over", async () => {
    const unhandled = await unhandledDuring({
      body: () => {
        absorb({ value: rejectedWith({ reason: rejectedWith({ reason: "nested" }) }) });
        // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
        absorb({ value: { then: rejectedWith({ reason: "kept as then" }) } });
        // Counterexample: a `then` that fulfils yet RETURNS a rejected promise.
        absorb({
          value: {
            // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
            then: ((fulfil) => {
              const handedBack = rejectedWith({ reason: "leaked" });
              fulfil(undefined);
              return handedBack;
            }) satisfies Executor,
          },
        });
        // A thenable rejecting twice, the second reason a rejected promise; and a native promise FULFILLED with an
        // object keeping a rejected promise as its `then`.
        absorb({
          value: {
            // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
            then: ((_, reject) => {
              reject("first");
              reject(rejectedWith({ reason: "second" }));
            }) satisfies Executor,
          },
        });
        // oxlint-disable-next-line unicorn/no-thenable -- the hostile value under test
        absorb({ value: Promise.resolve({ then: rejectedWith({ reason: "fulfilled with" }) }) });
      },
    });

    expect(unhandled).toEqual([]);
  });
});
