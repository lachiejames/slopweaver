import { describe, expect, it } from "vitest";
import { isRecord } from "../../lib/parsers.js";
import { unwrap } from "../../lib/result.js";
import {
  cassetteRedact,
  cursorMapKey,
  isSyntheticCursor,
  redactQueryValue,
  redactRequestPath,
  redactRequestQuery,
  redactRequestUrl,
  syntheticCursorFor,
} from "../cassetteRedact.js";
import {
  CASSETTE_CONFIGS,
  isIdQueryParamName,
  isSafeRequestPath,
  OPAQUE_QUERY_VALUE,
  providerForUrl,
} from "../cassetteRedactConfig.js";
import { EMPTY_ID_MAP } from "../cassetteRedactTypes.js";

/** A 32-hex opaque account id, assembled at runtime so this file stays hygiene-clean. */
const OPAQUE_ACCOUNT_ID = "0123456789abcdef".repeat(2);

/** Slack's one-time upload path, assembled at runtime so this file stays hygiene-clean. */
const OPAQUE_UPLOAD_PATH = `/upload/v1/${"CwABAAAAYwoAAW6o7o"}${"-Tv2aZCgACGMWtaJ06XtAMAAMLAAEAAAALRTA4VUdVTkE4RUE"}`;

const slack = CASSETTE_CONFIGS.slack;

/** Redact a value through the slack config with no known-values, returning the parsed redacted body + map. */
function redactSlack({
  value,
  idMap = EMPTY_ID_MAP,
  knownValues = [] as readonly string[],
}: {
  value: unknown;
  idMap?: typeof EMPTY_ID_MAP;
  knownValues?: readonly string[];
}): { body: unknown; next: number } {
  const out = unwrap(cassetteRedact({ body: JSON.stringify(value), config: slack, idMap, knownValues }));
  return { body: JSON.parse(out.body) as unknown, next: out.idMap.next };
}

describe("cassetteRedact (allowlist)", () => {
  it("blanks every non-allowlisted string, keeps non-strings + keepKey/id/url values", () => {
    const { body } = redactSlack({
      value: {
        active: true,
        channel: "U0001A",
        count: 3,
        name: "secret channel",
        note: null,
        text: "confidential message",
        ts: "1720000000.000100",
        type: "message",
        url: "https://acmecorp.slack.com/archives/x/p123",
        user: "U0001A",
        uuid_thing: "12345678-1234-4234-9234-123456789abc",
      },
    });
    expect(body).toEqual({
      active: true,
      channel: "id_1", // SAME real id under a different key → SAME synthetic (referential)
      count: 3,
      name: "[REDACTED]",
      note: null,
      text: "[REDACTED]",
      ts: "1720000000.000100", // keepKey → verbatim
      type: "message", // keepKey → verbatim
      url: "https://redacted.invalid/[REDACTED]", // urlKey, workspace subdomain → collapsed
      user: "id_1", // idKey → synthetic
      uuid_thing: "[REDACTED]",
    });
  });

  it("keeps a public URL host but blanks its path", () => {
    const { body } = redactSlack({ value: { url: "https://slack.com/api/x?token=abc" } });
    expect(body).toEqual({ url: "https://slack.com/[REDACTED]" });
  });

  it("assigns distinct synthetic ids to distinct real ids", () => {
    const { body, next } = redactSlack({ value: { a: { user: "U0001A" }, b: { user: "U0002B" } } });
    expect(body).toEqual({ a: { user: "id_1" }, b: { user: "id_2" } });
    expect(next).toBe(3);
  });

  it("keeps synthetic ids STABLE across calls when the id-map is threaded", () => {
    const first = unwrap(
      cassetteRedact({ body: JSON.stringify({ user: "U0001A" }), config: slack, idMap: EMPTY_ID_MAP, knownValues: [] }),
    );
    const second = unwrap(
      cassetteRedact({ body: JSON.stringify({ user: "U0001A" }), config: slack, idMap: first.idMap, knownValues: [] }),
    );
    expect(JSON.parse(second.body)).toEqual({ user: "id_1" });
    expect(second.idMap.next).toBe(2); // no new id assigned
  });

  it("blanks a known-sensitive literal even inside a kept (keepKey) value", () => {
    const { body } = redactSlack({ knownValues: ["Acme"], value: { type: "Acme daily standup" } });
    expect(body).toEqual({ type: "[REDACTED] daily standup" });
  });

  it("scrubs a non-JSON body via the generic backstop", () => {
    const out = unwrap(
      cassetteRedact({ body: `raw ${"U"}0001A0000 text`, config: slack, idMap: EMPTY_ID_MAP, knownValues: [] }),
    );
    expect(out.body).toBe("raw REDACTEDID text");
  });
});

