/**
 * The PURE half of reaching Supabase Storage off the running local stack: what `docker inspect` printed for
 * the API gateway and for the Storage container, turned into the API's URL and its key — or into the typed
 * refusal naming what was wrong.
 *
 * ## Why the key is read off the stack and stored nowhere
 *
 * The Storage key is the local stack's own,
 * so Slopweaver reads it off the running container each time and keeps no copy — none in a secret file, none
 * in a store row, none in a backup. MEASURED on this Mac: the docker read takes 0.04 s against
 * 4.26 s for `yarn store:status -o env`, and the two print the same key (sha-256 compared, never printed). Repro:
 * `time docker inspect --format '{{json .Config.Env}}' supabase_storage_slopweaver >/dev/null`.
 *
 * ## The one undocumented name
 *
 * `SERVICE_KEY` is the setting the Supabase CLI gives the Storage container. The CLI never documents it, so an
 * upgrade may rename it; its absence is `OBJECTS_SERVICE_KEY_MISSING`, a loud refusal, never a guess at
 * another name or a slower second source (`.claude/rules/typescript-patterns.md`, no silent fallback).
 *
 * ## Loopback only, read off the publication
 *
 * The gateway's URL is built from the host port docker publishes for its `8000/tcp`, so it is loopback by
 * construction. A publication on any other address — `0.0.0.0`, `::`, a LAN address — is refused outright,
 * because it means another machine can reach the Storage API. MEASURED: with Docker Desktop's port
 * binding set to "localhost only", the gateway reports `127.0.0.1` and `::1`, and the Mac's wifi address gets
 * no answer on the port.
 *
 * No error here carries a value read out of the container's settings: the settings list holds the key.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { exposureLabel, isLoopbackHostIp } from "../dockerPublication.js";
import {
  ObjectStoreErrors,
  type ObjectsApiPortExposedError,
  type ObjectsApiPortUnpublishedError,
  type ObjectsDockerEndpointUnreadableError,
  type ObjectsDockerNotLocalError,
  type ObjectsEnvProxyOnError,
  type ObjectsServiceKeyMissingError,
  type ObjectsStackUnreadableError,
} from "./errors.js";

/** The variables Node's environment proxy reads a proxy from. */
const PROXY_VARIABLES = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"] as const;

/** The Node flag that switches the environment proxy on, on the command line or in `NODE_OPTIONS`. */
const USE_ENV_PROXY_FLAG = "--use-env-proxy";

/**
 * Refuse when Node's environment proxy is on and a proxy is set: the process's `fetch` would then route the
 * Storage request, both key-carrying headers included, through that proxy rather than straight to the loopback
 * gateway this module selected. Read before docker is, so a refusal costs nothing and reads no key.
 *
 * @param env the process environment
 * @param execArgv the flags Node itself was started with
 * @returns nothing when no proxy could carry the request, or the refusal naming what switched it on and
 *   never the proxy's address
 */
export function envProxyOff({
  env,
  execArgv,
}: {
  env: Readonly<Record<string, string | undefined>>;
  execArgv: readonly string[];
}): Result<void, ObjectsEnvProxyOnError> {
  const proxySet = PROXY_VARIABLES.some((name) => {
    const value = env[name];
    return value !== undefined && value.trim() !== "";
  });
  if (!proxySet) {
    return ok(undefined);
  }
  const switchedOnBy = envProxySwitch({ env, execArgv });
  if (switchedOnBy === undefined) {
    return ok(undefined);
  }
  return err(ObjectStoreErrors.envProxyOn({ switchedOnBy }));
}

/**
 * What, if anything, switches Node's environment proxy on.
 *
 * @param env the process environment
 * @param execArgv the flags Node itself was started with
 * @returns the switch's name, or `undefined` when the proxy is off
 */
function envProxySwitch({
  env,
  execArgv,
}: {
  env: Readonly<Record<string, string | undefined>>;
  execArgv: readonly string[];
}): string | undefined {
  const flag = env["NODE_USE_ENV_PROXY"];
  if (flag !== undefined && flag.trim() !== "" && flag.trim() !== "0") {
    return "NODE_USE_ENV_PROXY";
  }
  const options = env["NODE_OPTIONS"];
  if (options !== undefined && optionsMayNameProxyFlag({ options })) {
    return "NODE_OPTIONS";
  }
  if (execArgv.some((token) => flagSwitchesProxyOn({ token }))) {
    return USE_ENV_PROXY_FLAG;
  }
  return undefined;
}

