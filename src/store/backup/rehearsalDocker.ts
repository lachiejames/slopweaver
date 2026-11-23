/**
 * The Docker edge of a restore rehearsal: describe the live database container, start a throwaway beside it,
 * read back what docker actually made, wait for it, restore into it, and stop it.
 *
 * Every function that WRITES takes a {@link RehearsalTarget} — the branded type only `rehearsalTarget` mints,
 * after refusing the live coordinates — and every `docker exec` it makes addresses the container ID this run's
 * `docker run` printed, never a name. The
 * restore steps are `./stackDatabase.ts`'s `…In` variants with the container passed explicitly; nothing here imports a
 * live-stack wrapper, `dropDatabase` or `untarStorage`, so there is no path from this file to a write on the
 * live server.
 *
 * **Nothing here deletes.** The throwaway is started with `--rm`; the one cleanup is `docker stop` of the
 * container ID THIS invocation's `docker run` printed, which discards that container's own writable layer and
 * nothing else. A container already carrying the throwaway's name is refused before anything starts, never
 * stopped, adopted or removed.
 *
 * Synchronous `spawnSync` on purpose, like `./stack.ts`: `no-headless` bans the async `child_process` members.
 */
import { spawnSync } from "node:child_process";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { storeRoleStatements } from "../policies.js";
import { type BackupError, backupErrorLines } from "./errors.js";
import type { BackupManifest } from "./plan.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";
import { type LiveMount, type RehearsalTarget, THROWAWAY_PASSWORD_ENV, throwawayRunArgs } from "./rehearsalTarget.js";
import { type RestoreMode, restoreModeFor } from "./restorePlan.js";
import {
  createDatabaseIn,
  createExtensionIn,
  databaseExistsIn,
  restoreDatabaseIn,
  runStatementIn,
  targetShapeIn,
} from "./stackDatabase.js";

/** How long a throwaway gets to finish its first-boot initialisation and accept TCP connections. */
const READY_SECONDS = 180;

/** What `docker inspect --format '{{json .Mounts}}'` prints — a bind mount's `Name` is absent or empty. */
const DOCKER_MOUNTS = z.array(z.object({ Destination: z.string(), Name: z.unknown().optional(), Source: z.string() }));

/**
 * How long one `docker` call here may run: an inspect, a list, a `run -d` of an image already on the machine (the
 * live stack's own image id, so never a pull) and a `stop` with its 10s grace all return in seconds, so this only
 * ends a client wedged on a daemon that never answers.
 */
const DOCKER_CALL_TIMEOUT_MS = 120_000;

/**
 * Run `docker` with piped output and report a non-zero exit with its stderr, and a call past its timeout as that.
 *
 * @param args the argv after `docker`
 * @param step how a failure names the step
 * @param env variables added to the client's environment for this one call — how a secret reaches docker unseen in argv
 * @param timeoutMs how long this call may run, when it legitimately waits longer than {@link DOCKER_CALL_TIMEOUT_MS}
 * @returns stdout, trimmed
 */
