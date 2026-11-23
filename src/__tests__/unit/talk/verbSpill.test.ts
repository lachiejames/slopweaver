/**
 * Where a `talk verb` answer too large for the voice goes whole: the prune rule, and a real write into a throwaway
 * home read back for its bytes and modes.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  spillsToPrune,
  VERB_SPILL_KEEP,
  VERB_SPILL_MAX_AGE_MS,
  VerbSpillErrors,
  verbSpillDir,
  writeVerbSpill,
} from "../../../talk/verbSpill.js";

const NOW = Date.UTC(2026, 9, 13, 13, 5, 0);

/** A spill file name for the n-th id. */
const spillName = ({ n }: { n: number }): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}.txt`;

describe("spillsToPrune", () => {
  it("removes every spill older than a day, and nothing younger", () => {
    const files = [
      { mtimeMs: NOW - VERB_SPILL_MAX_AGE_MS - 1, name: spillName({ n: 1 }) },
      { mtimeMs: NOW - VERB_SPILL_MAX_AGE_MS + 1, name: spillName({ n: 2 }) },
    ];
    expect(spillsToPrune({ files, nowMs: NOW })).toEqual([spillName({ n: 1 })]);
  });

  it("keeps the newest spills one short of the bound, leaving room for the one being written", () => {
    const files = Array.from({ length: VERB_SPILL_KEEP }, (_, n) => ({
      mtimeMs: NOW - n * 1000,
      name: spillName({ n }),
    }));
    expect(spillsToPrune({ files, nowMs: NOW })).toEqual([spillName({ n: VERB_SPILL_KEEP - 1 })]);
  });

  it("never names a file that is not a spill's, however close its name comes", () => {
    const files = [
      { mtimeMs: 0, name: "notes.md" },
      { mtimeMs: 0, name: `${"-".repeat(36)}.txt` },
      { mtimeMs: 0, name: "00000000-0000-1000-8000-000000000001.txt" },
      { mtimeMs: 0, name: "00000000-0000-4000-8000-00000000000A.txt" },
    ];
    expect(spillsToPrune({ files, nowMs: NOW })).toEqual([]);
  });
});

describe("writeVerbSpill", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes the whole stdout to a 0600 file in a 0700 directory and says its size", () => {
    home = mkdtempSync(join(tmpdir(), "verb-spill-"));
    const id = "0b8f3c4e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
    const spill = unwrap(writeVerbSpill({ home, id, nowMs: NOW, text: "diff ✓\n".repeat(3) }));
    expect(spill).toEqual({ bytes: 27, path: join(verbSpillDir({ home }), `${id}.txt`) });
    expect(readFileSync(spill.path, "utf8")).toBe("diff ✓\ndiff ✓\ndiff ✓\n");
    expect(statSync(spill.path).mode & 0o777).toBe(0o600);
    expect(statSync(verbSpillDir({ home })).mode & 0o777).toBe(0o700);
  });

  it("prunes a stale spill before it writes, and leaves an unrelated file alone", () => {
    home = mkdtempSync(join(tmpdir(), "verb-spill-"));
    const first = unwrap(writeVerbSpill({ home, id: spillName({ n: 1 }).slice(0, 36), nowMs: NOW, text: "old" }));
    const stale = (NOW - VERB_SPILL_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(first.path, stale, stale);
    writeFileSync(join(verbSpillDir({ home }), "notes.md"), "keep");
    unwrap(writeVerbSpill({ home, id: spillName({ n: 2 }).slice(0, 36), nowMs: NOW, text: "new" }));
    expect(readdirSync(verbSpillDir({ home })).toSorted()).toEqual([spillName({ n: 2 }), "notes.md"]);
  });

  it("refuses a spill directory that is a symlink, and prunes nothing it points at", () => {
    home = mkdtempSync(join(tmpdir(), "verb-spill-"));
    const outside = join(home, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, spillName({ n: 1 })), "not ours");
    mkdirSync(dirname(verbSpillDir({ home })), { recursive: true });
    symlinkSync(outside, verbSpillDir({ home }));
    const refused = writeVerbSpill({ home, id: spillName({ n: 2 }).slice(0, 36), nowMs: NOW + 10 ** 12, text: "x" });
    expect(unwrapErr(refused)).toEqual(VerbSpillErrors.dirNotPlain({ dir: verbSpillDir({ home }) }));
    expect(unwrapErr(refused).message).toBe(
      `the spill directory ${verbSpillDir({ home })} is not a plain directory, so nothing is pruned or kept there`,
    );
    expect(readdirSync(outside)).toEqual([spillName({ n: 1 })]);
  });

  it("refuses an id a later prune could never remove, and writes nothing", () => {
    home = mkdtempSync(join(tmpdir(), "verb-spill-"));
    const refused = writeVerbSpill({ home, id: "../escape", nowMs: NOW, text: "x" });
    expect(unwrapErr(refused)).toEqual(VerbSpillErrors.idInvalid({ id: "../escape" }));
    expect(unwrapErr(refused).message).toBe(
      "the spill id ../escape is not a lowercase v4 UUID, so a later prune could never remove it",
    );
    expect(readdirSync(home)).toEqual([]);
  });
});
