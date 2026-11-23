/**
 * Polly.js record/replay setup for the INTEGRATION lane (design ported from the private archive's
 * `setup-polly.ts`, re-skinned for this repo). Wired as the integration config's `setupFiles`.
 *
 * We use `@pollyjs/adapter-fetch`, which wraps Node's global `fetch` at the API level — so a connector's
 * upstream `fetch` call is intercepted without any node-http adapter, HTTPS/SSE patch, or `node-fetch` swap.
 * `POLLY_MODE` selects `record` (hit the real API, write HAR), `replay` (default when unset — serve the HAR,
 * offline), or `passthrough` (no Polly). Any other value fails the run at load, naming the valid modes.
 *
 * Two enforcement layers make an un-recorded call fail loudly (never silently hit the network in replay):
 *   1. Polly `recordIfMissing: false` in replay → a missing cassette entry throws a PollyError.
 *   2. A `nock` socket guard → `disableNetConnect()` (localhost allowlisted, historically for a local
 *      gateway a spawned transport was pointed at — no current lane needs it, but the carve-out is harmless
 *      to leave) blocks any raw outbound connection that bypasses fetch — the "no outbound connections in
 *      replay" safety net.
 *
 * The adapter is a PROCESS-GLOBAL fetch patch, so at most ONE Polly may be live per worker: a module-level
 * singleton is stopped in `afterEach` and any lingering one is stopped before the next `beforeEach` creates
 * a fresh instance. The integration config runs a single non-parallel worker to preserve this.
 *
 * A third layer decides what a cassette PROVES rather than whether it replays. Every request body is
 * persisted as an allowlist projection and a replayed request is held to the one its recording carries — see
 * {@link captureBodyFidelity}, `pollyBodyFidelity.ts` and `cassetteRequestBody.ts`, which carries the whole
 * design, including why it is a comparison in `beforeReplay` rather than the `matchRequestsBy.body` the shape
 * of the problem suggests.
 */

import { dirname, join } from "node:path";
import FetchAdapter from "@pollyjs/adapter-fetch";
import { Polly, type Request as PollyRequest, type Response as PollyResponse } from "@pollyjs/core";
import FSPersister from "@pollyjs/persister-fs";
import nock from "nock";
import { afterEach, beforeEach } from "vitest";
import { absentAs } from "#lib/absent.js";
import { loadDenylist } from "../hygiene/scan.js";
import { cassetteCookieTripwireText, type HarCookie, redactCassetteCookies } from "./cassetteCookies.js";
import { cassetteRedact, redactQueryValue, redactRequestPath, redactRequestUrl } from "./cassetteRedact.js";
import { CASSETTE_CONFIGS, isAllowedCassetteHeader, providerForUrl } from "./cassetteRedactConfig.js";
import { loadCassetteKnownValues, loadIdMap, saveIdMap } from "./cassetteRedactLocal.js";
import { type CassetteIdMap, type CassetteProvider } from "./cassetteRedactTypes.js";
import {
  cursorMatchKey,
  isParentConnectionFollowup,
  matchableCursor,
  matchableGraphqlVariables,
} from "./cassetteRequestRedact.js";
import {
  isGraphqlUrl,
  normalizeGraphqlBody,
  scrubGeneric,
  scrubKnownValues,
  scrubLeakClasses,
} from "./cassetteScrub.js";
import { assertRecordTimeTripwire } from "./cassetteTripwire.js";
import { liveBodyMismatch, persistedRequestBody } from "./pollyBodyFidelity.js";
import { pollyModeOrThrow } from "./pollyMode.js";
import { realAmbientHome } from "./realAmbientHome.js";

// nodenext types these CJS packages' default import as a module namespace, but at runtime the default IS
// the adapter/persister class (`module.exports = Class`), which is the `Newable` Polly.register expects
// (verified — the fetch adapter records + replays at runtime). The mismatch is purely tsc's CJS-interop view.
// @ts-expect-error — CJS default-import namespace vs runtime class (see note above)
Polly.register(FetchAdapter);
// @ts-expect-error — CJS default-import namespace vs runtime class (see note above)
Polly.register(FSPersister);

/**
 * The record/replay mode from the env: unset is strict offline replay, an unrecognised value THROWS (see
 * {@link pollyModeOrThrow}) so a typo like `recrod` can never pass as a green replay run.
 */
