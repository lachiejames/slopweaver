/**
 * The write lane's transport: the one authenticated client every operation in `./write.ts` and its siblings
 * shares, and the log routing that client is constructed with.
 *
 * Split out of `./write.ts` rather than left there because that file is a ratcheted offender
 * (`.baselines/file-size-baseline.json`) and the transport is the half of it that is not a wiring table —
 * the construction has three deliberate, documented choices in it, and they read better beside the trace-log
 * routing they depend on than buried under two hundred method shims. Same lane, same rules: nothing outside
 * `src/corpus/github/` constructs an Octokit for writes.
 */
import { Octokit } from "@octokit/rest";

import { isGraphqlMutation } from "../../lib/graphqlOperation.js";
import type { Logger } from "../../lib/logger.js";
import { logger } from "../../lib/logger.js";
import { scopeIdForToken } from "../../lib/providerCall.js";
import { type GithubWritePrivacy, refuseGithubWriteOnPrivacy } from "../../outbound/github/writePrivacy.js";
import { invalidDatadogHostHatchOpen, refuseInvalidDatadogHost } from "../../outbound/invalidDatadogHost.js";
import { noRedirectFetch } from "./writeCrud.js";

/**
 * The one authenticated client and rate-scope every operation in this lane shares.
 *
 * Exported so a sibling module can hold part of the same lane without constructing a second Octokit —
 * `./repoDescription.ts`, `./writeMerge.ts`, `./writeCrud.ts`, `./writeStack.ts`, `./writeReview.ts` and
 * `./protection.ts` all do. Nothing outside this lane constructs one.
 */
export interface WriteCtx {
  readonly client: Octokit;
  readonly scopeId: string;
}

/**
 * Route Octokit's own per-attempt request trace to `sink` at `debug`, rather than the SDK's raw
 * `console.error`/`console.info` default.
 *
 * `@octokit/rest` bundles `@octokit/plugin-request-log`, which logs every attempt — success or failure —
 * through `octokit.log`. `retryMode: "transient"` (`../../lib/providerCall.ts`) retries this client's calls
 * at the application layer, so a transient attempt the retry then recovers from still reaches
 * `octokit.log.error` and, unrouted, prints as a bare `GET ... - 500 with id UNKNOWN in Nms` line
 * indistinguishable from a real failure — the exact defect this function exists to fix. A definitive
 * failure is still reported: the caller's own `ResultAsync` carries it, and that is what surfaces at the
 * default log level. This per-attempt HTTP trace is diagnostic detail, so it belongs at `debug` — visible
 * with `--verbose`, silent otherwise.
 *
 * @param sink where the routed line goes
 * @returns the `log` option for an Octokit constructor
 */
export function octokitAttemptTraceLog({
  sink,
}: {
  sink: Logger;
}): NonNullable<NonNullable<ConstructorParameters<typeof Octokit>[0]>["log"]> {
  return {
    debug: (message) => {
      sink.debug({ msg: message });
    },
    error: (message) => {
      sink.debug({ msg: message });
    },
    info: (message) => {
      sink.debug({ msg: message });
    },
    warn: (message) => {
      sink.debug({ msg: message });
    },
  };
}

/**
 * Build the write lane's shared client and rate scope.
 *
 * `baseUrl` exists for one purpose and is documented rather than left to be guessed: the transport test in
 * `src/__tests__/integration/githubWriteTransport.test.ts` points this at a local server so it can assert
 * what the request ACTUALLY carried and count how many times an irreversible POST was sent. A cassette can
 * do neither — it matches with `body: false` and replays one exchange. Production never passes it.
 *
 * @param token the GitHub token
 * @param baseUrl override the API origin; omit in production
 * @param privacy the outbound privacy check's policy for this verb's home, judged on every write before it is sent
 * @returns the client and rate-scope pair every `*Via` function in this lane takes
 */
export function makeGithubWriteCtx({
  token,
  baseUrl,
  privacy,
}: {
  token: string;
  baseUrl?: string;
  privacy: GithubWritePrivacy;
}): WriteCtx {
  // The read client in ./githubClient.ts retries, and was measured sending 8 POSTs on one 421. Never reuse it here.
  // A separate CLIENT is not a separate connection: both go through the global `fetch`, so both draw on one
  // undici pool per origin and this lane's POST can ride a socket the read client parked (measured —
  // `../../outbound/github/mergeQueue.ts` carries it). What this construction isolates is the retry
  // policy, which is the property that matters; the transport is shared, and a caller of an irreversible
  // write has to survive that rather than assume it away.
  // devlint: sdk-factory -- the GitHub WRITE lane: SDK retries and throttling OFF, redirects unfollowed
  const client = new Octokit({
    auth: token,
    log: octokitAttemptTraceLog({ sink: logger }),
    request: { fetch: noRedirectFetch, retries: 0 },
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
  // Two refusals on every write this lane sends, in order: the dead-Datadog-host refusal
  // (`../../outbound/invalidDatadogHost.ts`), then the outbound privacy check (`../../outbound/github/writePrivacy.ts`).
  // A throw or rejection from the hook rejects the call before `fetch` runs, inside the caller's own `safeProviderCall`.
  client.hook.before("request", async (options) => {
    const payload = githubWritePayload({ options });
    if (payload !== undefined) {
      refuseInvalidDatadogHost({
        command: `github ${options.method} ${options.url}`,
        hatchIsOpen: invalidDatadogHostHatchOpen,
        payload,
      });
      await refuseGithubWriteOnPrivacy({ payload, privacy });
    }
  });
  return { client, scopeId: scopeIdForToken({ token }) };
}

/**
 * What a write-lane request would SEND that the dead-Datadog-host policy judges, or `undefined` for a read.
 *
 * A REST `GET`/`HEAD` is a read. GraphQL travels as a `POST` either way, so its operation decides: a `query`
 * is a read, and only a mutation is judged. Everything else — the path parameters, the body fields, a
 * mutation's variables — is judged whole, less `request`, which carries the transport (the fetch function,
 * the signal) and never content. A request with no recognisable method is judged, never waved through.
 *
 * @param options the endpoint options Octokit's `request` hook sees
 * @returns the payload to judge, or `undefined` when the request is a read
 */
export function githubWritePayload({ options }: { options: Readonly<Record<string, unknown>> }): unknown {
  const method = options["method"];
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  const document = options["query"];
  if (options["url"] === "/graphql" && typeof document === "string" && !isGraphqlMutation({ document })) {
    return undefined;
  }
  const sent: Record<string, unknown> = { ...options };
  delete sent["request"];
  return sent;
}
