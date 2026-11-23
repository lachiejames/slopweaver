/**
 * The CI safety net: walk every COMMITTED cassette — the synthetic safe fixture plus any recorded integration
 * cassette — and fail if any response-body string is not
 * provably safe (see `cassetteTripwire.isProvablySafe`). Runs in the fast unit lane so every CI run re-checks
 * the committed `.har`s — no local secret needed. A non-JSON body (the synthetic `claude` SSE) is skipped;
 * its safety rests on being fixture-derived + the hygiene gate.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarCookie, isRedactedCassetteCookie } from "../cassetteCookies.js";
import { parseHttpUrl } from "../cassetteRedact.js";
import { ALL_KEEP_KEYS, isAllowedCassetteHeader, isSafeRequestPath } from "../cassetteRedactConfig.js";
import { REQUEST_VARIABLE_KEEP_KEYS } from "../cassetteRequestRedact.js";
import { findUnsafeValues, type UnsafeLeaf } from "../cassetteTripwire.js";
import { parseOwnJson } from "../parseOwnJson.js";

const RECORDINGS_DIR = join(process.cwd(), "src/__tests__/integration/__recordings__");
const SAFE_FIXTURE = join(process.cwd(), "src/__tests__/fixtures/cassettes/safe/recording.har");
// Where the planted-cookie witness writes its clone — the fixture itself is never touched.
const PLANTED_DIR = mkdtempSync(join(tmpdir(), "cassette-tripwire-"));

afterAll(() => {
  rmSync(PLANTED_DIR, { force: true, recursive: true });
});

/** Every `.har` under `dir` (recursive); `[]` if the dir is absent. */
function harFiles({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir, { recursive: true })
      .map((e) => String(e))
      .filter((e) => e.endsWith(".har"))
      .map((e) => join(dir, e));
  } catch {
    return [];
  }
}

/**
 * Every committed cassette the walks below judge: the synthetic safe fixture, which is always there, plus
 * every recorded integration cassette, of which there may be none. The fixture is what keeps each
 * `toEqual([])` a statement about real entries rather than about an empty list.
 */
function committedCassettes(): readonly string[] {
  return [SAFE_FIXTURE, ...harFiles({ dir: RECORDINGS_DIR })];
}

/** The JSON-parseable response bodies in a `.har` (non-JSON entries, e.g. SSE, are skipped). */
function jsonResponseBodies({ file }: { file: string }): readonly unknown[] {
  const har = parseOwnJson<{ log?: { entries?: { response?: { content?: { text?: string } } }[] } }>({
    text: readFileSync(file, "utf8"),
  });
  const bodies: unknown[] = [];
  const entries = har.log?.entries;
  if (entries == null) {
    return bodies; // a HAR with no entry list at all — nothing to walk
  }
  for (const entry of entries) {
    const text = entry.response?.content?.text;
    if (text === undefined) {
      continue;
    }
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      continue;
    }
    try {
      bodies.push(JSON.parse(trimmed));
    } catch {
      // a non-JSON body that merely starts with a brace — skip (the generic backstop + hygiene cover it)
    }
  }
  return bodies;
}

/** Every unsafe leaf across a `.har`'s JSON response bodies, tagged with the file. */
function unsafeInFile({ file }: { file: string }): readonly (UnsafeLeaf & { file: string })[] {
  return jsonResponseBodies({ file }).flatMap((body) =>
    findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: body }).map((hit) => ({ ...hit, file })),
  );
}

/**
 * The keys a GraphQL request body keeps that no RESPONSE walk would ever allow: the operation's own query
 * text and its name. Both are static strings in this repository rather than caller data — it is what
 * `redactGraphqlRequestBody` deliberately keeps, and what makes a committed cassette reviewable by eye — so
 * they are skipped here rather than being blanked, which would leave nothing to review. Every VARIABLE under
 * them is still walked.
 */
const GRAPHQL_SOURCE_KEYS: ReadonlySet<string> = new Set(["query", "operationname"]);

/**
 * The keep-keys a REQUEST body is judged against: every provider's response allowlist, plus the paging,
 * ordering and window-bound variable names the request redactor keeps on purpose
 * ({@link REQUEST_VARIABLE_KEEP_KEYS}). Judging a request body against the response sets alone flags exactly
 * what the request lane deliberately keeps — a `{"gte":"<date>"}` range in `linear.test.ts`'s committed filter is
 * the case that proved it.
 */
const REQUEST_KEEP_KEYS: ReadonlySet<string> = new Set([...ALL_KEEP_KEYS, ...REQUEST_VARIABLE_KEEP_KEYS]);