const MODE = pollyModeOrThrow({ raw: process.env["POLLY_MODE"] });

/**
 * Record-time-only local state, all read from the operator's real state home — and `undefined` in
 * CI/replay, which reads nothing and persists nothing. `DENYLIST` + `KNOWN_VALUES` are the pre-seeded
 * sensitive literals stripped as a backstop + checked by the record-time tripwire; `idMap` is the persistent
 * real-id → synthetic-id map, grown as ids are seen and saved back after recording so synthetic ids stay
 * stable across re-records. Committed cassettes carry only placeholders + synthetic ids → replay needs none
 * of this.
 *
 * `realAmbientHome()` rather than a `process.env["SLOPWEAVER_HOME"]` read, and gated on `record` rather than
 * unconditional. Both halves matter and neither is style:
 *
 * - The raw read here ran at MODULE scope, before `setup-ambient-home.ts`'s `beforeAll` moves the variable —
 *   so it reached past the sandbox at a point the guard cannot observe, which is exactly the hole
 *   `realAmbientHome.ts`'s header measures. The `env-home-read` half of the `home-safety` gate now refuses
 *   that spelling anywhere under `src/__tests__/`.
 * - The gate on `record` is what makes replay read NOTHING: `loadDenylist({})` resolved to the operator's
 *   real `~/.slopweaver` on every offline lap, to build a denylist only `beforePersist` (record-only) ever
 *   consults. A resolved home is still used in record mode, because an unset `SLOPWEAVER_HOME` yielding an
 *   empty denylist is the regression `hygiene/scan.test.ts` pins: the tripwire watching for nothing while
 *   real traffic is written to a cassette.
 */
const HOME = MODE === "record" ? realAmbientHome() : undefined;
const DENYLIST = HOME === undefined ? [] : loadDenylist({ home: HOME });
const KNOWN_VALUES = loadCassetteKnownValues({ home: HOME });
let idMap: CassetteIdMap = loadIdMap({ home: HOME });
/** First record-time tripwire violation, surfaced as a hard failure in `afterEach` (never silently persisted). */
let tripwireError: string | undefined;
/** First REPLAY-time request-body mismatch, surfaced as a hard failure in `afterEach` (see {@link captureBodyFidelity}). */
let fidelityError: string | undefined;

/** At most one live Polly per worker (the fetch patch is process-global). */
let polly: Polly | undefined;

/**
 * The live Polly for the current test, so a test can TIGHTEN matching for its own assertions.
 *
 * The default config matches leniently (`body: false`, `order: false`) so cassettes survive incidental payload
 * churn. That is right for a read, and QUIETLY WRONG for a sequence: N calls to one endpoint with different
 * bodies all collapse onto a single recorded entry, so an assertion that N distinct calls succeeded passes on
 * one recorded success. A test that depends on the sequence must opt into `order: true` — see
 * `integration/slackPoll.test.ts`. The one sequence that needs NO opt-in is a paged read: a request carrying
 * a cursor is keyed on that cursor's identity (`configureCursorMatching`), so page 2 and page 3 are distinct
 * recordings and a follow-up that drops or repeats a cursor finds the wrong one — `integration/slackPaging.test.ts`.
 *
 * `body: false` stays, and it is no longer the hole it reads as: {@link captureBodyFidelity} holds a replayed
 * request to the body its own recording carries, so a wrong field fails with both projections printed instead
 * of replaying quietly. Widening the MATCHER is what may never happen — a recording's `_id` is hashed from the
 * match key at record time, so `body: true` would invalidate every committed cassette at once.
 *
 * @returns the active Polly, or `undefined` in `passthrough` mode where there is none
 */
export function activePolly(): Polly | undefined {
  return polly;
}

/*
 * Headers are kept by ALLOWLIST, not stripped by denylist (see {@link isAllowedCassetteHeader}). That also
 * subsumes two mechanical requirements it used to take a separate list to state: `content-encoding` must not
 * survive (the fetch adapter records the DECODED body, so replay would try to re-decompress plain text) and
 * `content-length` no longer matches the redacted body. Neither is on the allowlist, so neither is written.
 */
/** Keep only the allowlisted headers of a HAR header list (an absent list stays an empty one). */
function keepAllowedHeaders({
  headers = [],
  kind,
}: {
  headers: { name: string; value: string }[] | undefined;
  kind: "request" | "response";
}): { name: string; value: string }[] {
  return headers.filter((header) => isAllowedCassetteHeader({ kind, name: header.name }));
}

