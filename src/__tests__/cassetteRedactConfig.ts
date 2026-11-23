/**
 * Per-provider allowlist configs for the cassette redactor. Each set is derived from what that connector's
 * PARSER actually reads (see `src/corpus/{slack,linear,github}/*`, `src/live/gmail/*`, `src/datadog/*`):
 * structural enums/timestamps/flags → `keepKeys`; opaque ids → `idKeys`; URLs → `urlKeys`. EVERYTHING else
 * (message text, names, titles, descriptions, canvas blobs, `customer_id`, …) falls through to `[REDACTED]`.
 * Ambiguous keys are deliberately OMITTED (⇒ redacted). Keys are matched case-insensitively (stored
 * lower-cased).
 */
import type { CassetteProvider, CassetteRedactConfig } from "./cassetteRedactTypes.js";

/**
 * A structural object KEY — a field name, safe to keep verbatim in a committed cassette.
 *
 * The allowlist redactor originally walked only VALUES, which is a gap these APIs actually exercise: an
 * outbound `files.uploadV2` response keys its `shares` map BY CHANNEL ID (`shares.private["D0SYN123ABCD"]`),
 * so a real workspace id can sit in the key position and never be touched. Values are safe-by-default, so
 * keys must be too.
 *
 * The rule is shape-based and deliberately narrow: every field name in the Slack/GitHub/Linear/Notion
 * responses we record is snake_case or camelCase, i.e. it starts (after up to two leading underscores, for
 * `__typename`) with a LOWERCASE letter and contains only word characters. Opaque ids do not match — Slack
 * ids are upper-case (`D0SYN123ABCD`), UUIDs and channel names carry `-`, emails carry `@`. A key that does not
 * match is mapped to a synthetic id, so over-redaction (a broken assertion you then allowlist) is the
 * failure mode, never a leak.
 */
const STRUCTURAL_OBJECT_KEY = /^_{0,2}[a-z][A-Za-z0-9_]*$/;

/**
 * Non-structural-looking keys that are nonetheless known content, not identifiers. GitHub keys its reaction
 * counts by reaction NAME, two of which (`+1`/`-1`) are not word-shaped. Kept verbatim so a reaction parser
 * still reads them; anything added here is an explicit, reviewed exception.
 */
const STRUCTURAL_OBJECT_KEY_ALLOWLIST: ReadonlySet<string> = new Set(["+1", "-1"]);

/**
 * Whether an object key may be kept verbatim in a committed cassette. Shared by the redactor (which maps a
 * non-structural key to a synthetic id) and the CI tripwire (which fails on one that survived). Pure.
 *
 * @param key the raw object key
 * @returns true iff the key is a field name rather than a potential identifier
 */
export function isStructuralObjectKey({ key }: { key: string }): boolean {
  return STRUCTURAL_OBJECT_KEY.test(key) || STRUCTURAL_OBJECT_KEY_ALLOWLIST.has(key);
}

/**
 * The longest a REQUEST path segment may be and still read as a route name. Every route these connectors
 * call is a short word (`conversations.history`, `search`, `graphql`, `v1`) — the longest in any recording is
 * 28 characters. The ceiling sits well above that and well below an opaque token.
 */
const MAX_ROUTE_SEGMENT = 48;

/** A route-name-shaped path segment: word characters only, short. */
const ROUTE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Identifier shapes that are NEVER a route name, even though they are short and word-shaped: a UUID (Notion /
 * Linear ids), a raw upper-case workspace id (Slack), and a long hex digest. Layered under the length +
 * word-shape allowlist exactly as `isProvablySafe` layers its explicit unsafe shapes under `keepKeys`.
 */
const IDENTIFIER_SEGMENTS: readonly RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?=[A-Z0-9]*[0-9])[A-Z][A-Z0-9]{7,}$/,
  // A SYNTHETIC id, which the redactor itself minted. Without this, record and replay disagree about the
  // very same request: at record time the path carries a real id and collapses, while at replay the id has
  // become `id_555` — short, word-shaped, and kept — so the replayed key never matches the recorded one and
  // the cassette is unusable. Measured on the first Gmail recording, which failed in CI exactly this way.
  // Inert for every committed cassette: none has an `id_` segment in a path, because they all collapsed.
  /^id_\d+$/,
  // A bare hex run. The bound was 32 and Gmail walked straight under it: a message id is SIXTEEN lowercase
  // hex characters (`/gmail/v1/users/me/messages/<16 hex>`), which is word-shaped, short, and not
  // an id by any rule here — so it was kept verbatim in a committed cassette's request path. It identifies
  // one real message in one real mailbox. Measured before lowering the bound: across every cassette in the
  // repository, the ONLY 12-or-more hex path segments were those Gmail ids, so no other provider's match
  // key moves. No route name is a dozen unbroken hex characters.
  /^[0-9a-f]{12,}$/i,
  // Any segment CONTAINING a long digit run. Gmail draft ids are this shape and the hex rule above cannot
  // see them, because they are not hex: the first draft cassette committed a real draft id in its request
  // path AND was unusable, since at replay the id had become `id_575`, which collapses, so the key never
  // matched the verbatim one recorded. Both symptoms the hex rule exists for, from a shape it missed.
  //
  // It is written UNANCHORED after an anchored version (`^[a-z]?\d{8,}$`) was tried and failed inside this
  // same change: it matched `r6896368743676392683` and then missed `r-5886024529378826806`, because a draft
  // id may carry a hyphen. Enumerating affixes is the losing move — the invariant that actually holds is
  // that a ROUTE NAME never contains eight consecutive digits, so that is what is tested.
  //
  // Measured across every committed cassette: 42 distinct path segments, the longest digit run in a real
  // route name being `155` (a pull-request number), and the ONLY segment this collapses is that draft id —
  // so no other provider's match key moves. Reproduce the segment inventory with:
  //   find src/__tests__/integration/__recordings__ -name recording.har -exec grep -ho '"url": "[^"]*"' {} +
  /\d{8,}/,
];