/**
 * Whether `NODE_OPTIONS` could name the environment-proxy flag, read conservatively rather than parsed. Node
 * strips double quotes there and lets a backslash escape the next character, so `"--use-env-proxy"` and
 * `"--use-env-pro\xy"` both switch the proxy on (measured on Node 24.21 with the probe described under
 * `flagSwitchesProxyOn`, `NODE_OPTIONS='"--use-env-pro\xy"' node probe.mjs` reaching the proxy); re-implementing
 * that parser is a chase. Instead every quote and
 * backslash is dropped, `_` folds to `-`, and the flag's name ANYWHERE in what remains counts. Dropping
 * characters can only create a match, never hide one, so this over-refuses (a path or value containing the
 * name) and never under-refuses.
 *
 * @param options the `NODE_OPTIONS` value as the environment holds it
 * @returns `true` when the proxy flag may be in it
 */
function optionsMayNameProxyFlag({ options }: { options: string }): boolean {
  const flattened = options.replaceAll(/["'\\]/gu, "").replaceAll("_", "-");
  return flattened.includes(USE_ENV_PROXY_FLAG.slice(2));
}

/**
 * Whether one entry of `execArgv`, which Node has already parsed, switches the environment proxy on. Node folds `_` into `-` in a flag's name
 * and takes `--flag=<value>` as well as the bare flag, and on Node 24.21 EVERY value turns it on, `=false`
 * included, so the flag's name alone decides. Measured with a `fetch` to a loopback server under
 * `HTTP_PROXY=http://127.0.0.1:47391 NO_PROXY=` and a listener on that port counting what reached it:
 * `node --use-env-proxy=false probe.mjs` and `NODE_OPTIONS=--use_env_proxy node probe.mjs` both reached the
 * proxy, while `node probe.mjs` and `NODE_USE_ENV_PROXY=0 node probe.mjs` went direct.
 *
 * @param token one entry of `execArgv`
 * @returns `true` when the token turns the proxy on
 */
function flagSwitchesProxyOn({ token }: { token: string }): boolean {
  const equals = token.indexOf("=");
  const name = equals === -1 ? token : token.slice(0, equals);
  return name.replaceAll("_", "-") === USE_ENV_PROXY_FLAG;
}

/** The gateway's container port the Storage API is served behind. */
const GATEWAY_PORT = "8000/tcp";

/** The setting the Supabase CLI hands the Storage container its service-role key in. */
const SERVICE_KEY_PREFIX = "SERVICE_KEY=";

/**
 * The `docker inspect --format` template the gateway is read with: whether it runs, and what it publishes.
 *
 * @internal — exported so the edge and its test agree on one template
 */
export const GATEWAY_INSPECT_FORMAT = '{"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}';

/**
 * The `docker inspect --format` template the Storage container is read with: whether it runs, and its settings.
 *
 * @internal — exported so the edge and its test agree on one template
 */
export const STORAGE_INSPECT_FORMAT = '{"running":{{json .State.Running}},"env":{{json .Config.Env}}}';

/** What {@link GATEWAY_INSPECT_FORMAT} prints. A port docker exposes but does not publish maps to `null`. */
const GATEWAY_INSPECT = z.object({
  ports: z.record(z.string(), z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()).nullable(),
  running: z.boolean(),
});

/** What {@link STORAGE_INSPECT_FORMAT} prints. */
const STORAGE_INSPECT = z.object({ env: z.array(z.string()).nullable(), running: z.boolean() });

/**
 * Decode docker's JSON, or say it was not JSON — never quoting the text, which may hold the key.
 *
 * @param text what docker printed
 * @returns the decoded value, or `undefined` when the text is not JSON
 */
function decodeJson({ text }: { text: string }): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/**
 * The Storage API's base URL, read off what the gateway container publishes.
 *
 * @param container the gateway container, for the refusal
 * @param text what {@link GATEWAY_INSPECT_FORMAT} printed
 * @returns `http://<loopback>:<port>`, IPv4 preferred, or the refusal naming what was wrong
 */
export function storageApiUrlFromInspect({
  container,
  text,
}: {
  container: string;
  text: string;
}): Result<string, ObjectsApiPortExposedError | ObjectsApiPortUnpublishedError | ObjectsStackUnreadableError> {
  const decoded = decodeJson({ text });
  if (decoded === undefined) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "docker printed something that is not JSON" }));
  }
  const parsed = GATEWAY_INSPECT.safeParse(decoded.value);
  if (!parsed.success) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "its metadata is not the shape docker prints" }));
  }
  if (!parsed.data.running) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "the container is stopped" }));
  }
  const bindings = parsed.data.ports === null ? undefined : parsed.data.ports[GATEWAY_PORT];
  if (bindings == null || bindings.length === 0) {
    return err(ObjectStoreErrors.apiPortUnpublished({ container }));
  }
  const exposed = bindings.filter((binding) => !isLoopbackHostIp({ hostIp: binding.HostIp }));
  if (exposed.length > 0) {
    return err(
      ObjectStoreErrors.apiPortExposed({
        container,
        hostIps: [...new Set(exposed.map((binding) => exposureLabel({ hostIp: binding.HostIp })))],
      }),
    );
  }
  const ports = new Set(bindings.map((binding) => binding.HostPort));
  const [port] = [...ports];
  if (ports.size !== 1 || port === undefined || !isPortNumber({ text: port })) {
    return err(
      ObjectStoreErrors.stackUnreadable({
        container,
        reason: `it publishes ${GATEWAY_PORT} on no single valid host port`,
      }),
    );
  }
  const ipv4 = bindings.find((binding) => binding.HostIp !== "::1");
  const host = ipv4 === undefined ? "[::1]" : ipv4.HostIp;
  return ok(`http://${host}:${port}`);
}