/** The subset of a Polly HAR recording this setup reads/mutates before persisting, and re-reads on replay. */
interface HarRecording {
  request: {
    headers?: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
    cookies?: HarCookie[];
    method?: string;
    url?: string;
    postData?: { mimeType?: string; text?: string };
  };
  response: {
    headers?: { name: string; value: string }[];
    cookies?: HarCookie[];
    redirectURL?: string;
    content?: { text?: string };
  };
}

/**
 * A HAR request's query pairs. A request whose URL carries no query has no `queryString` to record, so it
 * has no pairs; `== null` because the recording is parsed JSON, where the field may arrive as `null`.
 */
function queryPairs({ request }: { request: HarRecording["request"] }): readonly { name: string; value: string }[] {
  const { queryString } = request;
  if (queryString == null) {
    return [];
  }
  return queryString;
}

/**
 * Redact the response body: the ALLOWLIST redactor for a known provider (blank every string except structural
 * keys; ids → synthetic; urls → origin), then the generic leak-class + known-value backstop over the result;
 * a non-provider body (e.g. the synthetic `claude` SSE) gets the generic backstop only. Grows `idMap`.
 */
function redactResponseBody({ text, url }: { text: string; url: string | undefined }): string {
  const provider = url !== undefined ? providerForUrl({ url }) : undefined;
  if (provider === undefined) {
    return scrubGeneric({ knownValues: KNOWN_VALUES, text });
  }
  const redacted = cassetteRedact({ body: text, config: CASSETTE_CONFIGS[provider], idMap, knownValues: KNOWN_VALUES });
  if (redacted.isErr()) {
    return scrubGeneric({ knownValues: KNOWN_VALUES, text });
  }
  idMap = redacted.value.idMap;
  return scrubGeneric({ knownValues: KNOWN_VALUES, text: redacted.value.body });
}

/*
 * Sanitise a recording IN PLACE before it is persisted: keep only allowlisted headers, blank every parsed
 * cookie value in both directions, scrub the request URL and the response's redirect URL (each keeping a
 * route-shaped path — the request's is the match key), keep+normalise a GraphQL request body (the matcher) or
 * drop any other request body, allowlist-redact the response body, then (record mode) run the tripwire so a
 * surviving real value fails loud. The single choke-point that makes a recording safe to commit.
 */
/**
 * The URL redaction chain a committed cassette's every URL goes through: collapse an OPAQUE path, then scrub
 * leak classes and known literals in what survives. Extracted so the response's `redirectURL` — the second
 * copy of the `Location` header the allowlist drops — runs exactly the chain the request URL runs, rather
 * than a lookalike.
 *
 * @returns the URL as it would be committed
 */
function redactUrlForPersist({ url }: { url: string }): string {
  return scrubKnownValues({ knownValues: KNOWN_VALUES, text: scrubLeakClasses({ text: redactRequestUrl({ url }) }) });
}

/** Scrub the request URL (path kept — the match key) + the request body (normalised GraphQL matcher, else drop). */
function redactRequest({ recording, url }: { recording: HarRecording; url: string | undefined }): void {
  if (typeof url === "string") {
    // Collapse an OPAQUE path first (Slack's one-time upload URL base64-encodes real ids in its path), then
    // scrub leak classes + known literals in what survives. A route-shaped path is the replay match key and is
    // kept — see `redactRequestPath`, which the request-time matcher below applies to the SAME requests, so the
    // recorded key and the replayed key agree.
    recording.request.url = redactUrlForPersist({ url });
  }
  // A HAR carries the query TWICE — inside `request.url` and again as `request.queryString` pairs — and
  // redacting only the first leaves the identifier sitting in the second. The pairs are the position that
  // survives even when `redactRequestUrl` drops the whole query with a collapsed path, so they are redacted
  // unconditionally rather than only when the URL kept its own copy.
  for (const pair of queryPairs({ request: recording.request })) {
    pair.value = scrubKnownValues({
      knownValues: KNOWN_VALUES,
      text: scrubLeakClasses({ text: redactQueryValue({ name: pair.name, value: pair.value }) }),
    });
  }
  const requestBody = recording.request.postData;
  if (requestBody?.text === undefined || requestBody.text.length === 0) {
    return;
  }
  // EVERY request body is allowlist-projected and KEPT. `scrubGeneric` alone is not enough to keep one: it
  // matches upper-case ids, token shapes, home paths and emails — never a lowercase UUID, which is Linear's id
  // format, and never free prose. A write carries both. The projection walks the provider's own allowlist
  // instead, so what survives is structure, numbers, booleans and enums, and what a cassette can therefore
  // PROVE is what the transport actually sent.
  //
  // The projection is deliberately more aggressive than the match key, and stays outside matching entirely:
  // a recording's `_id` is hashed from the match key at record time, so a body matcher would invalidate every
  // committed cassette. `cassetteRequestBody.ts`'s header carries that reasoning and the replay-time
  // comparison that gets the same property instead.
  requestBody.text = persistedRequestBody({
    knownValues: KNOWN_VALUES,
    mimeType: requestBody.mimeType,
    text: requestBody.text,
    url,
  });
}

