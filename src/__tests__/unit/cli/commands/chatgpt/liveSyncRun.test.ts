/**
 * `chatgpt live-sync` over a throwaway home: the refresh leg run whenever the live copy holds anything, a second run
 * reading only what moved, the carried listing, the summary and the one-run lock. The reading leg alone is
 * `liveSyncRead.test.ts`. The listing walk and the GET edge are plain fakes passed in; the snapshot store is real.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireOperationLockDetailed } from "../../../../../admit/operationLock.js";
import { type ChatgptError, ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";
import type { ChatgptInventory, ListedChatgptConversation } from "../../../../../cli/commands/chatgpt/listing.js";
import { readListingCarry } from "../../../../../cli/commands/chatgpt/liveSyncCarry.js";
import { listingStopLine, liveSyncSummaryLines } from "../../../../../cli/commands/chatgpt/liveSyncReport.js";
import {
  type ChatgptLiveSyncDeps,
  parseLiveSyncArgs,
  runChatgptLiveSync,
} from "../../../../../cli/commands/chatgpt/liveSyncRun.js";
import { importRequestPaste } from "../../../../../cli/commands/chatgpt/session.js";
import { CHATGPT_WEB_CAVEATS } from "../../../../../cli/commands/chatgpt/usage.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { readLiveAsOf } from "../../../../../corpus/chatgpt/liveAsOf.js";
import { heldLiveManifests } from "../../../../../corpus/chatgpt/liveSnapshotStore.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { chatId } from "../../../../chatgptFixture.js";
import { NO_PROTECTION } from "../../../../noProtection.js";
import { tempDir, useTempDirs } from "../../../corpus/chatgpt/ingest/harness.js";
import { bodyOf, listed, NO_PACE, STALE_UPDATE, tableFetch, Y, Z } from "./liveSyncFakes.js";

useTempDirs();

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
}): {
  deps: ChatgptLiveSyncDeps;
  asked: string[];
  verbs: (readonly string[])[];
  knownThrough: (string | undefined)[];
} {
  const table = tableFetch({ answers });
  const verbs: (readonly string[])[] = [];
  const knownThrough: (string | undefined)[] = [];
  return {
    asked: table.asked,
    deps: {
      backoff: () => Promise.resolve(),
      listInventory: ({ knownThroughIso }) => {
        knownThrough.push(knownThroughIso);
        return Promise.resolve(inventory);
      },
      nowIso: () => "2026-11-18T00:00:00.000Z",
      pacer: NO_PACE,
      protection: NO_PROTECTION,
      runVerb: (argv) => {
        verbs.push(argv);
        return Promise.resolve(refreshExit);
      },
      web: { fetchText: ({ path }) => table.fetchText({ path }) },
    },
    knownThrough,
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
      relist: false,
    });
    expect(unwrap(parseLiveSyncArgs({ rest: ["--home", "/h", "--relist"] })).relist).toBe(true);
    expect(unwrap(parseLiveSyncArgs({ rest: ["--home", "/h", "--max-conversations", "40"] })).maxConversations).toBe(
      40,
    );
    expect(unwrapErr(parseLiveSyncArgs({ rest: ["--max-conversations", "0"] }))[0]).toBe(
      "--max-conversations must be a whole number of at least 1, got 0",
    );
  });
});

describe("liveSyncSummaryLines", () => {
  it("counts what was listed, held and left, and prints no title", () => {
    const lines = liveSyncSummaryLines({
      behind: 0,
      bearerExpiresIso: "2026-11-26T14:10:55.000Z",
      current: 3,
      gone: 0,
      listed: 10,
      listedSinceIso: undefined,
      listingRequests: 3,
      planned: 7,
      read: 5,
    });
    expect(lines).toEqual([
      "chatgpt live-sync: listed 10 conversation(s); 3 already held at their listed update",
      "  listing: the whole account, 3 request(s)",
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
      gone: 0,
      listed: 4,
      listedSinceIso: "2026-11-17T23:50:00.000Z",
      listingRequests: 2,
      planned: 4,
      read: 4,
    });
    expect(lines.slice(0, 4)).toEqual([
      "chatgpt live-sync: listed 4 conversation(s); 0 already held at their listed update",
      "  listing: only what moved since 2026-11-17T23:50:00.000Z, laid over the carried one, 2 request(s)",
      "  read and held 4 of the 4 new or changed, newest first",
      "  2 answered older than the listing said; held as answered, read again next run, nothing certified",
    ]);
  });
});

describe("where a listing stopped", () => {
  it("names an offset lane's stop by its offset", () => {
    expect(listingStopLine({ stoppedAt: { kind: "offset", lane: "archived", offset: 56 } })).toBe(
      "chatgpt live-sync: the listing stopped in the archived lane at offset 56; the last completed listing, if any, stays the one carried",
    );
  });

  it("names a cursor lane's stop by its page, never an offset", () => {
    expect(listingStopLine({ stoppedAt: { kind: "cursor", lane: "projects", page: 2 } })).toBe(
      "chatgpt live-sync: the listing stopped in the projects lane on page 2; the last completed listing, if any, stays the one carried",
    );
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

  it("carries the listing: a stopped backfill's next run lists only what moved, yet still reads the chats it never reached", async () => {
    const home = homeWithSession();
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
      [`/backend-api/conversation/${Z}`, ok(bodyOf({ name: "conv-z", text: "zed" }))],
    ]);
    const whole = [
      listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
      listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
    ];
    const first = depsFor({ answers, inventory: ok(inventoryOf({ conversations: whole })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home, "--max-conversations", "1"] })).toBe(
      EXIT_OK,
    );
    expect(first.knownThrough).toEqual([undefined]);
    expect(first.asked).toEqual([`/backend-api/conversation/${Z}`]);
    // The next run's listing names nothing new at all, so only the carry can say Y was never read.
    const second = depsFor({ answers, inventory: ok(inventoryOf({ conversations: [] })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: second.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(second.knownThrough).toEqual(["2026-11-17T23:50:00.000Z"]);
    expect(second.asked).toEqual([`/backend-api/conversation/${Y}`]);
  });

  it("drops a carried chat deleted on the account once, and still reads the never-read chat behind it", async () => {
    const home = homeWithSession();
    const root = stateHomePaths({ home }).corpus.chatgptLive;
    const third = chatId({ name: "conv-x" });
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${third}`, ok(bodyOf({ name: "conv-x", text: "ex" }))],
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
    ]);
    const whole = [
      listed({ id: third, updatedIso: "2026-11-03T00:00:00.000Z" }),
      listed({ id: Z, updatedIso: "2026-11-02T00:00:00.000Z" }),
      listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" }),
    ];
    const first = depsFor({ answers, inventory: ok(inventoryOf({ conversations: whole })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home, "--max-conversations", "1"] })).toBe(
      EXIT_OK,
    );
    // Z was deleted before the next run: ChatGPT answers 404 for it (the table holds no answer for its path).
    const second = depsFor({ answers, inventory: ok(inventoryOf({ conversations: [] })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: second.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(second.asked).toEqual([`/backend-api/conversation/${Z}`, `/backend-api/conversation/${Y}`]);
    expect(unwrap(readListingCarry({ root }))!.conversations.map((one) => one.id)).toEqual([third, Y]);
    expect(unwrap(readLiveAsOf({ root }))).toBe("2026-11-18T00:00:00.000Z");
    const again = depsFor({ answers, inventory: ok(inventoryOf({ conversations: [] })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: again.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(again.asked).toEqual([]);
  });

  it("lists the whole account again on --relist, and a walk that failed writes no carry", async () => {
    const home = homeWithSession();
    const root = stateHomePaths({ home }).corpus.chatgptLive;
    const failed = depsFor({
      answers: new Map(),
      inventory: err(ChatgptErrors.httpRefused({ path: "/backend-api/conversations", status: 504 })),
      refreshExit: EXIT_OK,
    });
    expect(await runChatgptLiveSync({ deps: failed.deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(unwrap(readListingCarry({ root }))).toBe(undefined);
    const conversations = [listed({ id: Y, updatedIso: "2026-11-01T00:00:00.000Z" })];
    const answers = new Map<string, Result<string, ChatgptError>>([
      [`/backend-api/conversation/${Y}`, ok(bodyOf({ name: "conv-y", text: "why" }))],
    ]);
    const first = depsFor({ answers, inventory: ok(inventoryOf({ conversations })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: first.deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(unwrap(readListingCarry({ root }))!.conversations.map((one) => one.id)).toEqual([Y]);
    const relisted = depsFor({ answers, inventory: ok(inventoryOf({ conversations })), refreshExit: EXIT_OK });
    expect(await runChatgptLiveSync({ deps: relisted.deps, rest: ["--home", home, "--relist"] })).toBe(EXIT_OK);
    expect(relisted.asked).toEqual([]);
    expect(relisted.knownThrough).toEqual([undefined]);
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