/** The environment variables that point the docker CLI at a daemon other than its configured context. */
const DOCKER_ENDPOINT_VARIABLES = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"] as const;

/** The scheme a docker endpoint on this machine is reached over. */
const LOCAL_DOCKER_SCHEME = "unix://";

/**
 * The `docker context inspect --format` template: the daemon address of the active context.
 *
 * @internal — exported so the edge and its test agree on one template
 */
export const CONTEXT_ENDPOINT_FORMAT = "{{json .Endpoints.docker.Host}}";

/**
 * The environment every docker call here runs under: this process's own, minus every variable that would aim
 * the docker CLI at another daemon. A `DOCKER_HOST=tcp://…` exported in a shell would otherwise send both reads
 * to a remote machine, whose gateway can report loopback and whose Storage container would hand over its key.
 * What is left is the CLI's persisted context, which {@link localDockerHost} then checks is a local socket.
 *
 * @param env the environment to strip, normally `process.env`
 * @returns a copy without the docker endpoint variables
 */
export function localDockerEnv({ env }: { env: Readonly<Record<string, string | undefined>> }): Record<string, string> {
  const blocked = new Set<string>(DOCKER_ENDPOINT_VARIABLES);
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !blocked.has(name)) {
      kept[name] = value;
    }
  }
  return kept;
}

/**
 * The daemon address both container reads are pinned to: the active context's endpoint, accepted only when it
 * is a Unix socket. A persisted `docker context use <remote>` survives {@link localDockerEnv}, and a remote
 * daemon's gateway can report loopback as easily as this one's, so the endpoint itself is the check. A Unix
 * socket can still be forwarded to another machine by hand (`ssh -L`); that is deliberate plumbing on this
 * machine, and outside what this narrows.
 *
 * @param text what {@link CONTEXT_ENDPOINT_FORMAT} printed
 * @returns the `unix://` address, or the refusal naming only the endpoint's scheme
 */
export function localDockerHost({
  text,
}: {
  text: string;
}): Result<string, ObjectsDockerEndpointUnreadableError | ObjectsDockerNotLocalError> {
  const decoded = decodeJson({ text });
  const parsed = decoded === undefined ? undefined : z.string().safeParse(decoded.value);
  if (parsed === undefined || !parsed.success) {
    return err(ObjectStoreErrors.dockerEndpointUnreadable({ reason: "the active context names no endpoint" }));
  }
  const host = parsed.data;
  if (host.startsWith(LOCAL_DOCKER_SCHEME) && host.length > LOCAL_DOCKER_SCHEME.length) {
    return ok(host);
  }
  return err(ObjectStoreErrors.dockerNotLocal({ scheme: namedScheme({ host }) }));
}

/** The endpoint schemes a refusal may name. Anything else is named as unrecognised, never echoed. */
const NAMEABLE_SCHEMES = ["fd", "http", "https", "npipe", "ssh", "tcp", "unix"] as const;

/**
 * The scheme of a docker endpoint, from a closed list — an arbitrary scheme could carry an address.
 *
 * @param host the endpoint the active context names
 * @returns one of {@link NAMEABLE_SCHEMES}, or a fixed phrase when it is none of them
 */
function namedScheme({ host }: { host: string }): string {
  const scheme = NAMEABLE_SCHEMES.find((name) => host.toLowerCase().startsWith(`${name}://`));
  if (scheme === undefined) {
    return "an unrecognised scheme";
  }
  return scheme;
}

/**
 * Why `docker inspect` failed, in words of our own — never docker's stderr, which a shim or a future docker
 * can fill with the container's settings, and so with the key. Two failures are common enough to name: a
 * daemon that is not running, and a container that does not exist. Anything else names only the exit status.
 *
 * @param status the exit status, `null` when a signal ended docker
 * @param stderr what docker wrote to stderr — read to classify, never copied
 * @returns a reason no part of which came from stderr
 */