/**
 * The JSON-parseable REQUEST bodies in a `.har`, each with the GraphQL source keys stripped.
 *
 * Request bodies became committed content the moment `setup-polly.ts` stopped blanking them, so they get the
 * same walk their responses have always had. A body that is not JSON (a sorted form-pair list is, a
 * `[REDACTED_BODY]` marker is not) is skipped; its safety rests on the projection, which keeps nothing it
 * could not classify.
 */
function jsonRequestBodies({ file }: { file: string }): readonly unknown[] {
  const har = parseOwnJson<{
    log?: { entries?: { request?: { postData?: { mimeType?: string; text?: string } } }[] };
  }>({
    text: readFileSync(file, "utf8"),
  });
  const bodies: unknown[] = [];
  const entries = har.log?.entries;
  if (entries === undefined) {
    return bodies; // a HAR with no entry list at all — nothing to walk
  }
  for (const entry of entries) {
    const text = entry.request?.postData?.text?.trim();
    if (text === undefined || !(text.startsWith("{") || text.startsWith("["))) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const isForm = entry.request?.postData?.mimeType?.toLowerCase().includes(FORM_MIME) === true;
      bodies.push(requestBodyToWalk({ isForm, parsed }));
    } catch {
      // not JSON after all — the projection kept nothing structural, so there is nothing to walk
    }
  }
  return bodies;
}

/** The content type the Slack Web API client sends every write as, which the recorder projects to pairs. */
const FORM_MIME = "application/x-www-form-urlencoded";

/**
 * Read a projected form body — `cassetteRequestBody.ts`'s sorted `[name, value]` pair list — as one single-field
 * object per pair, so each value is judged under its own field name and each name is judged as an object key,
 * the same two checks a JSON body gets. Walked as bare arrays, every field NAME read as an unkeyed string and was
 * flagged, while a value lost the name its keep-key verdict depends on. Anything not shaped as pairs is returned
 * unchanged and walked as it stands.
 */
function formPairsAsFields({ value }: { value: unknown }): unknown {
  const isPairList =
    Array.isArray(value) &&
    value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string");
  if (!isPairList) {
    return value;
  }
  return (value as readonly (readonly [string, unknown])[]).map(([name, inner]) => ({ [name]: inner }));
}

/**
 * What the walk judges of one parsed request body. Only a JSON body can be GraphQL, so only it loses its own
 * `query`/`operationName`: a form field named `query` is caller data and is judged like any other.
 */
function requestBodyToWalk({ isForm, parsed }: { isForm: boolean; parsed: unknown }): unknown {
  if (isForm) {
    return formPairsAsFields({ value: parsed });
  }
  return withoutGraphqlSource({ value: parsed });
}

/** Drop a GraphQL body's own `query`/`operationName`, recursively, leaving every variable in place. */
function withoutGraphqlSource({ value }: { value: unknown }): unknown {
  // A batch is a top-level list of operations; anything deeper is a variable, judged whatever its name.
  if (Array.isArray(value)) {
    return value.map((entry) => withoutOperationSource({ value: entry }));
  }
  return withoutOperationSource({ value });
}

/**
 * Drop one GraphQL operation's own `query`/`operationName` and nothing beneath it: a variable that happens to be
 * named `query` is caller data, and stripping the name at every depth let its value pass unjudged.
 */
function withoutOperationSource({ value }: { value: unknown }): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  // Only an object carrying a string `query` is a GraphQL operation; any other body keeps every field, an
  // `operationName` included.
  const entries = Object.entries(value);
  const isOperation = entries.some(([key, inner]) => key.toLowerCase() === "query" && typeof inner === "string");
  if (!isOperation) {
    return value;
  }
  return Object.fromEntries(entries.filter(([key]) => !GRAPHQL_SOURCE_KEYS.has(key.toLowerCase())));
}

/** Every request URL recorded in a `.har`. */
function requestUrls({ file }: { file: string }): readonly string[] {
  const har = parseOwnJson<{ log?: { entries?: { request?: { url?: string } }[] } }>({
    text: readFileSync(file, "utf8"),
  });
  const entries = har.log?.entries;
  if (entries == null) {
    return []; // a HAR with no entry list at all recorded no request
  }
  return entries.map((entry) => entry.request?.url).filter((url): url is string => url !== undefined);
}

/**
 * Every non-empty `response.redirectURL` in a `.har` — the `Location` header's second copy.
 *
 * The same shape as the cookies below: the header allowlist drops `location`, and Polly writes the same
 * value into this field, which no walk read. A redirect cannot replay (the header it needs is gone), so this
 * is dead data that can still carry a signed URL.
 */