/**
 * Record-mode only: run the tripwire over the redacted url + BOTH bodies, capturing the first violation.
 *
 * The request body was previously not passed at all, which left the whole outbound position uninspected.
 * That was survivable while every cassette was a read — a GraphQL read sends a cursor and a page size. It
 * stops being survivable the moment a mutation is recorded, because a create's variables carry the
 * destination team id and the entire issue description, and those are the most sensitive bytes in the
 * exchange. A guardrail that does not look at the outbound half is not a guardrail for a write lane.
 *
 * The parsed `cookies[]` arrays are folded in for the same reason, as {@link cassetteCookieTripwireText}
 * renders them AFTER blanking — so what this judges is exactly what would be committed, and the live catch is
 * the `domain`/`path`/`name` that blanking deliberately keeps rather than the value it always replaces. The
 * redacted `redirectURL` rides beside them, the same second copy of a dropped header.
 */
function captureRecordTripwire({
  url,
  query,
  body,
  requestBody,
  cookies,
  redirectUrl,
}: {
  url: string | undefined;
  query: string | undefined;
  body: string | undefined;
  requestBody: string | undefined;
  cookies: string | undefined;
  redirectUrl: string | undefined;
}): void {
  if (MODE !== "record" || tripwireError !== undefined) {
    return;
  }
  const text = [url, query, body, requestBody, cookies, redirectUrl]
    .filter((part): part is string => part !== undefined)
    .join("\n");
  try {
    assertRecordTimeTripwire({ denylist: DENYLIST, knownValues: KNOWN_VALUES, text });
  } catch (error: unknown) {
    tripwireError = error instanceof Error ? error.message : "unknown tripwire failure";
  }
}

function redactForPersist({ recording }: { recording: HarRecording }): void {
  recording.request.headers = keepAllowedHeaders({ headers: recording.request.headers, kind: "request" });
  recording.response.headers = keepAllowedHeaders({ headers: recording.response.headers, kind: "response" });
  // A HAR carries `Set-Cookie` TWICE, exactly as it carries the query twice: the header above, and Polly's
  // own parse of that same header into `cookies[]`. Blanking the header reaches one copy; 66 real `__cf_bm`
  // values sat in the other across 30 committed cassettes. Both directions, unconditionally.
  recording.request.cookies = redactCassetteCookies({ cookies: recording.request.cookies });
  recording.response.cookies = redactCassetteCookies({ cookies: recording.response.cookies });
  // `redirectURL` is the same shape one field over: Polly writes the `Location` header there too, and the
  // allowlist above drops only the header. A redirect cannot replay either way — the header it would need is
  // gone — so this is dead data that can still carry a signed URL, and it runs the request URL's own chain.
  const redirectUrl = recording.response.redirectURL;
  if (redirectUrl !== undefined && redirectUrl.length > 0) {
    recording.response.redirectURL = redactUrlForPersist({ url: redirectUrl });
  }
  const url = recording.request.url;
  redactRequest({ recording, url });
  if (recording.response.content?.text !== undefined) {
    recording.response.content.text = redactResponseBody({ text: recording.response.content.text, url });
  }
  // Both directions, after redaction — so what the tripwire judges is exactly what would be committed. The
  // redacted URL is passed rather than the raw one for the same reason, and the query pairs alongside it:
  // they are a second copy of the query that the URL string does not always carry.
  captureRecordTripwire({
    body: recording.response.content?.text,
    cookies: cassetteCookieTripwireText({
      cookies: [...recording.request.cookies, ...recording.response.cookies],
    }),
    redirectUrl: recording.response.redirectURL,
    query: queryPairs({ request: recording.request })
      .map((pair) => `${pair.name}=${pair.value}`)
      .join("&"),
    requestBody: recording.request.postData?.text,
    url: recording.request.url,
  });
}