export function inspectFailureReason({ status, stderr }: { status: number | null; stderr: string }): string {
  if (/Cannot connect to the Docker daemon/iu.test(stderr)) {
    return "the docker daemon is not running";
  }
  if (/No such (?:object|container)/iu.test(stderr)) {
    return "no such container";
  }
  if (status === null) {
    return "docker inspect was ended by a signal";
  }
  return `docker inspect exited ${String(status)}`;
}

/**
 * Whether a published host port is a TCP port number.
 *
 * @param text the `HostPort` docker reports
 * @returns true for a decimal integer from 1 to 65535
 */
function isPortNumber({ text }: { text: string }): boolean {
  if (!/^\d{1,5}$/u.test(text)) {
    return false;
  }
  const port = Number(text);
  return port >= 1 && port <= 65_535;
}

/** The shortest SERVICE_KEY accepted. Every space-free run of fixed text a Storage error carries is shorter. */
const MIN_SERVICE_KEY_LENGTH = 20;

/** A JWT: a base64url header that opens `{"` (so `eyJ`), a payload and a signature, dot-separated. */
const SERVICE_KEY_SHAPE = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

/**
 * The Storage service key, read out of the running Storage container's settings.
 *
 * @param container the Storage container, for the refusal
 * @param text what {@link STORAGE_INSPECT_FORMAT} printed — it holds the key, so no refusal ever quotes it
 * @returns the key, or the refusal naming what was wrong
 */
export function serviceKeyFromInspect({
  container,
  text,
}: {
  container: string;
  text: string;
}): Result<string, ObjectsServiceKeyMissingError | ObjectsStackUnreadableError> {
  const decoded = decodeJson({ text });
  if (decoded === undefined) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "docker printed something that is not JSON" }));
  }
  const parsed = STORAGE_INSPECT.safeParse(decoded.value);
  if (!parsed.success) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "its metadata is not the shape docker prints" }));
  }
  if (!parsed.data.running) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: "the container is stopped" }));
  }
  if (parsed.data.env === null) {
    return err(ObjectStoreErrors.serviceKeyMissing({ container }));
  }
  const entries = parsed.data.env.filter((entry) => entry.startsWith(SERVICE_KEY_PREFIX));
  if (entries.length > 1) {
    return err(
      ObjectStoreErrors.stackUnreadable({ container, reason: "it carries more than one SERVICE_KEY setting" }),
    );
  }
  const [entry] = entries;
  if (entry === undefined) {
    return err(ObjectStoreErrors.serviceKeyMissing({ container }));
  }
  const key = entry.slice(SERVICE_KEY_PREFIX.length);
  if (key.length === 0) {
    return err(ObjectStoreErrors.serviceKeyMissing({ container }));
  }
  const unfit = serviceKeyUnfit({ key });
  if (unfit !== undefined) {
    return err(ObjectStoreErrors.stackUnreadable({ container, reason: unfit }));
  }
  return ok(key);
}

/**
 * Why a present SERVICE_KEY value cannot be used, if it cannot.
 *
 * @param key the value of the Storage container's SERVICE_KEY setting — never quoted in what this returns
 * @returns the refusal's reason, or `undefined` when the key is fit to send
 */
function serviceKeyUnfit({ key }: { key: string }): string | undefined {
  // The key goes out as two HTTP header values, and a value with a control character or a space makes Node's
  // `Headers` throw an error that QUOTES it — into an `OBJECT_REQUEST_FAILED` message. Refused here instead,
  // naming nothing of it. The Supabase CLI's key is a JWT, all visible ASCII.
  if (!/^[\x21-\x7e]+$/u.test(key)) {
    return "its SERVICE_KEY setting holds a character an HTTP header cannot carry";
  }
  // A key this short is no service key, and it could not be kept out of a message either: fixed text such as
  // a withheld-message line can spell it. The Supabase CLI's key is a signed JWT, many times this long.
  if (key.length < MIN_SERVICE_KEY_LENGTH) {
    return `its SERVICE_KEY setting is shorter than ${String(MIN_SERVICE_KEY_LENGTH)} characters, too short to be a service key`;
  }
  // Only the shape the Supabase CLI issues — a signed JWT, three base64url segments with a JSON header — is
  // accepted. That is what lets `withoutServiceKey` (`./client.ts`) promise no failure carries the key: no
  // fixed text this module emits, no error code and no hex object key has two dots in a run of token
  // characters opening `eyJ`, so a replacement failure can never itself spell an accepted key.
  if (!SERVICE_KEY_SHAPE.test(key)) {
    return "its SERVICE_KEY setting is not shaped like the signed token the Supabase CLI issues";
  }
  return undefined;
}