/**
 * An id can sit in the KEY position, not only the value position: an outbound `files.uploadV2` response keys
 * its `shares` map BY CHANNEL ID. These cover that (the PR5 tooling extension).
 */
describe("cassetteRedact — object keys", () => {
  it("maps an id-shaped object KEY to a synthetic id", () => {
    const { body } = redactSlack({ value: { shares: { private: { D0001AB: [{ ts: "1720000000.000100" }] } } } });
    expect(body).toEqual({ shares: { private: { id_1: [{ ts: "1720000000.000100" }] } } });
  });

  it("keeps snake_case and camelCase field names verbatim", () => {
    const { body } = redactSlack({ value: { __typename: "X", createdAt: "2026-07-26T00:00:00Z", thread_ts: "1.2" } });
    if (!isRecord(body)) {
      throw new Error("expected redactSlack to return an object");
    }
    expect(Object.keys(body).toSorted()).toEqual(["__typename", "createdAt", "thread_ts"]);
  });

  it("gives an id the SAME synthetic whether it appears as a key or as a value", () => {
    const { body } = redactSlack({ value: { channel: "D0001AB", shares: { public: { D0001AB: [] } } } });
    expect(body).toEqual({ channel: "id_1", shares: { public: { id_1: [] } } });
  });

  it("maps a channel-NAME key (dashes ⇒ not a field name) rather than keeping it", () => {
    const { body } = redactSlack({ value: { "team-private-chat": 1 } });
    expect(body).toEqual({ id_1: 1 });
  });

  it("keeps GitHub's non-word reaction keys, which are content rather than identifiers", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ reactions: { "-1": 0, "+1": 2 } }),
        config: CASSETTE_CONFIGS.github,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toEqual({ reactions: { "-1": 0, "+1": 2 } });
  });

  it("still applies the ORIGINAL key's allowlist behaviour to the child value", () => {
    const { body } = redactSlack({ value: { D0001AB: { text: "secret", ts: "1720000000.000100" } } });
    expect(body).toEqual({ id_1: { text: "[REDACTED]", ts: "1720000000.000100" } });
  });
});

/**
 * Request PATHS: Slack's `files.uploadV2` uploads to a one-time URL whose 179-character path base64-ENCODES
 * the real team/user/file ids — invisible to a value walk and to a literal known-value scan.
 */
describe("redactRequestPath", () => {
  it("keeps a Slack API route verbatim (it is the replay match key)", () => {
    expect(redactRequestPath({ path: "/api/chat.postMessage" })).toBe("/api/chat.postMessage");
  });

  it("keeps a GitHub REST route verbatim", () => {
    expect(redactRequestPath({ path: "/repos/octocat/Hello-World" })).toBe("/repos/octocat/Hello-World");
  });

  it("keeps a GraphQL route verbatim", () => {
    expect(redactRequestPath({ path: "/graphql" })).toBe("/graphql");
  });

  it("COLLAPSES an opaque upload path", () => {
    expect(redactRequestPath({ path: OPAQUE_UPLOAD_PATH })).toBe("/[REDACTED]");
  });

  it("is idempotent over an already-collapsed path (so replay matches record)", () => {
    expect(redactRequestPath({ path: "/[REDACTED]" })).toBe("/[REDACTED]");
  });

  it("collapses a path carrying a UUID segment", () => {
    const uuid = `${"12345678"}-${"1234"}-${"4234"}-${"9234"}-${"123456789abc"}`;
    expect(redactRequestPath({ path: `/v1/pages/${uuid}` })).toBe("/[REDACTED]");
  });

  it("keeps the root path", () => {
    expect(redactRequestPath({ path: "/" })).toBe("/");
  });
});