/**
 * REPLAY only: hold the live request to the body its recording carries.
 *
 * Polly emits `beforeReplay` with the exact entry it is about to serve, which is the one seam that has both
 * halves in hand — the live request and the recorded one. Re-projecting the live body through the SAME pure
 * function that persisted the recorded one turns a cassette from "some request reached this path" into
 * evidence of what was sent; see `cassetteRequestBody.ts` for what that does and does not prove.
 *
 * The first mismatch is captured and thrown from `afterEach`, the shape the record-time tripwire already
 * uses: a throw from inside an adapter event handler surfaces as whatever the connector does with a failed
 * `fetch`, which a retrying client can swallow, while a throw from the hook is attributed to the test that
 * caused it and cannot be caught by anything under test.
 */
function captureBodyFidelity({ req, recording }: { req: PollyRequest; recording: HarRecording }): void {
  if (MODE !== "replay" || fidelityError !== undefined) {
    return;
  }
  fidelityError = liveBodyMismatch({ knownValues: KNOWN_VALUES, postData: recording.request.postData, req });
}

/**
 * Configure a GraphQL request's match key: identifiers collapsed positionally (a record run's real workspace
 * UUID and a replay run's placeholder must produce the same key, or a write sequence can never replay — no
 * committed cassette has a UUID anywhere in its GraphQL variables, so this is a no-op for every existing one),
 * a root-level page's `after` replaced by its cursor identity (see {@link matchableCursor}; no committed
 * cassette carries a root-level `after`, so no existing key moves), plus order-sensitive matching for a
 * `ParentConnection` follow-up specifically (its `id`/`after` are sentinelled to a FIXED value, so every page
 * of one overflowing connection now shares one identifier — disambiguated by call sequence, the same fix
 * `slackPoll.test.ts` opts into for a different id collision).
 */
function configureGraphqlMatching({
  req,
  provider,
}: {
  req: PollyRequest;
  provider: CassetteProvider | undefined;
}): void {
  const normalizedBody = typeof req.body === "string" ? normalizeGraphqlBody({ body: req.body }) : undefined;
  const cursorFor =
    provider === undefined
      ? undefined
      : ({ value }: { value: string }): string => matchableCursor({ idMap, provider, value });
  req.configure({
    matchRequestsBy: {
      body: (body) =>
        typeof body === "string"
          ? matchableGraphqlVariables({
              body: normalizeGraphqlBody({ body }),
              ...(cursorFor === undefined ? {} : { cursorFor }),
            })
          : body,
      order: normalizedBody !== undefined && isParentConnectionFollowup({ body: normalizedBody }),
    },
  });
}

/**
 * Key a request that carries a paging cursor on that cursor's IDENTITY, so a replayed follow-up must send the
 * exact bookmark the previous page handed out or find no recording. The identity rides in the identifier's
 * query slot because that slot exists for every request (a Slack cursor travels in a form body, a Notion one
 * in a GET's query string) and Polly folds a body matcher in only when the request has a body.
 *
 * Conditional on purpose: a request carrying no cursor is left on the lenient default and keeps the
 * identifier it was recorded under, so every existing cassette replays unchanged.
 */
function configureCursorMatching({ req, provider }: { req: PollyRequest; provider: CassetteProvider }): void {
  const key = cursorMatchKey({
    body: typeof req.body === "string" ? req.body : undefined,
    config: CASSETTE_CONFIGS[provider],
    idMap,
    query: req.query,
  });
  if (key === undefined) {
    return;
  }
  req.configure({ matchRequestsBy: { url: { query: () => ({ cursor: key }) } } });
}

/**
 * RECORD time only: fold a response into the id-map the moment it arrives, so a cursor it hands out already
 * has its `cursor_N` when the follow-up request is identified. Polly computes a request's identifier when
 * that request is MADE and persists a recording only at flush, so waiting for `beforePersist` would leave a
 * page-2 request looking up a cursor the map does not hold yet. The same pure redactor runs again at persist
 * over the same map, so both passes mint the same identities by construction.
 */
