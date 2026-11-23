/**
 * REQUEST-BODY FIDELITY — what a cassette proves about the bytes that went OUT.
 *
 * Before this file, a non-GraphQL request body was persisted as the empty string and matching ignored the
 * body entirely, so a recorded write proved only that SOME request reached that method and path. The repo
 * said so in its own write-transport test header: `githubWriteTransport.test.ts` exists because a transport
 * rewritten to send `draft: false` replayed the cassette that recorded `draft: true` and passed. MEASURED
 * over all 99 committed recordings and their 330 entries: 93 carried a non-empty request body
 * (every one of them a GraphQL POST, the one lane already redacting its own outbound half), 132 carried `""`,
 * and 105 carried no body at all. Reproduce with `yarn test:unit cassetteBodyFidelity`, which prints the same
 * three numbers as assertions.
 *
 * ## Two jobs, one pure function
 *
 * {@link projectRequestBody} computes the committable PROJECTION of a request body, and the same call does
 * both halves of the mechanism:
 *
 *  - at RECORD time `setup-polly.ts` persists the projection instead of blanking the body;
 *  - at REPLAY time it re-projects the LIVE request and compares the result to the text the entry carries
 *    ({@link compareRequestBody}). A mismatch is a hard failure naming both sides.
 *
 * ## Why a comparison rather than a Polly `body` matcher, which is what the ask literally said
 *
 * A Polly recording's `_id` is a hash of that request's MATCH KEY, computed when the request is MADE and
 * written into the HAR. Turning on `matchRequestsBy.body` therefore changes every identifier and invalidates
 * every committed recording at once — and re-recording them is not a local act: it POSTS FOR REAL into the
 * owner's live Slack, Linear, GitHub, Gmail, Calendar, Notion, Datadog and Vanta.
 *
 * The comparison delivers the same property without moving a single `_id`, and reports it better: a body
 * matcher renders a wrong field as `Recording for the following request is not found`, indistinguishable from
 * a missing cassette, while this prints both projections. It also reaches one thing a matcher cannot — under
 * the lane's `order: false` default Polly serves the `_order`-th entry recorded under one id, so a transport
 * that SWAPPED two same-endpoint calls is caught here and would not be by `body: true`, which would simply
 * find each call's own recording.
 *
 * ## Where the property is actually NEW, stated rather than implied
 *
 * **Not on the GraphQL lane.** Those 93 entries already matched by a normalised body, and that match key is
 * at least as strict as this projection everywhere: it keeps every variable value verbatim except the UUIDs,
 * cursors and follow-up sentinels this blanks. So for GraphQL the comparison buys diagnostics and a STALE-
 * cassette detector, not fidelity — and it earned the second of those on its first run, failing
 * `linear.test.ts` (an entry persisted before `normalizeGraphqlBody` joined the persist path) and
 * `linearFollowupCassette.test.ts` (a cursor no two runs can agree on). Both are why {@link compareRequestBody}
 * canonicalises before it compares.
 *
 * **On the other 238 requests, where nothing checked the outbound half at all.** Every one of them matched on
 * method and path only. They gain the property one suite at a time, as each is re-recorded under the persist
 * path this change installs; `cassetteBodyDebt.ts` is the register of which still owe it.
 *
 * ## What a projection can and cannot prove
 *
 * A committed cassette carries no free text, the same allowlist rule its responses have always followed —
 * the one that governs a response body governs an outbound one identically. What survives is therefore everything EXCEPT content —
 * and that turns out to be most of what a transport can get wrong:
 *
 *  - **proven**: the exact set of fields, their nesting, and their order-independent identity; every number,
 *    boolean and `null` verbatim (`draft: true`, `number: 2884`, `size: 95000`); every enum or timestamp
 *    under a provider `keepKey` (a card's block `type` sequence); the ORIGIN of any URL sent; whether a field
 *    carried an identifier at all.
 *  - **not proven**: which identifier, which cursor, and what the free text said. A record run sends a real
 *    channel and a replay run sends `D0SYN00REPLAY`; no rule can make those equal by value, so both collapse to
 *    {@link REDACTED_ID}. String CONTENT stays the unit lane's job, exactly as `slackWrite.test.ts`'s header
 *    already says of the response side.
 *  - **two residues a review found, both needing a hand-built input no transport here sends**: two integers
 *    past `Number.MAX_SAFE_INTEGER` that `JSON.parse` rounds to one value project identically; and a REST
 *    URL whose path or query merely CONTAINS a GraphQL address takes the GraphQL path, because
 *    `isGraphqlUrl` is a substring test (`cassetteScrub.ts` says so). Parsing numbers losslessly and matching
 *    the GraphQL endpoint by origin and path would close each.
 *
 * The collapse is why identifiers are NOT numbered positionally here the way `matchableGraphqlVariables`
 * numbers UUIDs. Numbering keys agreement to the DISTINCTNESS of the ids, and a replay fixture that reuses
 * one placeholder for two different real ids would fail a comparison that is otherwise correct — a false red
 * bought for evidence the redaction has already destroyed.
 *
 * ## The one asymmetry, stated rather than discovered
 *
 * `knownValues` is the operator's local list of sensitive literals, and it exists only at RECORD time — a
 * replay reads nothing (`setup-polly.ts`'s `HOME` is gated on the mode, deliberately). So a recorded value
 * that the known-value scrub rewrote and a live value that nothing rewrites would not compare equal. It
 * cannot reach anything the projection blanks, and the values it CAN reach are enums, timestamps and window
 * bounds under a provider `keepKey` — but the residue is real, and it fails in the safe direction: a red
 * cassette you re-record, never a green one that proved nothing.
 */
