/**
 * The `chatgpt` shell: argv parsing, and `conversation` driven end to end over an injected edge into a
 * throwaway home — the files it writes, their mode, and the refusal before any request when no session exists.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newestPagePath } from "../../../../../cli/commands/chatgpt/conversation.js";
import type { ChatgptError } from "../../../../../cli/commands/chatgpt/errors.js";
import type { ChatgptSessionHeaders } from "../../../../../cli/commands/chatgpt/paste.js";
import {
  parseConversationArgs,
  parseImportRequestArgs,
  runChatgptConversation,
  runChatgptImportRequest,
} from "../../../../../cli/commands/chatgpt/run.js";
import {
  type ChatgptWebDeps as ChatgptConversationDeps,
  chatgptRequestInit,
  contentTypeRefusal,
  withholdHeaderValues,
} from "../../../../../cli/commands/chatgpt/web.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const ID = "6aba18a1-5280-83ec-9115-b16ac7e6a181";

describe("parseConversationArgs", () => {
  it("takes one id and defaults the page bound", () => {
    const options = unwrap(parseConversationArgs({ rest: [ID, "--home", "/h"] }));
    expect(options).toEqual({ home: "/h", id: ID, json: false, maxPages: 200 });
  });

  it("refuses a non-id and a bad bound", () => {
    expect(unwrapErr(parseConversationArgs({ rest: ["all"] }))[0]).toContain("is not a ChatGPT conversation id");
    expect(unwrapErr(parseConversationArgs({ rest: [ID, "--max-pages", "0"] }))[0]).toContain("--max-pages");
  });
});

describe("parseImportRequestArgs", () => {
  it("requires --from", () => {
    expect(unwrapErr(parseImportRequestArgs({ rest: [] }))[0]).toContain("--from <file> is required");
    expect(unwrap(parseImportRequestArgs({ rest: ["--from", "/p", "--home", "/h"] }))).toEqual({
      from: "/p",
      home: "/h",
      json: false,
    });
  });
});

describe("chatgptRequestInit", () => {
  it("is a GET that answers a redirect as itself rather than following it off the built path", () => {
    const headers: ChatgptSessionHeaders = {
      authorization: "Bearer b",
      "chatgpt-account-id": "a",
      cookie: "c=1",
      "oai-did": "d",
      "user-agent": "u",
    };
    expect(chatgptRequestInit({ headers })).toEqual({
      headers: { accept: "application/json", ...headers },
      method: "GET",
      redirect: "manual",
    });
  });
});

describe("withholdHeaderValues", () => {
  it("withholds a header value undici quotes in its refusal, and leaves other text alone", () => {
    const headers: ChatgptSessionHeaders = {
      authorization: "Bearer eyJ.eyJ.sig",
      "chatgpt-account-id": "acct-1f2e",
      cookie: "__Secure-next-auth=abc\u0000def",
      "oai-did": "did-9a8b",
      "user-agent": "Mozilla/5.0 (Macintosh)",
    };
    const text = 'Headers.append: "__Secure-next-auth=abc\u0000def" is an invalid header value.';
    expect(text).toContain(headers.cookie);
    expect(withholdHeaderValues({ headers, text })).toBe(
      'Headers.append: "<header value withheld>" is an invalid header value.',
    );
  });
});

describe("contentTypeRefusal", () => {
  const headers: ChatgptSessionHeaders = {
    authorization: "Bearer b",
    "chatgpt-account-id": "a",
    cookie: "c=1",
    "oai-did": "d",
    "user-agent": "application/x-synthetic-marker",
  };

  it("passes JSON and refuses an absent content-type", () => {
    expect(contentTypeRefusal({ contentType: "application/json; charset=utf-8", headers, path: "/p" })).toBe(undefined);
    expect(contentTypeRefusal({ contentType: null, headers, path: "/p" })!.code).toBe("NOT_JSON");
  });

  it("withholds a header value the server echoes back as its content-type", () => {
    const refusal = contentTypeRefusal({ contentType: headers["user-agent"], headers, path: "/p" })!;
    expect(refusal.code).toBe("NOT_JSON");
    expect(refusal.message).toContain("<header value withheld>");
    expect(refusal.message).not.toContain(headers["user-agent"]);
  });
});

describe("runChatgptConversation", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "chatgpt-run-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses with no session, before any request", async () => {
    const asked: string[] = [];
    const deps: ChatgptConversationDeps = {
      fetchText: ({ path }) => {
        asked.push(path);
        return Promise.resolve(ok("{}"));
      },
    };
    expect(await runChatgptConversation({ deps, rest: [ID, "--home", home] })).toBe(EXIT_ERROR);
    expect(asked).toEqual([]);
  });

  it("refuses a usage error with EXIT_USAGE", async () => {
    const deps: ChatgptConversationDeps = { fetchText: () => Promise.resolve(ok("{}")) };
    expect(await runChatgptConversation({ deps, rest: ["not-an-id", "--home", home] })).toBe(EXIT_USAGE);
  });

  it("writes messages.jsonl and transcript.md at 0600 with the stored headers sent", async () => {
    const paste = join(home, "paste.txt");
    writeFileSync(paste, "authorization: Bearer t\nchatgpt-account-id: a\ncookie: c=1\noai-did: d\nuser-agent: UA\n");
    expect(
      runChatgptImportRequest({ nowIso: "2026-09-29T14:00:00.000Z", rest: ["--from", paste, "--home", home] }),
    ).toBe(EXIT_OK);
    const sent: ChatgptSessionHeaders[] = [];
    const asked: string[] = [];
    const body = {
      messages: [
        {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Ayo"] },
          create_time: 1_790_000_000,
          id: "m1",
        },
      ],
      page_info: { has_previous_page: false, start_cursor: "m1" },
      title: "Greeting exchange",
    };
    const deps: ChatgptConversationDeps = {
      fetchText: ({ headers, path }): Promise<Result<string, ChatgptError>> => {
        sent.push(headers);
        asked.push(path);
        return Promise.resolve(ok(JSON.stringify(body)));
      },
    };
    expect(await runChatgptConversation({ deps, rest: [ID, "--home", home] })).toBe(EXIT_OK);
    expect(asked).toEqual([newestPagePath({ id: ID })]);
    expect(sent.map((headers) => headers.cookie)).toEqual(["c=1"]);
    const directory = join(home, "live", "chatgpt", "conversations", ID);
    const lines = readFileSync(join(directory, "messages.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    expect(readFileSync(join(directory, "transcript.md"), "utf8")).toContain(
      "## user · 2026-09-21T14:13:20.000Z\n\nAyo\n",
    );
    expect(statSync(join(directory, "transcript.md")).mode & 0o777).toBe(0o600);
  });
});
