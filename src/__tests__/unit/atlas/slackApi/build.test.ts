/**
 * The merge and the two lookups. `findResponseField` is the one that matters: it is the verb an
 * investigation uses to ask "is there ANY call that hands me this", and a lookup that quietly missed the
 * browser half would answer "no" to a question whose answer was "yes, but only the web client has seen it".
 */
import { describe, expect, it } from "vitest";

import { buildSlackApiAtlas, countAtlas, findMethods, findResponseField } from "../../../../atlas/slackApi/build.js";
import type { BrowserObservedMethod, DocsFacts, SdkMethod } from "../../../../atlas/slackApi/model.js";

const history: SdkMethod = {
  argsType: "ConversationsHistoryArguments",
  description: "Fetches a conversation's history.",
  name: "conversations.history",
  params: [
    { name: "channel", optional: false, type: "string" },
    { name: "limit", optional: true, type: "number" },
  ],
  responseFields: [
    { name: "has_more", optional: true, type: "boolean" },
    { name: "messages", optional: true, type: "MessageElement[]" },
  ],
  responseNested: { messages: ["latest_reply", "reply_count", "ts"] },
  responseType: "ConversationsHistoryResponse",
};

const usersList: SdkMethod = {
  argsType: "UsersListArguments",
  description: "",
  name: "users.list",
  params: [{ name: "cursor", optional: true, type: "string" }],
  responseFields: [{ name: "members", optional: true, type: "Member[]" }],
  responseNested: { members: ["id", "updated"] },
  responseType: "UsersListResponse",
};

const docs: DocsFacts = {
  audience: "bot-and-user",
  botScopes: ["channels:history"],
  limitDefault: 100,
  limitMax: 999,
  name: "conversations.history",
  note: undefined,
  observedOn: "2026-08-23",
  pagination: "cursor",
  tier: "3",
  userScopes: ["channels:history"],
};

const view: BrowserObservedMethod = {
  name: "conversations.view",
  publicSurface: false,
  responsePaths: ["history.messages[].reply_count", "im.unread_count"],
  responsePathsTotal: 127,
  undocumentedParams: ["include_mutation_timestamps"],
};

const atlas = buildSlackApiAtlas({
  browser: [view],
  builtAtIso: "2026-08-23T00:00:00.000Z",
  docs: [docs],
  methods: [usersList, history],
  sdkVersion: "8.0.0",
});

describe("countAtlas", () => {
  it("counts arguments and response fields across every method, nesting included", () => {
    expect(countAtlas({ browser: [view], docs: [docs], methods: [history, usersList] })).toEqual({
      browserObserved: 1,
      browserOnly: 1,
      methods: 2,
      params: 3,
      responseFields: 8,
      withDocs: 1,
    });
  });

  it("counts a docs row for a method the SDK does not declare as absent, not as coverage", () => {
    const orphan: DocsFacts = { ...docs, name: "admin.gone" };
    expect(countAtlas({ browser: [], docs: [orphan], methods: [history] }).withDocs).toBe(0);
  });

  it("reports zeroes for an empty atlas rather than refusing", () => {
    expect(countAtlas({ browser: [], docs: [], methods: [] })).toEqual({
      browserObserved: 0,
      browserOnly: 0,
      methods: 0,
      params: 0,
      responseFields: 0,
      withDocs: 0,
    });
  });
});

describe("buildSlackApiAtlas", () => {
  it("sorts methods by name regardless of input order", () => {
    expect(atlas.methods.map((method) => method.name)).toEqual(["conversations.history", "users.list"]);
  });

  it("carries the SDK version so a stale generation announces itself", () => {
    expect(atlas.sdkVersion).toBe("8.0.0");
  });
});

describe("findMethods", () => {
  it("matches a family substring and merges all three inputs into one view", () => {
    const views = findMethods({ atlas, term: "conversations" });
    expect(views.map((entry) => entry.name)).toEqual(["conversations.history", "conversations.view"]);
    expect(views[0]!.docs!.tier).toBe("3");
    expect(views[1]!.sdk).toBeUndefined();
    expect(views[1]!.browser!.undocumentedParams).toEqual(["include_mutation_timestamps"]);
  });

  it("is case-insensitive", () => {
    expect(findMethods({ atlas, term: "USERS" }).map((entry) => entry.name)).toEqual(["users.list"]);
  });

  it("returns every method for an empty term", () => {
    expect(findMethods({ atlas, term: "" })).toHaveLength(3);
  });

  it("returns nothing for a term no method name contains", () => {
    expect(findMethods({ atlas, term: "zzz" })).toEqual([]);
  });
});

describe("findResponseField", () => {
  it("finds a nested field and renders its path with the array marker", () => {
    const hits = findResponseField({ atlas, field: "reply_count" });
    expect(hits).toEqual([
      { browserOnly: false, method: "conversations.history", paths: ["messages[].reply_count"] },
      { browserOnly: true, method: "conversations.view", paths: ["history.messages[].reply_count"] },
    ]);
  });

  it("flags a hit seen only in the browser capture, so it is never planned around", () => {
    const hits = findResponseField({ atlas, field: "unread_count" });
    expect(hits).toEqual([{ browserOnly: true, method: "conversations.view", paths: ["im.unread_count"] }]);
  });

  it("matches a top-level field too", () => {
    expect(findResponseField({ atlas, field: "has_more" })).toEqual([
      { browserOnly: false, method: "conversations.history", paths: ["has_more"] },
    ]);
  });

  it("orders by how many paths matched, so the richest source is first", () => {
    const hits = findResponseField({ atlas, field: "e" });
    expect(hits[0]!.method).toBe("conversations.history");
    expect(hits[0]!.paths).toEqual(
      ["messages", "messages[].latest_reply", "messages[].reply_count", "has_more"].toSorted(),
    );
  });

  it("returns nothing for a field no observed response carries", () => {
    expect(findResponseField({ atlas, field: "thread_broadcast_signal" })).toEqual([]);
  });
});
