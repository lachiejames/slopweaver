/**
 * `chatgpt live-sync` over a throwaway home: each planned chat read whole and held, the first refusal stopping every
 * further request, the refresh leg run whenever the live copy holds anything, a second run reading only what moved,
 * and the one-run lock. The listing walk and the GET edge are plain fakes passed in; the snapshot store is real.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireOperationLockDetailed } from "../../../../../admit/operationLock.js";
import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import type { ChatgptInventory, ListedChatgptConversation } from "../../../../../cli/commands/chatgpt/listing.js";
import { bodyBehindListing, readPlannedConversations } from "../../../../../cli/commands/chatgpt/liveSyncRead.js";
import {
  type ChatgptLiveSyncDeps,
  liveSyncSummaryLines,
  parseLiveSyncArgs,
  runChatgptLiveSync,
} from "../../../../../cli/commands/chatgpt/liveSyncRun.js";
import { importRequestPaste } from "../../../../../cli/commands/chatgpt/session.js";
import { CHATGPT_WEB_CAVEATS } from "../../../../../cli/commands/chatgpt/usage.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { readLiveAsOf } from "../../../../../corpus/chatgpt/liveAsOf.js";
import { conversationDir, heldLiveManifests } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { chatId } from "../../../../chatgptFixture.js";
import { NO_PROTECTION, UNPROTECTED } from "../../../../noProtection.js";
import { conversation, liveBody, tempDir, useTempDirs } from "../../../corpus/chatgpt/ingest/harness.js";

useTempDirs();

const Y = chatId({ name: "conv-y" });
const Z = chatId({ name: "conv-z" });
const NO_PACE = { beforeRequest: (): Promise<void> => Promise.resolve() };

/** A listed chat at an update. */
function listed({ id, updatedIso }: { id: string; updatedIso: string }): ListedChatgptConversation {
  return { createdIso: "2026-01-01T00:00:00.000Z", id, lane: "active", projectId: null, title: "Secret", updatedIso };
}

/** An epoch later than every listing below, so a body at it is current. */
const CURRENT_UPDATE = 1794000000;

/** An epoch earlier than every listing below, so a body at it is older than its listing. */
const STALE_UPDATE = 1790100000;

/** The whole-conversation body for one named chat, current unless an older update is given. */
function bodyOf({
  name,
  text,
  updateTime = CURRENT_UPDATE,
}: {
  name: string;
  text: string;
  updateTime?: number;
}): string {
  return JSON.stringify(liveBody({ chat: conversation({ id: name, text, updateTime }) }));
}

/** A GET edge answering from a table, recording each path asked; an unlisted path answers 404. */
function tableFetch({ answers }: { answers: ReadonlyMap<string, Result<string, ChatgptError>> }): {
  asked: string[];
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
} {
  const asked: string[] = [];
  return {
    asked,
    fetchText: ({ path }) => {
      asked.push(path);
      const answer = answers.get(path);
      if (answer === undefined) {
        return Promise.resolve(err(ChatgptErrors.httpRefused({ path, status: 404 })));
      }
      return Promise.resolve(answer);
    },
  };
}

/** A home with a stored session. */
function homeWithSession(): string {
  const home = tempDir();
  const from = join(home, "paste.txt");
  const paste = ["authorization: Bearer opaque", "chatgpt-account-id: a", "cookie: c", "oai-did: d", "user-agent: u"];
  writeFileSync(from, paste.join("\n"));
  unwrap(importRequestPaste({ from, home, nowIso: "2026-11-17T00:00:00.000Z" }));
  return home;
}

