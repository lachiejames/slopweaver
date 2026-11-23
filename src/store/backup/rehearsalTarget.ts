/**
 * The PURE half of the restore rehearsal's safety: what the live store IS, what a throwaway target is, and the
 * one constructor that turns a request into a target only after refusing every live coordinate.
 *
 * ## Why a rehearsal cannot reach the live database
 *
 * A rehearsal that shares the live store's only database risks inadvertently deleting data that cannot be
 * got back. So the rehearsal is built so that reaching it takes more than one mistake:
 *
 * 1. **A different Postgres server, not a different database in the same one.** Every write a rehearsal
 *    makes is a `docker exec` into its OWN container, started from the live image with no volume, so its data
 *    directory is that container's writable layer. There is no connection string to the live cluster anywhere
 *    on the write path; `store restore --into` in the live cluster is a different verb.
 * 2. **{@link RehearsalTarget} is branded and {@link rehearsalTarget} is its only constructor**, which refuses
 *    the live database's name, the live port, any container of the live stack, and — read after the throwaway
 *    starts — any mount the live database container has. A function that writes takes a `RehearsalTarget`, so
 *    handing it the live coordinates does not compile.
 * 3. **Every live read runs in a read-only session** (`./rehearsalVerify.ts`), so Postgres itself refuses an
 *    INSERT, UPDATE, DELETE or DDL arriving on it.
 *
 * Nothing here deletes. A throwaway is started with `--rm`, so stopping it discards its own layer and nothing
 * else; a container that already carries the throwaway's name is refused, never removed.
 */
import { err, ok, type Result } from "#lib/result.js";
import { SUPABASE_PROJECT_ID } from "./plan.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";

/** The throwaway's database when the caller names none. Never `postgres`, the live store's name. */
export const DEFAULT_REHEARSAL_DATABASE = "slopweaver_rehearsal";

/** The throwaway's host port when the caller names none — 100 above the live stack's database port. */
export const DEFAULT_REHEARSAL_PORT = 55422;

/** The throwaway container's name when the caller names none. */
export const DEFAULT_REHEARSAL_CONTAINER = "slopweaver_rehearsal_db";

/** One mount the live database container has — its data directory, by volume name and host source. */
export interface LiveMount {
  /** The docker volume's name, or `null` for a bind mount. */
  readonly name: string | null;
  readonly source: string;
  readonly destination: string;
}

/** Everything the rehearsal must never touch, read before it starts anything. */
export interface LiveStore {
  readonly database: string;
  readonly port: number;
  /** The live database container, e.g. `supabase_db_slopweaver`. */
  readonly container: string;
  /**
   * The IMAGE ID it is running — `docker inspect`'s `.Image`, never the tag in `.Config.Image`, which can be
   * re-pointed — so the throwaway runs the very same server build and extensions.
   */
  readonly imageId: string;
  readonly mounts: readonly LiveMount[];
}

/** What the caller asked the throwaway to be. */
export interface RehearsalRequest {
  readonly database: string;
  readonly port: number;
  readonly container: string;
}

/** The brand's key. A real symbol, not a phantom, so minting a target needs no type assertion. */
const REHEARSAL_BRAND: unique symbol = Symbol("store.rehearsal.target");

/** A throwaway target {@link rehearsalTarget} has checked against the live store. Nothing else makes one. */
export type RehearsalTarget = RehearsalRequest & {
  /** The live container's image ID, which the throwaway runs. */
  readonly imageId: string;
  readonly [REHEARSAL_BRAND]: true;
};

/**
 * Whether a container name belongs to the live Supabase stack — `supabase_<service>_<project>`.
 *
 * @param container the name to judge
 * @returns true for any of the stack's containers, not only the database's
 */
function isLiveStackContainer({ container }: { container: string }): boolean {
  return container.startsWith("supabase_") && container.endsWith(`_${SUPABASE_PROJECT_ID}`);
}

