/*
 * Reading the target console's call registry: the run record names the port, a live server is asked, and every answer
 * short of the route's exact one is unreadable — while no server at all holds nothing, because the registry dies with
 * its process. Seams are plain fakes over an in-memory file map; nothing touches disk or the network.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cachePaths } from "../../../../../cacheHome.js";
import { consoleRecordKey } from "../../../../../checkouts/consoleBuild.js";
import {
  HELD_CONVERSATIONS_PATH,
  type HeldConversationsDeps,
  readHeldConversations,
} from "../../../../../cli/commands/desktop/e2eHeldConversationsRead.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

/** A file map value standing for a record that exists but cannot be read. */
const UNREADABLE = "\u0000unreadable";
const CHECKOUT = "/work/acme/slopweaver";
const HOME = "/home/acme/.slopweaver";
const CACHE = "/cache/acme";
const KEY = `${consoleRecordKey({ root: CHECKOUT })}.json`;
const CACHE_RECORD = join(cachePaths({ root: CACHE }).docsSite, KEY);
const HOME_RECORD = join(stateHomePaths({ home: HOME }).homeDocsSite, KEY);

/** A run record as `scripts/docs-site.sh` writes one. */
function record({ pid, port, worktree = CHECKOUT }: { pid: number; port: number; worktree?: string }): string {
  return JSON.stringify({ pid, port, startedIso: "2026-11-02T00:00:00Z", worktree });
}

/**
 * Fakes over a file map, a set of live pids and one answer per URL, recording every URL asked.
 *
 * @returns the seams and the URLs they were asked
 */