describe("the Gmail header-name allowlist", () => {
  it("keeps a header name a parser reads", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ headers: [{ name: "Subject", value: "the real subject" }] }),
        config: CASSETTE_CONFIGS.gmail,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ headers: [{ name: "Subject", value: "[REDACTED]" }] });
  });

  it("REDACTS a header name that fingerprints infrastructure, even though the key is the same", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ headers: [{ name: "X-NIGHTFALL-SCANNED", value: "yes" }] }),
        config: CASSETTE_CONFIGS.gmail,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ headers: [{ name: "[REDACTED]", value: "[REDACTED]" }] });
  });

  it("leaves another provider's `name` field governed by its own key rules", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ name: "anything" }),
        config: CASSETTE_CONFIGS.slack,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ name: "[REDACTED]" });
  });
});

describe("the Datadog value-scoped `type` allowlist", () => {
  it("keeps a metrics-scalar column's single-token type discriminator", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ type: "number" }),
        config: CASSETTE_CONFIGS.datadog,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ type: "number" });
  });

  it("REDACTS a monitor's own multi-word type, even though the key is the same", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ type: "query alert" }),
        config: CASSETTE_CONFIGS.datadog,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ type: "[REDACTED]" });
  });

  it("keeps overall_state as the WIRE (snake_case) key, never the SDK's camelCased one", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ overallState: "OK", overall_state: "OK" }),
        config: CASSETTE_CONFIGS.datadog,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    expect(JSON.parse(out.body)).toStrictEqual({ overallState: "[REDACTED]", overall_state: "OK" });
  });
});

describe("providerForUrl", () => {
  it("claims each provider's own host", () => {
    expect(providerForUrl({ url: "https://slack.com/api/chat.postMessage" })).toBe("slack");
    expect(providerForUrl({ url: "https://api.linear.app/graphql" })).toBe("linear");
    expect(providerForUrl({ url: "https://api.github.com/search/issues" })).toBe("github");
    expect(providerForUrl({ url: "https://gmail.googleapis.com/gmail/v1/users/me/messages" })).toBe("gmail");
    expect(providerForUrl({ url: "https://accounts.google.com/o/oauth2/v2/auth" })).toBe("gmail");
    // A regional site (`ap2.datadoghq.com`) is a SUBDOMAIN of the base `datadoghq.com` entry, not a literal
    // match — this is what `DD_SITES`' nine sites collapse onto three `PROVIDER_DOMAINS` entries for.
    expect(providerForUrl({ url: "https://api.ap2.datadoghq.com/api/v1/validate" })).toBe("datadog");
    expect(providerForUrl({ url: "https://api.datadoghq.eu/api/v1/monitor" })).toBe("datadog");
  });

  it("refuses a look-alike host that merely ENDS with a provider's name", () => {
    expect(providerForUrl({ url: "https://notgithub.com/x" })).toBe(undefined);
  });

  it("refuses a hostile host that merely CONTAINS a provider's domain", () => {
    expect(providerForUrl({ url: "https://slack.com.evil.test/api" })).toBe(undefined);
  });

  it("does not let a provider's domain in a QUERY PARAMETER claim another host's recording", () => {
    expect(providerForUrl({ url: "https://example.test/redirect?to=https://slack.com/api" })).toBe(undefined);
  });

  it("returns undefined for a non-provider host, which is what leaves it unredacted BY DECISION", () => {
    expect(providerForUrl({ url: "https://example.test/anything" })).toBe(undefined);
  });
});

describe("isSafeRequestPath", () => {
  it("accepts every route the connectors actually call", () => {
    const routes = ["/api/conversations.history", "/graphql", "/search/issues", "/v1/messages", "/[REDACTED]"];
    expect(routes.filter((path) => !isSafeRequestPath({ path }))).toEqual([]);
  });

  it("rejects the opaque upload path", () => {
    expect(isSafeRequestPath({ path: OPAQUE_UPLOAD_PATH })).toBe(false);
  });

  it("rejects a Gmail message id, which is only sixteen hex characters and reads as a route without this", () => {
    expect(isSafeRequestPath({ path: "/gmail/v1/users/me/messages/1a040f3c0bfaa311" })).toBe(false);
  });

  it("still accepts a hex-lettered route name, because a route is not an unbroken hex run", () => {
    expect(isSafeRequestPath({ path: "/api/conversations.history" })).toBe(true);
    expect(isSafeRequestPath({ path: "/decaf" })).toBe(true);
  });
});