/**
 * Whether a request path SEGMENT reads as a route name rather than an opaque token.
 *
 * This exists because of a real leak the value-only redactor could not see: Slack's `files.uploadV2` performs
 * its upload against a one-time URL whose path is a 179-character base64 blob — and that blob decodes to the
 * REAL team, user, and file ids. Nothing caught it: the allowlist redactor walks response values, not request
 * paths; the record-time tripwire matches known values as LITERALS, and base64 defeats a literal match. So
 * request paths get the same safe-by-default treatment as everything else: a segment that is not plainly a
 * route name is treated as an identifier, and the whole path is collapsed.
 *
 * @param segment one path segment (no slashes)
 * @returns true iff the segment may be kept verbatim
 */
export function isRouteShapedSegment({ segment }: { segment: string }): boolean {
  if (segment.length > MAX_ROUTE_SEGMENT || !ROUTE_SEGMENT.test(segment)) {
    return false;
  }
  return !IDENTIFIER_SEGMENTS.some((shape) => shape.test(segment));
}

/** The path a collapsed (opaque) request URL keeps — the same form {@link isRouteShapedSegment} rejects. */
export const OPAQUE_PATH = "/[REDACTED]";

/**
 * A query-parameter NAME that carries an identifier: one whose last word is `id` or `ids`, in any case and
 * under any separator convention — `id`, `account.id`, `account_id`, `accountId`, `labelIds`.
 */
const ID_QUERY_PARAM_NAME = /ids?$/;

/**
 * Whether a query parameter's name says its value identifies something.
 *
 * The QUERY was the one position on a request that nothing ever read. {@link redactRequestPath} collapses an
 * opaque path and {@link cassetteRedact} walks a response body, but a route-shaped path keeps its query
 * verbatim — so `zones?account.id=<32 hex>` committed the real account id four times while the same id in
 * the path form `accounts/<id>` collapsed. Reproduce the inventory this criterion was measured against:
 *   find src/__tests__/integration/__recordings__ -name recording.har -exec grep -ho '"url": "[^"]*"' {} +
 *
 * Measured across every committed cassette: 26 distinct name=value pairs, of which this predicate selects
 * only `account.id` and `labelIds`, and only the first has a value {@link isRouteShapedSegment} rejects. So
 * the rule redacts exactly the four leaked entries and moves nothing else.
 *
 * @param name the parameter's name as the request carries it
 * @returns true iff the name reads as an identifier field
 */
export function isIdQueryParamName({ name }: { name: string }): boolean {
  return ID_QUERY_PARAM_NAME.test(name.toLowerCase());
}

/**
 * What an identifying query parameter's value collapses to. Deliberately route-shaped (see
 * {@link isRouteShapedSegment}) so a second pass over an already-redacted cassette leaves it alone, and
 * so it survives `URLSearchParams` encoding unchanged.
 */
export const OPAQUE_QUERY_VALUE = "REDACTED_ID";

/**
 * Whether every segment of a request path is route-shaped — i.e. the path is safe to commit verbatim. The
 * collapsed {@link OPAQUE_PATH} also passes, so the check is idempotent over an already-redacted cassette.
 *
 * @param path the request URL's pathname
 * @returns true iff the path carries no opaque segment
 */
export function isSafeRequestPath({ path }: { path: string }): boolean {
  if (path === OPAQUE_PATH) {
    return true;
  }
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .every((segment) => isRouteShapedSegment({ segment }));
}

/**
 * The ONLY headers a committed cassette keeps — an allowlist, for the same reason the body walk is one.
 *
 * A provider's response headers are full of per-request identifiers (`x-slack-req-id`, `x-slack-unique-id`,
 * CloudFront ids, backend hostnames) and are exactly the sort of field nobody thinks to redact; a redirect's
 * `location` or a stray `set-cookie` would be worse. None of it is needed to replay, so the safe default is to
 * keep nothing and name the few that earn their place. Dropping `set-cookie` here reaches ONE of its two copies —
 * the parsed `cookies[]` array is `./cassetteCookies.ts`'s job:
 *   - `content-type` — the SDKs branch on it to parse a body;
 *   - `retry-after` — the rate-limit path reads it;
 *   - `x-oauth-scopes` / `x-accepted-oauth-scopes` — the Slack SDK lifts these onto `response_metadata.scopes`,
 *     which the `connect` write-scope preflight reads. A scope list is a capability, not an identifier.
 *   - `x-ratelimit-limit` / `x-ratelimit-period` / `x-ratelimit-remaining` / `x-ratelimit-reset` /
 *     `x-ratelimit-name` — Datadog's rate-limit budget (`src/datadog/rateLimit.ts`), read by
 *     `createDatadogClient`'s observing fetch on every metered response. A 429 carries no `retry-after`, so
 *     these five are the only wait signal; dropping them would leave a replayed rate-limit response
 *     unreadable and `lastRateLimit()` permanently `null`. The values are a request budget, never an
 *     identifier.
 */
const ALLOWED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-type",
  "retry-after",
  "x-oauth-scopes",
  "x-accepted-oauth-scopes",
  "x-ratelimit-limit",
  "x-ratelimit-period",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-name",
]);

/**
 * The only REQUEST headers a committed cassette keeps. Request matching ignores headers entirely
 * (`matchRequestsBy.headers: false`), so nothing here is load-bearing for replay — the set exists so a
 * recording carries no credential, cookie, or client fingerprint at all.
 */
const ALLOWED_REQUEST_HEADERS: ReadonlySet<string> = new Set(["accept", "content-type"]);

/**
 * Whether a header may be kept in a committed cassette. Shared by the persist hook and the CI tripwire, so the
 * gate checks exactly what the redactor promises. Pure.
 *
 * @param name the header name (any case)
 * @param kind whether it is a request or a response header
 * @returns true iff the header is on the relevant allowlist
 */
export function isAllowedCassetteHeader({ name, kind }: { name: string; kind: "request" | "response" }): boolean {
  const allowed = kind === "request" ? ALLOWED_REQUEST_HEADERS : ALLOWED_RESPONSE_HEADERS;
  return allowed.has(name.toLowerCase());
}

