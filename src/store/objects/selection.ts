/**
 * The effectful edge of reaching Supabase Storage: one `docker context inspect` and two `docker inspect` calls
 * against the running local stack, read fresh on every open and kept nowhere. The parsing, and why the key is
 * read rather than stored, is `./selectionCore.ts`.
 *
 * The daemon is checked FIRST: the active context's endpoint must be a local Unix socket, and both container
 * reads are pinned to that one address. The gateway is read next, so a stack published beyond loopback is
 * refused before the Storage container's settings — which hold the key — are read at all.
 *
 * The browser lane alone may name its own loopback Storage instead, by a pair of variables checked after the proxy
 * and before docker (`./e2eSelection.ts`); with neither set, nothing here changes.
 *
 * Synchronous `spawnSync` on purpose, like `../backup/stack.ts`: `no-headless` bans the async `child_process`
 * members, and each call measured 0.04 s.
 */
import { spawnSync } from "node:child_process";

import { err, ok, type Result } from "#lib/result.js";

import { supabaseContainer } from "../backup/plan.js";
import { e2eStoreObjectsSelection } from "./e2eSelection.js";
import {
  type ObjectStoreError,
  ObjectStoreErrors,
  type ObjectsDockerEndpointUnreadableError,
  type ObjectsStackUnreadableError,
} from "./errors.js";
import {
  CONTEXT_ENDPOINT_FORMAT,
  envProxyOff,
  GATEWAY_INSPECT_FORMAT,
  inspectFailureReason,
  localDockerEnv,
  localDockerHost,
  STORAGE_INSPECT_FORMAT,
  serviceKeyFromInspect,
  storageApiUrlFromInspect,
} from "./selectionCore.js";

/** One `docker inspect --format <format> <container>` against the daemon at `host`: what it printed, or why docker could not answer. */
export type DockerInspect = (request: {
  container: string;
  format: string;
  host: string;
}) => Result<string, ObjectsStackUnreadableError>;

/** One `docker context inspect --format` of the active context's endpoint: what it printed, or why docker could not answer. */
export type DockerContextEndpoint = () => Result<string, ObjectsDockerEndpointUnreadableError>;

/**
 * How long one docker call may take before it is a refusal rather than a hang. Each call measured 0.04 s on a
 * running stack (`time docker inspect --format '{{json .Config.Env}}' supabase_storage_slopweaver >/dev/null`);
 * a wedged daemon socket would otherwise block the synchronous caller indefinitely.
 */
const DOCKER_TIMEOUT_MS = 30_000;

/** A resolved Storage selection. The key is a credential and is never printed. */
export interface StoreObjectsSelection {
  readonly apiUrl: string;
  readonly serviceKey: string;
}

/**
 * Read the active docker context's daemon address, with every docker endpoint variable stripped.
 *
 * @returns what docker printed, or why it could not say
 */
const dockerContextEndpoint: DockerContextEndpoint = () => {
  const result = spawnSync("docker", ["context", "inspect", "--format", CONTEXT_ENDPOINT_FORMAT], {
    env: localDockerEnv({ env: process.env }),
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DOCKER_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    return err(
      ObjectStoreErrors.dockerEndpointUnreadable({
        reason: `docker did not run to completion: ${result.error.message}`,
      }),
    );
  }
  if (result.status !== 0) {
    return err(
      ObjectStoreErrors.dockerEndpointUnreadable({
        reason: inspectFailureReason({ status: result.status, stderr: String(result.stderr) }),
      }),
    );
  }
  return ok(String(result.stdout).trim());
};

/**
 * Run `docker inspect` with one format template against one pinned daemon, and report a failure without quoting
 * stdout or stderr.
 *
 * @param container the container to describe
 * @param format the `--format` template
 * @param host the `unix://` daemon address both reads are pinned to
 * @returns what docker printed, or why it could not describe the container
 */
const dockerInspect: DockerInspect = ({ container, format, host }) => {
  const result = spawnSync("docker", ["inspect", "--format", format, container], {
    env: { ...localDockerEnv({ env: process.env }), DOCKER_HOST: host },
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DOCKER_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    return err(
      ObjectStoreErrors.stackUnreadable({
        container,
        reason: `docker did not run to completion: ${result.error.message}`,
      }),
    );
  }
  if (result.status !== 0) {
    return err(
      ObjectStoreErrors.stackUnreadable({
        container,
        reason: inspectFailureReason({ status: result.status, stderr: String(result.stderr) }),
      }),
    );
  }
  return ok(String(result.stdout).trim());
};

/**
 * Read the Storage API's URL and key off the running local stack, storing neither.
 *
 * @param endpoint the docker context read — a plain fake in a test, the real `docker context inspect` otherwise
 * @param inspect the docker container read — a plain fake in a test, the real `docker inspect` otherwise
 * @param env the environment Node's proxy settings and the browser lane's pair are read from — the process's own
 *   unless a test names one
 * @param execArgv the flags Node was started with — the process's own unless a test names them
 * @returns the selection, or the typed refusal naming what was wrong
 */
export function storeObjectsSelection({
  endpoint = dockerContextEndpoint,
  inspect = dockerInspect,
  env = process.env,
  execArgv = process.execArgv,
}: {
  endpoint?: DockerContextEndpoint;
  inspect?: DockerInspect;
  env?: Readonly<Record<string, string | undefined>>;
  execArgv?: readonly string[];
} = {}): Result<StoreObjectsSelection, ObjectStoreError> {
  const direct = envProxyOff({ env, execArgv });
  if (direct.isErr()) {
    return err(direct.error);
  }
  // The browser lane's own Storage, named by a pair of variables; neither set is every other run.
  const lane = e2eStoreObjectsSelection({ env });
  if (lane.isErr()) {
    return err(lane.error);
  }
  if (lane.value !== undefined) {
    return ok(lane.value);
  }
  const host = endpoint().andThen((text) => localDockerHost({ text }));
  if (host.isErr()) {
    return err(host.error);
  }
  const gateway = supabaseContainer({ service: "kong" });
  const apiUrl = inspect({ container: gateway, format: GATEWAY_INSPECT_FORMAT, host: host.value }).andThen((text) =>
    storageApiUrlFromInspect({ container: gateway, text }),
  );
  if (apiUrl.isErr()) {
    return err(apiUrl.error);
  }
  const storage = supabaseContainer({ service: "storage" });
  return inspect({ container: storage, format: STORAGE_INSPECT_FORMAT, host: host.value })
    .andThen((text) => serviceKeyFromInspect({ container: storage, text }))
    .map((serviceKey) => ({ apiUrl: apiUrl.value, serviceKey }));
}
