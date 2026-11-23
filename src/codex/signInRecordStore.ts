/**
 * The store-backed Codex sign-in observations: one `codex_sign_in_observation` row per alias is the authority,
 * imported ONCE from a `$SLOPWEAVER_HOME/codex-signin/<alias>.json` written before the store held them, and changed
 * only by compare-and-set. Nothing is written back to a file.
 *
 * This module answers reads and files writes. Where an alias stands before either — its row, the one-time import,
 * nothing — is `./signInObservationCurrent.ts`, which also declares {@link CodexSignInStoreSeams}: every effect
 * arrives through them, so a unit test drives every branch over an in-memory fake (a seam, not a mock:
 * `.claude/rules/testing.md`). The Postgres half is `./signInRecordRows.ts`; what only a real database can prove
 * is the opt-in `src/__tests__/integration/codexSignInObservationStore.test.ts`.
 *
 * ## A store outage is a refusal, never an observation
 *
 * No selection, an unreachable store, a failed query: every one is `CODEX_SIGN_IN_STORE_UNAVAILABLE`, and NONE
 * falls back to the import file. The monitor reads it as unmeasurable; the routing read prints it and carries on.
 *
 * ## Compare-and-set, never a retry
 *
 * A write reads the alias's row at revision N, makes its one pure judgement (`./signInRecord.ts`'s
 * `nextCodexSignInRecord`), and updates `WHERE revision = N`. No row back is `CODEX_SIGN_IN_REVISION_CONFLICT`,
 * and nothing replays it: the observation waits for the next fleet read, exactly as a lock another pass held once
 * made it wait. In the direction that matters, a refusal that won the race is never overwritten by a signed-in
 * read judged against the row before it. An undecodable STORED row is refused rather than overwritten: it is the
 * authority, and assuming it held no refusal is the guess this whole record exists not to make.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { CodexSignInErrors, type CodexSignInStoreUnavailableError } from "./signInErrors.js";
import {
  type CodexSignInRows,
  type CodexSignInStoreSeams,
  type ConflictedObservation,
  type CurrentObservation,
  currentOfRow,
  observationsOnce,
  type StoredCodexSignIn,
  storedByAlias,
} from "./signInObservationCurrent.js";
import type {
  CodexSignInAliasRead,
  CodexSignInObserved,
  CodexSignInPort,
  CodexSignInReadRequest,
  CodexSignInWriteOutcome,
} from "./signInPort.js";
import { type CodexSignInRecord, nextCodexSignInRecord } from "./signInRecord.js";

/** Where an alias stands as a write sees it: what the store says, or a miss this operation already met. */
type FiledObservation = CurrentObservation | ConflictedObservation;

/**
 * Read every requested alias against an open connection, in the order asked.
 *
 * @param request which aliases, under which home
 * @returns one read per alias, or the store refusal
 */
async function readWith({
  request,
  rows,
  seams,
}: {
  request: CodexSignInReadRequest;
  rows: CodexSignInRows;
  seams: CodexSignInStoreSeams;
}): Promise<Result<readonly CodexSignInAliasRead[], CodexSignInStoreUnavailableError>> {
  const stored = await storedByAlias({ aliases: request.aliases, rows });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const observations = observationsOnce({ home: request.home, rows, seams, stored: stored.value });
  const reads: CodexSignInAliasRead[] = [];
  for (const alias of request.aliases) {
    const current = await observations.of({ alias });
    if (current.isErr()) {
      return err(current.error);
    }
    if (current.value.kind === "refused") {
      reads.push({ alias, error: current.value.error, kind: "refused" });
    } else if (current.value.kind === "record") {
      reads.push({ alias, kind: "record", record: current.value.record, revision: current.value.revision });
    } else {
      reads.push({ alias, kind: "absent" });
    }
  }
  return ok(reads);
}

/**
 * Judge one observation against where its alias stands, and compare-and-set the result — once.
 *
 * @param observed the alias, its live answer and both auth stamps
 * @param current where the alias stood when this operation read it, or the miss an earlier write in it met
 * @param rows the open connection's row operations
 * @returns what filing it did and where the alias stands after it, or the store refusal
 */
async function fileOne({
  current,
  observed,
  rows,
}: {
  current: FiledObservation;
  observed: CodexSignInObserved;
  rows: CodexSignInRows;
}): Promise<
  Result<
    { readonly now: FiledObservation; readonly outcome: CodexSignInWriteOutcome },
    CodexSignInStoreUnavailableError
  >