/** Public API hosts kept verbatim in a URL origin; any other host (a workspace subdomain) → `redacted.invalid`. */
export const PUBLIC_URL_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "api.github.com",
  "slack.com",
  "api.slack.com",
  "files.slack.com",
  "linear.app",
  "api.linear.app",
  "uploads.linear.app",
  // Linear's presigned upload slots live in Google Cloud Storage. The bucket name and the V4 signature are
  // both in the PATH and the QUERY, which are collapsed — this is the global public storage host, and it
  // names no workspace, so keeping the origin is what lets the recorded PUT and the replayed one line up.
  "storage.googleapis.com",
  // Every Datadog site's REST host (`DD_SITES` in `src/datadog/config.ts`) — a site name is a region, not an
  // org identifier, so keeping the origin discloses nothing.
  "api.datadoghq.com",
  "api.us3.datadoghq.com",
  "api.us5.datadoghq.com",
  "api.ap1.datadoghq.com",
  "api.ap2.datadoghq.com",
  "api.datadoghq.eu",
  "api.ddog-gov.com",
  "api.us2.ddog-gov.com",
  "api.uk1.datadoghq.com",
  "api.vanta.com",
  "api.notion.com",
  "api.cloudflare.com",
]);

/**
 * Build a config from plain key arrays (lower-cased into sets). `cursorKeys`/`cursorParams` default to empty:
 * a provider whose client never walks a cursor (Cloudflare and Datadog page by ordinal, Vanta's reads here
 * take one page) has no cursor identity to keep, and an empty set changes nothing for it.
 */
function config({
  provider,
  keepKeys,
  idKeys,
  urlKeys,
  cursorKeys = [],
  cursorParams = [],
}: {
  provider: CassetteProvider;
  keepKeys: readonly string[];
  idKeys: readonly string[];
  urlKeys: readonly string[];
  cursorKeys?: readonly string[];
  cursorParams?: readonly string[];
}): CassetteRedactConfig {
  const lower = ({ keys }: { keys: readonly string[] }): ReadonlySet<string> =>
    new Set(keys.map((k) => k.toLowerCase()));
  return {
    cursorKeys: lower({ keys: cursorKeys }),
    cursorParams: lower({ keys: cursorParams }),
    idKeys: lower({ keys: idKeys }),
    keepKeys: lower({ keys: keepKeys }),
    provider,
    urlKeys: lower({ keys: urlKeys }),
  };
}

const SLACK = config({
  // `response_metadata.next_cursor` is the bookmark every list/history/replies read pages on, and `cursor`
  // is the form field `@slack/web-api` sends it back under. `files.list` pages by ordinal (`page`), which
  // is a number, not an identity, and is left alone.
  cursorKeys: ["next_cursor"],
  cursorParams: ["cursor"],
  idKeys: [
    "id",
    "user",
    "user_id",
    "bot_id",
    "channel",
    "channel_id",
    "team",
    "team_id",
    "enterprise_id",
    "parent_user_id",
    // PR5 write responses: the ids a send confirms back (`files.uploadV2` file/share ids).
    "file_id",
    // The workspace-shape writes: `canvases.create` and `conversations.canvases.create` answer with a
    // top-level `canvas_id` and nothing else, so a cassette that redacted it could not prove a canvas was
    // created at all — only that the call returned `ok`. An opaque `F…` handle, exactly like `file_id`.
    "canvas_id",
  ],
  keepKeys: [
    "type",
    "subtype",
    "ts",
    "thread_ts",
    "event_ts",
    "latest",
    "oldest",
    "mimetype",
    "filetype",
    "mode",
    // `metadata.event_type` and `event_payload.renderer` are fixed, code-defined enums this repo itself
    // assigns (`slopweaver_turn_v1`, `slack-assistant-answer-v2`, …) — never user content — and a read-back
    // that classifies a message's metadata (`parseAssistantAnswerMetadata`, the exact-identity recovery
    // check it backs) needs their real value to structurally recognise what it is reading, the same way
    // `type`/`subtype` already do for the message shape itself.
    "event_type",
    "renderer",
    // `event_payload.askIdentity`'s own field names — this repo's camelCase spelling of the SAME timestamps
    // `ts`/`thread_ts` already keep, and a fixed `"exact"|"thread-only"` enum (or the `"legacy"` spelling of thread-only answer messages already in Slack carry), never user content. Without these a
    // read-back of the exact ask identity a real answer's metadata carries (the whole point of an assistant
    // answer's V2 metadata) cannot be checked from a cassette at all.
    "messageTs",
    "threadTs",
    "quality",
    // PR5 write responses: `chat.postMessage` returns `ok` + `ts` + `channel` (an id, above), and
    // `files.uploadV2` returns structural upload facts. Only enums/flags/timestamps/counts are kept — a
    // write response's `title`, `name`, `initial_comment`, `preview` and every echoed block still fall
    // through to `[REDACTED]`, because a write echoes back the content we just authored.
    "ok",
    // Slack's `error` is a documented machine ENUM (`message_not_found`, `not_authed`, `invalid_auth`, …), never
    // user content, so keeping it leaks nothing. Keeping it is also load-bearing twice over: a caller that must
    // tell "the message is gone" from "the token is broken" can only do so by reading this code, and a cassette
    // whose error codes are redacted cannot be AUDITED for a captured auth failure — the highest-value check
    // there is on a recorded suite, since a 401 replays as a permanent, meaningless pass.
    "error",
    // Slack's top-level `warning` is the same kind of documented machine enum (`already_in_channel`,
    // `superfluous_charset`), and `conversations.join` reports an account already in the channel ONLY there,
    // so a cassette that redacted it could not tell a fresh join from a no-op one.
    "warning",
    "created",
    "timestamp",
    "is_public",
    "is_external",
    "public_url_shared",
    "editable",
    "size",
  ],
  provider: "slack",
  urlKeys: [
    "url",
    "permalink",
    "permalink_public",
    "link",
    "image_512",
    "image_192",
    // PR5 write responses: an uploaded file's private/download/thumbnail URLs.
    "url_private",
    "url_private_download",
    "thumb_360",
    "thumb_720",
    "upload_url",
  ],
});