/** The run's edges over a listing and a GET table, recording every in-process verb call. */
function depsFor({
  inventory,
  answers,
  refreshExit,
}: {
  inventory: Result<ChatgptInventory, ChatgptError>;
  answers: ReadonlyMap<string, Result<string, ChatgptError>>;
  refreshExit: number;
}): { deps: ChatgptLiveSyncDeps; asked: string[]; verbs: (readonly string[])[] } {
  const table = tableFetch({ answers });
  const verbs: (readonly string[])[] = [];
  return {
    asked: table.asked,
    deps: {
      listInventory: () => Promise.resolve(inventory),
      nowIso: () => "2026-11-18T00:00:00.000Z",
      pacer: NO_PACE,
      protection: NO_PROTECTION,
      runVerb: (argv) => {
        verbs.push(argv);
        return Promise.resolve(refreshExit);
      },
      web: { fetchText: ({ path }) => table.fetchText({ path }) },
    },
    verbs,
  };
}

/** An inventory of the given chats. */
function inventoryOf({ conversations }: { conversations: readonly ListedChatgptConversation[] }): ChatgptInventory {
  return { conversations, projects: [], repeats: 0, requests: 1 };
}

describe("parseLiveSyncArgs", () => {
  it("defaults the listing bound, reads every due chat unless bounded, and refuses a bound under 1", () => {
    expect(unwrap(parseLiveSyncArgs({ rest: ["--home", "/h"] }))).toEqual({
      home: "/h",
      maxConversations: undefined,
      maxPages: 500,
    });
    expect(unwrap(parseLiveSyncArgs({ rest: ["--home", "/h", "--max-conversations", "40"] })).maxConversations).toBe(
      40,
    );
    expect(unwrapErr(parseLiveSyncArgs({ rest: ["--max-conversations", "0"] }))[0]).toBe(
      "--max-conversations must be a whole number of at least 1, got 0",
    );
  });
});

describe("readPlannedConversations", () => {
  it("holds each chat as it is read, in the order planned", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
        [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [
        listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
        listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
      ],
    });
    expect(outcome).toEqual({ behind: 0, read: 2, stoppedBy: undefined });
    expect(table.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    const held = unwrap(heldLiveManifests({ root }));
    expect(held.get(Z)!.listedUpdatedIso).toBe("2026-11-02T00:00:00.000Z");
    expect(held.get(Y)!.bodyUpdatedIso).toBe("2026-11-06T21:20:00.000Z");
  });

  it("holds a body older than its listing at the body's own update, so the next plan reads it again", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why", updateTime: STALE_UPDATE }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    expect(outcome).toEqual({ behind: 1, read: 1, stoppedBy: undefined });
    expect(unwrap(heldLiveManifests({ root })).get(Y)!.listedUpdatedIso).toBe("2026-09-22T18:00:00.000Z");
  });

  it("stops at the first refusal, keeping what it held and asking for nothing after", async () => {
    const root = join(tempDir(), "live");
    const third = chatId({ name: "conv-x" });
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
        [
          `/backend-api/conversation/${Y}`,
          err(ChatgptErrors.httpRefused({ path: `/backend-api/conversation/${Y}`, status: 429 })),
        ],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [
        listed({ id: Z, updatedIso: "2026-11-03T00:00:00.000Z" }),
        listed({ id: Y, updatedIso: "2026-11-02T00:00:00.000Z" }),
        listed({ id: third, updatedIso: "2026-11-01T00:00:00.000Z" }),
      ],
    });
    expect(outcome.read).toBe(1);
    expect(outcome.stoppedBy!.code).toBe("HTTP_REFUSED");
    expect(table.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    expect([...unwrap(heldLiveManifests({ root })).keys()]).toEqual([Z]);
  });

  it("stops on a body that does not read, holding nothing for it", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(JSON.stringify({ surprise: true }))],
      ]),
    });
    const outcome = await readPlannedConversations({
      ...UNPROTECTED,
      fetchText: table.fetchText,
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    expect(outcome.read).toBe(0);
    expect(outcome.stoppedBy!.code).toBe("PAGE_MALFORMED");
    expect(unwrap(heldLiveManifests({ root })).size).toBe(0);
  });

  it("stops on a live copy the owner's list marks read-only, writing nothing of the chat it read", async () => {
    const root = join(tempDir(), "live");
    const table = tableFetch({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      ]),
    });
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: root, why: "kept as it is" }]);
    const outcome = await readPlannedConversations({
      fetchText: table.fetchText,
      home: tempDir(),
      nowIso: () => "2026-11-18T00:00:00.000Z",
      onProgress: () => undefined,
      pacer: NO_PACE,
      protection,
      root,
      toRead: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })],
    });
    const directory = conversationDir({ conversationId: Y, root });
    expect(outcome.read).toBe(0);
    expect(outcome.stoppedBy!.message).toBe(
      `chatgpt: refusing to hold the live snapshot in ${directory}: it would write to ${directory}, which the ` +
        `owner's protect list marks read-only at ${root} (kept as it is) — nothing was written`,
    );
    expect(existsSync(root)).toBe(false);
  });
});

