/**
 * The shell's state file: a write is in place, whole, the moment it returns, and reads back.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { FRESH_STATE } from "../../src/persistedState";
import { readPersistedState, writePersistedState } from "../../src/stateStore";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh directory for one test's state file. */
const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "state-"));
  made.push(dir);
  return dir;
};

describe("writePersistedState", () => {
  it("has the state in place when it returns, leaving no temporary file", async () => {
    const dir = freshDir();
    const path = join(dir, "state.json");
    const state = { ...FRESH_STATE, permissionsDismissed: ["microphone", "systemAudio", "screen"] as const };
    const written = writePersistedState({ path, state });
    expect(written.isOk()).toBe(true);
    expect(readdirSync(dir)).toEqual(["state.json"]);
    const read = await readPersistedState({ path });
    expect(unwrap(read)).toEqual(state);
  });

  it("says why when the directory is not there", () => {
    const path = join(freshDir(), "missing", "state.json");
    const written = writePersistedState({ path, state: FRESH_STATE });
    expect(unwrapErr(written).code).toBe("STATE_UNWRITABLE");
    expect(unwrapErr(written).message).toContain("the window state could not be saved (ENOENT");
  });
});