import { isRecord } from "../lib/parsers.js";
import { redactUrl } from "./cassetteRedact.js";
import { isStructuralObjectKey } from "./cassetteRedactConfig.js";
import type { CassetteRedactConfig } from "./cassetteRedactTypes.js";
import { redactGraphqlRequestBody } from "./cassetteRequestRedact.js";
import { isGraphqlUrl, normalizeGraphqlBody, scrubGeneric } from "./cassetteScrub.js";

/**
 * What an identifier a request SENDS collapses to. Every placeholder in this file starts with `[REDACTED`, so
 * `cassetteTripwire.isProvablySafe` already accepts all of them and the committed-cassette gate needed no new
 * shape to learn.
 */
export const REDACTED_ID = "[REDACTED_ID]";

/** What a paging bookmark a request sends back collapses to — its identity is the cursor matcher's job. */
export const REDACTED_CURSOR = "[REDACTED_CURSOR]";

/** What a non-structural object key collapses to (an identifier can ride in the key position). */
export const REDACTED_KEY = "[REDACTED_KEY]";

/**
 * What a body this file cannot reason about collapses to: a multipart upload, a raw binary PUT, a body from a
 * host no provider config covers. Distinct from `""` on purpose — `""` means the recorder never wrote the
 * body down (the debt {@link ./cassetteBodyDebt.ts} enumerates), while this means it did and there was
 * nothing safely structural to keep.
 */
export const REDACTED_BODY = "[REDACTED_BODY]";

/** The form-encoded content type, which is what the Slack Web API client sends every write as. */
const FORM_MIME = "application/x-www-form-urlencoded";

/** One request body's verdict against the entry Polly is about to replay. */
export type RequestBodyVerdict =
  /** The live projection is byte-for-byte the recorded one — the cassette proves what was sent. */
  | { readonly kind: "match" }
  /** Nothing text-comparable was recorded — a blanked body, or one the persister wrote no text for. */
  | { readonly kind: "unrecorded" }
  /** The live request sent something the recording did not — the whole point of the check. */
  | { readonly kind: "mismatch"; readonly message: string };

/** Parse a JSON object/array, or `undefined` for anything else (a scalar, a blob, malformed text). */
function parseJsonStructure({ text }: { text: string }): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Project one string leaf by which of the provider's allowlist sets its key sits in. */
function projectString({
  key,
  value,
  config,
}: {
  key: string | undefined;
  value: string;
  config: CassetteRedactConfig;
}): string {
  const lowerKey = key?.toLowerCase();
  if (lowerKey === undefined) {
    return "[REDACTED]";
  }
  if (config.idKeys.has(lowerKey)) {
    return REDACTED_ID;
  }
  // Both sets, because a bookmark travels under its RESPONSE name in some clients and its REQUEST name in
  // others, and either way its value differs between a record run and a replay run by construction.
  if (config.cursorParams.has(lowerKey) || config.cursorKeys.has(lowerKey)) {
    return REDACTED_CURSOR;
  }
  if (config.urlKeys.has(lowerKey)) {
    return redactUrl({ value });
  }
  if (config.keepKeys.has(lowerKey)) {
    return value; // the generic backstop still runs over the whole projection
  }
  return "[REDACTED]";
}

/**
 * Project a parsed JSON value. Object keys are emitted SORTED so a client that reorders its own payload
 * cannot fail a comparison — the field SET is the evidence, never the serialisation order.
 */
function projectValue({
  value,
  key,
  config,
}: {
  value: unknown;
  key: string | undefined;
  config: CassetteRedactConfig;
}): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectValue({ config, key, value: entry }));
  }
  if (isRecord(value)) {
    const record = value;
    const out: Record<string, unknown> = {};
    for (const objectKey of Object.keys(record).toSorted()) {
      const outKey = isStructuralObjectKey({ key: objectKey }) ? objectKey : REDACTED_KEY;
      out[outKey] = projectValue({ config, key: objectKey, value: record[objectKey] });
    }
    return out;
  }
  if (typeof value === "string") {
    return projectString({ config, key, value });
  }
  // A number, a boolean or `null` carries no identifier and is the highest-value thing here: `draft: true`
  // is exactly the field the write-transport test had to be written to prove.
  return value;
}

