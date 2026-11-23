import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { ResyncState } from "../../../../live/resync/outcome.js";
import { readAllResyncState, readResyncState, writeResyncState } from "../../../../live/resync/outcomeStore.js";

const RECIPE = "resync-atlas-trelica";

const worked: ResyncState = {
  blocker: null,
  lastAttempt: null,
  lastSuccessAtIso: "2026-09-04T22:58:12.975Z",
  recipeId: RECIPE,
};

const ATTEMPT = {
  afterClock: null,
  beforeClock: null,
  exitCode: 0,
  finishedAtIso: "2026-09-04T22:58:12.975Z",
  outcome: "succeeded",
  problems: [],
  recipeId: RECIPE,
  startedAtIso: "2026-09-04T22:50:00.000Z",
} as const;

describe("readResyncState: missing is not corrupt", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "resync-state-"));
  });
  afterEach(() => {
    rmSync(stateDir, { force: true, recursive: true });
  });

  it("reads a target never attempted as no record", () => {
    expect(unwrap(readResyncState({ recipeId: RECIPE, stateDir }))).toBeNull();
  });

  it("reads back what was written", () => {
    unwrap(writeResyncState({ state: worked, stateDir }));
    expect(unwrap(readResyncState({ recipeId: RECIPE, stateDir }))).toEqual(worked);
  });

  it("refuses a record that is not JSON, naming the file and the way out", () => {
    const path = join(stateDir, `${RECIPE}.json`);
    writeFileSync(path, "{");
    const error = unwrapErr(readResyncState({ recipeId: RECIPE, stateDir }));
    expect(error.code).toBe("RESYNC_STATE_CORRUPT");
    expect(error.message).toContain(
      `the resync record for ${RECIPE} at ${path} is there but cannot be trusted (not JSON:`,
    );
    expect(error.message).toContain("delete that file to start the target's history over");
  });

  it("refuses a record that is JSON but not a resync record", () => {
    writeFileSync(join(stateDir, `${RECIPE}.json`), JSON.stringify({ recipeId: RECIPE }));
    const error = unwrapErr(readResyncState({ recipeId: RECIPE, stateDir }));
    expect(error.code).toBe("RESYNC_STATE_CORRUPT");
    expect(error.message).toContain("lastSuccessAtIso: ");
  });

  it("refuses a well-formed record for another target rather than carrying its history onto this one", () => {
    writeFileSync(join(stateDir, `${RECIPE}.json`), JSON.stringify({ ...worked, recipeId: "resync-corpus-notion" }));
    const error = unwrapErr(readResyncState({ recipeId: RECIPE, stateDir }));
    expect(error.code).toBe("RESYNC_STATE_CORRUPT");
    expect(error.message).toContain("(it records resync-corpus-notion, not this target)");
  });

  it("refuses a record whose last attempt belongs to another target", () => {
    const attempt = { ...ATTEMPT, recipeId: "resync-corpus-notion" };
    writeFileSync(join(stateDir, `${RECIPE}.json`), JSON.stringify({ ...worked, lastAttempt: attempt }));
    expect(unwrapErr(readResyncState({ recipeId: RECIPE, stateDir })).message).toContain(
      "(it records resync-corpus-notion, not this target)",
    );
  });

  it("refuses a record beneath a dangling state-directory link rather than reading it as never attempted", () => {
    const linked = join(stateDir, "linked");
    symlinkSync(join(stateDir, "gone"), linked);
    expect(unwrapErr(readResyncState({ recipeId: RECIPE, stateDir: linked })).code).toBe("RESYNC_STATE_CORRUPT");
  });
});

describe("readAllResyncState", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "resync-all-"));
  });
  afterEach(() => {
    chmodSync(stateDir, 0o700);
    rmSync(stateDir, { force: true, recursive: true });
  });

  it("keeps a trustworthy record and names a corrupt one, never dropping it as absent", () => {
    unwrap(writeResyncState({ state: worked, stateDir }));
    writeFileSync(join(stateDir, "resync-corpus-notion.json"), "not json");
    const read = readAllResyncState({ stateDir });
    expect([...read.states.keys()]).toEqual([RECIPE]);
    expect(read.corrupt.map((error) => error.code)).toEqual(["RESYNC_STATE_CORRUPT"]);
    expect(read.corrupt[0]!.message).toContain("resync-corpus-notion");
  });

  it("reads a directory that is not there yet as nothing recorded and nothing wrong", () => {
    const read = readAllResyncState({ stateDir: join(stateDir, "never-made") });
    expect(read.states.size).toBe(0);
    expect(read.corrupt).toEqual([]);
  });

  it("names a directory it cannot list rather than reading it as empty", () => {
    const locked = join(stateDir, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    const read = readAllResyncState({ stateDir: locked });
    chmodSync(locked, 0o700);
    expect(read.corrupt.map((error) => error.code)).toEqual(["RESYNC_STATE_DIR_UNREADABLE"]);
    expect(read.corrupt[0]!.message).toContain(`${locked} is there but cannot be listed (`);
    expect(read.corrupt[0]!.message).toContain("— restore its permissions or the target of its link");
  });

  it("names a state directory that is a dangling link rather than reading it as not made yet", () => {
    const linked = join(stateDir, "linked");
    symlinkSync(join(stateDir, "gone"), linked);
    const read = readAllResyncState({ stateDir: linked });
    expect(read.corrupt.map((error) => error.code)).toEqual(["RESYNC_STATE_DIR_UNREADABLE"]);
    // The ordinary trailing slash names the same dangling link, not its parent.
    const slashed = readAllResyncState({ stateDir: `${linked}/` });
    expect(slashed.corrupt.map((error) => error.code)).toEqual(["RESYNC_STATE_DIR_UNREADABLE"]);
  });
});
