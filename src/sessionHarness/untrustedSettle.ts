/**
 * Settling what an untrusted dependency hands over — an answer, a throw, a rejection reason — so that no rejection
 * among them is left unhandled, and naming a thrown value without running any of its code. The ledger recorder
 * (`./recordingHarness.ts`) routes every value its ledger hands it through here.
 */
import { types } from "node:util";

/**
 * Hand a rejection of whatever a dependency returned to `onRejected`, never leaving it unhandled. The value is adopted
 * by a promise this module made (`adopt`), so a real promise of any realm is observed without reading its own `then` or
 * `catch` (either may be shadowed), any other thenable through its `then`, and the handler goes on OUR promise.
 * The rejection reason is itself absorbed, since it may be a rejecting promise too, to `MAX_NESTED_REJECTIONS` deep: a
 * promise rejected with ITSELF would otherwise chain microtasks forever and starve the act, and a cycle is already
 * handled at its first level. Residue: code in this process rewriting `Promise.prototype`, `Reflect` or `util.types`;
 * a promise that refuses to have its `constructor` pinned (`adoptPromise`); and a chain nested deeper than the bound.
 *
 * @param returned what the dependency returned
 * @param onRejected told what it rejected with
 */
export function settleQuietly({
  returned,
  onRejected,
}: {
  returned: unknown;
  onRejected: (error: unknown) => void;
}): void {
  settleAt({ depth: 0, onRejected, returned });
}

/** How many rejection reasons deep `settleQuietly` absorbs: past any honest nesting, short of starving the loop. */
const MAX_NESTED_REJECTIONS = 8;

/**
 * A promise of OURS settling as `returned` does. A real promise, of any realm, is adopted through THIS realm's
 * `Promise.prototype.then`, which checks the internal slot rather than reading the value's own `then` — so a foreign
 * promise with `then` shadowed is still observed, where `await` would take it for a plain value and miss its
 * rejection. Any other object is adopted BY HAND rather than awaited, so each value the recorder reads is settled too:
 * its `then` is read once, called when it is a function, and absorbed when it is not (a rejected promise kept as
 * `then`, say); a value it fulfils with is adopted in turn. EVERY value handed back on the way — a fulfilment value,
 * each reason passed to `reject` (a second call's included), what `then` itself returns — is absorbed rather than
 * dropped. All of it to `MAX_NESTED_REJECTIONS` deep; a real promise's own residue is `adoptPromise`'s.
 */
// oxlint-disable-next-line typescript/promise-function-async -- `async` would add two adoption microtasks before onRejected runs
function adopt({ returned, depth }: { returned: unknown; depth: number }): Promise<void> {
  const deeper: (value: unknown) => void = (value) => {
    if (depth < MAX_NESTED_REJECTIONS) {
      absorbAt({ depth: depth + 1, value });
    }
  };
  if (types.isPromise(returned)) {
    return adoptPromise({ deeper, depth, returned });
  }
  if (returned === null || (typeof returned !== "object" && typeof returned !== "function")) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    try {
      // Read once, as `unknown`: a getter runs here and nowhere else, inside this executor.
      const then: unknown = Reflect.get(returned, "then");
      if (typeof then !== "function") {
        deeper(then);
        resolve();
        return;
      }
      // The FIRST callback decides, as the spec's resolving functions do: a later callback or a later throw is
      // absorbed, never allowed to turn a fulfilment (whose adoption is still in flight) into a rejection.
      let decided = false;
      const fulfilled: (value: unknown) => void = (value) => {
        if (decided) {
          deeper(value);
          return;
        }
        decided = true;
        if (depth >= MAX_NESTED_REJECTIONS) {
          resolve();
          return;
        }
        // oxlint-disable-next-line promise/always-return -- `resolve()` takes no argument, so a rewritten `then` cannot hand it one to adopt
        adopt({ depth: depth + 1, returned: value }).then(() => {
          resolve();
        }, reject);
      };
      const rejected: (reason: unknown) => void = (reason) => {
        deeper(reason);
        if (!decided) {
          decided = true;
          // oxlint-disable-next-line prefer-promise-reject-errors -- forwards the dependency's own reason, whatever it is
          reject(reason);
        }
      };
      try {
        deeper(Reflect.apply(then, returned, [fulfilled, rejected]));
      } catch (error: unknown) {
        rejected(error);
      }
    } catch (error: unknown) {
      // oxlint-disable-next-line prefer-promise-reject-errors -- forwards what the dependency threw, whatever it is
      reject(error);
    }
  });
}