const LINEAR_BASE = config({
  // A connection's `pageInfo.endCursor` comes back as `cursor_N`; a root-level page 2 sends it as the
  // `after` variable, which `cassetteRequestRedact.ts` maps through the same identity. The nested
  // `ParentConnection` follow-up is sentinelled BEFORE that mapping runs and is unaffected.
  cursorKeys: ["endCursor"],
  cursorParams: ["after"],
  idKeys: ["id", "identifier", "email"],
  // `status` and `contenttype` join the structural set for the same reason `state` and `health` are in it:
  // each is a closed provider enum a PARSER branches on, and none of them names a person, a team or a piece
  // of work. `status` is `InitiativeStatus`, five fixed values; `contenttype` is a MIME type. Where a
  // `status` field holds an OBJECT rather than a string (a workspace's configurable project status), its
  // own `name` is not on this list, so the object stays redacted — the key being kept is not the same as its
  // contents being kept.
  keepKeys: ["type", "state", "status", "health", "contenttype", "createdat", "updatedat"],
  provider: "linear",
  // `assetUrl` and `uploadUrl` redact to `scheme://host/[REDACTED]`, which is what makes the PUT replay at
  // all: `redactRequestPath` collapses the recorded request's path to the same shape, so the URL a replayed
  // run reads out of the reservation is the URL the cassette is keyed under — by construction rather than by
  // coincidence, exactly as `cassetteRedact.ts`'s own doc describes.
  urlKeys: ["url", "avatarurl", "asseturl", "uploadurl"],
});

/**
 * The header names a presigned upload PUT must send verbatim, lowercased because `redactString` compares
 * `value.toLowerCase()` — what is persisted keeps its own case. MEASURED against a live `fileUpload`
 * reservation; reproduce by reserving a slot and printing `reservation.headers`.
 */
const LINEAR_UPLOAD_HEADER_NAMES: readonly string[] = ["x-goog-content-length-range", "content-disposition"];

/**
 * Linear, with `key` layered on as a VALUE-scoped allowlist, and the distinction is load-bearing.
 *
 * An `UploadFileHeader.key` is an HTTP header NAME the presigned PUT has to send verbatim: a replayed run
 * that read `[REDACTED]` there would build `new Headers({ "[REDACTED]": … })`, which throws inside `fetch`
 * before Polly's adapter is reached at all. But `key` on a Linear TEAM is that team's identifier prefix — a
 * private identifier this repository may not contain — so keeping the key outright would put every team key
 * in every Linear cassette. Two sanctioned values, and their VALUES stay redacted; one of them carries the
 * uploaded filename.
 */
const LINEAR: CassetteRedactConfig = {
  ...LINEAR_BASE,
  keepValuesByKey: { key: new Set(LINEAR_UPLOAD_HEADER_NAMES) },
};

const GITHUB = config({
  // GraphQL connections page on `pageInfo.endCursor` → `after`, exactly as Linear's do. REST pages by
  // ordinal `page`, which carries no identity.
  cursorKeys: ["endCursor"],
  cursorParams: ["after"],
  idKeys: ["id", "node_id", "login"],
  keepKeys: [
    "__typename",
    "state",
    "reviewdecision",
    "mergeable",
    "status",
    "createdat",
    "updatedat",
    "submittedat",
    "created_at",
    "updated_at",
    "pushed_at",
    "closed_at",
    "merged_at",
    "state_reason",
    "author_association",
    "type",
    "user_view_type",
    "visibility",
  ],
  provider: "github",
  urlKeys: ["url", "html_url", "avatar_url"],
});

/**
 * Gmail, and it is the one config where the allowlist has to be read as a REFUSAL rather than as a list.
 *
 * A recorded Gmail response is a person's mail: subjects, bodies, signatures, colleagues' addresses. So the
 * kept set is only what a PARSER branches on — the label ids that decide unread/inbox, the MIME type that
 * decides which body part wins, the size fields, the internal date — and every header VALUE, every body
 * `data` blob and every snippet falls through to `[REDACTED]`. `data` and `filename` are deliberately absent from all
 * three sets: `data` is the base64 body itself, and a base64 blob defeats the record-time tripwire's literal
 * matching exactly as the Slack upload path's base64 URL once did, while an attachment filename is prose a
 * sender chose (`Q3-acquisition-terms.pdf` names a deal in its own right).
 *
 * `historyid`/`threadsTotal`-style counters are also left out. A mailbox's message count is not structural
 * to any parser here, and it is a real fact about a real person's mailbox.
 */
const GMAIL_BASE = config({
  // A list read pages on `nextPageToken`, sent back as the `pageToken` query parameter.
  cursorKeys: ["nextPageToken"],
  cursorParams: ["pageToken"],
  idKeys: ["id", "threadid", "messageid", "attachmentid", "historyid", "emailaddress"],
  keepKeys: [
    // `labelids` is NOT a key-level keep, and that is still deliberate: a user-created label id is content.
    // It IS a VALUE-level keep for the closed system vocabulary below — so `INBOX` and `UNREAD` survive and
    // `Label_7` does not, which is what lets a cassette prove an archive without naming anyone's folders.
    "mimetype",
    "size",
    "internaldate",
    "sizeestimate",
    "resultsizeestimate",
    "partid",
  ],
  provider: "gmail",
  urlKeys: [],
});

/**
 * The only header NAMES a committed Gmail cassette keeps — the five a parser actually reads.
 *
 * `name` is deliberately NOT in `keepKeys`. A `format: full` read returns every header real mail carries,
 * and those names alone fingerprint an organisation's mail-security and delivery stack (a DLP scanner, a
 * relaying domain, a sending service) without a single byte of content. Header names are also what a
 * replayed message must keep or it parses to nothing, so neither keeping all of them nor dropping all of
 * them is right — hence a value-scoped keep.
 */
