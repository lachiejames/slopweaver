/**
 * The relay-words guard's runner and its real readers. The property that matters on a loaded machine is proved by
 * recording every read: a write that is not a board row reads NOTHING, a status edit on a relay row reads the row
 * alone, and the talk records are read only for a protected part that changed. The real readers are then run against a
 * throwaway home the shipped relay code wrote (`../../relayWordsFixture.ts`), never the operator's own.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_ALLOW, EXIT_BLOCK } from "../../../admit/preToolUseDispatch.js";
import { type RelayWordsReaders, relayWordsPayload, runRelayWordsGuard } from "../../../admit/relayWordsGuardRunner.js";
import { relayWordsSeams } from "../../../admit/relayWordsSeams.js";
import { type RelayFixture, relayFixture } from "../../relayWordsFixture.js";

const CLASS = "[class: a private reply steer]";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh relay in a throwaway home, removed after the test. */
function fixture(): RelayFixture {
  const made = relayFixture({ offered: undefined });
  homes.push(made.home);
  return made;
}

/** The real readers wrapped so every call is recorded, by name. */
function recorded({ readers }: { readers: RelayWordsReaders }): { readers: RelayWordsReaders; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    readers: {
      handoversDir: readers.handoversDir,
      readPrior: (args) => {
        calls.push("readPrior");
        return readers.readPrior(args);
      },
      readTurn: (args) => {
        calls.push("readTurn");
        return readers.readTurn(args);
      },
      realDir: (args) => {
        calls.push("realDir");
        return readers.realDir(args);
      },
      resolveRecord: (args) => {
        calls.push("resolveRecord");
        return readers.resolveRecord(args);
      },
    },
  };
}

/** Run the guard over one payload against the fixture's home, recording every read and every refusal line. */
async function run({
  made,
  payload,
  env = {},
}: {
  made: RelayFixture;
  payload: unknown;
  env?: Record<string, string>;
}): Promise<{ code: number; calls: readonly string[]; errors: readonly string[] }> {
  const { calls, readers } = recorded({ readers: relayWordsSeams({ env: { SLOPWEAVER_HOME: made.home } }) });
  const errors: string[] = [];
  const code = await runRelayWordsGuard({
    env,
    readStdin: () => Promise.resolve(JSON.stringify(payload)),
    readers,
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { calls, code, errors };
}

/** A `Write` payload of the whole file. */
function write({ path, content }: { path: string; content: string }): unknown {
  return { cwd: "/repo", tool_input: { content, file_path: path }, tool_name: "Write" };
}

describe("runRelayWordsGuard", () => {
  it("allows an ordinary source edit having read nothing", async () => {
    const made = fixture();
    const payload = {
      tool_input: { file_path: "/repo/src/a.ts", new_string: "b", old_string: "a" },
      tool_name: "Edit",
    };
    expect(await run({ made, payload })).toEqual({ calls: [], code: EXIT_ALLOW, errors: [] });
  });

  it("allows a status edit on a relay row having read the row alone", async () => {
    const made = fixture();
    const payload = {
      tool_input: { file_path: made.path, new_string: "status: done", old_string: "status: ready" },
      tool_name: "Edit",
    };
    expect(await run({ made, payload })).toEqual({ calls: ["readPrior"], code: EXIT_ALLOW, errors: [] });
  });

  it("refuses the incident's Write, reading the record and the turn, and names the hatch", async () => {
    const made = fixture();
    const content = made.text.split(JSON.stringify(made.ask)).join(JSON.stringify(CLASS)).split(made.ask).join(CLASS);
    const result = await run({ made, payload: write({ content, path: made.path }) });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.calls).toEqual(["readPrior", "readTurn"]);
    expect(result.errors.join("")).toContain("the summary no longer rebuilds to the digest the relay turn stored");
    expect(result.errors.join("")).toContain("SLOPWEAVER_ALLOW_RELAY_WORDS=1");
  });

  it("allows the same Write with the hatch open, having read nothing", async () => {
    const made = fixture();
    const result = await run({
      env: { SLOPWEAVER_ALLOW_RELAY_WORDS: "1" },
      made,
      payload: write({ content: "reworded", path: made.path }),
    });
    expect(result).toEqual({ calls: [], code: EXIT_ALLOW, errors: [] });
  });

  it("allows a new file on the board — a row is born by `handover register`, not judged as a hand edit", async () => {
    const made = fixture();
    const result = await run({ made, payload: write({ content: "---\n---\n", path: `${made.handoversDir}/new.md` }) });
    expect(result).toEqual({ calls: ["readPrior"], code: EXIT_ALLOW, errors: [] });
  });

  it("fails open on a payload it cannot read", async () => {
    const made = fixture();
    expect(await run({ made, payload: "not an object" })).toEqual({ calls: [], code: EXIT_ALLOW, errors: [] });
  });
});

describe("relayWordsPayload", () => {
  it("reads an Edit's four fields and a payload's cwd", () => {
    const raw = JSON.stringify({
      cwd: "/repo",
      tool_input: { file_path: "a.md", new_string: "n", old_string: "o", replace_all: true },
      tool_name: "Edit",
    });
    expect(relayWordsPayload({ raw })).toEqual({
      cwd: "/repo",
      filePath: "a.md",
      replaceAll: true,
      replacedText: "o",
      text: "n",
      toolName: "Edit",
    });
  });

  it("is null for a tool it does not judge, a missing field, or text that is not JSON", () => {
    const read = JSON.stringify({ tool_input: { file_path: "a.md" }, tool_name: "Read" });
    const missing = JSON.stringify({ tool_input: { file_path: "a.md" }, tool_name: "Write" });
    expect([
      relayWordsPayload({ raw: read }),
      relayWordsPayload({ raw: missing }),
      relayWordsPayload({ raw: "{" }),
    ]).toEqual([null, null, null]);
  });
});

describe("relayWordsSeams", () => {
  it("reads the guarded home's board, row, turn and record", async () => {
    const made = fixture();
    const readers = relayWordsSeams({ env: { SLOPWEAVER_HOME: made.home } });
    const turn = await readers.readTurn({ turnId: made.turn.turnId });
    const record = await readers.resolveRecord({ anchor: made.anchor });
    expect(readers.handoversDir).toBe(made.handoversDir);
    expect(readers.readPrior({ path: made.path })).toBe(made.text);
    expect(turn!.digest).toBe(made.turn.digest);
    expect(record.kind).toBe("held");
  });

  it("answers absence rather than throwing: no row, no turn, no directory", async () => {
    const made = fixture();
    const readers = relayWordsSeams({ env: { SLOPWEAVER_HOME: made.home } });
    const turn = await readers.readTurn({ turnId: "0f6b7a52-0000-4d55-9b8e-5f0c2a1d9e33" });
    expect([
      readers.readPrior({ path: `${made.handoversDir}/none.md` }),
      turn,
      readers.realDir({ dir: `${made.home}/none` }),
    ]).toEqual([null, undefined, undefined]);
  });
});
