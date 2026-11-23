/** `chatgpt list`: its flags, its bounded summary, and refusing before any request with no session. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listSummaryLines, parseListArgs, runChatgptList } from "../../../../../cli/commands/chatgpt/listRun.js";
import { CHATGPT_WEB_CAVEATS } from "../../../../../cli/commands/chatgpt/usage.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseListArgs", () => {
  it("defaults the per-lane page bound and refuses one under 1", () => {
    expect(unwrap(parseListArgs({ rest: ["--home", "/h"] }))).toEqual({ home: "/h", json: false, maxPages: 500 });
    expect(unwrapErr(parseListArgs({ rest: ["--max-pages", "0"] }))[0]).toBe(
      "--max-pages must be a whole number of at least 1, got 0",
    );
  });
});

describe("listSummaryLines", () => {
  it("counts each lane and the repeats, names the update span and expiry, and prints no title", () => {
    const lines = listSummaryLines({
      bearerExpiresIso: "2026-11-26T14:10:55.000Z",
      inventory: {
        conversations: [
          {
            createdIso: "2026-01-01T00:00:00.000Z",
            id: "a",
            lane: "active",
            projectId: null,
            title: "Secret title",
            updatedIso: "2026-11-02T00:00:00.000Z",
          },
          {
            createdIso: "2025-01-01T00:00:00.000Z",
            id: "b",
            lane: "archived",
            projectId: null,
            title: null,
            updatedIso: "2025-03-01T00:00:00.000Z",
          },
        ],
        projects: [{ id: "g-p-1", name: "Secret project" }],
        repeats: 3,
        requests: 7,
      },
    });
    expect(lines).toEqual([
      "listed 2 conversation(s) over 7 request(s): 1 active, 1 archived, 0 in 1 project(s)",
      "  3 listing(s) named a conversation already listed; each is counted once",
      "  updates run from 2025-03-01T00:00:00.000Z to 2026-11-02T00:00:00.000Z",
      "  the session's bearer expires 2026-11-26T14:10:55.000Z",
      ...CHATGPT_WEB_CAVEATS.map((caveat) => `  ${caveat}`),
    ]);
    expect(lines.join("\n")).not.toContain("Secret");
  });
});

describe("runChatgptList", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "chatgpt-list-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses with no session, before any request", async () => {
    const asked: string[] = [];
    const code = await runChatgptList({
      deps: {
        pacer: { beforeRequest: () => Promise.resolve() },
        web: {
          fetchText: ({ path }) => {
            asked.push(path);
            return Promise.resolve(ok("{}"));
          },
        },
      },
      rest: ["--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(asked).toEqual([]);
  });
});