function redirectUrls({ file }: { file: string }): readonly string[] {
  const har = parseOwnJson<{ log?: { entries?: { response?: { redirectURL?: string } }[] } }>({
    text: readFileSync(file, "utf8"),
  });
  const entries = har.log?.entries;
  if (entries === undefined) {
    return [];
  }
  return entries
    .map((entry) => entry.response?.redirectURL)
    .filter((url): url is string => url !== undefined && url.length > 0);
}

/** Every header name in a `.har` that is NOT on its allowlist, as `request:<name>` / `response:<name>`. */
function disallowedHeadersInFile({ file }: { file: string }): readonly string[] {
  const har = parseOwnJson<{
    log?: {
      entries?: {
        request?: { headers?: { name: string }[] };
        response?: { headers?: { name: string }[] };
      }[];
    };
  }>({ text: readFileSync(file, "utf8") });
  const hits: string[] = [];
  const entries = har.log?.entries;
  if (entries == null) {
    return hits; // a HAR with no entry list at all carries no header
  }
  for (const entry of entries) {
    for (const kind of ["request", "response"] as const) {
      hits.push(...disallowedHeaderNames({ headers: entry[kind]?.headers, kind }));
    }
  }
  return hits;
}

/** Every header name in a `.har`, allowlisted or not, as `request:<name>` / `response:<name>`. */
function headerNamesInFile({ file }: { file: string }): readonly string[] {
  const har = parseOwnJson<{
    log?: { entries?: { request?: { headers?: { name: string }[] }; response?: { headers?: { name: string }[] } }[] };
  }>({ text: readFileSync(file, "utf8") });
  const entries = har.log?.entries;
  if (entries == null) {
    return []; // a HAR with no entry list at all carries no header
  }
  return entries.flatMap((entry) =>
    (["request", "response"] as const).flatMap((kind) => {
      const headers = entry[kind]?.headers;
      if (headers == null) {
        return [];
      }
      return headers.map((header) => `${kind}:${header.name.toLowerCase()}`);
    }),
  );
}

/** One direction's off-allowlist header names, tagged `<kind>:<name>` — the per-entry half of the walk above. */
function disallowedHeaderNames({
  headers,
  kind,
}: {
  headers: { name: string }[] | undefined;
  kind: "request" | "response";
}): readonly string[] {
  if (headers == null) {
    return []; // a direction that recorded no header list carries no header to judge
  }
  return headers
    .filter((header) => !isAllowedCassetteHeader({ kind, name: header.name }))
    .map((header) => `${kind}:${header.name.toLowerCase()}`);
}

/** One direction's unredacted cookies, tagged `<kind>:<name>` — the per-entry half of the walk below. */
function unredactedCookieNames({
  cookies,
  kind,
}: {
  cookies: HarCookie[] | undefined;
  kind: "request" | "response";
}): readonly string[] {
  if (cookies === undefined) {
    return [];
  }
  return cookies.filter((cookie) => !isRedactedCassetteCookie({ cookie })).map((cookie) => `${kind}:${cookie.name}`);
}

/**
 * Every cookie in a `.har` whose value is not the placeholder, as `request:<name>` / `response:<name>`.
 *
 * A HAR carries `Set-Cookie` twice and the header allowlist above reaches only one copy: Polly's persister
 * parses the same header into `cookies[]`, which no walk here used to read. That is the gap this closes.
 */
function unredactedCookiesInFile({ file }: { file: string }): readonly string[] {
  const har = parseOwnJson<{
    log?: {
      entries?: {
        request?: { cookies?: HarCookie[] };
        response?: { cookies?: HarCookie[] };
      }[];
    };
  }>({ text: readFileSync(file, "utf8") });
  const entries = har.log?.entries;
  if (entries === undefined) {
    return [];
  }
  return entries.flatMap((entry) =>
    (["request", "response"] as const).flatMap((kind) =>
      unredactedCookieNames({ cookies: entry[kind]?.cookies, kind }),
    ),
  );
}

/** A request URL or redirect URL whose path carries an opaque (identifier-bearing) segment. */
function unsafePathsInFile({ file }: { file: string }): readonly string[] {
  return [...requestUrls({ file }), ...redirectUrls({ file })].filter((url) => {
    const parsed = parseHttpUrl({ url });
    return parsed !== undefined && !isSafeRequestPath({ path: parsed.pathname });
  });
}

