/**
 * Whether the store a Codex Connect record names is the worker's to sign into and, later, to remove.
 *
 * A record is a file on disk, not proof of a reservation, so a worker checks the store against three things before
 * anything touches it — the one path a Connect reserves for the alias, this attempt's own reservation file inside it,
 * and the register — and checks the last two again before a removal, since a hand `plans add` may have come to name
 * the directory in between.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { CodexConnectDeps } from "./connectCodexRecord.js";
import type { PlanConnection } from "./connection.js";
import {
  type PlanConnectionError,
  PlanConnectionErrors,
  type StoreKeptError,
  StoreKeptErrors,
} from "./connectionErrors.js";
import { CONNECT_ALIAS, connectStoreDir } from "./connectPlan.js";
import { storeIdentity } from "./structure.js";
import type { PlanRegisterSnapshot } from "./types.js";

/** The alias of the register row naming a store under the register's own identity, if any row does. */
function holderOf({ snapshot, storeDir }: { snapshot: PlanRegisterSnapshot; storeDir: string }): string | undefined {
  const identity = storeIdentity({ storeDir });
  return snapshot.plans.find((plan) => storeIdentity({ storeDir: plan.storeDir }) === identity)?.alias;
}

/**
 * The alias of a register row naming `root` or any directory beneath it, if any row does — what a recursive removal of
 * `root` would take from under that row.
 */
function holderWithin({ root, snapshot }: { root: string; snapshot: PlanRegisterSnapshot }): string | undefined {
  const identity = storeIdentity({ storeDir: root });
  return snapshot.plans.find((plan) => {
    const named = storeIdentity({ storeDir: plan.storeDir });
    return named === identity || named.startsWith(`${identity}/`);
  })?.alias;
}

/**
 * Whether a store carries this attempt's own reservation — the id its start wrote inside the directory it created.
 * A directory that was already there, or another attempt's, does not, so the worker leaves it alone.
 */
function reservationOf({
  deps,
  id,
  storeDir,
}: {
  deps: CodexConnectDeps;
  id: string;
  storeDir: string;
}): Result<void, StoreKeptError> {
  const held = deps.readStoreReservation({ storeDir });
  if (held.isErr()) {
    return err(StoreKeptErrors.reservationUnreadable({ cause: held.error }));
  }
  if (held.value !== id) {
    return err(StoreKeptErrors.reservationNotOurs());
  }
  return ok(undefined);
}

/** A reservation refusal as the clause `foreignStore` reads after "which". */
function reservationReason({ kept }: { kept: StoreKeptError }): string {
  if (kept.code === "RESERVATION_NOT_OURS") {
    return "this attempt did not reserve";
  }
  return `could not be checked for this attempt's reservation (${kept.message})`;
}

/**
 * Whether a starting record's store is one this worker may sign into and later remove: exactly the store a Connect
 * reserves for the record's alias, carrying this attempt's own reservation, and named by no register row. A store
 * outside `codex-accounts`, a directory the attempt did not create, or a plan's own, is refused before anything
 * touches it.
 *
 * @param connection the starting record whose store is checked
 * @returns nothing when the store is this attempt's, or `CONNECTION_STORE_FOREIGN` saying why it is not
 */
export async function storeIsConnects({
  connection,
  deps,
  home,
}: {
  connection: PlanConnection;
  deps: CodexConnectDeps;
  home: string;
}): Promise<Result<void, PlanConnectionError>> {
  const expected = connectStoreDir({ alias: connection.alias, home });
  const identity = storeIdentity({ storeDir: connection.storeDir });
  if (!CONNECT_ALIAS.test(connection.alias) || identity !== storeIdentity({ storeDir: expected })) {
    return err(
      PlanConnectionErrors.foreignStore({
        reason: `is not the store a Connect reserves for ${connection.alias}`,
        storeDir: connection.storeDir,
      }),
    );
  }
  const reservation = reservationOf({ deps, id: connection.id, storeDir: connection.storeDir });
  if (reservation.isErr()) {
    return err(
      PlanConnectionErrors.foreignStore({
        reason: reservationReason({ kept: reservation.error }),
        storeDir: connection.storeDir,
      }),
    );
  }
  const read = await deps.readRegister();
  if (read.isErr()) {
    return err(PlanConnectionErrors.registerUnreadable({ error: read.error }));
  }
  const holder = holderOf({ snapshot: read.value, storeDir: connection.storeDir });
  if (holder !== undefined) {
    return err(
      PlanConnectionErrors.foreignStore({
        reason: `the plan ${holder} already uses`,
        storeDir: connection.storeDir,
      }),
    );
  }
  return ok(undefined);
}

/**
 * A store kept after it left its own path, left where it now stands rather than moved back: a rename back would
 * replace an empty directory a concurrent `plans add` made at the original path (`rename(2)` does), which this attempt
 * never created.
 */
function keptAside({ holding, kept }: { holding: string; kept: StoreKeptError }): Result<void, StoreKeptError> {
  return err({ ...kept, message: `${kept.message}; it stands at ${join(holding, "store")}` });
}

/**
 * Remove the worker's own store. It must be exactly the store a Connect reserves for the alias and still carry this
 * attempt's reservation. It is then moved, in one rename, into a holding directory created exclusively under a random
 * name beside it — so the rename never lands on anything else — BEFORE the register's last read, so the read and the
 * removal cannot be split by a commit: a row naming the store's path, the holding directory or anything beneath either
 * keeps the store, left in the holding directory and reported there; a row committed after the read names a path the
 * removal never touches (that add makes its own directory there, `plans add`'s `ensureStoreDir`). What is deleted is
 * the holding directory, and only when no row read after the rename names it or anything beneath it.
 *
 * @param alias the alias the store was reserved for
 * @param id the attempt whose reservation the store must carry
 * @returns nothing once removed, or why the store was kept
 */
export async function removeOwnStore({
  alias,
  deps,
  home,
  id,
  storeDir,
}: {
  alias: string;
  deps: CodexConnectDeps;
  home: string;
  id: string;
  storeDir: string;
}): Promise<Result<void, StoreKeptError>> {
  const expected = connectStoreDir({ alias, home });
  if (!CONNECT_ALIAS.test(alias) || storeIdentity({ storeDir }) !== storeIdentity({ storeDir: expected })) {
    return err(StoreKeptErrors.notConnects({ alias }));
  }
  const reservation = reservationOf({ deps, id, storeDir });
  if (reservation.isErr()) {
    return reservation;
  }
  const retired = deps.retireStoreDir({ storeDir });
  if (retired.isErr()) {
    return err(StoreKeptErrors.removalFailed({ cause: retired.error }));
  }
  const holding = retired.value;
  const read = await deps.readRegister();
  if (read.isErr()) {
    return keptAside({ holding, kept: StoreKeptErrors.registerUnreadable({ error: read.error }) });
  }
  // The store's own path, and the holding directory the removal below deletes recursively: a row naming either, or
  // anything beneath either, keeps the store.
  for (const root of [storeDir, holding]) {
    const holder = holderWithin({ root, snapshot: read.value });
    if (holder !== undefined) {
      return keptAside({ holding, kept: StoreKeptErrors.planHolds({ alias: holder }) });
    }
  }
  return deps
    .removeStoreDir({ storeDir: holding })
    .mapErr((cause) =>
      StoreKeptErrors.removalFailed({ cause: `it was moved to ${holding} and could not be removed there: ${cause}` }),
    );
}
