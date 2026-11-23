/**
 * The SDK-typings extractor, against declaration text written by hand rather than read from
 * `node_modules` — so these assertions stay true across a dependency bump, and a bump that BREAKS the
 * parser shows up in `./slackApiRun.test.ts`'s live-shape test rather than as a silently smaller method count.
 */
import { describe, expect, it } from "vitest";

import { methodHeads } from "../../../../atlas/slackApi/methodHeads.js";
import {
  collectDeclarations,
  extractSdkMethods,
  membersOf,
  resolveMembers,
} from "../../../../atlas/slackApi/sdkTypings.js";

const METHODS_TEXT = `
    readonly conversations: {
        /**
         * @description Fetches a conversation's history of messages and events.
         * @see {@link https://docs.slack.dev/reference/methods/conversations.history \`conversations.history\` API reference}.
         */
        history: MethodWithRequiredArgument<ConversationsHistoryArguments, ConversationsHistoryResponse>;
    };
    readonly search: {
        /**
         * @description Searches for messages matching a query.
         * @see {@link https://docs.slack.dev/reference/methods/search.messages search.messages\` API reference}.
         */
        messages: MethodWithRequiredArgument<SearchMessagesArguments, SearchMessagesResponse>;
    };
    readonly entity: {
        /**
         * @description Provide information about the entity.
         * @see {@link https://docs.slack.dev/reference/methods/entity.presentDetails}
         */
        presentDetails: MethodWithRequiredArgument<EntityPresentDetailsArguments, EntityPresentDetailsResponse>;
    };
    readonly api: {
        /**
         * @see {@link https://docs.slack.dev/reference/methods/api.test \`api.test\` API reference}.
         */
        test: MethodWithOptionalArgument<APITestArguments, ApiTestResponse>;
    };
`;

const REQUEST_TEXT = `
export interface TokenOverridable {
    token?: string;
}
export interface CursorPaginationEnabled {
    /** @description Paginate. */
    cursor?: string;
    limit?: number;
}
export interface Channel {
    channel: string;
}
export type ConversationsHistoryArguments = Channel & TokenOverridable & CursorPaginationEnabled & {
    oldest?: string;
};
export type SearchMessagesArguments = TokenOverridable & (Sortable | Paged);
export interface Sortable {
    sort?: string;
}
export interface Paged {
    page?: number;
}
export interface EntityPresentDetailsArguments {
    entity_id: string;
}
export interface APITestArguments {
    foo?: string;
}
`;

const HISTORY_RESPONSE = `
export type ConversationsHistoryResponse = WebAPICallResult & {
    has_more?: boolean;
    messages?: MessageElement[];
    ok?: boolean;
};
export interface MessageElement {
    latest_reply?: string;
    reply_count?: number;
    ts?: string;
}
`;

const responseTexts = new Map([
  ["ConversationsHistoryResponse", HISTORY_RESPONSE],
  ["SearchMessagesResponse", "export type SearchMessagesResponse = WebAPICallResult & { ok?: boolean; };"],
  ["EntityPresentDetailsResponse", "export interface EntityPresentDetailsResponse { ok?: boolean; }"],
  ["ApiTestResponse", "export interface ApiTestResponse { ok?: boolean; }"],
]);

describe("methodHeads", () => {
  it("finds all three JSDoc shapes the SDK actually ships", () => {
    const names = methodHeads({ methodsText: METHODS_TEXT }).map((head) => head.name);
    expect(names).toEqual(["conversations.history", "search.messages", "entity.presentDetails", "api.test"]);
  });

  it("keeps the first declaration when a name appears twice", () => {
    const doubled = `${METHODS_TEXT}${METHODS_TEXT}`;
    expect(methodHeads({ methodsText: doubled })).toHaveLength(4);
  });

  it("carries the description with its comment leader stripped", () => {
    const head = methodHeads({ methodsText: METHODS_TEXT }).find((entry) => entry.name === "conversations.history")!;
    expect(head.description).toBe("Fetches a conversation's history of messages and events.");
  });

  it("leaves the description empty when the SDK declares none", () => {
    const head = methodHeads({ methodsText: METHODS_TEXT }).find((entry) => entry.name === "api.test")!;
    expect(head.description).toBe("");
  });

  it("finds nothing in text with no method declarations", () => {
    expect(methodHeads({ methodsText: "export interface Nothing { a?: string; }" })).toEqual([]);
  });
});