describe("redactRequestUrl", () => {
  it("collapses an opaque path and drops its query with it", () => {
    expect(redactRequestUrl({ url: `https://files.slack.com${OPAQUE_UPLOAD_PATH}?t=abc` })).toBe(
      "https://files.slack.com/[REDACTED]",
    );
  });

  it("leaves a route-shaped URL — including its query — untouched", () => {
    expect(redactRequestUrl({ url: "https://api.github.com/search/issues?q=repo%3Aoctocat%2FHello-World" })).toBe(
      "https://api.github.com/search/issues?q=repo%3Aoctocat%2FHello-World",
    );
  });

  it("preserves the origin exactly", () => {
    expect(redactRequestUrl({ url: "https://slack.com/api/chat.postMessage" })).toBe(
      "https://slack.com/api/chat.postMessage",
    );
  });

  it("returns a non-absolute URL unchanged for the generic scrub to handle", () => {
    expect(redactRequestUrl({ url: "not-a-url" })).toBe("not-a-url");
  });

  it("blanks an opaque id riding in a query slot while a route-shaped path is kept", () => {
    expect(
      redactRequestUrl({ url: `https://api.cloudflare.com/client/v4/zones?account.id=${OPAQUE_ACCOUNT_ID}` }),
    ).toBe("https://api.cloudflare.com/client/v4/zones?account.id=REDACTED_ID");
  });

  it("keeps every other parameter of the same query, in place", () => {
    expect(
      redactRequestUrl({ url: `https://api.cloudflare.com/client/v4/zones?account.id=${OPAQUE_ACCOUNT_ID}&page=2` }),
    ).toBe("https://api.cloudflare.com/client/v4/zones?account.id=REDACTED_ID&page=2");
  });

  it("is idempotent over an already-redacted query", () => {
    const once = redactRequestUrl({
      url: `https://api.cloudflare.com/client/v4/zones?account.id=${OPAQUE_ACCOUNT_ID}`,
    });
    expect(redactRequestUrl({ url: once })).toBe(once);
  });
});

describe("isIdQueryParamName", () => {
  it("selects a name whose last word is id or ids, under any separator convention", () => {
    expect(isIdQueryParamName({ name: "id" })).toBe(true);
    expect(isIdQueryParamName({ name: "account.id" })).toBe(true);
    expect(isIdQueryParamName({ name: "account_id" })).toBe(true);
    expect(isIdQueryParamName({ name: "accountId" })).toBe(true);
    expect(isIdQueryParamName({ name: "labelIds" })).toBe(true);
  });

  it("rejects a name that merely contains id, or none at all", () => {
    expect(isIdQueryParamName({ name: "identity" })).toBe(false);
    expect(isIdQueryParamName({ name: "video" })).toBe(false);
    expect(isIdQueryParamName({ name: "page" })).toBe(false);
    expect(isIdQueryParamName({ name: "q" })).toBe(false);
  });
});

describe("redactQueryValue", () => {
  it("blanks an opaque value under an id-named parameter", () => {
    expect(redactQueryValue({ name: "account.id", value: OPAQUE_ACCOUNT_ID })).toBe(OPAQUE_QUERY_VALUE);
  });

  it("keeps a route-shaped value even under an id-named parameter, so a cassette stays readable", () => {
    expect(redactQueryValue({ name: "page_id", value: "2" })).toBe("2");
    expect(redactQueryValue({ name: "labelIds", value: "INBOX" })).toBe("INBOX");
  });

  it("keeps an opaque value under a parameter that is not an id — a search expression is not org data", () => {
    const query = "repo:octocat/Hello-World updated:2024-01-01..2024-01-02";
    expect(redactQueryValue({ name: "q", value: query })).toBe(query);
  });

  it("leaves its own placeholder alone, so a second pass changes nothing", () => {
    expect(redactQueryValue({ name: "account.id", value: OPAQUE_QUERY_VALUE })).toBe(OPAQUE_QUERY_VALUE);
  });
});