const GMAIL_KEPT_HEADER_NAMES: ReadonlySet<string> = new Set(["from", "to", "cc", "subject", "date"]);

/**
 * Gmail's SYSTEM label vocabulary — closed, published, and byte-identical in every Gmail mailbox on earth.
 *
 * These are kept verbatim because they identify nobody: `INBOX` in this cassette says exactly what `INBOX`
 * says in every other one. What is emphatically NOT here is a user-created label — its id (`Label_7`) and
 * its name (`Clients/Othercompany`) both name something about a real person's work, so both fall through and are
 * redacted. That is the whole reason this is a VALUE allowlist rather than a key one: the same `id` key
 * carries a universal constant on the `labels.list` route and a real message id on every other.
 *
 * Deliberately NOT imported from `src/live/gmail/labels.ts`'s `SYSTEM_LABELS`, which is a different set for
 * a different job — the four ids the door writes code against, versus the fourteen that are safe to commit.
 * Lowercased because {@link redactString} matches case-insensitively.
 */
const GMAIL_SYSTEM_LABEL_IDS: readonly string[] = [
  "inbox",
  "unread",
  "starred",
  "important",
  "sent",
  "draft",
  "spam",
  "trash",
  "chat",
  "category_personal",
  "category_social",
  "category_promotions",
  "category_updates",
  "category_forums",
];

/**
 * Gmail, with both value-scoped allowlists layered onto the key-level config.
 *
 * `name` carries the union of the kept header names and the system label ids, because a system label's NAME
 * is its id — a `labels.list` entry is `{ id: "INBOX", name: "INBOX" }`, and keeping one without the other
 * would leave a report able to name the label it resolved but not display it.
 */
const GMAIL: CassetteRedactConfig = {
  ...GMAIL_BASE,
  keepValuesByKey: {
    id: new Set(GMAIL_SYSTEM_LABEL_IDS),
    labelids: new Set(GMAIL_SYSTEM_LABEL_IDS),
    name: new Set([...GMAIL_KEPT_HEADER_NAMES, ...GMAIL_SYSTEM_LABEL_IDS]),
  },
};

/**
 * Google Calendar, read as a REFUSAL the way Gmail is: a recorded diary is a person's meetings, colleagues
 * and rooms, so only what a parser BRANCHES on survives — the enum-shaped fields, the instants, the zones
 * and the flags — and every title, description, location, display name, comment and join link falls
 * through to `[REDACTED]`.
 *
 * Two shapes are worth naming. `start`/`end` are OBJECTS on an event (`{ dateTime, timeZone }`, traversed,
 * never a string) and STRINGS on a free/busy `busy` period, so keeping them keeps the RFC3339 instants of a
 * busy block while an event's own instants are kept through `date`/`datetime`. And a free/busy response
 * keys its `calendars` map by calendar id — an email address — which the redactor leaves as a KEY; the
 * calendar cassette therefore only ever asks free/busy about `primary`, so no address is written as a map
 * key at all. Attendee and organiser `email` values are id-mapped (`id_N`), which keeps "the same person
 * appears twice" true across a recording without keeping who.
 *
 * `value` is kept only for the account's time zone (`settings.get` answers `{ id: "timezone", value: … }`),
 * and only for IANA zones the bound account has actually reported, because a global `value` keep would
 * survive into any other response that happened to carry the key.
 */
const CALENDAR_BASE = config({
  cursorKeys: ["nextPageToken", "nextSyncToken"],
  cursorParams: ["pageToken", "syncToken"],
  idKeys: ["id", "recurringeventid", "icaluid", "etag", "email", "calendarid", "eventid"],
  keepKeys: [
    "kind",
    "status",
    "accessrole",
    "responsestatus",
    "eventtype",
    "transparency",
    "visibility",
    "date",
    "datetime",
    "timezone",
    "timemin",
    "timemax",
    "start",
    "end",
    "created",
    "updated",
    "primary",
    "selected",
    "self",
    "optional",
    "resource",
    "organizer",
    "usedefault",
    "minutes",
    "method",
    "reason",
    "domain",
    "sequence",
    "entrypointtype",
    "guestscanmodify",
    "guestscaninviteothers",
    "guestscanseeotherguests",
    "anyonecanaddself",
    "privatecopy",
    "locked",
    "endtimeunspecified",
    "recurrence",
  ],
  provider: "calendar",
  urlKeys: ["htmllink", "hangoutlink", "uri"],
});

/** Calendar, with the one value-scoped keep the account zone needs. */
const CALENDAR: CassetteRedactConfig = {
  ...CALENDAR_BASE,
  keepValuesByKey: {
    id: new Set(["timezone", "primary"]),
    value: new Set(["australia/melbourne", "australia/sydney", "australia/brisbane", "utc"]),
  },
};