describe("membersOf", () => {
  it("reads a member's name, optionality and declared type", () => {
    expect(membersOf({ body: "  a?: string;\n  b: number;\n" })).toEqual([
      { name: "a", optional: true, type: "string" },
      { name: "b", optional: false, type: "number" },
    ]);
  });

  it("skips members nested inside another member's object type", () => {
    const body = "  outer?: {\n    inner: string;\n  };\n  sibling?: number;\n";
    expect(membersOf({ body }).map((member) => member.name)).toEqual(["outer", "sibling"]);
  });

  it("skips comment lines", () => {
    expect(membersOf({ body: "  /** @description hi */\n  * stray\n  a?: string;\n" })).toEqual([
      { name: "a", optional: true, type: "string" },
    ]);
  });

  it("reads nothing out of an empty body", () => {
    expect(membersOf({ body: "" })).toEqual([]);
  });
});

describe("resolveMembers", () => {
  const declarations = collectDeclarations({ text: REQUEST_TEXT });

  it("follows an intersection to every member it inherits", () => {
    const names = resolveMembers({ declarations, typeName: "ConversationsHistoryArguments" })
      .map((member) => member.name)
      .toSorted();
    expect(names).toEqual(["channel", "cursor", "limit", "oldest", "token"]);
  });

  it("follows a UNION so both arms' members are offered", () => {
    const names = resolveMembers({ declarations, typeName: "SearchMessagesArguments" })
      .map((member) => member.name)
      .toSorted();
    expect(names).toEqual(["page", "sort", "token"]);
  });

  it("returns nothing for a name no declaration defines", () => {
    expect(resolveMembers({ declarations, typeName: "NotDeclaredAnywhere" })).toEqual([]);
  });

  it("returns nothing for an undefined type name", () => {
    expect(resolveMembers({ declarations, typeName: undefined })).toEqual([]);
  });

  it("terminates on a self-referential declaration", () => {
    const cyclic = collectDeclarations({
      text: "export type A = B & { a?: string; };\nexport type B = A & { b?: string; };",
    });
    expect(
      resolveMembers({ declarations: cyclic, typeName: "A" })
        .map((member) => member.name)
        .toSorted(),
    ).toEqual(["a", "b"]);
  });
});

describe("extractSdkMethods", () => {
  const methods = extractSdkMethods({ methodsText: METHODS_TEXT, requestText: REQUEST_TEXT, responseTexts });

  it("returns one row per distinct method, sorted by name", () => {
    expect(methods.map((method) => method.name)).toEqual([
      "api.test",
      "conversations.history",
      "entity.presentDetails",
      "search.messages",
    ]);
  });

  it("resolves the argument surface of a method built from four intersected types", () => {
    const history = methods.find((method) => method.name === "conversations.history")!;
    expect(history.params).toEqual([
      { name: "channel", optional: false, type: "string" },
      { name: "cursor", optional: true, type: "string" },
      { name: "limit", optional: true, type: "number" },
      { name: "oldest", optional: true, type: "string" },
      { name: "token", optional: true, type: "string" },
    ]);
  });

  it("records one level of response nesting, which is where the thread fields live", () => {
    const history = methods.find((method) => method.name === "conversations.history")!;
    expect(history.responseFields.map((field) => field.name)).toEqual(["has_more", "messages", "ok"]);
    expect(history.responseNested["messages"]).toEqual(["latest_reply", "reply_count", "ts"]);
  });

  it("leaves responseNested empty when no field's type is declared alongside it", () => {
    const search = methods.find((method) => method.name === "search.messages")!;
    expect(search.responseNested).toEqual({});
  });

  it("yields nothing when the methods text declares nothing", () => {
    expect(extractSdkMethods({ methodsText: "", requestText: REQUEST_TEXT, responseTexts })).toEqual([]);
  });
});