describe("liveSyncSummaryLines", () => {
  it("counts what was listed, held and left, and prints no title", () => {
    const lines = liveSyncSummaryLines({
      behind: 0,
      bearerExpiresIso: "2026-11-26T14:10:55.000Z",
      current: 3,
      listed: 10,
      planned: 7,
      read: 5,
    });
    expect(lines).toEqual([
      "chatgpt live-sync: listed 10 conversation(s); 3 already held at their listed update",
      "  read and held 5 of the 7 new or changed, newest first",
      "  2 left for the next run, which picks up exactly where this one stopped",
      "  the session's bearer expires 2026-11-26T14:10:55.000Z",
      ...CHATGPT_WEB_CAVEATS.map((caveat) => `  ${caveat}`),
    ]);
  });

  it("names how many ChatGPT answered older than it listed them", () => {
    const lines = liveSyncSummaryLines({
      behind: 2,
      bearerExpiresIso: null,
      current: 0,
      listed: 4,
      planned: 4,
      read: 4,
    });
    expect(lines.slice(0, 3)).toEqual([
      "chatgpt live-sync: listed 4 conversation(s); 0 already held at their listed update",
      "  read and held 4 of the 4 new or changed, newest first",
      "  2 answered older than the listing said; held as answered, read again next run, nothing certified",
    ]);
  });
});

describe("bodyBehindListing", () => {
  it("is true only for a body strictly older than its listing", () => {
    const listedUpdatedIso = "2026-11-17T14:11:57.662Z";
    expect(
      [null, "2026-11-17T14:12:01.825Z", listedUpdatedIso, "2026-11-17T14:11:57.661Z"].map((bodyUpdatedIso) =>
        bodyBehindListing({ bodyUpdatedIso, listedUpdatedIso }),
      ),
    ).toEqual([false, false, false, true]);
  });
});

