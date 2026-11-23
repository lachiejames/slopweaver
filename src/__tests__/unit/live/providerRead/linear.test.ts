/*
 * `parseLinearReadAddress` and `readLinearObject`: which identifiers and links parse, which documents a read
 * sends for the connections it was asked to want, and every way a partial answer is refused rather than shown.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import { LinearLiveErrors } from "../../../../live/linear/errors.js";
import { type LinearReadRequest, parseLinearReadAddress, readLinearObject } from "../../../../live/linear/read.js";
import { NOW } from "./fixtures.js";

/**
 * The root field a GraphQL document selects, so a test can say WHICH document was sent.
 *
 * Each optional part opens on a character the part before it cannot match — the name on `[A-Za-z_]`, the
 * arguments on `(` — because the obvious spelling lets two whitespace quantifiers claim the same run and is
 * the polynomial backtracking `redos-check` refuses.
 *
 * A document this cannot read is a THROW rather than an empty string: every caller here uses the answer to
 * choose a reply, and an empty field would quietly pick the fallback reply for a document the fake does not
 * understand — which is a passing test over the wrong request.
 */
function rootFieldOf({ query }: { query: string }): string {
  const field = /(?:query|mutation)\s+(?:[A-Za-z_]\w*[\t ]*)?(?:\([^)]*\)[\s]*)?\{\s*([A-Za-z_]\w*)/.exec(query)?.[1];
  if (field === undefined) {
    throw new Error(`no root field in the document sent: ${query.slice(0, 120)}`);
  }
  return field;
}

