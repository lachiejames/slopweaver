import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import {
  BumpRecordStoreErrors,
  bumpRecordPath,
  readBumpRecords,
  writeBumpRecord,
} from "../../../codex/bumpRecordStore.js";
import { type BumpManifest, type BumpRow, digestOf } from "../../../devLint/baselineBump.js";
import { stateHomePaths } from "../../../stateHome.js";

const BASE = "a".repeat(40);
const ROW: BumpRow = {
  cause: "widening",
  entry: "offenders:tools/gen.ts",
  file: ".baselines/file-size-baseline.json",
  from: null,
  to: 319,
};
const MANIFEST: BumpManifest = {
  base: BASE,
  digest: digestOf({ base: BASE, rows: [ROW] }),
  loosenings: [ROW],
  reason: "r",
};
const NAME = `${MANIFEST.digest}.json`;

const made: string[] = [];

/** A fresh state home, removed after the case. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "bump-store-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("bumpRecordPath", () => {
  it("places a record under the home's baseline-bumps ledger", () => {
    expect(bumpRecordPath({ name: NAME })).toBe(`ledgers/baseline-bumps/${NAME}`);
  });
});

describe("readBumpRecords", () => {
  it("reads an absent directory as no records", () => {
    expect(unwrap(readBumpRecords({ home: home() }))).toEqual([]);
  });

  it("reads back what the writer wrote, and passes over a dot-prefixed staging file", () => {
    const at = home();
    unwrap(writeBumpRecord({ home: at, manifest: MANIFEST }));
    writeFileSync(join(stateHomePaths({ home: at }).baselineBumps, `.${MANIFEST.digest}.x.staging`), "partial");

    expect(unwrap(readBumpRecords({ home: at }))).toEqual([
      { manifest: MANIFEST, path: `ledgers/baseline-bumps/${NAME}` },
    ]);
  });

  it("refuses the whole read on a name that is not <digest>.json", () => {
    const at = home();
    mkdirSync(stateHomePaths({ home: at }).baselineBumps, { recursive: true });
    writeFileSync(join(stateHomePaths({ home: at }).baselineBumps, "notes.txt"), "x");

    expect(unwrapErr(readBumpRecords({ home: at }))).toEqual(
      BumpRecordStoreErrors.invalid({
        detail: "not a bump record (every record is <digest>.json)",
        path: "ledgers/baseline-bumps/notes.txt",
      }),
    );
  });

  it("refuses the whole read on a record filed under another digest", () => {
    const at = home();
    const dir = stateHomePaths({ home: at }).baselineBumps;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${"0".repeat(64)}.json`), JSON.stringify(MANIFEST));

    const error = unwrapErr(readBumpRecords({ home: at }));

    expect(error.code).toBe("BUMP_RECORD_INVALID");
    expect(error.path).toBe(`ledgers/baseline-bumps/${"0".repeat(64)}.json`);
  });
});

describe("writeBumpRecord", () => {
  it("writes the record under its own digest, leaving no staging file behind", () => {
    const at = home();

    expect(unwrap(writeBumpRecord({ home: at, manifest: MANIFEST })).path).toBe(`ledgers/baseline-bumps/${NAME}`);
    expect(readdirSync(stateHomePaths({ home: at }).baselineBumps)).toEqual([NAME]);
  });

  it("refuses a name already taken, leaving the first record's bytes as they were", () => {
    const at = home();
    unwrap(writeBumpRecord({ home: at, manifest: MANIFEST }));
    const path = join(stateHomePaths({ home: at }).baselineBumps, NAME);
    const before = readFileSync(path, "utf8");

    const again = writeBumpRecord({ home: at, manifest: { ...MANIFEST, reason: "other words" } });

    expect(unwrapErr(again)).toEqual(BumpRecordStoreErrors.exists({ path: `ledgers/baseline-bumps/${NAME}` }));
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(stateHomePaths({ home: at }).baselineBumps)).toEqual([NAME]);
  });
});