function foldResponseIntoIdMap({ req, res }: { req: PollyRequest; res: PollyResponse }): void {
  if (MODE !== "record" || typeof res.body !== "string") {
    return;
  }
  const provider = providerForUrl({ url: req.url });
  if (provider === undefined) {
    return;
  }
  const redacted = cassetteRedact({
    body: res.body,
    config: CASSETTE_CONFIGS[provider],
    idMap,
    knownValues: KNOWN_VALUES,
  });
  if (redacted.isOk()) {
    idMap = redacted.value.idMap;
  }
}

/** In replay, block every outbound socket except localhost; in record/passthrough allow all. */
function applyNockGuard(): void {
  if (MODE === "replay") {
    nock.disableNetConnect();
    nock.enableNetConnect((host) => host.includes("127.0.0.1") || host.includes("localhost") || host.includes("[::1]"));
  } else {
    nock.enableNetConnect();
  }
}

beforeEach(async (ctx) => {
  if (polly) {
    await polly.stop(); // defensive: never run two concurrent global-fetch patches
  }
  const testFile = ctx.task.file.filepath;
  polly = new Polly(`${absentAs({ value: ctx.task.suite?.name, whenAbsent: "suite" })}/${ctx.task.name}`, {
    adapters: ["fetch"],
    logLevel: "error",
    // Match by method + URL path ONLY (body/headers/query all carry per-run/per-platform-variable data, and
    // `order` does NOT replay portably here — a macOS-recorded request order didn't line up on Linux CI).
    // See `activePolly`'s doc for why this default is lenient rather than order-sensitive, and how a test
    // that genuinely needs the sequence opts in.
    matchRequestsBy: {
      body: false,
      headers: false,
      method: true,
      order: false,
      url: { hostname: true, pathname: true, protocol: true, query: false },
    },
    mode: MODE,
    persister: "fs",
    persisterOptions: { fs: { recordingsDir: join(dirname(testFile), "__recordings__") } },
    recordFailedRequests: true,
    recordIfMissing: MODE === "record",
  });
  // GraphQL providers (Linear, GitHub) POST every operation to ONE `/graphql` path, so method+path matching
  // alone would collapse `issues`/`projects`/`page 2` onto a single cassette entry. Match those by a
  // normalised request body instead, so each distinct operation replays its own recording.
  polly.server.any().on("request", (req) => {
    const provider = providerForUrl({ url: req.url });
    if (isGraphqlUrl({ url: req.url })) {
      configureGraphqlMatching({ provider, req });
    } else if (provider !== undefined) {
      configureCursorMatching({ provider, req });
    }
    // An OPAQUE request path (a one-time upload URL) is normalised for MATCHING as well as for persisting.
    // Polly hashes a recording's identity from the match key at RECORD time, so redacting the path only in
    // `beforePersist` would leave a cassette whose key still encoded the original blob — un-replayable. Applying
    // the same normalisation here makes the record-time key and the replay-time key identical.
    req.configure({ matchRequestsBy: { url: { pathname: (pathname) => redactRequestPath({ path: pathname }) } } });
  });
  polly.server.any().on("response", (req, res) => {
    foldResponseIntoIdMap({ req, res });
  });
  polly.server.any().on("beforePersist", (_req, recording: HarRecording) => {
    redactForPersist({ recording });
  });
  polly.server.any().on("beforeReplay", (req, recording: HarRecording) => {
    captureBodyFidelity({ recording, req });
  });
  applyNockGuard();
});

afterEach(async () => {
  if (polly) {
    await polly.flush();
    await polly.stop();
    polly = undefined;
  }
  nock.cleanAll();
  nock.enableNetConnect();
  if (MODE === "record") {
    saveIdMap({ home: HOME, idMap }); // persist stable synthetic ids for the next re-record
    if (tripwireError !== undefined) {
      const failure = tripwireError;
      tripwireError = undefined;
      throw new Error(`cassette record-time tripwire failed — do NOT commit this recording. ${failure}`);
    }
  }
  // Thrown here rather than from the `beforeReplay` hook so the failure is attributed to the test that caused
  // it, and so no retrying client under test can swallow it as a transport error.
  if (fidelityError !== undefined) {
    const failure = fidelityError;
    fidelityError = undefined;
    throw new Error(failure);
  }
});