/**
 * Project a form-encoded body as a sorted `[name, value]` pair list rather than a re-encoded query string.
 *
 * Pairs rather than an object because a form may repeat a name, and sorted for the same reason the JSON walk
 * sorts its keys. A field whose value is itself JSON (Slack sends `blocks` and `metadata` that way) is walked
 * as JSON under its own field name, so a card's block structure is projected rather than blanked wholesale.
 *
 * The field NAME goes through the same structural check the JSON walk applies to an object key. Every form
 * name this repo's clients send is a field name, so it never fires — it is here because "an identifier can
 * ride in the key position" is a class the response redactor learned the hard way, and a lane that only
 * checks values is exactly where it would return.
 */
function projectFormBody({ body, config }: { body: string; config: CassetteRedactConfig }): string {
  const pairs = [...new URLSearchParams(body)].map(([name, value]): readonly [string, unknown] => {
    const outName = isStructuralObjectKey({ key: name }) ? name : REDACTED_KEY;
    const structure = parseJsonStructure({ text: value });
    if (structure === undefined) {
      return [outName, projectString({ config, key: name, value })];
    }
    return [outName, projectValue({ config, key: name, value: structure })];
  });
  return JSON.stringify(pairs.toSorted((left, right) => byName({ left: left[0], right: right[0] })));
}

/** Order two field names by code unit — `Array#sort`'s own default, spelled out because the pairs are tuples. */
function byName({ left, right }: { left: string; right: string }): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Whether a body's declared content type says it is form-encoded. */
function isFormEncoded({ contentType }: { contentType: string | undefined }): boolean {
  return contentType?.toLowerCase().includes(FORM_MIME) === true;
}

/**
 * The committable projection of one request body — what a cassette records, and what a replayed request is
 * held to. Pure, and idempotent over its own output for every shape the lane records.
 *
 * A GraphQL body keeps the path it already had ({@link redactGraphqlRequestBody} over the normalised form),
 * byte for byte, so none of the 93 entries that already carry one moves. Everything else is walked against
 * the provider's own allowlist, then passed through the generic leak-class backstop.
 *
 * @param body the raw request body, exactly as the client sent it
 * @param contentType the body's declared MIME type, which is what distinguishes a form post from JSON
 * @param url the request URL, read only to recognise the GraphQL lane
 * @param config the provider allowlist; absent for a host no provider covers, which cannot be walked
 * @param knownValues the pre-seeded sensitive literals (record time only; empty in replay and in CI)
 * @returns the projection, `""` for an absent or empty body, or {@link REDACTED_BODY} when nothing structural
 *   could be kept
 */
export function projectRequestBody({
  body,
  contentType,
  url,
  config,
  knownValues,
}: {
  body: string | undefined;
  contentType: string | undefined;
  url: string | undefined;
  config: CassetteRedactConfig | undefined;
  knownValues: readonly string[];
}): string {
  if (body === undefined || body.length === 0) {
    return "";
  }
  if (url !== undefined && isGraphqlUrl({ url })) {
    return scrubGeneric({ knownValues, text: redactGraphqlRequestBody({ body: normalizeGraphqlBody({ body }) }) });
  }
  if (config === undefined) {
    return REDACTED_BODY;
  }
  if (isFormEncoded({ contentType })) {
    return scrubGeneric({ knownValues, text: projectFormBody({ body, config }) });
  }
  const structure = parseJsonStructure({ text: body });
  if (structure === undefined) {
    return REDACTED_BODY;
  }
  return scrubGeneric({
    knownValues,
    text: JSON.stringify(projectValue({ config, key: undefined, value: structure })),
  });
}

/** Replace every string under a key the provider pages on with {@link REDACTED_CURSOR}, at any depth. */
function neutraliseCursorValues({
  value,
  key,
  config,
}: {
  value: unknown;
  key: string | undefined;
  config: CassetteRedactConfig;
}): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => neutraliseCursorValues({ config, key, value: entry }));
  }
  if (isRecord(value)) {
    const record = value;
    const out: Record<string, unknown> = {};
    for (const objectKey of Object.keys(record)) {
      out[objectKey] = neutraliseCursorValues({ config, key: objectKey, value: record[objectKey] });
    }
    return out;
  }
  const lowerKey = key?.toLowerCase();
  if (typeof value === "string" && lowerKey !== undefined && isCursorKey({ config, lowerKey })) {
    return REDACTED_CURSOR;
  }
  return value;
}