function docker({
  args,
  env,
  step,
  timeoutMs = DOCKER_CALL_TIMEOUT_MS,
}: {
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
  step: string;
  timeoutMs?: number;
}): Result<string, RehearsalError> {
  const result = spawnSync("docker", [...args], {
    env: env === undefined ? process.env : { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  if (result.error !== undefined) {
    const timedOut = "code" in result.error && result.error.code === "ETIMEDOUT";
    if (timedOut) {
      return err(
        RehearsalErrors.stepFailed({
          reasons: [`docker did not finish within ${String(timeoutMs / 1000)}s and was stopped`],
          step,
        }),
      );
    }
    return err(RehearsalErrors.stepFailed({ reasons: [result.error.message], step }));
  }
  if (result.status !== 0) {
    return err(RehearsalErrors.stepFailed({ reasons: [String(result.stderr).trim()], step }));
  }
  return ok(String(result.stdout).trim());
}

/**
 * Decode `docker inspect --format '{{json .Mounts}}'` into mounts.
 *
 * @param text the JSON docker printed
 * @returns the mounts, or `null` when the text is not the shape docker prints
 */
export function parseMounts({ text }: { text: string }): readonly LiveMount[] | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = DOCKER_MOUNTS.safeParse(decoded);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.map((mount) => ({
    destination: mount.Destination,
    name: typeof mount.Name === "string" && mount.Name.length > 0 ? mount.Name : null,
    source: mount.Source,
  }));
}

/**
 * Read the live database container's image ID and mounts.
 *
 * @param container the live database container
 * @returns both, or why docker could not describe it
 */
export function inspectLiveContainer({
  container,
}: {
  container: string;
}): Result<{ imageId: string; mounts: readonly LiveMount[] }, RehearsalError> {
  const image = docker({
    args: ["container", "inspect", "--format", "{{.Image}}", container],
    step: `docker inspect ${container}`,
  });
  const mountsText = docker({
    args: ["container", "inspect", "--format", "{{json .Mounts}}", container],
    step: `docker inspect ${container}`,
  });
  if (image.isErr() || mountsText.isErr()) {
    const reasons = [image, mountsText].flatMap((step) => (step.isErr() ? [step.error.message] : []));
    return err(RehearsalErrors.liveUnreadable({ reasons }));
  }
  const mounts = parseMounts({ text: mountsText.value });
  if (mounts === null) {
    return err(
      RehearsalErrors.liveUnreadable({ reasons: [`docker printed mounts this cannot read: ${mountsText.value}`] }),
    );
  }
  return ok({ imageId: image.value, mounts });
}

/**
 * Whether any container, running or stopped, already carries a name.
 *
 * @param name the container name
 * @returns true when one does
 */
export function containerNameTaken({ name }: { name: string }): Result<boolean, RehearsalError> {
  return docker({
    args: ["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"],
    step: "docker container ls",
  }).map((out) => out.split("\n").some((line) => line.trim() === name));
}

/**
 * Stop a throwaway whose start could not be read back, so a failed inspect never strands it under the name
 * the next run would then refuse.
 *
 * @param id the ID `docker run` printed
 * @param failure why the start could not be read back
 * @returns the failure, carrying the stop's own failure when the container would not stop either
 */
function stopUnreadStart({ id, failure }: { id: string; failure: RehearsalError }): RehearsalError {
  const stopped = stopThrowaway({ id });
  if (stopped.isOk()) {
    return failure;
  }
  return RehearsalErrors.stepFailed({
    reasons: [failure.message, `and it would not stop, so it is still running: ${stopped.error.message}`],
    step: `docker run ${id.slice(0, 12)}`,
  });
}

/**
 * Start the throwaway and read back what docker made of it. A read-back that fails stops the container this
 * call just started before reporting, since no caller ever learns its ID.
 *
 * @param target the checked target
 * @param password the per-run superuser password
 * @returns the container ID this invocation created, and the mounts docker reports for it
 */
export function startThrowaway({
  target,
  password,
}: {
  target: RehearsalTarget;
  password: string;
}): Result<{ id: string; mounts: readonly LiveMount[] }, RehearsalError> {
  const started = docker({
    args: throwawayRunArgs({ target }),
    env: { [THROWAWAY_PASSWORD_ENV]: password },
    step: `docker run ${target.container}`,
  });
  if (started.isErr()) {
    return err(started.error);
  }
  const id = started.value;
  const mountsText = docker({
    args: ["container", "inspect", "--format", "{{json .Mounts}}", id],
    step: `docker inspect ${target.container}`,
  });
  if (mountsText.isErr()) {
    return err(stopUnreadStart({ failure: mountsText.error, id }));
  }
  const mounts = parseMounts({ text: mountsText.value });
  if (mounts === null) {
    return err(
      stopUnreadStart({
        failure: RehearsalErrors.stepFailed({
          reasons: [`docker printed mounts this cannot read: ${mountsText.value}`],
          step: `docker inspect ${target.container}`,
        }),
        id,
      }),
    );
  }
  return ok({ id, mounts });
}

/**
 * Wait until the throwaway accepts TCP connections — which the image's first boot only does once its init
 * scripts have finished and the real server has started.
 *
 * @param id the container this invocation created
 * @returns nothing once it is ready, else why it never became so
 */
export function waitForThrowaway({ id }: { id: string }): Result<void, RehearsalError> {
  return docker({
    args: [
      "exec",
      id,
      "sh",
      "-c",
      `i=0; until pg_isready -q -h 127.0.0.1 -U postgres; do i=$((i+1)); [ $i -ge ${String(READY_SECONDS)} ] && exit 1; sleep 1; done`,
    ],
    step: `waiting ${String(READY_SECONDS)}s for the throwaway to accept connections`,
    // The loop gives up on its own after READY_SECONDS; the client gets a minute past that before it is stopped.
    timeoutMs: (READY_SECONDS + 60) * 1000,
  }).map(() => undefined);
}

/**
 * Stop the container this invocation started. It was run with `--rm`, so stopping it discards it.
 *
 * @param id the ID `docker run` printed — never a name, so nothing else can be addressed
 * @returns nothing on success, else why it would not stop
 */
export function stopThrowaway({ id }: { id: string }): Result<void, RehearsalError> {
  return docker({ args: ["stop", id], step: `docker stop ${id.slice(0, 12)}` }).map(() => undefined);
}

/**
 * Restore the verified dump into the throwaway: create the store's three roles and the database, re-create
 * the extensions a scoped dump omits, and replay it with `--exit-on-error`.
 *
 * The roles are cluster-level, so no database dump carries them, and the dump's policies name them: MEASURED
 * on the first rehearsal against the live backup stopped at `CREATE POLICY atlas_coverage_agent_read
 * … TO slopweaver_agent` with `role "slopweaver_agent" does not exist`. They are created with the same
 * idempotent statements the apply loop runs before a migration (`storeRoleStatements`), into the throwaway's
 * server only. Repro: `slopweaver store rehearse` on a build without this step.
 *
 * @param target the checked target, for its database name
 * @param id the container ID this run's `docker run` printed — every `docker exec` addresses it, never a name
 * @param manifest the verified manifest, whose extensions are re-created first
 * @param dumpPath the verified dump on the host
 * @returns the restore mode it took, or why it stopped
 */
export function restoreIntoThrowaway({
  target,
  id,
  manifest,
  dumpPath,
}: {
  target: RehearsalTarget;
  id: string;
  manifest: BackupManifest;
  dumpPath: string;
}): Result<RestoreMode, RehearsalError> {
  const { database } = target;
  const container = id;
  const created = createEmptyTarget({ container, database });
  if (created.isErr()) {
    return err(created.error);
  }
  const shape = targetShapeIn({ container, database }).mapErr((error) =>
    stepFailed({ error, name: "reading the rehearsal database" }),
  );
  if (shape.isErr()) {
    return err(shape.error);
  }
  const mode = restoreModeFor(shape.value).mapErr((error) => stepFailed({ error, name: "deciding the restore mode" }));
  if (mode.isErr()) {
    return err(mode.error);
  }
  for (const extension of manifest.extensions) {
    const made = createExtensionIn({ container, database, extension }).mapErr((error) =>
      stepFailed({ error, name: `create extension ${extension.name}` }),
    );
    if (made.isErr()) {
      return err(made.error);
    }
  }
  const restored = restoreDatabaseIn({ container, database, mode: mode.value, path: dumpPath }).mapErr((error) =>
    stepFailed({ error, name: `pg_restore into ${database}` }),
  );
  return restored.map(() => mode.value);
}

/**
 * Create the rehearsal database in the throwaway, refusing one that is somehow already there, and the store's
 * three roles beside it.
 *
 * @param container the throwaway's ID
 * @param database the rehearsal database's name
 * @returns nothing once both exist, else why not
 */
function createEmptyTarget({
  container,
  database,
}: {
  container: string;
  database: string;
}): Result<void, RehearsalError> {
  const exists = databaseExistsIn({ container, database }).mapErr((error) =>
    stepFailed({ error, name: "reading the throwaway's databases" }),
  );
  if (exists.isErr()) {
    return err(exists.error);
  }
  if (exists.value) {
    return err(
      RehearsalErrors.stepFailed({
        reasons: [`${database} already exists in a container this run just created`],
        step: "creating the rehearsal database",
      }),
    );
  }
  const created = createDatabaseIn({ container, database }).mapErr((error) =>
    stepFailed({ error, name: `createdb ${database}` }),
  );
  if (created.isErr()) {
    return err(created.error);
  }
  for (const statement of storeRoleStatements()) {
    const role = runStatementIn({ container, database, label: "creating the store's roles", statement }).mapErr(
      (error) => stepFailed({ error, name: "creating the store's roles" }),
    );
    if (role.isErr()) {
      return err(role.error);
    }
  }
  return ok(undefined);
}

/**
 * Carry a stack step's own failure into the rehearsal's union, its lines intact.
 *
 * @param error what the stack step returned
 * @param name which step it was
 * @returns the rehearsal failure
 */
function stepFailed({ error, name }: { error: BackupError; name: string }): RehearsalError {
  return RehearsalErrors.stepFailed({ reasons: backupErrorLines({ error }), step: name });
}
