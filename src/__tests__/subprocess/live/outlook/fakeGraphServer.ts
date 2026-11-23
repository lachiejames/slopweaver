/**
 * A loopback stand-in for the two Microsoft hosts the Outlook door talks to — the identity platform's token
 * endpoint and Microsoft Graph — so the SHIPPED `bin/slopweaver outlook …` verbs can run end to end with no
 * account. The spawned CLI reaches it through `fakeFetchRedirect.ts`'s preload, which rewrites
 * `https://<host>/<path>` to `<origin>/<host>/<path>`; that is the only seam, and production code carries none.
 *
 * Every value is SYNTHETIC — `example.test` addresses, invented subjects, tokens named `at-N` and `rt-N`. It
 * records every request it answers, so a test asserts what the CLI SENT (a header on the second page, the
 * refresh token it presented) as well as what it printed.
 */
import { createServer, type ServerResponse } from "node:http";
import type { GraphMessage } from "../../../../live/outlook/graphWire.js";
import {
  ARCHIVE_FOLDER,
  CATEGORY_PAGES,
  INBOX_CHILD,
  ME,
  seedMessages,
  TOP_FOLDER_PAGES,
  tokenSet,
} from "./fakeGraphData.js";
import { bodyOf, graphError, json } from "./fakeGraphHttp.js";
import { answerMessages } from "./fakeGraphMessage.js";

/** Graph's v1.0 root, as the paging links the server hands back spell it. */
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

/**
 * One request the server answered.
 *
 * @internal — the element type of `FakeGraphServer.requests`; tests filter that list, never name the row.
 */
