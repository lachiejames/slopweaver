/**
 * The typed failures of the store's object half — Supabase Storage, which holds the bytes a `text` column
 * cannot.
 *
 * Its own union rather than new members of `../errors.ts`'s `StoreError`, per `.claude/rules/error-handling.md`:
 * these are failures of a second system with its own credential, its own transport and its own way of being
 * wrong, and a caller branches on them differently — a stopped stack is an instruction to start it, while a
 * digest mismatch is a stored object that no longer holds what was put in it.
 */

/** Docker could not describe one of the local stack's containers: docker failed, it is stopped, or its metadata is not the shape docker prints. */
export interface ObjectsStackUnreadableError {
  readonly code: "OBJECTS_STACK_UNREADABLE";
  readonly message: string;
  readonly container: string;
  /** What went wrong, never a value read out of the container's settings. */
  readonly reason: string;
}

/** The running Storage container carries no `SERVICE_KEY` setting — the name the Supabase CLI gives it, which it does not document. */
export interface ObjectsServiceKeyMissingError {
  readonly code: "OBJECTS_SERVICE_KEY_MISSING";
  readonly message: string;
  readonly container: string;
  readonly variable: "SERVICE_KEY";
}

/** The API gateway container publishes no host port for its `8000/tcp`. */
export interface ObjectsApiPortUnpublishedError {
  readonly code: "OBJECTS_API_PORT_UNPUBLISHED";
  readonly message: string;
  readonly container: string;
  readonly containerPort: "8000/tcp";
}

/** The API gateway is published on an address another machine can reach, so the Storage API is not opened. */
export interface ObjectsApiPortExposedError {
  readonly code: "OBJECTS_API_PORT_EXPOSED";
  readonly message: string;
  readonly container: string;
  /** What kind of exposure each non-loopback publication is (`every interface`, `a non-loopback address`), never the address. */
  readonly hostIps: readonly string[];
}

/** Docker could not say which daemon its active context points at, so no container is read. */
export interface ObjectsDockerEndpointUnreadableError {
  readonly code: "OBJECTS_DOCKER_ENDPOINT_UNREADABLE";
  readonly message: string;
  readonly reason: string;
}

/** Docker's active context points at a daemon reached over something other than a local Unix socket. */
export interface ObjectsDockerNotLocalError {
  readonly code: "OBJECTS_DOCKER_NOT_LOCAL";
  readonly message: string;
  /** The endpoint's scheme only — `tcp`, `ssh`, `npipe` — never its address. */
  readonly scheme: string;
}

/**
 * Node's environment proxy is switched on with a proxy set, so a Storage request — and both headers carrying
 * the key — could be sent to that proxy instead of straight to the loopback gateway.
 */
export interface ObjectsEnvProxyOnError {
  readonly code: "OBJECTS_ENV_PROXY_ON";
  readonly message: string;
  /** What switched it on — `NODE_USE_ENV_PROXY`, `NODE_OPTIONS` or `--use-env-proxy` — never the proxy's address. */
  readonly switchedOnBy: string;
}

/** Only one of the browser lane's two Storage variables is set, so neither the lane's fake nor the stack is chosen. */
export interface ObjectsE2ePairIncompleteError {
  readonly code: "OBJECTS_E2E_PAIR_INCOMPLETE";
  readonly message: string;
  /** The variable that IS set — its name, never its value. */
  readonly present: string;
}

/** The browser lane's Storage address is not a plain loopback `http://` origin with a port. */
export interface ObjectsE2eApiUrlNotLoopbackError {
  readonly code: "OBJECTS_E2E_API_URL_NOT_LOOPBACK";
  readonly message: string;
}

/** The browser lane's Storage key is too short, or holds more than a generated key would. */
export interface ObjectsE2eServiceKeyInvalidError {
  readonly code: "OBJECTS_E2E_SERVICE_KEY_INVALID";
  readonly message: string;
}

/** A leftover copy of a retired Storage secret is still on disk and could not be removed. */
export interface ObjectsRetiredCopyUnremovedError {
  readonly code: "OBJECTS_RETIRED_COPY_UNREMOVED";
  readonly message: string;
  readonly path: string;
}

/** A Storage request failed — the API answered with an error, or could not be reached at all. */
export interface ObjectRequestFailedError {
  readonly code: "OBJECT_REQUEST_FAILED";
  readonly message: string;
  /** The object key, or the bucket name for a bucket call. */
  readonly key: string;
  /** The HTTP status the API answered with, when it answered at all. */
  readonly status: number | undefined;
}

/** A downloaded object's bytes do not hash to the key they were stored under. */
export interface ObjectDigestMismatchError {
  readonly code: "OBJECT_DIGEST_MISMATCH";
  readonly message: string;
  readonly key: string;
  readonly actual: string;
}

/** Every way the object half can fail. */
export type ObjectStoreError =
  | ObjectDigestMismatchError
  | ObjectRequestFailedError
  | ObjectsApiPortExposedError
  | ObjectsApiPortUnpublishedError
  | ObjectsDockerEndpointUnreadableError
  | ObjectsDockerNotLocalError
  | ObjectsE2eApiUrlNotLoopbackError
  | ObjectsE2ePairIncompleteError
  | ObjectsE2eServiceKeyInvalidError
  | ObjectsEnvProxyOnError
  | ObjectsRetiredCopyUnremovedError
  | ObjectsServiceKeyMissingError
  | ObjectsStackUnreadableError;