describe("runChatgptLiveSync", () => {
  it("refuses with no session, before any request or refresh", async () => {
    const run = depsFor({ answers: new Map(), inventory: ok(inventoryOf({ conversations: [] })), refreshExit: 0 });
    expect(await runChatgptLiveSync({ deps: run.deps, rest: ["--home", tempDir()] })).toBe(EXIT_ERROR);
    expect(run.asked).toEqual([]);
    expect(run.verbs).toEqual([]);
  });

  it("holds every listed chat, refreshes, and a second run reads only the chat whose update moved", async () => {
    const home = homeWithSession();
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
    ]);
    const first = depsFor({
      answers,
      inventory: ok(
        inventoryOf({
          conversations: [
            listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
            listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
          ],
        }),
      ),
      refreshExit: EXIT_OK,
    });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(first.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    expect(first.verbs).toEqual([["node", "slopweaver", "refresh", "--source", "chatgpt", "--store", "--home", home]]);

    const second = depsFor({
      answers,
      inventory: ok(
        inventoryOf({
          conversations: [
            listed({ id: Y, updatedIso: "2026-11-05T00:00:00.000Z" }),
            listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
          ],
        }),
      ),
      refreshExit: EXIT_OK,
    });
    expect(await runChatgptLiveSync({ deps: second.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(second.asked).toEqual([`/backend-api/conversation/${Y}`]);
    const held = unwrap(heldLiveManifests({ root: stateHomePaths({ home }).corpus.chatgptLive }));
    expect(held.get(Y)!.listedUpdatedIso).toBe("2026-11-05T00:00:00.000Z");
  });

  it("certifies the listing's start only once every listed chat is held, never on a run its bound cut short", async () => {
    const home = homeWithSession();
    const root = stateHomePaths({ home }).corpus.chatgptLive;
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
    ]);
    const inventory = ok(
      inventoryOf({
        conversations: [
          listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
          listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
        ],
      }),
    );
    const bounded = depsFor({ answers, inventory, refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: bounded.deps, rest: ["--home", home, "--max-conversations", "1"] })).toBe(
      EXIT_OK,
    );
    expect(unwrap(readLiveAsOf({ root }))).toBe(undefined);
    const rest = depsFor({ answers, inventory, refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: rest.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(rest.asked).toEqual([`/backend-api/conversation/${Y}`]);
    expect(unwrap(readLiveAsOf({ root }))).toBe("2026-11-18T00:00:00.000Z");
  });

  it("certifies nothing when ChatGPT answers a body older than its listing, and the next run reads it again", async () => {
    const home = homeWithSession();
    const root = stateHomePaths({ home }).corpus.chatgptLive;
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why", updateTime: STALE_UPDATE }))],
    ]);
    const inventory = ok(inventoryOf({ conversations: [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })] }));
    const first = depsFor({ answers, inventory, refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(unwrap(readLiveAsOf({ root }))).toBe(undefined);
    const second = depsFor({ answers, inventory, refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: second.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(second.asked).toEqual([`/backend-api/conversation/${Y}`]);
  });

  it("answers 3 when every chat is current and the refresh finds nothing new", async () => {
    const home = homeWithSession();
    const conversations = [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })];
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
    ]);
    const first = depsFor({ answers, inventory: ok(inventoryOf({ conversations })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    const again = depsFor({ answers, inventory: ok(inventoryOf({ conversations })), refreshExit: EXIT_EXPECTED_EMPTY });
    expect(await runChatgptLiveSync({ deps: again.deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(again.asked).toEqual([]);
    expect(again.verbs.length).toBe(1);
  });

  it("still refreshes what it held when a later read is refused, and answers 1", async () => {
    const home = homeWithSession();
    const run = depsFor({
      answers: new Map<string, Result<string, ChatgptError>>([
        [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
        [
          `/backend-api/conversation/${Y}`,
          err(ChatgptErrors.httpRefused({ path: `/backend-api/conversation/${Y}`, status: 401 })),
        ],
      ]),
      inventory: ok(
        inventoryOf({
          conversations: [
            listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
            listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
          ],
        }),
      ),
      refreshExit: EXIT_OK,
    });
    expect(await runChatgptLiveSync({ deps: run.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(run.verbs.length).toBe(1);
  });

  it("answers 1 and refreshes nothing when the listing fails and nothing is held", async () => {
    const home = homeWithSession();
    const run = depsFor({
      answers: new Map(),
      inventory: err(ChatgptErrors.httpRefused({ path: "/backend-api/conversations", status: 429 })),
      refreshExit: EXIT_OK,
    });
    expect(await runChatgptLiveSync({ deps: run.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(run.verbs).toEqual([]);
  });

  it("answers 4, not yet, while another run holds the lock", async () => {
    const home = homeWithSession();
    const held = unwrap(
      acquireOperationLockDetailed({ home, key: "chatgpt-live-sync", nowIso: "2026-11-18T00:00:00.000Z" }),
    );
    try {
      const run = depsFor({ answers: new Map(), inventory: ok(inventoryOf({ conversations: [] })), refreshExit: 0 });
      expect(await runChatgptLiveSync({ deps: run.deps, rest: ["--home", home] })).toBe(EXIT_DEFERRED);
      expect(run.asked).toEqual([]);
    } finally {
      held.release();
    }
  });
});