/**
 * A promise of OURS settling as the real promise `returned` does, through THIS realm's `Promise.prototype.then`. That
 * call reads `returned.constructor` and its `Symbol.species` to build the promise it returns — values of the
 * dependency's that a hostile one could make anything (a throwing getter, a species that never hands over its
 * resolving functions, a rejected promise kept as the constructor). So this promise's own `constructor` is pinned to
 * the intrinsic `Promise` FIRST, and `then` reads nothing of the dependency's at all. Residue: a promise that refuses
 * the pin (frozen, non-extensible, or its `constructor` own and non-configurable) is read as it stands — what `then`
 * reads from it is not settled, and one whose constructor breaks the build is unobservable by ANY JavaScript API,
 * since `await`, `Promise.resolve` and every combinator take the same path; that throw still earns the warning.
 */
// oxlint-disable-next-line typescript/promise-function-async -- `async` would add two adoption microtasks before onRejected runs
function adoptPromise({
  returned,
  deeper,
  depth,
}: {
  returned: Promise<unknown>;
  deeper: (value: unknown) => void;
  depth: number;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // A fulfilment value is adopted in turn, exactly as a thenable's is: a promise fulfilled WITH a rejected promise
    // (its `then` hidden while it resolved) has settled as a rejection.
    const fulfilled: (value: unknown) => void = (value) => {
      if (depth >= MAX_NESTED_REJECTIONS) {
        resolve();
        return;
      }
      // oxlint-disable-next-line promise/always-return -- `resolve()` takes no argument, so a rewritten `then` cannot hand it one to adopt
      adopt({ depth: depth + 1, returned: value }).then(() => {
        resolve();
      }, reject);
    };
    // Refused only by a promise that will not take it — the residue above; `then` then reads it as it stands.
    Reflect.defineProperty(returned, "constructor", { configurable: true, value: Promise, writable: true });
    try {
      deeper(Reflect.apply(Promise.prototype.then, returned, [fulfilled, reject]));
    } catch (error: unknown) {
      deeper(error);
      // oxlint-disable-next-line prefer-promise-reject-errors -- forwards what the dependency's promise threw, whatever it is
      reject(error);
    }
  });
}

/** `absorb` at one nesting depth. */
function absorbAt({ value, depth }: { value: unknown; depth: number }): void {
  settleAt({ depth, onRejected: () => undefined, returned: value });
}

/** `settleQuietly` at one nesting depth. */
function settleAt({
  returned,
  onRejected,
  depth,
}: {
  returned: unknown;
  onRejected: (error: unknown) => void;
  depth: number;
}): void {
  const adopted = adopt({ depth, returned });
  adopted.then(undefined, (reason: unknown) => {
    if (depth < MAX_NESTED_REJECTIONS) {
      absorbAt({ depth: depth + 1, value: reason });
    }
    onRejected(reason);
  });
}

/**
 * Settle anything a ledger dependency handed over — a value it answered, threw or rejected with — so that a rejecting
 * promise among them is never left unhandled. Every `catch` in the recorder that receives a dependency's throw calls it.
 *
 * @param value what the dependency handed over
 */
export function absorb({ value }: { value: unknown }): void {
  absorbAt({ depth: 0, value });
}

/**
 * What a dependency threw, as text, WITHOUT running any of its code: a primitive's own string form, an `Error`'s own
 * plain-data `message` (an Error of any realm), and a fixed phrase for anything else. No getter, `toString` or coercion
 * of the thrown value is invoked, so nothing it could answer (a throw, a rejecting promise) is created here unseen.
 * Residue: a rejection the dependency creates and drops itself is its own.
 *
 * @param error what the dependency threw
 * @returns the text the warning carries
 */
export function describeThrown({ error }: { error: unknown }): string {
  const unreadable = "a thrown value that could not be read as text";
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === undefined
  ) {
    // `String` converts each of these primitives without calling anything.
    return String(error);
  }
  try {
    // `Error.isError`, not `instanceof`: it holds for an Error of any realm and runs no Proxy trap.
    const own = Error.isError(error) ? Object.getOwnPropertyDescriptor(error, "message") : undefined;
    if (own !== undefined && "value" in own) {
      if (typeof own.value === "string") {
        return own.value;
      }
      // Read, so settled: a rejecting promise kept as the message is still a value the recorder was handed.
      absorb({ value: own.value });
    }
  } catch (thrown: unknown) {
    absorb({ value: thrown });
  }
  return unreadable;
}