/**
 * Datadog. The response bodies are the widest of any provider here — a monitor's `message` is a whole
 * runbook, its `name` and `query` are org-authored, and a metrics-scalar group column's `values` are raw tag
 * values (host names, service names) — so almost nothing is a keep-key.
 *
 * `overall_state`/`status` are kept because they are Datadog's own closed, documented vocabularies
 * (`MonitorOverallStates`) rather than anything a team named — the same distinction that lets GitHub's
 * `state` survive. `created`/`modified` mirror GitHub's `created_at`/`updated_at`. Every key here is the WIRE
 * spelling (snake_case) rather than the SDK's camelCased TS property — the redactor walks the raw JSON text
 * before the SDK's own deserialiser renames anything, so `overallState` (the TS field) would never match a
 * real response at all; `overall_state` (measured off a real recording) does.
 *
 * `type` is VALUE-scoped, not a plain keep-key, and this is load-bearing rather than tidy. The SAME `type`
 * key carries Datadog's own closed vocabulary in two completely different places: a metrics-scalar column's
 * data-shape discriminator (`"group"`/`"number"`) and a JSON:API envelope's resource kind (`"permissions"`,
 * `"scalar_response"`) — all single tokens, all needed structurally by `metricsScalar.ts`'s reader — versus a
 * monitor's `MonitorType` (`"query alert"`, `"log alert"`, …), which is EQUALLY a closed, code-defined
 * vocabulary but is multi-word. `cassetteTripwire.ts`'s `isProvablySafe` treats a keep-key's value as
 * provably safe only when it carries no whitespace (an anti-leak heuristic: a multi-word string under an
 * allowlisted key reads as prose that slipped through, not as an enum) — measured directly, committing
 * `"query alert"` as a plain `keepKeys` entry fails `cassetteHarTripwire.test.ts`. Scoping to the specific
 * single-token values actually read keeps the metrics reader working without weakening that gate; a monitor's
 * `type` simply falls through to `[REDACTED]` like its `name` and `message`.
 *
 * Deliberately ABSENT: `name` and `query` (monitor titles and both logs/metrics query strings are free text
 * an org wrote, and a metrics-scalar group column's tag-name field also happens to be spelled `name` —
 * keeping it would keep monitor titles too, since this allowlist is flat, not path-scoped); `tags`
 * (service/env/team tags); `message` (a monitor's runbook body). A raw numeric id (a monitor's `id`, a
 * bucket's numeric fields) is never touched by the redactor at all — see `cassetteRedact.ts`'s "non-string
 * leaves are kept" — so this config's `idKeys` only ever matters for a STRING id (a permission's UUID,
 * `data.additionalProperties.id`).
 */
const DATADOG: CassetteRedactConfig = {
  ...config({
    idKeys: ["id"],
    keepKeys: ["overall_state", "status", "created", "modified"],
    provider: "datadog",
    urlKeys: [],
  }),
  keepValuesByKey: { type: new Set(["group", "number", "permissions", "scalar_response"]) },
};

/**
 * Vanta. This is our own real, live Manage API workspace — there is no throwaway compliance tenant to point
 * this at instead — so the allowlist has to survive the actual shape of our controls, policies, risks,
 * vendors and evidence, and it is deliberately the narrowest of any provider here: `id`/`riskId` become
 * synthetic, and almost every OTHER string field (`name`, `description`, `note`, every owner's
 * `displayName`/`emailAddress`, every `domains`/`customFields`/`integrations` entry, every free-text
 * `*Description`/`*Reason`) is left OUT of every set below and falls through to `[REDACTED]` by default —
 * that is real compliance content, not something a parser reads structurally.
 *
 * `source`/`treatment`/`inherentRiskLevel`/`residualRiskLevel` are Vanta's own closed, single-token
 * vocabularies (`vantaControlDtoSchema`/`vantaRiskScenarioDtoSchema`/`vantaVendorDtoSchema` in
 * `apiSchemas.ts`), so keeping them is the same call as GitHub's `state` or Datadog's `overall_state`.
 * `status`/`method` are VALUE-scoped (below), for the same reason as Datadog's `type`: `status` is one flat
 * key shared by `vantaPolicyDtoSchema`(`.status`/`.latestVersion.status`) and
 * `vantaVendorDtoSchema`(`.status`/`.latestDecision.status`), and every value in both is a real, measured,
 * single-token enum member (`OK`, `NEEDS_REMEDIATION`, `APPROVED`, `PENDING_APPROVAL`, `DRAFT`,
 * `NOT_STARTED`, `MANAGED`, `CONDITIONALLY_APPROVED`) — `vantaVendorDtoSchema.authDetails.method` likewise
 * (`GOOGLE_WORKSPACE`, `USERNAME_PASSWORD`, `SSO`).
 *
 * Three fields are deliberately ABSENT, and irreparably so — not "not yet measured" but structurally
 * impossible to add via this mechanism at all: `vantaRiskScenarioDtoSchema.type` (`"Risk Scenario"` /
 * `"Enterprise Risk"`), `vantaDocumentDtoSchema.category` (`documentCategorySchema` — most of its ~18
 * members are multi-word, e.g. `"Vulnerability management"`, `"Account setup"`) and `.uploadStatus`
 * (`documentStatusSchema` — `"Needs document"`/`"Needs update"`/`"Not relevant"` alongside single-word
 * `"OK"`). `cassetteTripwire.ts`'s `isProvablySafe` rejects ANY whitespace under an allowlisted key —
 * plain `keepKeys` or `keepValuesByKey`, it makes no difference — exactly the constraint Datadog's own
 * header describes for `"query alert"`. Datadog's `type` had an escape (scope to its single-token members
 * only); these three do not, because Vanta's own vocabularies put multi-word members on the
 * commonest rows (every risk scenario carries `type: "Risk Scenario"`; `uploadStatus: "Needs document"` is an
 * ordinary state; most `category` values are multi-word) — so `vanta.test.ts` does not call
 * `listRisksRiskScenario`/`listEvidenceDocuments` at all, and documents exactly why in its own header
 * rather than recording a cassette these three fields would make permanently unparseable on replay.
 */
const VANTA: CassetteRedactConfig = {
  ...config({
    idKeys: [
      "id",
      "riskid",
      "externalid",
      "ownerid",
      "businessowneruserid",
      "securityowneruserid",
      "versionid",
      "slugid",
    ],
    keepKeys: [
      "source",
      "treatment",
      "inherentrisklevel",
      "residualrisklevel",
      // `policyLocaleSchema`'s 2-letter/short codes (`apiSchemas.ts`) — always single-token by construction,
      // unlike every `*status`/`*category`/`type` field below.
      "language",
    ],
    provider: "vanta",
    urlKeys: ["url"],
  }),
  // `status` is the SAME flat key on `vantaPolicyDtoSchema.status`/`.latestVersion.status` and
  // `vantaVendorDtoSchema.status`/`.latestDecision.status` — every value below is exactly what a real
  // recording against an account produced (`policies-list`/`vendors-list`), not the schemas' full
  // theoretical enums; a value the recorded account has never produced stays redacted (and a future re-record
  // would surface that as a new, honest schema-parse failure to fix here, not a silent gap). `method` is
  // `vantaVendorDtoSchema.authDetails.method`, same discipline. Neither `risks-*`'s `type` nor
  // `evidence-documents`' `category`/`uploadStatus` appears here — see this config's own header for why
  // those three can never be added this way.
  // Values are lower-cased — {@link cassetteRedact}'s value-scoped check matches `value.toLowerCase()`
  // against this set (see its own comment); the ORIGINAL casing Vanta sent is what survives in the cassette.
  keepValuesByKey: {
    method: new Set(["google_workspace", "username_password", "sso"]),
    status: new Set([
      "ok",
      "needs_remediation",
      "approved",
      "pending_approval",
      "draft",
      "not_started",
      "managed",
      "conditionally_approved",
    ]),
  },
};