> {
  const { alias } = observed;
  if (current.kind === "conflicted" || (current.kind === "refused" && !current.writable)) {
    return ok({ now: current, outcome: { alias, error: current.error, kind: "refused" } });
  }
  let previous: CodexSignInRecord | undefined;
  let expectedRevision: number | null = null;
  if (current.kind === "record") {
    previous = current.record;
    expectedRevision = current.revision;
  }
  const change = nextCodexSignInRecord({
    alias,
    authAfter: observed.authAfter,
    authBefore: observed.authBefore,
    live: observed.live,
    previous,
  });
  if (change.kind === "keep") {
    return ok({ now: current, outcome: { alias, kind: "kept", why: change.why } });
  }
  let committed: Result<StoredCodexSignIn | undefined, CodexSignInStoreUnavailableError>;
  // `0` names "expected no row at all" — the revision an adopting insert pins to, since a real one starts at 1.
  let pinned = 0;
  if (expectedRevision === null) {
    committed = await rows.insert({ alias, record: change.record });
  } else {
    pinned = expectedRevision;
    committed = await rows.update({ alias, expectedRevision, record: change.record });
  }
  if (committed.isErr()) {
    return err(committed.error);
  }
  if (committed.value === undefined) {
    const error = CodexSignInErrors.revisionConflict({ alias, expectedRevision: pinned });
    // A miss leaves where the alias stands unknown to this operation, so nothing later in it writes the alias again:
    // a second observation in the same batch is refused with the same conflict, never retried at the stale revision.
    return ok({ now: { error, kind: "conflicted" }, outcome: { alias, error, kind: "refused" } });
  }
  return ok({
    now: currentOfRow({ alias, row: committed.value }),
    outcome: { alias, kind: "written", revision: committed.value.revision },
  });
}

/**
 * File one live batch's observations against an open connection.
 *
 * @param home the Slopweaver home whose import files are consulted
 * @param observed each store's alias, live answer and auth stamps
 * @returns one outcome per observation, or the store refusal
 */
async function recordWith({
  home,
  observed,
  rows,
  seams,
}: {
  home: string;
  observed: readonly CodexSignInObserved[];
  rows: CodexSignInRows;
  seams: CodexSignInStoreSeams;
}): Promise<Result<readonly CodexSignInWriteOutcome[], CodexSignInStoreUnavailableError>> {
  const stored = await storedByAlias({ aliases: observed.map((one) => one.alias), rows });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const observations = observationsOnce<ConflictedObservation>({ home, rows, seams, stored: stored.value });
  const outcomes: CodexSignInWriteOutcome[] = [];
  for (const one of observed) {
    const current = await observations.of({ alias: one.alias });
    if (current.isErr()) {
      return err(current.error);
    }
    const filed = await fileOne({ current: current.value, observed: one, rows });
    if (filed.isErr()) {
      return err(filed.error);
    }
    // A second observation of the same alias in this batch is judged against what the first one committed.
    observations.settle({ alias: one.alias, now: filed.value.now });
    outcomes.push(filed.value.outcome);
  }
  return ok(outcomes);
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * Every seam is meant to answer a Result, and production's do (`./signInRecordRows.ts` catches every driver throw).
 * One that rejects anyway is still a step that did not finish, so it is the same refusal. A close that fails after
 * a write committed refuses too: the next read meets the committed row, which is visible, never a lost change.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams where the connection comes from
 * @param body what to do with it
 * @returns whatever the body answered, or the connection refusal
 */
async function withRows<T>({
  body,
  home,
  seams,
}: {
  body: (rows: CodexSignInRows) => Promise<Result<T, CodexSignInStoreUnavailableError>>;
  home: string;
  seams: CodexSignInStoreSeams;
}): Promise<Result<T, CodexSignInStoreUnavailableError>> {
  let rows: Awaited<ReturnType<CodexSignInStoreSeams["connect"]>>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(CodexSignInErrors.storeUnavailable({ doing: "be opened", reason: errorMessage({ error: cause }) }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, CodexSignInStoreUnavailableError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(
      CodexSignInErrors.storeUnavailable({ doing: "finish the operation", reason: errorMessage({ error: cause }) }),
    );
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(
      CodexSignInErrors.storeUnavailable({ doing: "close its connection", reason: errorMessage({ error: cause }) }),
    );
  }
  return answer;
}

/**
 * A sign-in observation port whose authority is the store rows, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./signInRecordRows.ts`'s `productionCodexSignInSeams`
 * @returns the port
 */
export function storeCodexSignInPort({ seams }: { seams: CodexSignInStoreSeams }): CodexSignInPort {
  return {
    read: (request) => withRows({ body: (rows) => readWith({ request, rows, seams }), home: request.home, seams }),
    record: ({ home, observed }) =>
      withRows({ body: (rows) => recordWith({ home, observed, rows, seams }), home, seams }),
  };
}
