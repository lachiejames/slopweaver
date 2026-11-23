/**
 * Request-side cassette safety. Two independent properties, and they pull in opposite directions:
 * the MATCH key must be identical for a record run and a replay run that carry different real ids, while the
 * PERSISTED text must give up nothing. Both are asserted here, including the specific gap that motivated the
 * work — a lowercase UUID, which no generic leak class matches.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../lib/result.js";
import { cassetteRedact } from "../cassetteRedact.js";
import { CASSETTE_CONFIGS } from "../cassetteRedactConfig.js";
import { EMPTY_ID_MAP } from "../cassetteRedactTypes.js";
import {
  cursorMatchKey,
  isParentConnectionFollowup,
  matchableCursor,
  matchableGraphqlVariables,
  positionalIdentifiers,
  positionalUuids,
  redactGraphqlRequestBody,
} from "../cassetteRequestRedact.js";
import { scrubLeakClasses } from "../cassetteScrub.js";

const TEAM = "ff0ccd01-2ff2-41e6-bddd-1a2b3c4d5e6f";
const ISSUE = "752562e2-b5aa-5934-b0aa-03e0165a6196";

describe("the gap this exists to close", () => {
  it("confirms the generic leak classes do NOT catch a lowercase UUID", () => {
    // This is the whole reason the request lane needed its own redactor. If this test ever starts failing
    // because `scrubLeakClasses` grew a UUID rule, the extra layer here is still correct but no longer sole.
    expect(scrubLeakClasses({ text: TEAM })).toBe(TEAM);
  });

  it("catches it here", () => {
    expect(positionalUuids({ text: TEAM })).toBe("<uuid:1>");
  });
});

describe("positionalUuids", () => {
  it("numbers distinct ids by first appearance and reuses the number for a repeat", () => {
    expect(positionalUuids({ text: `${TEAM} ${ISSUE} ${TEAM}` })).toBe("<uuid:1> <uuid:2> <uuid:1>");
  });

  it("is case-insensitive about the same id", () => {
    expect(positionalUuids({ text: `${TEAM} ${TEAM.toUpperCase()}` })).toBe("<uuid:1> <uuid:1>");
  });

  it("leaves text with no ids untouched", () => {
    expect(positionalUuids({ text: '{"first":5,"after":"cursor"}' })).toBe('{"first":5,"after":"cursor"}');
  });
});

describe("matchableGraphqlVariables — the record/replay agreement", () => {
  const bodyWith = ({ team, issue }: { team: string; issue: string }): string =>
    JSON.stringify({
      operationName: "IssueCreate",
      query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success } }",
      variables: { input: { id: issue, teamId: team, title: "A title" } },
    });

  it("produces the SAME key for a real record run and a placeholder replay run", () => {
    // The property the whole write lane depends on. Record sends the real workspace's team id; replay has no
    // access to it and sends a placeholder. Without this they are different requests and nothing replays.
    const recorded = matchableGraphqlVariables({ body: bodyWith({ issue: ISSUE, team: TEAM }) });
    const replayed = matchableGraphqlVariables({
      body: bodyWith({ issue: "00000000-0000-4000-8000-000000000002", team: "00000000-0000-4000-8000-000000000001" }),
    });

    expect(recorded).toBe(replayed);
  });

  it("still separates two genuinely different operations", () => {
    // Collapsing ids must not collapse OPERATIONS — that would land two calls on one cassette entry and make
    // a two-call assertion pass on a single recorded success.
    const create = matchableGraphqlVariables({ body: bodyWith({ issue: ISSUE, team: TEAM }) });
    const other = matchableGraphqlVariables({
      body: JSON.stringify({
        operationName: "IssueDelete",
        query: "mutation IssueDelete($id: String!) { issueDelete(id: $id) { success } }",
        variables: { id: ISSUE },
      }),
    });

    expect(create).not.toBe(other);
  });

  it("still separates two pages of the same query", () => {
    const page1 = matchableGraphqlVariables({ body: JSON.stringify({ query: "q", variables: { first: 5 } }) });
    const page2 = matchableGraphqlVariables({
      body: JSON.stringify({ query: "q", variables: { after: "cursor", first: 5 } }),
    });

    expect(page1).not.toBe(page2);
  });
});

describe("matchableGraphqlVariables — the ParentConnection follow-up", () => {
  const PARENT_CONNECTION_QUERY =
    "query ParentConnection($id: String!, $after: String) { issue(id: $id) { comments(first: 25, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }";

  const followupBody = ({ id, after }: { id: string; after: string }): string =>
    JSON.stringify({ operationName: null, query: PARENT_CONNECTION_QUERY, variables: { after, id } });

  it("recognises the follow-up query by its text", () => {
    expect(isParentConnectionFollowup({ body: followupBody({ after: "cursor", id: ISSUE }) })).toBe(true);
  });

  it("does not recognise an unrelated query", () => {
    expect(isParentConnectionFollowup({ body: JSON.stringify({ query: "q", variables: {} }) })).toBe(false);
  });

  it("produces the SAME key for a real record run and the redacted values replay actually sends", () => {
    // Record: a real UUID issue id and a real, UUID-embedding cursor. Replay: whatever the PARENT response's
    // allowlist redaction left behind — a stable synthetic id and a blanket "[REDACTED]" cursor, per the
    // cassette-followup-cursor-redaction-gap doc. Neither pair is UUID-shaped the same way, so only the
    // sentinel makes them agree.
    const recorded = matchableGraphqlVariables({
      body: followupBody({ after: TEAM, id: ISSUE }),
    });
    const replayed = matchableGraphqlVariables({
      body: followupBody({ after: "[REDACTED]", id: "id_236" }),
    });

    expect(recorded).toBe(replayed);
  });

  it("still separates the follow-up from an unrelated GraphQL operation", () => {
    const followup = matchableGraphqlVariables({ body: followupBody({ after: "cursor", id: ISSUE }) });
    const other = matchableGraphqlVariables({
      body: JSON.stringify({
        operationName: null,
        query: "query IssueReadBack($id: String!) { issue(id: $id) { id } }",
        variables: { id: ISSUE },
      }),
    });

    expect(followup).not.toBe(other);
  });

  it("leaves a root-level page's own real cursor alone, so two root pages stay distinct", () => {
    // Option B's own trap: sentinelling must be scoped to the ParentConnection query text, never to the
    // variable name `after` on its own, or a root query's page 2 and page 3 would collide.
    const page2 = matchableGraphqlVariables({ body: JSON.stringify({ query: "q", variables: { after: "cursor-2" } }) });
    const page3 = matchableGraphqlVariables({ body: JSON.stringify({ query: "q", variables: { after: "cursor-3" } }) });

    expect(page2).not.toBe(page3);
  });
});

describe("redactGraphqlRequestBody — the committed text", () => {
  const created = JSON.stringify({
    operationName: "IssueCreate",
    query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success } }",
    variables: {
      input: {
        description: "## Problem\n\nSomething confidential about a real customer.",
        id: ISSUE,
        labelIds: ["b1a2c3d4-1111-4222-8333-444455556666"],
        teamId: TEAM,
        title: "A real ticket title",
      },
    },
  });

  it("blanks the description, which is the largest private payload in a write", () => {
    const out = redactGraphqlRequestBody({ body: created });

    expect(out.includes("confidential")).toBe(false);
    expect(out.includes("A real ticket title")).toBe(false);
  });

  it("blanks every real UUID, including one nested in an array", () => {
    const out = redactGraphqlRequestBody({ body: created });

    expect(out.includes(TEAM)).toBe(false);
    expect(out.includes(ISSUE)).toBe(false);
    expect(out.includes("b1a2c3d4-1111-4222-8333-444455556666")).toBe(false);
  });

  it("KEEPS the query, which we wrote and which makes a cassette reviewable", () => {
    expect(redactGraphqlRequestBody({ body: created })).toContain("mutation IssueCreate");
  });

  it("keeps structural paging values so a read cassette stays legible", () => {
    const out = redactGraphqlRequestBody({
      body: JSON.stringify({ query: "q", variables: { filter: { updatedAt: { gte: "2020-01-01" } }, first: 5 } }),
    });

    expect(out).toContain('"first":5');
    expect(out).toContain("2020-01-01");
  });

  it("refuses to keep anything from a body it cannot parse", () => {
    expect(redactGraphqlRequestBody({ body: "not json at all" })).toBe("[REDACTED]");
  });

  it("refuses a JSON body that is not a GraphQL request", () => {
    expect(redactGraphqlRequestBody({ body: JSON.stringify({ secret: "value" }) })).toBe("[REDACTED]");
  });

  it("replaces a non-field-shaped KEY, which can itself be an identifier", () => {
    const out = redactGraphqlRequestBody({
      body: JSON.stringify({ query: "q", variables: { [TEAM]: "value" } }),
    });

    expect(out.includes(TEAM)).toBe(false);
    expect(out).toContain("[REDACTED_KEY]");
  });
});

describe("matchableCursor — record and replay agree exactly when the follow-up carries the handed-out bookmark", () => {
  const REAL = "dXNlcjpVMDYxTkZUVDI=";
  const mapAfterPageOne = unwrap(
    cassetteRedact({
      body: JSON.stringify({ response_metadata: { next_cursor: REAL } }),
      config: CASSETTE_CONFIGS.slack,
      idMap: EMPTY_ID_MAP,
      knownValues: [],
    }),
  ).idMap;

  it("resolves a record run's real cursor to the identity page one minted", () => {
    expect(matchableCursor({ idMap: mapAfterPageOne, provider: "slack", value: REAL })).toBe("cursor_1");
  });

  it("passes a replay run's synthetic cursor through, with no map at all", () => {
    expect(matchableCursor({ idMap: EMPTY_ID_MAP, provider: "slack", value: "cursor_1" })).toBe("cursor_1");
  });

  it("collapses a cursor nobody handed out to a fixed sentinel, never the raw value", () => {
    expect(matchableCursor({ idMap: EMPTY_ID_MAP, provider: "slack", value: REAL })).toBe("<cursor:unmapped>");
    expect(matchableCursor({ idMap: mapAfterPageOne, provider: "slack", value: "[REDACTED]" })).toBe(
      "<cursor:unmapped>",
    );
  });

  it("keeps providers' namespaces apart", () => {
    expect(matchableCursor({ idMap: mapAfterPageOne, provider: "notion", value: REAL })).toBe("<cursor:unmapped>");
  });
});

describe("cursorMatchKey — where a client sends a cursor back", () => {
  const REAL = "dXNlcjpVMDYxTkZUVDI=";
  const slackMap = unwrap(
    cassetteRedact({
      body: JSON.stringify({ response_metadata: { next_cursor: REAL } }),
      config: CASSETTE_CONFIGS.slack,
      idMap: EMPTY_ID_MAP,
      knownValues: [],
    }),
  ).idMap;
  const notionMap = unwrap(
    cassetteRedact({
      body: JSON.stringify({ next_cursor: REAL }),
      config: CASSETTE_CONFIGS.notion,
      idMap: EMPTY_ID_MAP,
      knownValues: [],
    }),
  ).idMap;

  it("is undefined for a request carrying no cursor, so its recorded identifier does not move", () => {
    expect(
      cursorMatchKey({
        body: "limit=200&types=public_channel",
        config: CASSETTE_CONFIGS.slack,
        idMap: slackMap,
        query: {},
      }),
    ).toBe(undefined);
    expect(cursorMatchKey({ body: undefined, config: CASSETTE_CONFIGS.slack, idMap: slackMap, query: {} })).toBe(
      undefined,
    );
  });

  it("reads a Slack cursor out of a form-encoded body", () => {
    expect(
      cursorMatchKey({
        body: `limit=2&cursor=${encodeURIComponent(REAL)}`,
        config: CASSETTE_CONFIGS.slack,
        idMap: slackMap,
        query: {},
      }),
    ).toBe("cursor=cursor_1");
  });

  it("reads a Notion cursor out of a GET's query string and out of a POST's JSON body alike", () => {
    expect(
      cursorMatchKey({
        body: undefined,
        config: CASSETTE_CONFIGS.notion,
        idMap: notionMap,
        query: { start_cursor: REAL },
      }),
    ).toBe("start_cursor=cursor_1");
    expect(
      cursorMatchKey({
        body: JSON.stringify({ page_size: 50, start_cursor: REAL }),
        config: CASSETTE_CONFIGS.notion,
        idMap: notionMap,
        query: {},
      }),
    ).toBe("start_cursor=cursor_1");
  });

  it("computes the same key for the replay run that sends the synthetic back", () => {
    expect(
      cursorMatchKey({
        body: "limit=2&cursor=cursor_1",
        config: CASSETTE_CONFIGS.slack,
        idMap: EMPTY_ID_MAP,
        query: {},
      }),
    ).toBe("cursor=cursor_1");
  });

  it("ignores a cursor-shaped value under a parameter the provider does not page on", () => {
    expect(
      cursorMatchKey({
        body: `bookmark=${encodeURIComponent(REAL)}`,
        config: CASSETTE_CONFIGS.slack,
        idMap: slackMap,
        query: {},
      }),
    ).toBe(undefined);
  });
});

describe("matchableGraphqlVariables — a root-level page's after gets its cursor identity", () => {
  const REAL = "Y3Vyc29yOnYyOpK5MjAyNi0wOC0yOFQwMDowMDowMFrOAAAAAQ==";
  const linearMap = unwrap(
    cassetteRedact({
      body: JSON.stringify({ data: { issues: { pageInfo: { endCursor: REAL, hasNextPage: true } } } }),
      config: CASSETTE_CONFIGS.linear,
      idMap: EMPTY_ID_MAP,
      knownValues: [],
    }),
  ).idMap;
  const cursorFor = ({ value }: { value: string }): string =>
    matchableCursor({ idMap: linearMap, provider: "linear", value });
  const rootPage = ({ after }: { after: string }): string =>
    JSON.stringify({
      operationName: "Issues",
      query: "query Issues($after: String) { issues(after: $after) { nodes { id } } }",
      variables: { after, first: 50 },
    });

  it("makes the record run's real cursor and the replay run's synthetic one the same key", () => {
    expect(matchableGraphqlVariables({ body: rootPage({ after: REAL }), cursorFor })).toBe(
      matchableGraphqlVariables({ body: rootPage({ after: "cursor_1" }), cursorFor }),
    );
    expect(matchableGraphqlVariables({ body: rootPage({ after: REAL }), cursorFor })).toContain('"after":"cursor_1"');
  });

  it("keeps two distinct root pages distinct", () => {
    expect(matchableGraphqlVariables({ body: rootPage({ after: "cursor_1" }), cursorFor })).not.toBe(
      matchableGraphqlVariables({ body: rootPage({ after: "cursor_2" }), cursorFor }),
    );
  });

  it("leaves the ParentConnection follow-up's sentinel alone", () => {
    const followup = JSON.stringify({
      operationName: "ParentConnection",
      query: "query ParentConnection($id: String!, $after: String) { x }",
      variables: { after: REAL, id: ISSUE },
    });

    expect(matchableGraphqlVariables({ body: followup, cursorFor })).toContain('"after":"<followup:after>"');
  });

  it("without a lookup, keeps the live value — the pre-existing contract", () => {
    expect(matchableGraphqlVariables({ body: rootPage({ after: REAL }) })).toContain(`"after":"${REAL}"`);
  });
});

describe("positionalIdentifiers — the match-key alphabet", () => {
  it("collapses a synthetic id onto the same placeholder a real UUID collapses to", () => {
    expect(positionalIdentifiers({ text: TEAM })).toBe(positionalIdentifiers({ text: "id_2544" }));
  });

  it("numbers a synthetic and a real id by first appearance, in one sequence", () => {
    expect(positionalIdentifiers({ text: `id_7 ${TEAM} id_7` })).toBe("<uuid:1> <uuid:2> <uuid:1>");
  });

  it("leaves a synthetic CURSOR alone, which the cursor lane keys on by identity instead", () => {
    expect(positionalIdentifiers({ text: "cursor_3" })).toBe("cursor_3");
  });

  it("is what makes a RESPONSE-DERIVED id replayable: the record and replay bodies key alike", () => {
    const atRecord = `{"query":"query project($id: String!)","variables":{"id":"${TEAM}"}}`;
    const atReplay = '{"query":"query project($id: String!)","variables":{"id":"id_2544"}}';

    expect(positionalIdentifiers({ text: atRecord })).toBe(positionalIdentifiers({ text: atReplay }));
  });

  it("does NOT collapse a synthetic id in the PERSISTED lane, where referential equality is the assertion", () => {
    expect(positionalUuids({ text: "id_2544" })).toBe("id_2544");
  });
});
