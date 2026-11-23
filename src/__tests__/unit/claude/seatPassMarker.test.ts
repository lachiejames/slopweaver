import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  newestSeatPassMs,
  removeSeatPasses,
  SeatPassMarkerErrors,
  writeDatedSeatPass,
} from "../../../claude/seatPassMarker.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const JUDGED_AT = "2026-11-05T01:00:00.000Z";
const CONTENTS = "4242\tThu Nov  5 01:00:00 2026\t-\n";

describe("writeDatedSeatPass", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seat-pass-marker-"));
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("writes the marker's exact contents", () => {
    const path = join(dir, "session-a");
    unwrap(writeDatedSeatPass({ judgedAtIso: JUDGED_AT, marker: { contents: CONTENTS, path } }));
    expect(readFileSync(path, "utf8")).toBe(CONTENTS);
  });

  it("dates the marker to when its check began, so an input written after that outranks it", () => {
    const path = join(dir, "session-a");
    unwrap(writeDatedSeatPass({ judgedAtIso: JUDGED_AT, marker: { contents: CONTENTS, path } }));
    expect(statSync(path).mtimeMs).toBe(Date.parse(JUDGED_AT));
  });

  it("refuses an instant that does not parse, and writes nothing", () => {
    const path = join(dir, "session-a");
    const written = writeDatedSeatPass({ judgedAtIso: "not-a-date", marker: { contents: CONTENTS, path } });
    expect(unwrapErr(written)).toEqual(SeatPassMarkerErrors.notWritten({ path, why: "not-a-date is not an instant" }));
    expect(existsSync(path)).toBe(false);
  });

  it("says so when the marker cannot be written", () => {
    const blocked = join(dir, "is-a-directory");
    mkdirSync(blocked);
    const written = writeDatedSeatPass({ judgedAtIso: JUDGED_AT, marker: { contents: CONTENTS, path: blocked } });
    expect(unwrapErr(written).code).toBe("SEAT_PASS_NOT_WRITTEN");
    expect(unwrapErr(written).message).toContain(`the cached pass at ${blocked} was not written`);
  });
});

describe("removeSeatPasses", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seat-pass-remove-"));
  });
  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { force: true, recursive: true });
  });

  it("removes one marker and leaves its siblings", () => {
    writeFileSync(join(dir, "session-a"), CONTENTS);
    writeFileSync(join(dir, "session-b"), CONTENTS);
    unwrap(removeSeatPasses({ path: join(dir, "session-a") }));
    expect(readdirSync(dir)).toEqual(["session-b"]);
  });

  it("removes the whole directory of markers", () => {
    const passes = join(dir, "seat-pass");
    mkdirSync(passes);
    writeFileSync(join(passes, "session-a"), CONTENTS);
    unwrap(removeSeatPasses({ path: passes }));
    expect(existsSync(passes)).toBe(false);
  });

  it("reads an absent path as already removed", () => {
    expect(removeSeatPasses({ path: join(dir, "never-written") }).isOk()).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says so when a marker cannot be removed", () => {
    const path = join(dir, "session-a");
    writeFileSync(path, CONTENTS);
    chmodSync(dir, 0o500);
    const removed = unwrapErr(removeSeatPasses({ path }));
    expect(removed.code).toBe("SEAT_PASS_NOT_REMOVED");
    expect(removed.message).toContain(`the cached pass at ${path} was not removed`);
    expect(existsSync(path)).toBe(true);
  });
});

describe("newestSeatPassMs", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seat-pass-newest-"));
  });
  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads an absent directory as no passes", () => {
    expect(unwrap(newestSeatPassMs({ dir: join(dir, "never-made") }))).toBeUndefined();
  });

  it("answers the newest mtime among the passes", () => {
    writeFileSync(join(dir, "session-a"), CONTENTS);
    writeFileSync(join(dir, "session-b"), CONTENTS);
    utimesSync(join(dir, "session-a"), 1_800_000_100, 1_800_000_100);
    utimesSync(join(dir, "session-b"), 1_800_000_000, 1_800_000_000);
    expect(unwrap(newestSeatPassMs({ dir }))).toBe(1_800_000_100_000);
  });

  it("says so when the directory cannot be listed, never reading it as empty", () => {
    chmodSync(dir, 0o000);
    const newest = unwrapErr(newestSeatPassMs({ dir }));
    expect(newest.code).toBe("SEAT_PASSES_NOT_LISTED");
    expect(newest.message).toContain(`the cached passes in ${dir} could not be listed`);
  });
});