/**
 * Notion. Also our own real, live workspace — no throwaway tenant — so the same discipline as Vanta applies:
 * `id`/`page_id`/`database_id`/`block_id`/`user_id` become synthetic, `url`/`public_url`/`href` keep an
 * allowlisted origin, and almost every OTHER string (a page/database title, a rich-text run's `plain_text`
 * or `text.content`, a comment body, a person's `name`/`email`, a property's own NAME) falls through to
 * `[REDACTED]` by default.
 *
 * A Notion property/column NAME needs no special handling here at all — it is exactly the class
 * `isStructuralObjectKey` (`cassetteRedact.ts`'s own header) exists for: a human names a database column
 * ("Priority", "Due Date"), that name sits in the KEY position under `properties`, and it does not match the
 * lower-camelCase shape a real Notion field name always does, so the walker maps it to a synthetic id
 * automatically — no allowlist entry required, and none is safe to add.
 *
 * `object`/`type`/`color` are Notion's own closed, single-token, code-defined vocabularies (a block/property
 * TYPE discriminator, an annotation colour) — the same call as every other provider's structural enum.
 * `created_time`/`last_edited_time` mirror GitHub's `created_at`/`updated_at`. `archived`/`in_trash`/
 * `has_more`/`checked` are booleans and a raw numeric id is never touched at all — neither needs a keepKey
 * (`cassetteRedact.ts`'s "non-string leaves are kept").
 */
const NOTION: CassetteRedactConfig = {
  ...config({
    // Every list read (`blocks.children.list`, `databases.query`, `search`) pages on `next_cursor`, sent back
    // as `start_cursor` — in the query string for a GET, in the JSON body for a POST.
    cursorKeys: ["next_cursor"],
    cursorParams: ["start_cursor"],
    idKeys: ["id", "page_id", "database_id", "block_id", "user_id", "block", "comment_id"],
    keepKeys: ["object", "type", "color", "created_time", "last_edited_time"],
    provider: "notion",
    urlKeys: ["url", "public_url", "href"],
  }),
  // `markdown` (a written page's canonical body, `pages.retrieveMarkdown`) is otherwise real organisation
  // content and stays redacted — this scopes an exception to the ONLY two literal strings
  // `notion.test.ts`'s own write-cycle test ever sends, single-token by construction because
  // `isProvablySafe` refuses whitespace under any allowlisted key regardless of scoping (see that config's
  // own header). A real page's markdown, or any string besides these two, still falls through to
  // `[REDACTED]` — this is not a general "keep markdown" rule.
  keepValuesByKey: {
    markdown: new Set([
      "original-body-marker",
      "replaced-body-marker",
      // The move test's SUBJECT body. A move must be shown to leave content alone, so this one has to
      // survive the round trip the way the update cycle's markers do. The destination's own body is
      // deliberately absent: nothing ever reads it back, so allowlisting it would sanction a value that
      // never appears — measured, it occurs zero times in the recorded cassette.
      "move-subject-marker",
    ]),
  },
};

/**
 * Cloudflare. Recorded against a real, live account rather than a throwaway tenant, so the narrowest
 * allowlist discipline again:
 * `status`/`type`/`decision`/`kind`/`subtype` are Cloudflare's own closed, single-token vocabularies measured
 * directly off every projection this atlas has (`atlas/cloudflare/projection/*.ts` — `active`/`disabled`/
 * `pending`, `standard`/`enterprise`, `allow`/`deny`/`non_identity`/`bypass`, …), the same call as every other
 * provider's structural enum here. `created_on`/`modified_on`/`created_at`/`updated_at`/`sent`/`start_time`/
 * `end_time` mirror GitHub's `created_at`. `enabled`/`paused`/`editable`/`reusable`/`success`/
 * `uses_functions`/`subdomain_enabled` are booleans and every numeric field (`precedence`, counts) is never
 * touched at all — neither needs a keepKey.
 *
 * Deliberately ABSENT (except one narrow, literal exception below): `name` (a zone/policy/project/rule/list/
 * plan NAME is org content, even a zone's own domain name or a plan tier); `value`/`content`/`comment`/
 * `description`/`url`/`filter`/`mechanisms` (DNS content,
 * filter expressions, webhook URLs, free text); `subdomain` (the account's own Workers subdomain — a real,
 * guessable-adjacent identifier, not a code-defined enum). `guardingFetch`'s own `success:false` envelope is
 * exercised but not specially redacted here — a real synthesized error body carries no more than the
 * allowlist already keeps.
 */