/**
 * Turn a request into a target, refusing every coordinate it shares with the live store.
 *
 * Every collision is listed, not only the first, so one refusal says everything that was wrong with it.
 *
 * @param live what the live store is
 * @param requested what the caller asked for
 * @returns the target, or the refusal naming every collision
 */
export function rehearsalTarget({
  live,
  requested,
}: {
  live: LiveStore;
  requested: RehearsalRequest;
}): Result<RehearsalTarget, RehearsalError> {
  const collisions = [
    ...(requested.database === live.database
      ? [`--into ${requested.database} is the live store's database name (port ${String(live.port)})`]
      : []),
    ...(requested.port === live.port ? [`--port ${String(requested.port)} is the live store's port`] : []),
    ...(requested.container === live.container || isLiveStackContainer({ container: requested.container })
      ? [`--container ${requested.container} is a container of the live Supabase stack`]
      : []),
  ];
  if (collisions.length > 0) {
    return err(RehearsalErrors.targetIsLive({ collisions }));
  }
  // The only place a `RehearsalTarget` is minted: the brand's symbol is not exported.
  return ok({ ...requested, imageId: live.imageId, [REHEARSAL_BRAND]: true });
}

/**
 * Check a STARTED throwaway's mounts — the half of the guard that can only be read once docker has made the
 * container.
 *
 * The throwaway is started with no mount flag at all, so ANY mount it reports is refused, not only one it
 * shares with live: "we never pass one" is a claim about our argv, this is a reading of what docker actually
 * did, and an image that one day declares a `VOLUME` would otherwise give the throwaway a data directory
 * that outlives it. A mount it shares with the live data directory — by volume name or host source — is
 * named as that, because it is the one this whole module exists to prevent.
 *
 * @param live the live store, whose mounts are the data directory
 * @param mounts what `docker inspect` reports for the throwaway
 * @returns nothing when it has no mount, else the refusal naming each one
 */
export function throwawayMountsClear({
  live,
  mounts,
}: {
  live: LiveStore;
  mounts: readonly LiveMount[];
}): Result<void, RehearsalError> {
  if (mounts.length === 0) {
    return ok(undefined);
  }
  return err(
    RehearsalErrors.targetIsLive({
      collisions: mounts.map((mount) => {
        const isLive = live.mounts.some(
          (liveMount) => liveMount.source === mount.source || (mount.name !== null && liveMount.name === mount.name),
        );
        return isLive
          ? `the throwaway mounts ${mount.source} at ${mount.destination}, the live store's data directory`
          : `the throwaway mounts ${mount.source} at ${mount.destination}, and a throwaway is started with none`;
      }),
    }),
  );
}

/**
 * The `docker run` argv that starts a throwaway — detached, removed when stopped, bound to loopback only, and
 * with NO mount of any kind, so its data directory is its own writable layer. The superuser password is named,
 * never valued: `--env POSTGRES_PASSWORD` makes the docker client copy it from its own environment
 * ({@link THROWAWAY_PASSWORD_ENV}), so the per-run password never sits in a process argv any local user can list.
 *
 * @param target the checked target
 * @returns the argv after `docker`
 */
export function throwawayRunArgs({ target }: { target: RehearsalTarget }): readonly string[] {
  return [
    "run",
    "--detach",
    "--rm",
    "--name",
    target.container,
    "--publish",
    `127.0.0.1:${String(target.port)}:5432`,
    "--env",
    THROWAWAY_PASSWORD_ENV,
    target.imageId,
  ];
}

/** The variable the docker client reads the throwaway's password from, and the name the container receives it as. */
export const THROWAWAY_PASSWORD_ENV = "POSTGRES_PASSWORD";

/**
 * The connection string the verification reads the throwaway through, on loopback and its own port.
 *
 * @param target the checked target
 * @param password the per-run password
 * @returns the URL
 */
export function throwawayUrl({ target, password }: { target: RehearsalTarget; password: string }): string {
  return `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${String(target.port)}/${target.database}`;
}
