/*
 * The one distinction a group write has to be able to make about its own failure: did the request LEAVE
 * this machine, or not.
 *
 * It is a typed union rather than the default `readonly string[]` because a caller branches on it, which is
 * exactly the threshold `.claude/rules/error-handling.md` draws. The branch is not cosmetic. A leg the
 * report calls `unconfirmed` tells an auditor "the call was sent and its outcome could not be read", so
 * somebody has to go and read the group back before acting again; a leg that never went out is
 * `not-attempted` and settles nothing. Collapsing the two makes the verb state something false about an
 * external write, which is the single thing this verb exists to get right.
 *
 * MEASURED, and why it is a type rather than a comment (property
 * `partial-failure-is-never-success`): a token with 61 seconds left, an add leg that takes
 * two seconds and so enters the 60-second refresh window, and an HTTP 503 on the refresh. The recorded
 * requests were `/oauth/token`, `/v1/groups/<id>/add-people`, `/oauth/token` — no remove request at all —
 * and the run reported the remove leg as sent-but-unreadable. `writeTransport.ts` returns on a failed
 * `getToken()` BEFORE it calls `transport.request()`, so the information was always there; nothing carried
 * it up.
 */

/** A leg that never reached the network: the failure happened before the request was dispatched. */
export interface VantaGroupNotDispatchedError {
  readonly code: "NOT_DISPATCHED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A leg that DID go out, whose answer could not be read — the state that obliges a read-back. */
export interface VantaGroupUnreadableError {
  readonly code: "UNREADABLE";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Every way one leg of a group write fails, discriminated on whether the request was dispatched. */
export type VantaGroupWriteError = VantaGroupNotDispatchedError | VantaGroupUnreadableError;

export const VantaGroupWriteErrors = {
  notDispatched: ({ problems }: { problems: readonly string[] }): VantaGroupNotDispatchedError => ({
    code: "NOT_DISPATCHED",
    message: problems.join("; "),
    problems,
  }),
  unreadable: ({ problems }: { problems: readonly string[] }): VantaGroupUnreadableError => ({
    code: "UNREADABLE",
    message: problems.join("; "),
    problems,
  }),
} as const;
