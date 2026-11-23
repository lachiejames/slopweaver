/**
 * Appending a supersession row without ever throwing — the containment layer `./run.ts` sits on.
 *
 * `./journal.ts` builds a row, `./store.ts` writes one, and this is the third thing neither of them is: the
 * layer that guarantees a failed write REPORTS rather than raises. It is its own module because that
 * guarantee is a property of the write, not of the supersession — everything here is about a `catch`, and
 * nothing here knows what a correction is.
 *
 * The reason the guarantee has to exist at all is an ordering. `./store.ts` writes synchronously and its
 * every call can throw — a directory that cannot be created, a read-only home, a path something else
 * replaced between two rows. Left uncontained that throw travels up through `../outcomeFields.ts` into
 * `runTurn` AFTER the delete has already happened, which is the one ordering `./run.ts` exists to make
 * impossible: a rejected turn with the superseded answer gone.
 */
import type { SupersessionEvent } from "./journal.js";

/**
 * Append one journal row with the throw CONTAINED, answering what the append cost rather than raising it.
 *
 * The row is BUILT inside the containment rather than passed in, because the clock is a seam too: a row
 * constructed at the call site puts that clock outside the `try`, and the one caller that most needs this to
 * hold is `./run.ts`'s own catch, where an escaping throw is the defect itself.
 *
 * @param journal the append seam, which reports failure by THROWING
 * @param build the row to append, constructed inside the containment
 * @returns one sentence naming what went wrong, or `undefined` when the row landed
 */
export function record({
  journal,
  build,
}: {
  journal: (input: { event: SupersessionEvent }) => void;
  build: () => SupersessionEvent;
}): string | undefined {
  try {
    journal({ event: build() });
    return undefined;
  } catch (thrown: unknown) {
    return causeOf({ thrown });
  }
}

/**
 * One sentence naming what was thrown — an `Error`'s own message, or whatever a non-Error value prints as.
 *
 * **Both steps are inside the `try`, and each has its own counterexample.** `String(Object.create(null))`
 * raises `TypeError: Cannot convert object to primitive value` — a value with no `toString`. And
 * `thrown instanceof Error` raises on a REVOKED Proxy, because the check walks a prototype chain the proxy
 * will no longer answer for. Both were found by review, the second after the first was fixed by wrapping
 * only the conversion. A containment layer that can throw while describing a throw is not one, and this
 * function is reached only from the places whose whole job is that nothing escapes.
 *
 * An `Error`'s `message` is CONVERTED rather than returned, for the third counterexample of the same shape:
 * the field is typed `string` and is not one at runtime if somebody redefined it, so
 * `Object.defineProperty(new Error("x"), "message", { value: Symbol("x") })` returns a symbol that throws
 * `TypeError: Cannot convert a Symbol value to a string` the moment the CALLER interpolates it — outside
 * this `try`, past every layer, with the journal row not yet written. `String()` here is inside the
 * containment and gives "Symbol(x)".
 *
 * `typeof` is the one operation left outside a guard, and deliberately: it is a syntactic operator that
 * traps nothing, so it answers for a revoked proxy and a null-prototype object alike.
 *
 * @param thrown whatever the seam raised, of any shape at all
 * @returns the sentence a journal row and a diagnostic both carry
 */
export function causeOf({ thrown }: { thrown: unknown }): string {
  try {
    if (thrown instanceof Error) {
      // The conversion reads as redundant because `Error.message` is TYPED `string`; the counterexample in
      // this function's header is a real one where it is not, and the throw lands outside this containment.
      // oxlint-disable-next-line typescript/no-unnecessary-type-conversion
      return String(thrown.message);
    }
    return String(thrown);
  } catch {
    return `the thrown value (a ${typeof thrown}) could not be inspected or printed`;
  }
}

/**
 * Say an unwritten row out loud in the sentence a reader sees, rather than letting the journal fail quietly.
 *
 * @param detail what the supersession itself found, absent on a clean delete
 * @param unwritten what {@link record} answered, absent when the row landed
 * @returns the one sentence carrying both, or `undefined` when there is nothing to say
 */
export function withUnwritten({
  detail,
  unwritten,
}: {
  detail: string | undefined;
  unwritten: string | undefined;
}): string | undefined {
  if (unwritten === undefined) {
    return detail;
  }
  if (detail === undefined) {
    return `the journal row recording this supersession could not be written: ${unwritten}`;
  }
  return `${detail} — and the journal row recording it could not be written: ${unwritten}`;
}
