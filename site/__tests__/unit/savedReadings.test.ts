import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readSavedReadings,
  SAVED_READINGS_DIR_VAR,
  type SavedReading,
  savedFileName,
  savedFileOf,
  savedReadingOf,
  savedReadingsDirectory,
  saveReading,
} from "../../lib/savedReadings";

/** A reading the board verb answered, true at `at`. */
const reading = ({ at, rows }: { at: string; rows: number }): SavedReading => ({
  observedAtIso: at,
  ok: true,
  payload: { rows },
  stampedByRoute: true,
});

const EARLIER = "2026-10-17T14:00:01.000Z";
const LATER = "2026-10-17T14:00:02.000Z";

const roots: string[] = [];

/** A saved-readings directory not yet created, as a launcher names it; its parent is removed after each test. */
const freshDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), "saved-readings-"));
  roots.push(root);
  return join(root, "saved-readings");
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("which directory the console saves into", () => {
  it("is the one the launcher named, made absolute without its trailing slash", () => {
    expect(savedReadingsDirectory({ env: { [SAVED_READINGS_DIR_VAR]: "/cache/console/saved-readings/0a1b/" } })).toBe(
      "/cache/console/saved-readings/0a1b",
    );
  });

  it("is none when the launcher named none, or named a blank", () => {
    expect(savedReadingsDirectory({ env: {} })).toBe(undefined);
    expect(savedReadingsDirectory({ env: { [SAVED_READINGS_DIR_VAR]: "  " } })).toBe(undefined);
  });

  it("saves nothing, and reads nothing, when none was named", async () => {
    expect(
      await saveReading({ directory: undefined, result: reading({ at: EARLIER, rows: 1 }), slug: "board" }),
    ).toEqual({
      kind: "skipped",
      why: "SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR names no directory, so this console saves nothing",
    });
    expect(await readSavedReadings({ directory: undefined })).toEqual({ dropped: [], readings: {} });
  });
});

describe("which values count as a saved reading", () => {
  it("accepts a successful reading from the machine, exactly", () => {
    expect(
      savedReadingOf({ value: { observedAtIso: EARLIER, ok: true, payload: [1], stampedByRoute: false } }),
    ).toEqual({
      observedAtIso: EARLIER,
      ok: true,
      payload: [1],
      stampedByRoute: false,
    });
  });

  it("refuses a failed read", () => {
    expect(savedReadingOf({ value: { notMeasured: "timed out", observedAtIso: EARLIER, ok: false } })).toBe(undefined);
  });

  it("refuses a fixture's frozen reading", () => {
    expect(
      savedReadingOf({
        value: { fixture: "busy", observedAtIso: EARLIER, ok: true, payload: [], stampedByRoute: false },
      }),
    ).toBe(undefined);
  });

  it("refuses a reading with no payload or no stamp flag", () => {
    expect(savedReadingOf({ value: { observedAtIso: EARLIER, ok: true, stampedByRoute: true } })).toBe(undefined);
    expect(savedReadingOf({ value: { observedAtIso: EARLIER, ok: true, payload: [] } })).toBe(undefined);
  });

  it("refuses a value that is not an object", () => {
    expect(savedReadingOf({ value: "board" })).toBe(undefined);
    expect(savedReadingOf({ value: null })).toBe(undefined);
  });
});

describe("a saved file's name", () => {
  it("carries the slug and the instant the reading was true, and reads back", () => {
    expect(savedFileName({ observedMs: 1_760_709_601_000, slug: "slack-drafts" })).toBe(
      "slack-drafts@1760709601000.json",
    );
    expect(savedFileOf({ file: "slack-drafts@1760709601000.json" })).toEqual({
      observedMs: 1_760_709_601_000,
      slug: "slack-drafts",
    });
  });

  it("refuses an instant too large to read back exactly", () => {
    expect(savedFileOf({ file: "board@9007199254740993.json" })).toBe(undefined);
    expect(savedFileOf({ file: "board@9007199254740991.json" })).toEqual({
      observedMs: 9_007_199_254_740_991,
      slug: "board",
    });
  });

  it("refuses a staging sibling and a name with no instant", () => {
    expect(savedFileOf({ file: ".board.0b1d.tmp" })).toBe(undefined);
    expect(savedFileOf({ file: "board.json" })).toBe(undefined);
  });
});

