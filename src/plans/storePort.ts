/**
 * The store-backed plan register: the singleton `plan_register` row is the authority, imported ONCE from a
 * `plans.json`, changed only by compare-and-set, and followed by two one-way file projections.
 *
 * This module is the ORCHESTRATION and nothing else. Every effect arrives through {@link PlanRegisterStoreSeams}
 * — the connection and its three row operations, the import file read, the projection writer, the
 * divergence diagnostics — so a unit test drives every branch below over a plain in-memory fake (a seam, not
 * a mock: `.claude/rules/testing.md`). The Postgres half is `./storeRows.ts`; what only a real database can
 * prove (the CAS predicate, the CHECKs, the `jsonb` round trip) is the opt-in
 * `src/__tests__/integration/planRegisterStore.test.ts`.
 *
 * ## A store outage is a refusal, never a register
 *
 * No selection, a stale database, an unreachable one, a failed query: every one is
 * `REGISTER_STORE_UNAVAILABLE`, and NONE of them falls back to `plans.json`. A file that stopped being the
 * authority is exactly how a register becomes confidently wrong, and "the store is down" seated on an ambient
 * credential is the failure routing exists to prevent.
 *
 * ## The one-time import, and why it cannot overwrite anything
 *
 * A read finding no row consults the register files, and only then. A valid `plans.json` is inserted at
 * revision 1 with `ON CONFLICT DO NOTHING` and the row is read back, so a concurrent importer's row wins and a
 * file never overwrites a row. An absent `plans.json` inserts nothing — the derived, unadopted picture is
 * returned with `revision: null`, because loading new code must never adopt state. A present but damaged one
 * is refused rather than derived around.
 *
 * ## Compare-and-set, never a retry
 *
 * A write reads revision N, makes its one pure judgement (`prepareRegisterChange`), and updates `WHERE
 * revision = N`. No row back is `REGISTER_REVISION_CONFLICT`, and nothing replays the change: replaying it
 * against a register that moved is a new judgement, which is the caller's. A caller that judged something itself
 * before writing passes `judgedAtRevision`, and a register that moved past it refuses the same way.
 *
 * ## Projections after the commit
 *
 * Both files are regenerated from the COMMITTED row. A failure there is `PROJECTION_WRITE_FAILED` with the
 * committed revision — the row stands, and `plans validate --repair-projection` rewrites the files from it
 * without bumping its revision, because repairing copies is not a change to the register.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  describeCause,
  type PlanRegisterError,
  PlanRegisterErrors,
  type ProjectionWriteFailedError,
  type RegisterStoreUnavailableError,
  type SeatPassesNotClearedError,
} from "./errors.js";
import { prepareRegisterChange } from "./mutate.js";
import type { PlanRegisterPort, PlanRegisterRequest, PlanRegisterWrite } from "./port.js";
import { parsePlanRegister } from "./register.js";
import type { PlanRegisterDocument, PlanRegisterSnapshot } from "./types.js";

/** One stored register row as the store returned it: the raw document, undecoded, and its revision. */
export interface StoredPlanRegister {
  /** `unknown` on purpose — `jsonb` is not validation, so every reader decodes it. */
  readonly document: unknown;
  readonly revision: number;
}

/**
 * The three row operations one open connection offers, and the handle that closes it. A store step's only
 * failure is `REGISTER_STORE_UNAVAILABLE`, typed so: no seam can make a failed statement read as anything else.
 */