describe("committed cassette tripwire", () => {
  it("finds committed cassettes to walk at all — the guard against a silently empty walk", () => {
    expect(committedCassettes().length).toBeGreaterThan(0);
  });

  // The per-field guards: a cassette set can be non-empty and still carry no request body or no header, and
  // then the request-body and header walks below would each assert `[]` of nothing. The safe fixture carries
  // one of each, so both walks always judge something.
  it("finds a committed REQUEST body for the request walk to judge", () => {
    expect(committedCassettes().flatMap((file) => jsonRequestBodies({ file })).length).toBeGreaterThan(0);
  });

  it("finds a committed header in each direction for the allowlist walk to judge", () => {
    expect(headerNamesInFile({ file: SAFE_FIXTURE })).toEqual(["request:content-type", "response:content-type"]);
  });

  it("finds no unsafe value in the safe fixture", () => {
    expect(unsafeInFile({ file: SAFE_FIXTURE })).toEqual([]);
  });

  it("flags a planted unsafe value in a cloned fixture", () => {
    const har = parseOwnJson<{ log: { entries: { response: { content: { text: string } } }[] } }>({
      text: readFileSync(SAFE_FIXTURE, "utf8"),
    });
    har.log.entries[0]!.response.content.text = JSON.stringify({ messages: [{ author: "Jane Doe" }], ok: true });
    const bodies = har.log.entries.map((e) => JSON.parse(e.response.content.text) as unknown);
    const hits = bodies.flatMap((b) => findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: b }));
    expect(hits).toContainEqual({ key: "author", path: "$.messages[0].author", value: "Jane Doe" });
  });

  it("finds no unsafe value in any COMMITTED cassette", () => {
    const hits = committedCassettes().flatMap((file) => unsafeInFile({ file }));
    expect(hits).toEqual([]);
  });

  // Request bodies are committed content now that a cassette records what was sent, so the walk that has
  // always guarded the inbound half guards the outbound one on the same terms.
  it("finds no unsafe value in any COMMITTED cassette's REQUEST bodies", () => {
    const hits = committedCassettes().flatMap((file) =>
      jsonRequestBodies({ file }).flatMap((body) =>
        findUnsafeValues({ allKeepKeys: REQUEST_KEEP_KEYS, value: body }).map((hit) => ({ ...hit, file })),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("flags a planted identifier in a request body, so the request walk is falsifiable", () => {
    const planted = { variables: { teamId: "550e8400-e29b-41d4-a716-446655440000" } };
    expect(findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: planted })).toEqual([
      { key: "teamId", path: "$.variables.teamId", value: "550e8400-e29b-41d4-a716-446655440000" },
    ]);
  });

  it("judges a projected form body by field name, and still flags a planted value or an id-shaped name", () => {
    const channelId = `C${"0001AB0"}`;
    const projected = [
      ["channel", "[REDACTED_ID]"],
      ["name", "Jane Doe"],
      [channelId, "[REDACTED]"],
      ["query", "Jane Doe"],
    ];
    const value = requestBodyToWalk({ isForm: true, parsed: projected });
    const hits = findUnsafeValues({ allKeepKeys: REQUEST_KEEP_KEYS, value });
    expect(hits).toEqual([
      { key: "name", path: "$[1].name", value: "Jane Doe" },
      { key: channelId, path: `$[2].${channelId}`, value: channelId },
      { key: "query", path: "$[3].query", value: "Jane Doe" },
    ]);
  });

  it("keeps a GraphQL body's own query text, which is this repository's source rather than caller data", () => {
    const body = { operationName: null, query: "query Q { viewer { id } }", variables: { first: 5 } };
    expect(withoutGraphqlSource({ value: body })).toEqual({ variables: { first: 5 } });
  });

  it("still judges a variable named query, dropping only each operation's own source", () => {
    const single = { operationName: "Q", query: "query Q($query: String!) { a }", variables: { query: "Jane Doe" } };
    const value = requestBodyToWalk({ isForm: false, parsed: [single] });
    expect(value).toEqual([{ variables: { query: "Jane Doe" } }]);
    expect(findUnsafeValues({ allKeepKeys: REQUEST_KEEP_KEYS, value })).toEqual([
      { key: "query", path: "$[0].variables.query", value: "Jane Doe" },
    ]);
  });

  it("keeps an operationName on a JSON body that carries no GraphQL query", () => {
    const value = requestBodyToWalk({ isForm: false, parsed: { operationName: "Jane Doe", payload: true } });
    expect(findUnsafeValues({ allKeepKeys: REQUEST_KEEP_KEYS, value })).toEqual([
      { key: "operationName", path: "$.operationName", value: "Jane Doe" },
    ]);
  });

  it("flags an id-shaped object KEY (a write response keys its shares map by channel id)", () => {
    const channelId = `D${"0001AB0"}`;
    const body = { ok: true, shares: { private: { [channelId]: [{ ts: "1720000000.000100" }] } } };
    const hits = findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: body });
    expect(hits).toEqual([{ key: channelId, path: `$.shares.private.${channelId}`, value: channelId }]);
  });

  it("does not flag field-name keys", () => {
    const body = { files: [{ mimetype: "image/png", thread_ts: "1720000000.000100" }], ok: true };
    expect(findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: body })).toEqual([]);
  });

  // Request paths are checked as well as response bodies: Slack's one-time upload URL carries a base64 path
  // that DECODES to real team/user/file ids, which a value-only walk (and a literal known-value scan) misses.
  it("finds no opaque request path in any COMMITTED cassette", () => {
    const hits = committedCassettes().flatMap((file) => unsafePathsInFile({ file }).map((url) => ({ file, url })));
    expect(hits).toEqual([]);
  });

  it("finds no opaque request path in the safe fixture", () => {
    expect(unsafePathsInFile({ file: SAFE_FIXTURE })).toEqual([]);
  });

  // Headers were the third place an identifier could hide: a provider's response headers carry per-request
  // trace ids, backend hostnames, and (worse, if it ever appeared) a `set-cookie` or a redirect `location`.
  it("keeps only allowlisted headers in every COMMITTED cassette", () => {
    const hits = committedCassettes().flatMap((file) =>
      disallowedHeadersInFile({ file }).map((header) => ({ file, header })),
    );
    expect(hits).toEqual([]);
  });

  it("keeps only allowlisted headers in the safe fixture", () => {
    expect(disallowedHeadersInFile({ file: SAFE_FIXTURE })).toEqual([]);
  });

  // Cookies are the fourth place, and the one the header check above cannot reach: the comment on that check
  // names a stray `set-cookie` as the worst thing a header could carry, and Polly parses exactly that header
  // into `cookies[]` as well. MEASURED once: 66 full-length `__cf_bm` values across 30
  // committed HARs, every one of them in a recording whose response headers were already stripped to
  // `content-type`.
  it("blanks every cookie value in every COMMITTED cassette", () => {
    const hits = committedCassettes().flatMap((file) =>
      unredactedCookiesInFile({ file }).map((cookie) => ({ cookie, file })),
    );
    expect(hits).toEqual([]);
  });

  it("blanks every cookie value in the safe fixture", () => {
    expect(unredactedCookiesInFile({ file: SAFE_FIXTURE })).toEqual([]);
  });

  // The witness for the check above: the safe fixture CARRIES a cookie in both directions, so the two
  // `toEqual([])`s are evidence rather than silence — planting a real value in a clone reddens them.
  // The witness for the redirect half of the path walk: the safe fixture CARRIES a redirect URL, so the two
  // path assertions above are evidence rather than silence for this field too.
  it("flags a planted opaque redirect URL in a cloned fixture", () => {
    const har = parseOwnJson<{ log: { entries: { response: { redirectURL?: string } }[] } }>({
      text: readFileSync(SAFE_FIXTURE, "utf8"),
    });
    har.log.entries[0]!.response.redirectURL = "https://slack.com/files/T0001AB0/F0001AB0/planted.png";
    const planted = join(PLANTED_DIR, "redirect.har");
    writeFileSync(planted, JSON.stringify(har));
    expect(unsafePathsInFile({ file: planted })).toEqual(["https://slack.com/files/T0001AB0/F0001AB0/planted.png"]);
  });

  it("flags a planted off-allowlist header in a cloned fixture", () => {
    const har = parseOwnJson<{
      log: { entries: { response: { headers?: { name: string; value: string }[] } }[] };
    }>({ text: readFileSync(SAFE_FIXTURE, "utf8") });
    har.log.entries[1]!.response.headers = [{ name: "X-Request-Id", value: "planted" }];
    const planted = join(PLANTED_DIR, "header.har");
    writeFileSync(planted, JSON.stringify(har));
    expect(disallowedHeadersInFile({ file: planted })).toEqual(["response:x-request-id"]);
  });

  it("flags a planted cookie value in a cloned fixture", () => {
    const har = parseOwnJson<{
      log: { entries: { response: { cookies?: { name: string; value: string }[] } }[] };
    }>({ text: readFileSync(SAFE_FIXTURE, "utf8") });
    har.log.entries[0]!.response.cookies = [{ name: "__cf_bm", value: `${"A".repeat(60)}.planted` }];
    const planted = join(PLANTED_DIR, "recording.har");
    writeFileSync(planted, JSON.stringify(har));
    expect(unredactedCookiesInFile({ file: planted })).toEqual(["response:__cf_bm"]);
  });
});