describe("saving and reading back", () => {
  it("reads nothing, and drops nothing, from a directory that has never been saved into", async () => {
    expect(await readSavedReadings({ directory: freshDirectory() })).toEqual({ dropped: [], readings: {} });
  });

  it("round-trips a reading under its own file, readable only by its owner", async () => {
    const directory = freshDirectory();
    const outcome = await saveReading({ directory, result: reading({ at: EARLIER, rows: 8932 }), slug: "board" });
    const path = join(directory, savedFileName({ observedMs: Date.parse(EARLIER), slug: "board" }));
    expect(outcome).toEqual({ kind: "saved", path });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(await readSavedReadings({ directory })).toEqual({
      dropped: [],
      readings: { board: reading({ at: EARLIER, rows: 8932 }) },
    });
  });

  it("refuses a reading whose instant cannot be read, and writes nothing", async () => {
    const directory = freshDirectory();
    expect(await saveReading({ directory, result: reading({ at: "not an instant", rows: 1 }), slug: "board" })).toEqual(
      {
        kind: "skipped",
        why: "board carries no readable instant: not an instant",
      },
    );
    expect(await readSavedReadings({ directory })).toEqual({ dropped: [], readings: {} });
  });

  it("drops a malformed file, an unknown slug and an unnamed file by name, and still reads the good one", async () => {
    const directory = freshDirectory();
    mkdirSync(directory, { recursive: true });
    const at = Date.parse(EARLIER);
    writeFileSync(
      join(directory, savedFileName({ observedMs: at, slug: "board" })),
      JSON.stringify(reading({ at: EARLIER, rows: 3 })),
    );
    writeFileSync(join(directory, savedFileName({ observedMs: at, slug: "hands" })), "{ not json");
    writeFileSync(
      join(directory, savedFileName({ observedMs: at, slug: "no-such-verb" })),
      JSON.stringify(reading({ at: EARLIER, rows: 0 })),
    );
    writeFileSync(
      join(directory, savedFileName({ observedMs: at, slug: "drafts" })),
      JSON.stringify({ notMeasured: "x", observedAtIso: EARLIER, ok: false }),
    );
    writeFileSync(join(directory, "board.json"), JSON.stringify(reading({ at: EARLIER, rows: 9 })));
    writeFileSync(join(directory, ".board.0b1d.tmp"), "half a write");
    const { readings, dropped } = await readSavedReadings({ directory });
    expect(readings).toEqual({ board: reading({ at: EARLIER, rows: 3 }) });
    expect(dropped.map((one) => one.file).toSorted()).toEqual([
      "board.json",
      savedFileName({ observedMs: at, slug: "drafts" }),
      savedFileName({ observedMs: at, slug: "hands" }),
      savedFileName({ observedMs: at, slug: "no-such-verb" }),
    ]);
    // The malformed file's reason is the JSON parser's own sentence, which varies by Node version.
    expect(
      dropped.filter((one) => !one.file.startsWith("hands@")).toSorted((a, b) => a.file.localeCompare(b.file)),
    ).toEqual([
      { file: "board.json", why: "not named as a saved reading" },
      { file: savedFileName({ observedMs: at, slug: "drafts" }), why: "not a successful reading from the machine" },
      {
        file: savedFileName({ observedMs: at, slug: "no-such-verb" }),
        why: "no-such-verb is not a live verb this console reads",
      },
    ]);
  });

  it("falls back to a slug's older reading when its newest file is unreadable", async () => {
    const directory = freshDirectory();
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, savedFileName({ observedMs: Date.parse(EARLIER), slug: "board" })),
      JSON.stringify(reading({ at: EARLIER, rows: 1 })),
    );
    writeFileSync(join(directory, savedFileName({ observedMs: Date.parse(LATER), slug: "board" })), "{ cut short");
    const { readings, dropped } = await readSavedReadings({ directory });
    expect(readings).toEqual({ board: reading({ at: EARLIER, rows: 1 }) });
    expect(dropped.map((one) => one.file)).toEqual([savedFileName({ observedMs: Date.parse(LATER), slug: "board" })]);
  });
});

describe("the order readings land in, across every process sharing the directory", () => {
  it("keeps the later reading and deletes the earlier when the earlier lands first", async () => {
    const directory = freshDirectory();
    expect((await saveReading({ directory, result: reading({ at: EARLIER, rows: 1 }), slug: "board" })).kind).toBe(
      "saved",
    );
    expect((await saveReading({ directory, result: reading({ at: LATER, rows: 2 }), slug: "board" })).kind).toBe(
      "saved",
    );
    expect(readdirSync(directory)).toEqual([savedFileName({ observedMs: Date.parse(LATER), slug: "board" })]);
    expect((await readSavedReadings({ directory })).readings).toEqual({ board: reading({ at: LATER, rows: 2 }) });
  });

  it("never lets an earlier reading that lands last replace a later one", async () => {
    const directory = freshDirectory();
    await saveReading({ directory, result: reading({ at: LATER, rows: 2 }), slug: "board" });
    expect(await saveReading({ directory, result: reading({ at: EARLIER, rows: 1 }), slug: "board" })).toEqual({
      kind: "skipped",
      why: `board already has a reading from ${LATER}`,
    });
    expect((await readSavedReadings({ directory })).readings).toEqual({ board: reading({ at: LATER, rows: 2 }) });
  });

  it("keeps the later reading when two saves race, as two console processes would", async () => {
    const directory = freshDirectory();
    await Promise.all([
      saveReading({ directory, result: reading({ at: EARLIER, rows: 1 }), slug: "board" }),
      saveReading({ directory, result: reading({ at: LATER, rows: 2 }), slug: "board" }),
    ]);
    expect((await readSavedReadings({ directory })).readings).toEqual({ board: reading({ at: LATER, rows: 2 }) });
  });

  it("orders each slug on its own, so one slug's reading never deletes another's", async () => {
    const directory = freshDirectory();
    await saveReading({ directory, result: reading({ at: LATER, rows: 5 }), slug: "board" });
    await saveReading({ directory, result: reading({ at: EARLIER, rows: 3 }), slug: "hands" });
    expect((await readSavedReadings({ directory })).readings).toEqual({
      board: reading({ at: LATER, rows: 5 }),
      hands: reading({ at: EARLIER, rows: 3 }),
    });
  });
});