export interface PlanRegisterRows {
  /** The singleton row, or undefined when the store holds none. */
  readonly read: () => Promise<Result<StoredPlanRegister | undefined, RegisterStoreUnavailableError>>;
  /** Insert at revision 1 unless a row exists; undefined when one already did, which this writer then lost. */
  readonly insert: (request: {
    readonly document: PlanRegisterDocument;
  }) => Promise<Result<StoredPlanRegister | undefined, RegisterStoreUnavailableError>>;
  /** Update iff the row is still at `expectedRevision`, bumping it; undefined when it was not. */
  readonly update: (request: {
    readonly document: PlanRegisterDocument;
    readonly expectedRevision: number;
  }) => Promise<Result<StoredPlanRegister | undefined, RegisterStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Every effect the store-backed register performs, injected so the orchestration is testable without one. */
export interface PlanRegisterStoreSeams {
  /** Open the store for one home, refusing with `REGISTER_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: {
    readonly home: string;
  }) => Promise<Result<PlanRegisterRows, RegisterStoreUnavailableError>>;
  /** The file read the one-time import consults: a registered, derived or refused snapshot. */
  readonly readImportFile: (request: PlanRegisterRequest) => Result<PlanRegisterSnapshot, PlanRegisterError>;
  /** Clear every seat's cached pass before a change commits; a failure means the change must not commit. */
  readonly clearSeatPasses: (request: { readonly home: string }) => Result<undefined, SeatPassesNotClearedError>;
  /** Regenerate both projections from a committed document. */
  readonly writeProjections: (request: {
    readonly committedRevision: number;
    readonly document: PlanRegisterDocument;
    readonly home: string;
  }) => Result<undefined, ProjectionWriteFailedError>;
  /** The diagnostics a stored register's read carries — projection divergence and the like. */
  readonly diagnose: (request: {
    readonly home: string;
    readonly snapshot: PlanRegisterSnapshot;
  }) => PlanRegisterSnapshot;
}

/**
 * Decode one stored row into a snapshot carrying its revision and the file diagnostics.
 *
 * @param home the Slopweaver home whose projections are compared
 * @param row the row as stored
 * @param seams where the diagnostics come from
 * @returns the registered snapshot, or why the stored document is unusable
 */
function snapshotOfRow({
  home,
  row,
  seams,
}: {
  home: string;
  row: StoredPlanRegister;
  seams: PlanRegisterStoreSeams;
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const parsed = parsePlanRegister({ value: row.document });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok(seams.diagnose({ home, snapshot: { ...parsed.value, revision: row.revision } }));
}

/**
 * The register as it stands for one home: the stored row, else the one-time import, else the derived picture.
 *
 * @param request which home's register is meant
 * @param rows the open connection's row operations
 * @param seams the remaining effects
 * @returns the current snapshot, or the refusal
 */
async function currentRegister({
  request,
  rows,
  seams,
}: {
  request: PlanRegisterRequest;
  rows: PlanRegisterRows;
  seams: PlanRegisterStoreSeams;
}): Promise<Result<PlanRegisterSnapshot, PlanRegisterError>> {
  const stored = await rows.read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value !== undefined) {
    return snapshotOfRow({ home: request.home, row: stored.value, seams });
  }
  const fromFile = seams.readImportFile(request);
  if (fromFile.isErr()) {
    return err(fromFile.error);
  }
  if (fromFile.value.source === "derived") {
    return ok({ ...fromFile.value, revision: null });
  }
  const inserted = await rows.insert({ document: fromFile.value.document });
  if (inserted.isErr()) {
    return err(inserted.error);
  }
  // A lost insert means another importer got there first: ITS row is the register, so read that back.
  const winner = inserted.value === undefined ? await rows.read() : ok(inserted.value);
  if (winner.isErr()) {
    return err(winner.error);
  }
  if (winner.value === undefined) {
    return err(
      PlanRegisterErrors.registerStoreUnavailable({
        doing: "import the plan register",
        reason: "the import's insert was refused and no row is there to read back",
      }),
    );
  }
  return snapshotOfRow({ home: request.home, row: winner.value, seams });
}

/**
 * Commit one prepared register: insert it when no row backs the snapshot, compare-and-set it otherwise.
 *
 * @param rows the open connection's row operations
 * @param changed the register the change produced
 * @param expectedRevision the revision the change was judged against, or null when no row backed it
 * @returns the committed row, or the conflict that stopped it
 */
async function commitChange({
  changed,
  expectedRevision,
  rows,
}: {
  changed: PlanRegisterSnapshot;
  expectedRevision: number | null;
  rows: PlanRegisterRows;
}): Promise<Result<StoredPlanRegister, PlanRegisterError>> {
  let committed: Result<StoredPlanRegister | undefined, PlanRegisterError>;
  // `0` names "expected no row at all" — the revision an adopting insert pins to, since a real one starts at 1.
  let pinned = 0;
  if (expectedRevision === null) {
    committed = await rows.insert({ document: changed.document });
  } else {
    pinned = expectedRevision;
    committed = await rows.update({ document: changed.document, expectedRevision });
  }
  if (committed.isErr()) {
    return err(committed.error);
  }
  if (committed.value === undefined) {
    return err(PlanRegisterErrors.registerRevisionConflict({ expectedRevision: pinned }));
  }
  return ok(committed.value);
}

/**
 * The conflict a write refuses with when its caller judged the change at a revision the register has since left.
 *
 * @param judged the revision the caller judged at, `null` for no row, `undefined` when it judged nothing itself
 * @param revision the revision the write just read
 * @returns the conflict, or `undefined` when nothing was judged or the register has not moved
 */
function staleJudgement({
  judged,
  revision,
}: {
  judged: number | null | undefined;
  revision: number | null;
}): PlanRegisterError | undefined {
  if (judged === undefined || judged === revision) {
    return undefined;
  }
  if (judged === null) {
    // `0` names "judged with no row at all", the same convention `commitChange` pins an adopting insert to.
    return PlanRegisterErrors.registerRevisionConflict({ expectedRevision: 0 });
  }
  return PlanRegisterErrors.registerRevisionConflict({ expectedRevision: judged });
}

/**
 * Apply one change against an open connection: read, judge, compare-and-set, project.
 *
 * @param request the change and the home it targets
 * @param rows the open connection's row operations
 * @param seams the remaining effects
 * @returns the published snapshot, or the first failure
 */
async function writeWith({
  request,
  rows,
  seams,
}: {
  request: PlanRegisterWrite;
  rows: PlanRegisterRows;
  seams: PlanRegisterStoreSeams;
}): Promise<Result<PlanRegisterSnapshot, PlanRegisterError>> {
  const current = await currentRegister({ request, rows, seams });
  if (current.isErr()) {
    return err(current.error);
  }
  const stale = staleJudgement({ judged: request.judgedAtRevision, revision: current.value.revision });
  if (stale !== undefined) {
    return err(stale);
  }
  const changed = prepareRegisterChange({ mutation: request.mutation, snapshot: current.value });
  if (changed.isErr()) {
    return err(changed.error);
  }
  let committed: StoredPlanRegister;
  if (request.mutation.kind === "repair-projection" && current.value.revision !== null) {
    // Repairing copies is not a change to the register: rewrite the files from the row as it stands.
    committed = { document: current.value.document, revision: current.value.revision };
  } else {
    const cleared = seams.clearSeatPasses({ home: request.home });
    if (cleared.isErr()) {
      return err(cleared.error);
    }
    const written = await commitChange({ changed: changed.value, expectedRevision: current.value.revision, rows });
    if (written.isErr()) {
      return err(written.error);
    }
    committed = written.value;
  }
  const published = snapshotOfRow({ home: request.home, row: committed, seams });
  if (published.isErr()) {
    return err(published.error);
  }
  const projected = seams.writeProjections({
    committedRevision: committed.revision,
    document: published.value.document,
    home: request.home,
  });
  if (projected.isErr()) {
    return err(projected.error);
  }
  return ok({ ...published.value, diagnostics: [] });
}

/**
 * Run one operation over a connection this function opens and always closes.
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
  body: (rows: PlanRegisterRows) => Promise<Result<T, PlanRegisterError>>;
  home: string;
  seams: PlanRegisterStoreSeams;
}): Promise<Result<T, PlanRegisterError>> {
  // Every seam is meant to answer a Result, and production's do (`storeRows.ts` catches every driver throw).
  // One that rejects anyway is still a step that did not finish, so it is the same refusal: the port never lets
  // a raw rejection stand in for "which plans this install has is unknown". A close that fails after a write
  // committed refuses too — the caller retrying meets a revision conflict, which is visible, never a lost change.
  let rows: Awaited<ReturnType<PlanRegisterStoreSeams["connect"]>>;
  try {
    rows = await seams.connect({ home });
  } catch (cause) {
    return err(unavailable({ cause, doing: "be opened" }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, PlanRegisterError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ cause, doing: "finish the operation" }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(unavailable({ cause, doing: "close its connection" }));
  }
  return answer;
}

/**
 * The store refusal for a seam that rejected rather than answering a Result.
 *
 * @param cause what the seam rejected with
 * @param doing what the step was for, finishing "the store could not …"
 * @returns the typed refusal
 */
function unavailable({ cause, doing }: { cause: unknown; doing: string }): RegisterStoreUnavailableError {
  return PlanRegisterErrors.registerStoreUnavailable({ doing, reason: describeCause({ cause }) });
}

/**
 * The STORED register row for one home, and nothing else: never the one-time import, never the derived picture.
 *
 * The port's own read (`currentRegister`) imports a legacy `plans.json` into an empty store, which is the right
 * bootstrap for a production reader and the wrong thing for a caller promised never to change the register it reads —
 * the paid Codex acceptance run reading the operator's real home (`../__tests__/codexAcceptanceDestination.ts`). Undefined
 * here means the install has adopted no register, so no row it chose exists to spend.
 *
 * The one effect left is the store's own: opening it selects it (`../store/config.ts`'s `storeUrlSelection`), which
 * removes the retired Storage secret copies nothing reads, exactly as every verb that opens the store does.
 *
 * @param home the Slopweaver home whose store is opened
 * @param seams the effects — only `connect`, the row `read` and `diagnose` are ever called
 * @returns the registered snapshot, `ok(undefined)` when the store holds no row, or why it could not be read
 */
export async function readStoredPlanRegister({
  home,
  seams,
}: {
  home: string;
  seams: PlanRegisterStoreSeams;
}): Promise<Result<PlanRegisterSnapshot | undefined, PlanRegisterError>> {
  return withRows({
    body: async (rows): Promise<Result<PlanRegisterSnapshot | undefined, PlanRegisterError>> => {
      const stored = await rows.read();
      if (stored.isErr()) {
        return err(stored.error);
      }
      if (stored.value === undefined) {
        return ok(undefined);
      }
      return snapshotOfRow({ home, row: stored.value, seams });
    },
    home,
    seams,
  });
}

/**
 * A plan register port whose authority is the store row, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./storeRows.ts`'s `productionPlanRegisterSeams`
 * @returns the port
 */
export function storePlanRegisterPort({ seams }: { seams: PlanRegisterStoreSeams }): PlanRegisterPort {
  return {
    read: (request) =>
      withRows({ body: (rows) => currentRegister({ request, rows, seams }), home: request.home, seams }),
    write: (request) => withRows({ body: (rows) => writeWith({ request, rows, seams }), home: request.home, seams }),
  };
}