export interface FakeGraphRequest {
  readonly method: string;
  /** The Microsoft host the CLI addressed. */
  readonly host: string;
  /** The path under that host, without the query. */
  readonly path: string;
  readonly query: URLSearchParams;
  readonly prefer: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** What a test configures, and may flip between two runs of the CLI. */
export interface FakeGraphOptions {
  /** When false, `/me/mailFolders/archive` answers 404, as a personal mailbox with no Archive folder does. */
  hasArchive: boolean;
  /** When true, a `conversationId` filter answers Graph's `InefficientFilter` 400. */
  refuseThreadFilter: boolean;
  /** When true, a draft's `/send` answers 500 and sends nothing — a send whose outcome the CLI cannot know. */
  failSend: boolean;
  /** When true, a message PATCH applies, then answers with a field the strict boundary does not declare. */
  driftPatch: boolean;
  /** How long the token endpoint holds each answer, so two refreshing processes overlap rather than take turns. */
  tokenDelayMs: number;
}

/** A running fake, its request log, and the mailbox state it mutates. */
export interface FakeGraphServer {
  readonly origin: string;
  readonly requests: FakeGraphRequest[];
  readonly messages: Map<string, GraphMessage>;
  /** Every refresh token the CLI presented, in order. */
  readonly refreshTokensPresented: string[];
  /** How many token sets the endpoint has issued; the latest refresh token is `rt-<this>`. */
  readonly tokensIssued: () => number;
  readonly close: () => Promise<void>;
}

/**
 * Graph's `/me/mailFolders/inbox/messages`, listing or search alike: two messages, then a nextLink to the rest
 * — server-driven paging, which Graph applies below `$top` whenever it likes.
 */
function answerInbox({
  res,
  query,
  messages,
}: {
  res: ServerResponse;
  query: URLSearchParams;
  messages: Map<string, GraphMessage>;
}): void {
  const unreadOnly = query.get("$filter")?.includes("isRead eq false") === true;
  const all = [...messages.values()].filter(
    (message) => message.parentFolderId === "folder-inbox" && (!unreadOnly || message.isRead === false),
  );
  if (query.get("$skiptoken") === "page-2") {
    json({ body: { value: all.slice(2) }, res, status: 200 });
    return;
  }
  const next = `${GRAPH_ROOT}/me/mailFolders/inbox/messages?$skiptoken=page-2`;
  json({ body: { "@odata.nextLink": next, value: all.slice(0, 2) }, res, status: 200 });
}

/** `/me/outlook/masterCategories`: the first page and a nextLink, then the second page alone. */
function answerCategories({ res, query }: { res: ServerResponse; query: URLSearchParams }): void {
  if (query.get("$skiptoken") === "categories-2") {
    json({ body: { value: CATEGORY_PAGES[1] }, res, status: 200 });
    return;
  }
  const next = `${GRAPH_ROOT}/me/outlook/masterCategories?$skiptoken=categories-2`;
  json({ body: { "@odata.nextLink": next, value: CATEGORY_PAGES[0] }, res, status: 200 });
}

/** `/me/mailFolders` and one folder's `/childFolders`: the top level over two pages, the Inbox's one child. */
function answerFolders({
  res,
  query,
  parentId,
}: {
  res: ServerResponse;
  query: URLSearchParams;
  parentId: string | undefined;
}): void {
  if (parentId !== undefined) {
    json({ body: { value: parentId === "folder-inbox" ? [INBOX_CHILD] : [] }, res, status: 200 });
    return;
  }
  if (query.get("$skiptoken") === "folders-2") {
    json({ body: { value: TOP_FOLDER_PAGES[1] }, res, status: 200 });
    return;
  }
  const next = `${GRAPH_ROOT}/me/mailFolders?$skiptoken=folders-2`;
  json({ body: { "@odata.nextLink": next, value: TOP_FOLDER_PAGES[0] }, res, status: 200 });
}

/** Route one Graph request under `/v1.0`. */
function answerGraph({
  res,
  request,
  options,
  messages,
}: {
  res: ServerResponse;
  request: FakeGraphRequest;
  options: FakeGraphOptions;
  messages: Map<string, GraphMessage>;
}): void {
  const segments = request.path.split("/").filter((part) => part !== "");
  const [version, me, collection, ...rest] = segments;
  if (version !== "v1.0" || me !== "me") {
    graphError({ code: "ErrorInvalidUrl", res, status: 400 });
    return;
  }
  if (collection === undefined) {
    json({ body: ME, res, status: 200 });
    return;
  }
  if (collection === "mailFolders") {
    answerMailFolders({ messages, options, query: request.query, res, rest });
    return;
  }
  if (collection === "outlook" && rest.join("/") === "masterCategories") {
    answerCategories({ query: request.query, res });
    return;
  }
  if (collection === "messages") {
    const { body, method, query } = request;
    answerMessages({ body, messages, method, options, query, res, rest });
    return;
  }
  graphError({ code: "ErrorInvalidUrl", res, status: 400 });
}

/** `/me/mailFolders/…`: the inbox's messages, the hierarchy over its pages, and the two well-known folders. */
function answerMailFolders({
  res,
  rest,
  query,
  options,
  messages,
}: {
  res: ServerResponse;
  rest: readonly string[];
  query: URLSearchParams;
  options: FakeGraphOptions;
  messages: Map<string, GraphMessage>;
}): void {
  const route = rest.join("/");
  if (route === "inbox/messages") {
    answerInbox({ messages, query, res });
    return;
  }
  if (route === "") {
    answerFolders({ parentId: undefined, query, res });
    return;
  }
  if (rest.length === 2 && rest[1] === "childFolders") {
    answerFolders({ parentId: decodeURIComponent(rest[0]!), query, res });
    return;
  }
  if (route === "inbox") {
    json({ body: TOP_FOLDER_PAGES[0][0], res, status: 200 });
    return;
  }
  if (route === "archive" && options.hasArchive) {
    json({ body: ARCHIVE_FOLDER, res, status: 200 });
    return;
  }
  if (route === "archive") {
    graphError({ code: "ErrorItemNotFound", res, status: 404 });
    return;
  }
  graphError({ code: "ErrorInvalidUrl", res, status: 400 });
}

/**
 * Start the fake on an ephemeral loopback port.
 *
 * @param options which of Graph's refusals this mailbox exhibits
 * @returns the running server, its origin and its request log
 */
export async function startFakeGraphServer({ options }: { options: FakeGraphOptions }): Promise<FakeGraphServer> {
  const requests: FakeGraphRequest[] = [];
  const messages = seedMessages();
  const state = { issued: 0, refreshTokensPresented: [] as string[] };
  const server = createServer((req, res) => {
    void (async () => {
      // Node always sets both on a request a server received; the `!` states that, rather than inventing a default.
      const url = new URL(req.url!, "http://fake.invalid");
      const [, host = "", ...pathParts] = url.pathname.split("/");
      const body = await bodyOf({ req });
      const request: FakeGraphRequest = {
        authorization: req.headers.authorization,
        body,
        host,
        method: req.method!,
        path: `/${pathParts.join("/")}`,
        prefer: typeof req.headers["prefer"] === "string" ? req.headers["prefer"] : undefined,
        query: url.searchParams,
      };
      requests.push(request);
      if (host === "login.microsoftonline.com" && request.path.endsWith("/oauth2/v2.0/token")) {
        await new Promise((resolveDelay) => {
          setTimeout(resolveDelay, options.tokenDelayMs);
        });
        json({ body: tokenSet({ form: new URLSearchParams(body), state }), res, status: 200 });
        return;
      }
      if (host === "graph.microsoft.com") {
        answerGraph({ messages, options, request, res });
        return;
      }
      graphError({ code: "UnknownHost", res, status: 421 });
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("outlook fixture: the fake Graph server is not listening on a TCP port");
  }
  const { port } = address;
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
    messages,
    origin: `http://127.0.0.1:${String(port)}`,
    refreshTokensPresented: state.refreshTokensPresented,
    requests,
    tokensIssued: () => state.issued,
  };
}
