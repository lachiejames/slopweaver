/**
 * The `profile` verbs' shell, exercised on the paths that decide an exit code before a database is opened.
 *
 * Every case here is a refusal or a usage print, and that is the whole point rather than a limitation: the
 * runners' store-backed halves are proven against a real Postgres in the live run the pull request records,
 * while what a CALLER sees when they mistype a flag or point at a file that is not there is decided entirely
 * by this module and is what a person actually meets. `EXIT_USAGE` rather than `EXIT_ERROR` is the claim:
 * a bad invocation is the caller's to fix, and a shell that reported it as a failure of the system would
 * send them looking at the database.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  profileContextDisposition,
  profileContextReport,
  runProfileContext,
} from "../../../../../cli/commands/profile/contextRun.js";
import { runProfilePerson } from "../../../../../cli/commands/profile/personRun.js";
import { runProfileSet, runProfileShow, runProfileVoice } from "../../../../../cli/commands/profile/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { FIRST_BOOT_LINES, UNLOADED_HEADLINE } from "../../../../../context/loadLedger.js";

/** `argv` as the CLI hands it over, for one spoken verb and its tail. */
function argvFor({ verb, tail }: { verb: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "profile", verb, ...tail];
}

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-profile-run-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("every profile verb answers --help without reaching a store", () => {
  it("shows", async () => {
    expect(await runProfileShow(argvFor({ tail: ["--help"], verb: "show" }))).toBe(EXIT_OK);
  });

  it("sets", async () => {
    expect(await runProfileSet(argvFor({ tail: ["--help"], verb: "set" }))).toBe(EXIT_OK);
  });

  it("curates a person", async () => {
    expect(await runProfilePerson(argvFor({ tail: ["--help"], verb: "person" }))).toBe(EXIT_OK);
  });

  it("reads the voice register", async () => {
    expect(await runProfileVoice(argvFor({ tail: ["--help"], verb: "voice" }))).toBe(EXIT_OK);
  });

  it("renders the context", async () => {
    expect(await runProfileContext(argvFor({ tail: ["--help"], verb: "context" }))).toBe(EXIT_OK);
  });
});

describe("a bad invocation is refused as usage, before any connection is opened", () => {
  it("refuses `profile set` with no --file", async () => {
    expect(await runProfileSet(argvFor({ tail: [], verb: "set" }))).toBe(EXIT_USAGE);
  });

  it("refuses `profile person` naming nobody", async () => {
    expect(await runProfilePerson(argvFor({ tail: [], verb: "person" }))).toBe(EXIT_USAGE);
  });

  it("refuses `profile person` naming two different people", async () => {
    expect(await runProfilePerson(argvFor({ tail: ["--id", "u", "--name", "n"], verb: "person" }))).toBe(EXIT_USAGE);
  });

  it("refuses a --file that is not there, naming the path rather than the database", async () => {
    expect(await runProfileSet(argvFor({ tail: ["--file", join(dir, "absent.json")], verb: "set" }))).toBe(EXIT_USAGE);
  });

  it("refuses a --file holding a JSON array, which is not an owner row", async () => {
    const path = join(dir, "owner.json");
    writeFileSync(path, "[]", "utf8");
    expect(await runProfileSet(argvFor({ tail: ["--file", path], verb: "set" }))).toBe(EXIT_USAGE);
  });

  it("refuses an owner file with no displayName before it opens a store", async () => {
    const path = join(dir, "owner.json");
    writeFileSync(path, JSON.stringify({ selfDescription: {} }), "utf8");
    expect(await runProfileSet(argvFor({ tail: ["--file", path], verb: "set" }))).toBe(EXIT_USAGE);
  });
});

describe("profileContextReport", () => {
  const NONE = { lines: ["## About the owner", "unavailable: no store"], origin: "none" as const, reason: "no store" };

  it("prints the first-boot lines in place of the STOP block on a never-configured machine", () => {
    expect(profileContextReport({ firstBoot: true, json: false, loaded: NONE })).toEqual([
      ...FIRST_BOOT_LINES,
      "origin: none — no store",
    ]);
  });

  it("keeps the STOP block on an installed machine that loaded nothing", () => {
    const lines = profileContextReport({ firstBoot: false, json: false, loaded: NONE });
    expect([lines[0], lines.at(-1)]).toEqual([UNLOADED_HEADLINE, "origin: none — no store"]);
  });
});

describe("profileContextDisposition", () => {
  const NONE = { lines: [], origin: "none" as const, reason: "no store" };
  const CACHE = { lines: ["## About the owner"], origin: "cache" as const, reason: "" };
  const ABSENT = { lines: ["## About the owner"], origin: "live" as const, ownerAbsent: true as const, reason: "" };

  it("exits 0 and records nothing on a first boot, exits 1 and records on a configured miss, records every load", () => {
    expect([
      profileContextDisposition({ firstBoot: true, loaded: NONE }),
      profileContextDisposition({ firstBoot: false, loaded: NONE }),
      profileContextDisposition({ firstBoot: false, loaded: CACHE }),
    ]).toEqual([
      { exitCode: EXIT_OK, recordLoad: false },
      { exitCode: EXIT_ERROR, recordLoad: true },
      { exitCode: EXIT_OK, recordLoad: true },
    ]);
  });

  it("records nothing for a live read that found no owner row on a first boot, and records it on a configured machine", () => {
    // An empty live read recorded as a load let a session create the profile and act unloaded.
    expect([
      profileContextDisposition({ firstBoot: true, loaded: ABSENT }),
      profileContextDisposition({ firstBoot: false, loaded: ABSENT }),
    ]).toEqual([
      { exitCode: EXIT_OK, recordLoad: false },
      { exitCode: EXIT_OK, recordLoad: true },
    ]);
  });
});