describe("Linear named-object reads", () => {
  it("parses an issue identifier and project URL", () => {
    expect(unwrap(parseLinearReadAddress({ address: "AIL-123" }))).toEqual({
      address: "AIL-123",
      id: "AIL-123",
      identity: "AIL-123",
      kind: "issue",
    });
    expect(
      unwrap(parseLinearReadAddress({ address: "https://linear.app/acme/project/source-routing-abc123/overview" })),
    ).toEqual({
      address: "https://linear.app/acme/project/source-routing-abc123/overview",
      id: "source-routing-abc123",
      identity: "source-routing-abc123",
      kind: "project",
    });
    expect(unwrap(parseLinearReadAddress({ address: "What is the current state of AIL-69?" }))).toMatchObject({
      address: "AIL-69",
      id: "AIL-69",
      kind: "issue",
    });
  });

  it("asks for NOTHING it was not told to want — one request, no activity", async () => {
    const roots: string[] = [];
    const result = await readLinearObject({
      address: "AIL-9",
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) => {
        roots.push(rootFieldOf({ query }));
        return Promise.resolve(ok({ issue: { identifier: "AIL-9", title: "Live" } }));
      },
    });

    expect(roots).toEqual(["issue"]);
    expect(unwrap(result).data).toEqual({ identifier: "AIL-9", title: "Live" });
    expect(unwrap(result).coverage.detail).toBe("one named object, with no activity connections requested");
    expect(unwrap(result).coverage.residue).toEqual([
      "only fields declared by the typed live-reader query were requested",
      "not requested, so not read: comments, attachments, history",
    ]);
  });

  it("asks for exactly the connections it was told to want, and names the ones it skipped", async () => {
    const variables: unknown[] = [];
    const result = await readLinearObject({
      address: "AIL-9",
      include: { comments: true },
      limit: 10,
      nowIso: () => NOW,
      request: ({ query, variables: vars }) => {
        variables.push(vars);
        return Promise.resolve(
          ok(
            rootFieldOf({ query }) === "issue" && !query.includes("comments")
              ? { issue: { identifier: "AIL-9" } }
              : {
                  issue: {
                    comments: {
                      nodes: [{ body: "a comment", id: "c-1" }],
                      pageInfo: { hasNextPage: false, hasPreviousPage: false },
                    },
                  },
                },
          ),
        );
      },
    });

    expect(variables).toEqual([
      { id: "AIL-9", limit: 10 },
      { first: 10, id: "AIL-9" },
    ]);
    expect(unwrap(result).data).toEqual({
      comments: { nodes: [{ body: "a comment", id: "c-1" }], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
      identifier: "AIL-9",
    });
    expect(unwrap(result).coverage.detail).toBe("one named object, with up to 10 items from each of: comments");
    expect(unwrap(result).coverage.residue).toContain("not requested, so not read: attachments, history");
  });

  it("reads a project's teams with it, because an update sends them back whole", async () => {
    const variables: unknown[] = [];
    const teams = { nodes: [{ id: "t-sops" }, { id: "t-sup" }], pageInfo: { hasNextPage: false } };
    const result = await readLinearObject({
      address: "https://linear.app/acme/project/source-routing-abc123",
      limit: 1,
      nowIso: () => NOW,
      request: ({ query, variables: vars }) => {
        variables.push(vars);
        return Promise.resolve(
          ok(query.includes("query project_teams") ? { project: { teams } } : { project: { name: "Source routing" } }),
        );
      },
    });

    // The caller's `--limit 1` bounds activity, never the teams an update must send back whole, archived ones too.
    expect(variables).toEqual([
      { id: "source-routing-abc123", limit: 1 },
      { first: 250, id: "source-routing-abc123", includeArchived: true },
    ]);
    expect(unwrap(result).data).toEqual({ name: "Source routing", teams });
  });

  it("refuses a project whose teams run past one page, rather than showing them short", async () => {
    const result = await readLinearObject({
      address: "https://linear.app/acme/project/source-routing-abc123",
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          ok(
            query.includes("query project_teams")
              ? { project: { teams: { nodes: [{ id: "t-sops" }], pageInfo: { hasNextPage: true } } } }
              : { project: { name: "Source routing" } },
          ),
        ),
    });

    expect(unwrapErr(result).message).toBe(
      "Linear did not return every team of project source-routing-abc123 in one page; refused rather than shown short",
    );
  });

  it("fails a project read whose teams did not come back, rather than showing a project on no team", async () => {
    const result = await readLinearObject({
      address: "https://linear.app/acme/project/source-routing-abc123",
      limit: 10,
      nowIso: () => NOW,
      request: () => Promise.resolve(ok({ project: { name: "Source routing" } })),
    });

    expect(unwrapErr(result).message).toBe("Linear returned no teams for project source-routing-abc123");
  });

  it("fails the whole read when a requested connection fails, rather than reporting a partial issue", async () => {
    const result = await readLinearObject({
      address: "AIL-9",
      include: { history: true },
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          query.includes("history")
            ? err(LinearLiveErrors.notFound({ identity: "AIL-9", kind: "issue" }))
            : ok({ issue: { identifier: "AIL-9" } }),
        ),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("NOT_FOUND");
  });

  const DOCUMENT_URL = "https://linear.app/acme/document/desktop-app-architecture-ce7efb5309b4";

  it("reads a DOCUMENT's comments when asked, from the document root, rather than dropping them", async () => {
    const queries: string[] = [];
    const comments = {
      nodes: [{ body: "Definitely not in Tome.", id: "c-tome", quotedText: "an endpoint in Tome." }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    };
    const result = await readLinearObject({
      address: DOCUMENT_URL,
      include: { comments: true },
      limit: 25,
      nowIso: () => NOW,
      request: ({ query }) => {
        queries.push(query.includes("comments(") ? "comments" : "object");
        return Promise.resolve(
          ok(query.includes("comments(") ? { document: { comments } } : { document: { title: "Proposal" } }),
        );
      },
    });

    expect(queries).toEqual(["object", "comments"]);
    expect(unwrap(result).data).toEqual({ comments, title: "Proposal" });
    expect(unwrap(result).coverage.detail).toBe("one named object, with up to 25 items from each of: comments");
  });

  it("fails a read whose requested connection did not come back, rather than claiming it was read", async () => {
    const result = await readLinearObject({
      address: DOCUMENT_URL,
      include: { comments: true },
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(ok(query.includes("comments(") ? { document: {} } : { document: { title: "Proposal" } })),
    });
    const noPageInfo = await readLinearObject({
      address: DOCUMENT_URL,
      include: { comments: true },
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          ok(query.includes("comments(") ? { document: { comments: { nodes: [] } } } : { document: { title: "P" } }),
        ),
    });

    // A `pageInfo` that does not say whether more follow leaves the read's completeness unknowable.
    const silentPageInfo = await readLinearObject({
      address: DOCUMENT_URL,
      include: { comments: true },
      limit: 10,
      nowIso: () => NOW,
      request: ({ query }) =>
        Promise.resolve(
          ok(
            query.includes("comments(")
              ? { document: { comments: { nodes: [], pageInfo: {} } } }
              : { document: { title: "P" } },
          ),
        ),
    });

    expect(unwrapErr(result).message).toBe(
      "Linear returned no comments connection for document desktop-app-architecture-ce7efb5309b4",
    );
    expect(unwrapErr(noPageInfo).code).toBe("READ_FAILED");
    expect(unwrapErr(silentPageInfo).message).toBe(
      "Linear returned no comments connection for document desktop-app-architecture-ce7efb5309b4",
    );
  });

  it("fails a read whose connection holds a node that is not an object with an id, or is not its first page", async () => {
    const readWith = ({
      nodes,
      pageInfo = { hasNextPage: false, hasPreviousPage: false },
    }: {
      nodes: readonly unknown[];
      pageInfo?: unknown;
    }): ReturnType<typeof readLinearObject> =>
      readLinearObject({
        address: DOCUMENT_URL,
        include: { comments: true },
        limit: 10,
        nowIso: () => NOW,
        request: ({ query }) =>
          Promise.resolve(
            ok(
              query.includes("comments(")
                ? { document: { comments: { nodes, pageInfo } } }
                : { document: { title: "P" } },
            ),
          ),
      });

    const one = [{ body: "one", id: "c-1" }];
    const nullNode = await readWith({ nodes: [null] });
    const idless = await readWith({ nodes: [{ body: "who am i" }] });
    const midway = await readWith({ nodes: one, pageInfo: { hasNextPage: false, hasPreviousPage: true } });
    const unstated = await readWith({ nodes: one, pageInfo: { hasNextPage: false } });
    const fine = await readWith({ nodes: one });

    expect(unwrapErr(nullNode).message).toBe(
      "Linear returned no comments connection for document desktop-app-architecture-ce7efb5309b4",
    );
    expect(unwrapErr(idless).code).toBe("READ_FAILED");
    expect(unwrapErr(midway).message).toBe(
      "Linear returned no comments connection for document desktop-app-architecture-ce7efb5309b4",
    );
    expect(unwrapErr(unstated).code).toBe("READ_FAILED");
    expect(unwrap(fine).coverage.detail).toBe("one named object, with up to 10 items from each of: comments");
  });

  it("names a document's comments as not read when none were asked for", async () => {
    const result = await readLinearObject({
      address: DOCUMENT_URL,
      limit: 10,
      nowIso: () => NOW,
      request: () => Promise.resolve(ok({ document: { title: "Proposal" } })),
    });

    expect(unwrap(result).coverage.residue).toContain("not requested, so not read: comments");
  });

  it("REFUSES, before any request, a connection the kind does not have", async () => {
    const sent: string[] = [];
    const request: LinearReadRequest = ({ query }) => {
      sent.push(query);
      return Promise.resolve(ok({ document: { title: "Proposal" } }));
    };

    const onDocument = await readLinearObject({
      address: DOCUMENT_URL,
      include: { comments: true, history: true },
      limit: 10,
      nowIso: () => NOW,
      request,
    });
    const onProject = await readLinearObject({
      address: "https://linear.app/acme/project/source-routing-abc123",
      include: { comments: true },
      limit: 10,
      nowIso: () => NOW,
      request,
    });

    expect(unwrapErr(onDocument).code).toBe("ACTIVITY_UNAVAILABLE");
    expect(unwrapErr(onDocument).message).toContain("history");
    expect(unwrapErr(onProject).code).toBe("ACTIVITY_UNAVAILABLE");
    expect(sent).toEqual([]);
  });
});
