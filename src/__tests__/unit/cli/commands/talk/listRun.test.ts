/**
 * `talk list`'s verb shell and its human reading: who an item is from, the lines printed, and the exits a list
 * that is missing, broken or asked for wrongly gives. The list's own rules are `src/talk/runningList.ts`'s and the
 * store's are `runningListStore.ts`'s, each tested beside it; `list-add` reads stdin, so its shell is driven from
 * the subprocess lane rather than here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseListArgs } from "../../../../../cli/commands/talk/listArgs.js";
import { runningListLines, runningListWho, runTalkList } from "../../../../../cli/commands/talk/listRun.js";
import { TALK_LIST_ADD_USAGE, TALK_LIST_USAGE } from "../../../../../cli/commands/talk/listUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { RunningListErrors } from "../../../../../talk/runningListErrors.js";

/** The argv a verb sees before its own flags. */
const PREFIX = ["node", "slopweaver", "talk", "list"] as const;

const homes: string[] = [];

/** A fresh home, removed after the test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "talk-list-"));
  homes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("runningListWho", () => {
  it("names each origin, a fleet item by its session", () => {
    expect([
      runningListWho({ item: { origin: "owner" } }),
      runningListWho({ item: { origin: "voice" } }),
      runningListWho({ item: { from: "the-chair", origin: "fleet" } }),
      runningListWho({ item: { origin: "fleet" } }),
    ]).toEqual(["you", "the voice", "fleet · the-chair", "fleet"]);
  });
});

describe("runningListLines", () => {
  it("says the list is empty rather than printing nothing", () => {
    expect(runningListLines({ items: [] })).toEqual(["the running list is empty"]);
  });

  it("prints a heading, the exact text and a gap per item, the label after the time", () => {
    expect(
      runningListLines({
        items: [
          { atIso: "2026-10-12T09:00:00.000Z", id: "a", label: "reply", origin: "voice", seq: 4, text: "*on it*\n" },
          { atIso: "2026-10-12T08:00:00.000Z", id: "b", origin: "owner", seq: 2, text: "call Ari" },
        ],
      }),
    ).toEqual([
      "#4 · the voice · 2026-10-12T09:00:00.000Z · reply",
      "*on it*\n",
      "",
      "#2 · you · 2026-10-12T08:00:00.000Z",
      "call Ari",
      "",
    ]);
  });
});

describe("runTalkList", () => {
  it("prints its usage for --help", () => {
    expect(runTalkList([...PREFIX, "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage error", () => {
    expect(runTalkList([...PREFIX, "--nope", "--home", home()])).toBe(EXIT_USAGE);
  });

  it("reads a home that never held a list as the empty list", () => {
    expect(runTalkList([...PREFIX, "--json", "--home", home()])).toBe(EXIT_OK);
  });

  it("fails on a list file that will not decode, rather than reading it as empty", () => {
    const dir = home();
    mkdirSync(join(dir, "talk"), { recursive: true });
    writeFileSync(join(dir, "talk", "running-list.json"), "{ not json");
    expect(runTalkList([...PREFIX, "--json", "--home", dir])).toBe(EXIT_ERROR);
  });
});

describe("parseListArgs", () => {
  it("leaves --since unset when absent, and takes zero and the largest safe number", () => {
    expect([
      unwrap(parseListArgs({ rest: [] })).since,
      unwrap(parseListArgs({ rest: ["--since", "0"] })).since,
      unwrap(parseListArgs({ rest: ["--since", "9007199254740991"] })).since,
    ]).toEqual([undefined, 0, 9007199254740991]);
  });

  it("refuses a --since that is negative, fractional, words or past a safe number", () => {
    expect([
      unwrapErr(parseListArgs({ rest: ["--since", "-1"] })),
      unwrapErr(parseListArgs({ rest: ["--since", "1.5"] })),
      unwrapErr(parseListArgs({ rest: ["--since", "later"] })),
      unwrapErr(parseListArgs({ rest: ["--since", "9007199254740992"] })),
    ]).toEqual([
      ["--since must be a non-negative whole number, got -1"],
      ["--since must be a non-negative whole number, got 1.5"],
      ["--since must be a non-negative whole number, got later"],
      ["--since must be a non-negative whole number, got 9007199254740992"],
    ]);
  });
});

describe("the usage lines", () => {
  it("name every flag each verb takes", () => {
    expect([
      ["--since", "--voice-safe", "--home", "--json"].filter((flag) => !TALK_LIST_USAGE.includes(flag)),
      ["--origin", "--from", "--label", "--id", "--home", "--json"].filter(
        (flag) => !TALK_LIST_ADD_USAGE.includes(flag),
      ),
    ]).toEqual([[], []]);
  });
});

describe("RunningListErrors", () => {
  it("words each variant from its own fields", () => {
    expect([
      RunningListErrors.inputInvalid({ field: "text", why: "it is empty" }),
      RunningListErrors.storeUnreadable({ path: "/h/talk/running-list.json", why: "not an object" }),
      RunningListErrors.storeIo({ cause: new Error("EACCES"), path: "/h/talk" }),
      RunningListErrors.lockHeld({ cause: "timed out", path: "/h/talk/running-list.json.lock" }),
    ]).toEqual([
      { code: "INPUT_INVALID", field: "text", message: "the running list will not hold this text: it is empty" },
      {
        code: "STORE_UNREADABLE",
        message: "the running list at /h/talk/running-list.json is not a running list: not an object",
        path: "/h/talk/running-list.json",
      },
      { code: "STORE_IO", message: "the running list at /h/talk could not be used — EACCES", path: "/h/talk" },
      {
        code: "LOCK_HELD",
        message: "another writer held the running list's lock — timed out",
        path: "/h/talk/running-list.json.lock",
      },
    ]);
  });
});