function fakes({
  files,
  live,
  answers,
}: {
  files: Readonly<Record<string, string>>;
  live: readonly number[];
  answers: Readonly<Record<string, { status: number; text: string } | Error>>;
}): { deps: HeldConversationsDeps; asked: string[] } {
  const asked: string[] = [];
  const deps: HeldConversationsDeps = {
    alive: ({ pid }) => live.includes(pid),
    get: async ({ url }) => {
      asked.push(url);
      const answer = answers[url]!;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    readText: ({ path }) => {
      const text = files[path];
      if (text === UNREADABLE) {
        return err("EACCES: permission denied");
      }
      return ok(text);
    },
  };
  return { asked, deps };
}

describe("readHeldConversations", () => {
  const URL_4100 = `http://localhost:4100${HELD_CONVERSATIONS_PATH}`;

  it("asks the port the cache root's record names and reads what is held", async () => {
    const { deps, asked } = fakes({
      answers: { [URL_4100]: { status: 200, text: JSON.stringify({ held: [{ id: "t1", surface: "typed" }] }) } },
      files: { [CACHE_RECORD]: record({ pid: 41, port: 4100 }) },
      live: [41],
    });
    const held = unwrap(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME }));
    expect([held, asked]).toEqual([[{ id: "t1", surface: "typed" }], [URL_4100]]);
  });

  it("reads the home's older record past a stopped server's in the cache root", async () => {
    const { deps, asked } = fakes({
      answers: { [URL_4100]: { status: 200, text: JSON.stringify({ held: [] }) } },
      files: { [CACHE_RECORD]: record({ pid: 7, port: 3000 }), [HOME_RECORD]: record({ pid: 41, port: 4100 }) },
      live: [41],
    });
    const held = unwrap(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME }));
    expect([held, asked]).toEqual([[], [URL_4100]]);
  });

  // A recycled pid in the cache root's record, its port answered by another console's empty registry,
  // once hid the live console the home's record names.
  it("asks every live record and holds what any of them holds", async () => {
    const URL_3000 = `http://localhost:3000${HELD_CONVERSATIONS_PATH}`;
    const { deps, asked } = fakes({
      answers: {
        [URL_3000]: { status: 200, text: JSON.stringify({ held: [] }) },
        [URL_4100]: { status: 200, text: JSON.stringify({ held: [{ id: "t1", surface: "typed" }] }) },
      },
      files: { [CACHE_RECORD]: record({ pid: 500, port: 3000 }), [HOME_RECORD]: record({ pid: 41, port: 4100 }) },
      live: [500, 41],
    });
    const held = unwrap(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME }));
    expect([held, asked]).toEqual([[{ id: "t1", surface: "typed" }], [URL_3000, URL_4100]]);
  });

  it("is unreadable when any live record's console cannot be asked, whatever another answered", async () => {
    const URL_3000 = `http://localhost:3000${HELD_CONVERSATIONS_PATH}`;
    const { deps } = fakes({
      answers: {
        [URL_3000]: { status: 200, text: JSON.stringify({ held: [] }) },
        [URL_4100]: new Error("connect ECONNREFUSED"),
      },
      files: { [CACHE_RECORD]: record({ pid: 500, port: 3000 }), [HOME_RECORD]: record({ pid: 41, port: 4100 }) },
      live: [500, 41],
    });
    expect(
      unwrapErr(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME })).message,
    ).toBe(
      `${URL_4100} could not be reached: connect ECONNREFUSED — whether the console holds a conversation cannot be told, so no test call is placed`,
    );
  });

  it("holds nothing, asking nothing, with no record or only a stopped server's", async () => {
    const none = fakes({ answers: {}, files: {}, live: [] });
    const stopped = fakes({ answers: {}, files: { [CACHE_RECORD]: record({ pid: 7, port: 3000 }) }, live: [] });
    expect([
      unwrap(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps: none.deps, home: HOME })),
      unwrap(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps: stopped.deps, home: HOME })),
      [...none.asked, ...stopped.asked],
    ]).toEqual([[], [], []]);
  });

  it("is unreadable, never none held, when a live server cannot be asked or answers wrong", async () => {
    const files = { [CACHE_RECORD]: record({ pid: 41, port: 4100 }) };
    const answersEach = [
      new Error("connect ECONNREFUSED"),
      { status: 404, text: "not found" },
      { status: 200, text: "<html>" },
      { status: 200, text: JSON.stringify({ calls: [] }) },
    ];
    const messages = await Promise.all(
      answersEach.map(async (answer) => {
        const { deps } = fakes({ answers: { [URL_4100]: answer }, files, live: [41] });
        return unwrapErr(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME }))
          .message;
      }),
    );
    expect(messages).toEqual([
      `${URL_4100} could not be reached: connect ECONNREFUSED — whether the console holds a conversation cannot be told, so no test call is placed`,
      `${URL_4100} answered 404 — whether the console holds a conversation cannot be told, so no test call is placed`,
      `${URL_4100} answered something that is not JSON — whether the console holds a conversation cannot be told, so no test call is placed`,
      `${URL_4100} answered a shape this build does not read — whether the console holds a conversation cannot be told, so no test call is placed`,
    ]);
  });

  // An unreadable record once read as no record, so as nothing held, beside a live typed conversation.
  it("is unreadable, never none held, when a record exists but cannot be read", async () => {
    const { deps, asked } = fakes({
      answers: {},
      files: { [CACHE_RECORD]: UNREADABLE, [HOME_RECORD]: record({ pid: 41, port: 4100 }) },
      live: [41],
    });
    const failure = unwrapErr(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME }));
    expect([failure.message, asked]).toEqual([
      `${CACHE_RECORD} could not be read: EACCES: permission denied — whether the console holds a conversation cannot be told, so no test call is placed`,
      [],
    ]);
  });

  it("refuses a record that names another checkout", async () => {
    const { deps } = fakes({
      answers: {},
      files: { [CACHE_RECORD]: record({ pid: 41, port: 4100, worktree: "/work/acme/other" }) },
      live: [41],
    });
    expect(
      unwrapErr(await readHeldConversations({ cacheRoot: CACHE, checkout: CHECKOUT, deps, home: HOME })).code,
    ).toBe("CONVERSATIONS_UNREADABLE");
  });
});
