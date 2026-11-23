/**
 * One operation over one store connection that is opened, used and always closed — the shape every store-backed
 * register port shares. A seam that REJECTS rather than answering a Result is still a step that did not finish,
 * so each of the three steps turns a rejection into the caller's own typed outage refusal, never a raw throw.
 */
import { err, type Result } from "#lib/result.js";

/**
 * Open a connection, run `body` over it, and close it whatever the body answered.
 *
 * A refusal the body already reached stands when the close then fails, so a lost insert stays a collision rather
 * than reading as an outage. A close failing after a write committed refuses too: running it again meets the
 * collision, which is visible, never a lost write.
 *
 * @param connect opens the store, answering the caller's own refusal when it cannot
 * @param body the operation, over the open rows
 * @param unavailable the caller's typed outage refusal for a step that rejected, given what that step was for
 * @returns whatever the body answered, or the refusal for the step that did not finish
 */
export async function withStoreConnection<Rows extends { readonly close: () => Promise<void> }, T, E>({
  body,
  connect,
  unavailable,
}: {
  body: (rows: Rows) => Promise<Result<T, E>>;
  connect: () => Promise<Result<Rows, E>>;
  unavailable: (request: { readonly cause: unknown; readonly doing: string }) => E;
}): Promise<Result<T, E>> {
  let rows: Result<Rows, E>;
  try {
    rows = await connect();
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, E>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ cause, doing: "finish the operation" }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    if (answer.isErr()) {
      return answer;
    }
    return err(unavailable({ cause, doing: "close its connection" }));
  }
  return answer;
}
