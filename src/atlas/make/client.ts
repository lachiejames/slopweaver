/**
 * The Make door's one way to the network: the official SDK, behind a rail that lets only a GET out.
 *
 * The owner's ask: a READ-ONLY Make atlas — "nothing in make.com is changed or run". The SDK can
 * do both (`scenarios.run`, `scenarios.create`, `connections.delete`, …), and a scoped token is only half a
 * guard because the token's scopes are ticked by hand in Make's UI and are not readable from here. So the
 * other half is structural: every SDK endpoint class is built over `this.fetch.bind(this)`, which means
 * overriding `fetch` intercepts EVERY call the SDK can make. {@link ReadOnlyMake} refuses, before a byte
 * leaves the process, any method but GET, any URL that is not a path on the configured zone's own API, and
 * any protocol but https. `client.test.ts` calls real write methods and watches each one refused.
 *
 * This is the ONLY production module that imports `@makehq/sdk` — `readOnlyRail.test.ts` scans the tree for
 * a second — and what it hands the fill is one function over a closed union of read requests.
 */
import { type FetchOptions, Make } from "@makehq/sdk";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { isMakeZone, type MakeZone } from "./credential.js";
import { type MakeAtlasError, MakeAtlasErrors } from "./errors.js";
import { redactMakeToken, redactMakeTokenDeep } from "./redact.js";

/** Items asked for per page on every list the fill pages. */
export const MAKE_PAGE_LIMIT = 100;

/** Every read the fill makes, and nothing else. A new member here is a new read the descriptor must count. */
export type MakeReadRequest =
  | { readonly op: "organizations.list"; readonly offset: number }
  | { readonly op: "teams.list"; readonly organizationId: number; readonly offset: number }
  | { readonly op: "folders.list"; readonly teamId: number }
  | { readonly op: "scenarios.list"; readonly teamId: number; readonly offset: number }
  | { readonly op: "blueprints.get"; readonly scenarioId: number }
  | { readonly op: "executions.list"; readonly scenarioId: number; readonly limit: number }
  | { readonly op: "connections.list"; readonly teamId: number }
  | { readonly op: "hooks.list"; readonly teamId: number; readonly offset: number };

/** The one read function the fill is handed. A test passes a plain function answering canned bodies. */
export type MakeRead = (input: { request: MakeReadRequest }) => Promise<Result<unknown, MakeAtlasError>>;

/** The one operation label every Make read is paced under — mapped in `operationEndpointClass.ts`. */
const OPERATION = "make.api.read";

/** Thrown by the rail; carries the typed refusal so a caller reports it as one rather than a network blip. */
class MakeRailRefusal extends Error {
  readonly refusal: MakeAtlasError;

  constructor({ refusal }: { refusal: MakeAtlasError }) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

/**
 * Whether the rail lets one request out.
 *
 * @param method the request's method, `undefined` meaning GET as the SDK sends it
 * @param url the URL the SDK was asked for, before it prefixes the zone
 * @param protocol the protocol the SDK instance would use
 * @param zone the host the SDK instance would prefix the path with
 * @returns `null` to let it out, else the refusal
 */
function railVerdict({
  method,
  url,
  protocol,
  zone,
}: {
  method: string | undefined;
  url: string;
  protocol: string;
  zone: string;
}): MakeAtlasError | null {
  const verb = method === undefined ? "GET" : method.toUpperCase();
  if (verb !== "GET") {
    return MakeAtlasErrors.writeRefused({ method: verb, url, why: "only GET leaves this door" });
  }
  // A single leading slash is the one shape the SDK turns into `<protocol>://<zone>/api/v2<path>`; an
  // absolute or protocol-relative URL would carry the token to whatever host it names.
  if (!url.startsWith("/") || url.startsWith("//")) {
    return MakeAtlasErrors.writeRefused({ method: verb, url, why: "only a path on the configured zone is read" });
  }
  if (protocol !== "https") {
    return MakeAtlasErrors.writeRefused({ method: verb, url, why: `protocol ${protocol} is not https` });
  }
  // Checked here, on every request, and not only when the credential is resolved: the SDK's constructor
  // takes any host, and its `zone` is writable at runtime, so a client built or changed past the credential
  // would otherwise carry the token to a host nobody allowlisted.
  if (!isMakeZone(zone)) {
    return MakeAtlasErrors.writeRefused({ method: verb, url, why: `zone ${zone} is not a published Make zone` });
  }
  return null;
}

/**
 * Judge one request and return the exact options the SDK is handed. The caller's options are read ONCE into
 * plain data, so the method judged is the method sent — a getter answering GET to the rail and POST on a
 * second read never gets that second read — and the options sent carry GET outright.
 *
 * @param options the SDK's request options, as the endpoint class passed them
 * @param url the path the SDK was asked for
 * @param protocol the protocol the client would use
 * @param zone the host the client would prefix the path with
 * @returns the options to send, or the refusal
 * @internal
 */
export function railedOptions({
  options,
  url,
  protocol,
  zone,
}: {
  options: FetchOptions | undefined;
  url: string;
  protocol: string;
  zone: string;
}): Result<FetchOptions, MakeAtlasError> {
  const snapshot: FetchOptions = { ...options };
  const refusal = railVerdict({ method: snapshot.method, protocol, url, zone });
  if (refusal !== null) {
    return err(refusal);
  }
  return ok({ ...snapshot, method: "GET" });
}

/**
 * The SDK with every request held to the rail. Exported for `client.test.ts` alone, which calls its write
 * methods to watch them refused; production reaches it only through {@link createMakeRead}.
 *
 * @internal
 */
export class ReadOnlyMake extends Make {
  constructor(...args: ConstructorParameters<typeof Make>) {
    super(...args);
    const refusal = railVerdict({ method: "GET", protocol: this.protocol, url: "/", zone: this.zone });
    if (refusal !== null) {
      throw new MakeRailRefusal({ refusal });
    }
    // The SDK sets these as plain writable fields and rereads them while building each request, so a value
    // the rail checked could be swapped (or replaced by a getter) before the request leaves. Pinned here as
    // non-writable, non-configurable data properties, they cannot change after construction at all.
    for (const key of ["zone", "protocol", "version"] as const) {
      Object.defineProperty(this, key, { configurable: false, enumerable: true, value: this[key], writable: false });
    }
  }