/** The factories the client, the selection and their tests build failures with. */
export const ObjectStoreErrors = {
  apiPortExposed: ({
    container,
    hostIps,
  }: {
    container: string;
    hostIps: readonly string[];
  }): ObjectsApiPortExposedError => ({
    code: "OBJECTS_API_PORT_EXPOSED",
    container,
    hostIps,
    message:
      `refusing to open Supabase Storage: ${container} publishes the API on ${hostIps.join(", ")}, which another ` +
      `machine may reach. Publish the local stack on loopback only (Docker Desktop: Settings > Resources > Network, ` +
      `port binding "localhost only") and run it again.`,
  }),
  apiPortUnpublished: ({ container }: { container: string }): ObjectsApiPortUnpublishedError => ({
    code: "OBJECTS_API_PORT_UNPUBLISHED",
    container,
    containerPort: "8000/tcp",
    message: `refusing to open Supabase Storage: ${container} publishes no host port for 8000/tcp, so there is no API to call. Is the stack started with \`yarn store:start\`?`,
  }),
  dockerEndpointUnreadable: ({ reason }: { reason: string }): ObjectsDockerEndpointUnreadableError => ({
    code: "OBJECTS_DOCKER_ENDPOINT_UNREADABLE",
    message: `refusing to open Supabase Storage: docker could not say which daemon its active context points at (${reason}). Is Docker running?`,
    reason,
  }),
  dockerNotLocal: ({ scheme }: { scheme: string }): ObjectsDockerNotLocalError => ({
    code: "OBJECTS_DOCKER_NOT_LOCAL",
    message:
      `refusing to open Supabase Storage: docker's active context reaches its daemon over ${scheme}, not a local ` +
      `Unix socket, so the containers it describes may be another machine's and so may the key. Switch back to ` +
      `this machine's daemon (\`docker context use\` with the local context) and run it again.`,
    scheme,
  }),
  e2eApiUrlNotLoopback: (): ObjectsE2eApiUrlNotLoopbackError => ({
    code: "OBJECTS_E2E_API_URL_NOT_LOOPBACK",
    message:
      "refusing to open Supabase Storage: SLOPWEAVER_E2E_OBJECTS_API_URL is not a plain http://127.x.x.x:<port> or " +
      "http://[::1]:<port> origin, so the service key could be sent off this machine. Only the browser lane sets it.",
  }),
  e2ePairIncomplete: ({ present }: { present: string }): ObjectsE2ePairIncompleteError => ({
    code: "OBJECTS_E2E_PAIR_INCOMPLETE",
    message:
      `refusing to open Supabase Storage: ${present} is set without its pair, so neither the browser lane's ` +
      "Storage nor the local stack is chosen. Unset it, or set both SLOPWEAVER_E2E_OBJECTS_* variables.",
    present,
  }),
  e2eServiceKeyInvalid: (): ObjectsE2eServiceKeyInvalidError => ({
    code: "OBJECTS_E2E_SERVICE_KEY_INVALID",
    message:
      "refusing to open Supabase Storage: SLOPWEAVER_E2E_OBJECTS_SERVICE_KEY is not a generated key of at least 32 " +
      "letters, digits, dashes or underscores.",
  }),
  envProxyOn: ({ switchedOnBy }: { switchedOnBy: string }): ObjectsEnvProxyOnError => ({
    code: "OBJECTS_ENV_PROXY_ON",
    message:
      `refusing to open Supabase Storage: ${switchedOnBy} switches on Node's environment proxy and a proxy is ` +
      `set, so the request carrying the service key could go to that proxy instead of straight to this ` +
      `machine's gateway. Run it again without the environment proxy.`,
    switchedOnBy,
  }),
  digestMismatch: ({ key, actual }: { key: string; actual: string }): ObjectDigestMismatchError => ({
    actual,
    code: "OBJECT_DIGEST_MISMATCH",
    key,
    message: `the stored object ${key} hashes to ${actual}, not to its own key — it no longer holds what was put in it`,
  }),
  requestFailed: ({
    key,
    status,
    reason,
  }: {
    key: string;
    status: number | undefined;
    reason: string;
  }): ObjectRequestFailedError => ({
    code: "OBJECT_REQUEST_FAILED",
    key,
    message: `the Storage API refused ${key}${status === undefined ? "" : ` (HTTP ${String(status)})`}: ${reason}`,
    status,
  }),
  retiredCopyUnremoved: ({ path }: { path: string }): ObjectsRetiredCopyUnremovedError => ({
    code: "OBJECTS_RETIRED_COPY_UNREMOVED",
    message: `refusing to open Supabase Storage: ${path} is a retired copy of a value the running stack now supplies, and it could not be removed. Delete it by hand and run it again.`,
    path,
  }),
  serviceKeyMissing: ({ container }: { container: string }): ObjectsServiceKeyMissingError => ({
    code: "OBJECTS_SERVICE_KEY_MISSING",
    container,
    message:
      `refusing to open Supabase Storage: the running ${container} carries no SERVICE_KEY setting. That name is ` +
      `the Supabase CLI's own and undocumented, so a CLI upgrade may have renamed it; nothing here guesses another. ` +
      `\`yarn store:status -o env\`, run from this checkout, prints the same key as SERVICE_ROLE_KEY — use it to ` +
      `find the new name by hand, never as a fallback.`,
    variable: "SERVICE_KEY",
  }),
  stackUnreadable: ({ container, reason }: { container: string; reason: string }): ObjectsStackUnreadableError => ({
    code: "OBJECTS_STACK_UNREADABLE",
    container,
    message: `refusing to open Supabase Storage: docker could not describe ${container} (${reason}). Is the local stack running? \`yarn store:start\` from this checkout starts it.`,
    reason,
  }),
} as const;