/** Whether a key names a paging bookmark for this provider, under either its request or its response name. */
function isCursorKey({ config, lowerKey }: { config: CassetteRedactConfig; lowerKey: string }): boolean {
  return config.cursorParams.has(lowerKey) || config.cursorKeys.has(lowerKey);
}

/**
 * The form two projections are compared in — applied to the RECORDED text and the LIVE one identically, so it
 * can never hide a difference on one side alone. Two normalisations, each answering a way a record run and a
 * replay run legitimately disagree:
 *
 *  - **the GraphQL normal form.** A committed entry may have been persisted before `normalizeGraphqlBody`
 *    joined the persist path, so it carries the raw query text and no `operationName` while a live request
 *    projects to the collapsed form. Two spellings of one operation; `linear.test.ts`'s `Issues` query is the
 *    committed example.
 *  - **cursor identity.** A bookmark cannot agree by VALUE across the two runs by construction — a record run
 *    sends the real cursor and a replay run sends whatever the replayed previous page handed out. That is not
 *    left unproven: `configureCursorMatching` keys a cursor-bearing request on the bookmark's identity, so a
 *    follow-up that drops or repeats one finds no recording at all. The GraphQL lane's own projection keeps
 *    a cursor (it is `redactGraphqlRequestBody`'s shape, unchanged so no committed entry moves), so the
 *    neutralisation happens here rather than there; the non-GraphQL projection already emits
 *    {@link REDACTED_CURSOR}, over which this is a no-op. `linearFollowupCassette.test.ts` is the committed
 *    example: `<uuid:1>` recorded, `[REDACTED]` replayed.
 */
function canonicalise({
  text,
  config,
  url,
}: {
  text: string;
  config: CassetteRedactConfig | undefined;
  url: string;
}): string {
  const normalised = isGraphqlUrl({ url }) ? normalizeGraphqlBody({ body: text }) : text;
  if (config === undefined) {
    return normalised;
  }
  const structure = parseJsonStructure({ text: normalised });
  if (structure === undefined) {
    return normalised;
  }
  return JSON.stringify(neutraliseCursorValues({ config, key: undefined, value: structure }));
}

/** The failure a mismatch reports, with both projections so the diff is readable without re-running. */
function mismatch({
  method,
  url,
  recorded,
  live,
}: {
  method: string;
  url: string;
  recorded: string;
  live: string;
}): RequestBodyVerdict {
  return {
    kind: "mismatch",
    message:
      `cassette request-body fidelity: ${method} ${url} sent a body the recording does not carry.\n` +
      `  recorded: ${recorded}\n` +
      `  sent:     ${live}`,
  };
}

/**
 * Judge a live request's projection against the one its recording carries.
 *
 * The whole `postData` member is read rather than its text alone, because the three states it distinguishes
 * are three different verdicts and two of them look identical once you have only the string:
 *
 *  - **absent** — the request carried NO body when it was recorded. That is not a gap, it is a recorded fact:
 *    `@pollyjs/persister`'s `har/request.js` writes `postData` if and only if `request.body` was truthy. So a
 *    live request that sends a body here is a real, detectable difference and MISMATCHES. Reading `.text`
 *    alone would have made it indistinguishable from the blanked case below and passed it silently.
 *  - **present, `text` absent** — a non-string body (the persister only writes `text` for a string). Nothing
 *    text-comparable was recorded, so nothing can be proven.
 *  - **present, `text` empty** — the entry predates request-body fidelity and the recorder blanked it. Also
 *    unprovable; the standing count of these is the debt register's job rather than this function's.
 *
 * @param postData the recording's `request.postData`, exactly as the HAR carries it
 * @param live the projection of the request being replayed
 * @param method the request method, for the failure message
 * @param url the request URL, read to pick the canonical form and quoted in the failure message
 * @param config the provider allowlist, for the cursor keys {@link canonicalise} neutralises
 * @returns the verdict
 */
export function compareRequestBody({
  postData,
  live,
  method,
  url,
  config,
}: {
  postData: { readonly text?: string } | undefined;
  live: string;
  method: string;
  url: string;
  config: CassetteRedactConfig | undefined;
}): RequestBodyVerdict {
  if (postData === undefined) {
    if (live.length === 0) {
      return { kind: "match" };
    }
    return mismatch({ live, method, recorded: "<no request body was recorded for this entry>", url });
  }
  const recorded = postData.text;
  if (recorded === undefined) {
    return { kind: "unrecorded" };
  }
  if (recorded.length === 0) {
    return live.length === 0 ? { kind: "match" } : { kind: "unrecorded" };
  }
  if (canonicalise({ config, text: recorded, url }) === canonicalise({ config, text: live, url })) {
    return { kind: "match" };
  }
  return mismatch({ live, method, recorded, url });
}