  /**
   * Every SDK request, held to the rail before the parent sends it.
   *
   * @param url the path the SDK built, relative to the zone's `/api/v2`; anything but a string is refused
   * @param options the SDK's request options; only their method is judged here
   * @returns what the parent fetch resolved, for a GET the rail let through
   */
  // named-object-params-exempt: every SDK endpoint class calls Make.fetch(url, options) positionally
  override async fetch<T = unknown>(url: unknown, options?: FetchOptions): Promise<T> {
    // Wider than the parent's `string` on purpose, so this check is one the type cannot vouch away: a URL-like
    // object reaching here past the type could answer the rail's string checks one way and stringify to
    // another host when the SDK sends it.
    if (typeof url !== "string") {
      throw new MakeRailRefusal({
        refusal: MakeAtlasErrors.writeRefused({
          method: "the request",
          url: "to a URL that is not a string",
          why: "only a string path on the configured zone is read",
        }),
      });
    }
    const sent = railedOptions({ options, protocol: this.protocol, url, zone: this.zone });
    if (sent.isErr()) {
      throw new MakeRailRefusal({ refusal: sent.error });
    }
    return super.fetch<T>(url, sent.value);
  }
}

/**
 * Dispatch one read request to the SDK method that serves it.
 *
 * @param client the railed client
 * @param request the read
 * @returns whatever the SDK resolved, untyped until the projection validates the fields it keeps
 */
async function dispatch({ client, request }: { client: Make; request: MakeReadRequest }): Promise<unknown> {
  const pg = ({ offset }: { offset: number }): { limit: number; offset: number } => ({
    limit: MAKE_PAGE_LIMIT,
    offset,
  });
  switch (request.op) {
    case "organizations.list":
      return client.organizations.list({ pg: pg({ offset: request.offset }) });
    case "teams.list":
      return client.teams.list(request.organizationId, { pg: pg({ offset: request.offset }) });
    case "folders.list":
      return client.folders.list(request.teamId, { childrenDepth: "all" });
    case "scenarios.list":
      return client.scenarios.list(request.teamId, { pg: pg({ offset: request.offset }) });
    case "blueprints.get":
      return client.blueprints.get(request.scenarioId);
    case "executions.list":
      return client.executions.list(request.scenarioId, {
        pg: { limit: request.limit, sortBy: "timestamp", sortDir: "desc" },
      });
    case "connections.list":
      return client.connections.list(request.teamId);
    case "hooks.list":
      return client.hooks.list(request.teamId, { pg: pg({ offset: request.offset }) });
    default: {
      const unreachable: never = request;
      throw new Error(`unknown Make read ${String(unreachable)}`);
    }
  }
}

/**
 * Build the read function the fill runs on: a railed client with the SDK's own retries OFF — so
 * `safeProviderCall` alone owns pacing, the shared 429 block and retry — and every read sent through it.
 * Every answered body has the token stripped from its strings before the fill sees it.
 *
 * @param token the API token from the secrets store
 * @param zone the zone host, already held to the published set by `credential.ts`
 * @returns the read function
 */
export function createMakeRead({ token, zone }: { token: string; zone: MakeZone }): MakeRead {
  const client = new ReadOnlyMake(token, zone, { retry: { maxRetries: 0, onRateLimit: false, onServerError: false } });
  const scopeId = scopeIdForToken({ token });
  return async ({ request }) => {
    const answered = await safeProviderCall({
      execute: () => dispatch({ client, request }),
      operation: OPERATION,
      provider: "make",
      retryMode: "transient",
      scopeId,
    });
    if (answered.isOk()) {
      return ok(redactMakeTokenDeep({ token, value: answered.value }));
    }
    if (answered.error.cause instanceof MakeRailRefusal) {
      return err(answered.error.cause.refusal);
    }
    return err(
      MakeAtlasErrors.readFailed({
        operation: request.op,
        reason: redactMakeToken({ text: answered.error.message, token }),
        status: unsetFieldAsNull({ key: "status", record: answered.error }),
      }),
    );
  };
}