describe("redactRequestQuery", () => {
  it("returns an untouched query VERBATIM rather than re-serialising it", () => {
    // `URLSearchParams` normalises `%20` to `+` as it round-trips, so re-serialising unconditionally would
    // rewrite the query of every already-committed cassette on its next re-record.
    const search = "?order=desc&page=1&q=repo%3Aoctocat%2FHello-World%20updated%3A2024-01-01";
    expect(redactRequestQuery({ search })).toBe(search);
  });

  it("returns an empty query unchanged", () => {
    expect(redactRequestQuery({ search: "" })).toBe("");
  });
});

describe("cassetteRedact — a cursor keeps its identity", () => {
  const CURSOR_1 = "dXNlcjpVMDYxTkZUVDI=";
  const CURSOR_2 = "dXNlcjpVMDYxTkZUVDM=";

  it("mints a synthetic cursor_N for a cursorKey, distinguishable from an id", () => {
    const { body } = redactSlack({
      value: { members: [{ id: "U0001A" }], response_metadata: { next_cursor: CURSOR_1 } },
    });
    const parsed = body as { members: { id: string }[]; response_metadata: { next_cursor: string } };

    expect(parsed.members[0]!.id).toBe("id_1");
    expect(parsed.response_metadata.next_cursor).toBe("cursor_2");
  });

  it("keeps an EMPTY cursor empty — the provider's own last-page signal", () => {
    const { body } = redactSlack({ value: { response_metadata: { next_cursor: "" } } });

    expect((body as { response_metadata: { next_cursor: string } }).response_metadata.next_cursor).toBe("");
  });

  it("gives two pages two distinct identities and the same page the same one, across calls through the map", () => {
    const first = unwrap(
      cassetteRedact({
        body: JSON.stringify({ response_metadata: { next_cursor: CURSOR_1 } }),
        config: slack,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );
    const second = unwrap(
      cassetteRedact({
        body: JSON.stringify({ response_metadata: { next_cursor: CURSOR_2 } }),
        config: slack,
        idMap: first.idMap,
        knownValues: [],
      }),
    );
    const again = unwrap(
      cassetteRedact({
        body: JSON.stringify({ response_metadata: { next_cursor: CURSOR_1 } }),
        config: slack,
        idMap: second.idMap,
        knownValues: [],
      }),
    );

    expect(first.body).toBe('{"response_metadata":{"next_cursor":"cursor_1"}}');
    expect(second.body).toBe('{"response_metadata":{"next_cursor":"cursor_2"}}');
    expect(again.body).toBe('{"response_metadata":{"next_cursor":"cursor_1"}}');
    expect(again.idMap.next).toBe(3);
  });

  it("files a cursor in its own namespace, so it can be looked up by real value and never collides with an id", () => {
    const out = unwrap(
      cassetteRedact({
        body: JSON.stringify({ id: CURSOR_1, response_metadata: { next_cursor: CURSOR_1 } }),
        config: slack,
        idMap: EMPTY_ID_MAP,
        knownValues: [],
      }),
    );

    expect(out.body).toBe('{"id":"id_1","response_metadata":{"next_cursor":"cursor_2"}}');
    expect(syntheticCursorFor({ idMap: out.idMap, provider: "slack", real: CURSOR_1 })).toBe("cursor_2");
    expect(cursorMapKey({ provider: "slack", real: CURSOR_1 })).toBe(`slack\tcursor\t${CURSOR_1}`);
  });

  it("returns undefined for a cursor no recorded response has handed out", () => {
    expect(syntheticCursorFor({ idMap: EMPTY_ID_MAP, provider: "slack", real: CURSOR_1 })).toBe(undefined);
  });

  it("recognises exactly the synthetic form", () => {
    expect(isSyntheticCursor({ value: "cursor_12" })).toBe(true);
    expect(isSyntheticCursor({ value: "id_12" })).toBe(false);
    expect(isSyntheticCursor({ value: "[REDACTED]" })).toBe(false);
    expect(isSyntheticCursor({ value: CURSOR_1 })).toBe(false);
  });

  it("is still the safe default for a cursor-shaped value under a key that is NOT a cursorKey", () => {
    const { body } = redactSlack({ value: { bookmark: CURSOR_1 } });

    expect((body as { bookmark: string }).bookmark).toBe("[REDACTED]");
  });
});