const CLOUDFLARE: CassetteRedactConfig = {
  ...config({
    idKeys: [
      "id",
      "zone_id",
      "account_id",
      "certificate_id",
      "cert_id",
      "policy_id",
      "list_id",
      "parent_org_id",
      "filter",
    ],
    keepKeys: [
      "success",
      "status",
      "type",
      "decision",
      "kind",
      "subtype",
      "enabled",
      "paused",
      "editable",
      "reusable",
      "uses_functions",
      "subdomain_enabled",
      "subdomain_previews_enabled",
      "precedence",
      "created_on",
      "modified_on",
      "created_at",
      "updated_at",
      "sent",
      "start_time",
      "end_time",
    ],
    provider: "cloudflare",
    urlKeys: [],
  }),
  // `name` is otherwise real organisation content (a zone/policy/project's own title) and stays redacted —
  // this scopes an exception to the ONE literal string `resolveLiveCloudflareScope` must match a real zone's
  // name against to resolve the deep-zone scope at all (`client.ts`'s `zone.name.toLowerCase() ===
  // selection.deepZoneName`): the account's own public DNS zone name, already named directly in
  // `cloudflare.test.ts`'s own `DEEP_ZONE_NAME` constant — not a secret, and not a blanket "keep zone names"
  // rule. Any other zone's name still falls through to `[REDACTED]`.
  //
  // `id` is normally an `idKey` (synthesised), and stays that way for every OTHER value — this adds the
  // SAME narrow exception for the one account id `resolveLiveCloudflareScope` compares a matched zone's
  // `account.id` against (`client.ts`'s `zone.accountId !== selection.accountId`): the test's own
  // `ACCOUNT_ID` constant. Without this the comparison structurally can never pass on replay — one side is
  // the test's never-redacted input, the other is read from a redacted response body, so a synthesised id
  // can never equal the literal. A value-scoped keep is checked BEFORE the `idKeys` rule
  // (`cassetteRedact.ts`'s own header), so every other id under this key is still synthesised exactly as
  // before. The committed value is synthetic: a re-record against a real account substitutes that account's
  // id here and in the test locally, rewrites it back to this synthetic value in the recorded cassette, and
  // commits neither — the hygiene gate refuses the real id if it survives.
  keepValuesByKey: {
    id: new Set(["0000000000000000000000000000ac01"]),
    name: new Set(["acme.com"]),
  },
};

/** Every provider config, by provider id. */
export const CASSETTE_CONFIGS: Readonly<Record<CassetteProvider, CassetteRedactConfig>> = {
  calendar: CALENDAR,
  cloudflare: CLOUDFLARE,
  datadog: DATADOG,
  github: GITHUB,
  gmail: GMAIL,
  linear: LINEAR,
  notion: NOTION,
  slack: SLACK,
  vanta: VANTA,
};

/**
 * The union of every provider's keepKeys — the tripwire's "a verbatim value under this key is allowed" set.
 *
 * A VALUE-scoped keep counts here too. `keepValuesByKey` still permits a verbatim value under its key, just
 * a narrower set of them, so a tripwire that only read `keepKeys` would flag exactly the values the
 * redactor was configured to preserve — a gate failing on its own policy. The tripwire's own job is
 * catching a value nobody sanctioned; these are sanctioned, by a stricter rule than the keys around them.
 */
export const ALL_KEEP_KEYS: ReadonlySet<string> = new Set(
  Object.values(CASSETTE_CONFIGS).flatMap((c) => [...c.keepKeys, ...Object.keys(c.keepValuesByKey ?? {})]),
);

/**
 * Pick the provider for a recorded request URL, or `undefined` (⇒ not a redacted provider, e.g. claude).
 *
 * @param url the recorded request URL
 * @returns the provider whose allowlist applies, or undefined when no provider's domain appears ANYWHERE in
 *   the URL. Matched by substring on the whole string, not by parsed host — so a URL merely CONTAINING
 *   another provider's domain (in a path or a query parameter) is claimed by that provider. Fine for
 *   cassette URLs, which are the request lines this repo records; a returned undefined means the request is
 *   not redacted at all, so it must be a deliberate decision rather than a miss
 */
export function providerForUrl({ url }: { url: string }): CassetteProvider | undefined {
  const host = hostOf({ url });
  if (host === undefined) {
    return undefined;
  }
  // The Calendar API lives on the SHARED Google host (`www.googleapis.com/calendar/v3/…`), so it is the one
  // provider a host alone cannot pick out; its path is checked first, and every other Google request —
  // OAuth, Gmail, Docs — keeps falling to the general rule below.
  if (isHostUnder({ domain: "googleapis.com", host }) && pathOf({ url }).startsWith("/calendar/")) {
    return "calendar";
  }
  return PROVIDER_DOMAINS.find(({ domains }) => domains.some((domain) => isHostUnder({ domain, host })))?.provider;
}

/** The path of an absolute URL, or `""` when it is not one. */
function pathOf({ url }: { url: string }): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Each provider's registrable domains. A recorded host must BE one of these, or a subdomain of one. */
const PROVIDER_DOMAINS: readonly { readonly provider: CassetteProvider; readonly domains: readonly string[] }[] = [
  { domains: ["slack.com"], provider: "slack" },
  { domains: ["linear.app"], provider: "linear" },
  { domains: ["github.com"], provider: "github" },
  { domains: ["googleapis.com", "google.com"], provider: "gmail" },
  // Three base domains cover all nine `DD_SITES` (`src/datadog/config.ts`) — every regional site
  // (`us3.datadoghq.com`, `ap2.datadoghq.com`, …) is a subdomain of one of these three.
  { domains: ["datadoghq.com", "datadoghq.eu", "ddog-gov.com"], provider: "datadog" },
  { domains: ["vanta.com"], provider: "vanta" },
  { domains: ["notion.com"], provider: "notion" },
  { domains: ["cloudflare.com"], provider: "cloudflare" },
];

/** The lower-cased host of an absolute URL, or undefined when it is not one. */
function hostOf({ url }: { url: string }): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether a host IS a domain or a subdomain of it — never a substring of one.
 *
 * The four checks above used to be `url.includes("slack.com")`, which the previous comment defended as
 * "fine for cassette URLs". It is not, and CodeQL was right to say so: `includes` matches
 * `slack.com.evil.test`, and it matches a provider's domain sitting in a QUERY PARAMETER of a completely
 * different host — so a recording could be claimed by the wrong provider's allowlist and redacted under the
 * wrong rules. The failure mode is silent and it is the leaky direction. Parsing the host removes the whole
 * class, and the dot prefix is what stops `notgithub.com` matching `github.com`.
 */
function isHostUnder({ host, domain }: { host: string; domain: string }): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
