/**
 * The register's effectful edge over a real throwaway home: absent is empty, a bad file is refused and never
 * rewritten, and an append re-plans against the register as read under its lock. Synthetic words only.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { RulingErrors } from "../../../ruling/errors.js";
import { type RulingRecord, renderRulingLine } from "../../../ruling/registry.js";
import {
  appendOrRestore,
  appendRulings,
  readRulingSource,
  readRulings,
  readSeedDecisions,
} from "../../../ruling/store.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh throwaway home and its register path. */
function freshHome(): { home: string; file: string } {
  const home = mkdtempSync(join(tmpdir(), "ruling-store-"));
  homes.push(home);
  return { file: join(home, "rulings.jsonl"), home };
}

/** A row, overridable per test. */
function row(over: Partial<RulingRecord> = {}): RulingRecord {
  return {
    category: "landing",
    decidedOn: "2026-01-05",
    id: "ruling-aaaaaaaaaaaa",
    origin: { kind: "record" },
    recordedIso: "2026-01-05T10:00:00.000Z",
    replaces: [],
    schemaVersion: 1,
    words: "two review passes, no third",
    ...over,
  };
}

const NOW = "2026-01-05T10:00:00.000Z";

describe("readRulings", () => {
  it("reads a missing register as empty", () => {
    const { file } = freshHome();
    expect(unwrap(readRulings({ file })).rows).toStrictEqual([]);
  });

  it("refuses a blank line inside the file, naming its line", () => {
    const { file } = freshHome();
    writeFileSync(
      file,
      `${renderRulingLine({ record: row() })}\n\n${renderRulingLine({ record: row({ id: "ruling-bbbbbbbbbbbb", category: "privacy" }) })}\n`,
    );
    const error = unwrapErr(readRulings({ file }));
    expect(error.code).toBe("REGISTER_MALFORMED");
    expect(error.message).toContain(`${file}:2`);
  });

  it("refuses a line that is not UTF-8 rather than repairing it", () => {
    const { file } = freshHome();
    writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    expect(unwrapErr(readRulings({ file })).message).toContain("not UTF-8");
  });
});

describe("appendRulings", () => {
  it("appends planned rows as mode 0600 lines and reads them back exactly", () => {
    const { home, file } = freshHome();
    const words = "keep\n  as said: <it> & 07:30Z";
    const receipt = unwrap(appendRulings({ file, home, nowIso: NOW, plan: () => ok([row({ words })]) }));
    expect(receipt.appended.map((each) => each.id)).toStrictEqual(["ruling-aaaaaaaaaaaa"]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(unwrap(readRulings({ file })).rows[0]!.words).toBe(words);
  });

  it("hands the plan the register as it stands, and appends after what is there", () => {
    const { home, file } = freshHome();
    unwrap(appendRulings({ file, home, nowIso: NOW, plan: () => ok([row()]) }));
    const seen: number[] = [];
    unwrap(
      appendRulings({
        file,
        home,
        nowIso: NOW,
        plan: ({ projection }) => {
          seen.push(projection.rows.length);
          return ok([row({ id: "ruling-bbbbbbbbbbbb", replaces: ["ruling-aaaaaaaaaaaa"] })]);
        },
      }),
    );
    expect(seen).toStrictEqual([1]);
    expect(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0),
    ).toHaveLength(2);
    expect(unwrap(readRulings({ file })).current.map((each) => each.id)).toStrictEqual(["ruling-bbbbbbbbbbbb"]);
  });

  it("writes nothing when the plan refuses", () => {
    const { home, file } = freshHome();
    const error = unwrapErr(appendRulings({ file, home, nowIso: NOW, plan: () => err(RulingErrors.wordsEmpty()) }));
    expect(error.code).toBe("WORDS_EMPTY");
    expect(() => statSync(file)).toThrow("ENOENT");
  });

  it("refuses rows that would contradict the register, writing nothing", () => {
    const { home, file } = freshHome();
    unwrap(appendRulings({ file, home, nowIso: NOW, plan: () => ok([row()]) }));
    const before = readFileSync(file, "utf8");
    const error = unwrapErr(appendRulings({ file, home, nowIso: NOW, plan: () => ok([row()]) }));
    expect(error.message).toContain("appears twice");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("never rewrites a malformed register", () => {
    const { home, file } = freshHome();
    writeFileSync(file, "not json\n");
    const error = unwrapErr(appendRulings({ file, home, nowIso: NOW, plan: () => ok([row()]) }));
    expect(error.code).toBe("REGISTER_MALFORMED");
    expect(readFileSync(file, "utf8")).toBe("not json\n");
  });
});

describe("appendOrRestore", () => {
  /** A write that lands a prefix of the text, then fails, as a full disk does. */
  const failsPartWay = ({ file, text }: { file: string; text: string }): void => {
    appendFileSync(file, text.slice(0, 7));
    throw new Error("ENOSPC: no space left on device");
  };

  it("cuts an existing register back to its exact bytes when the write fails part way", () => {
    const { file } = freshHome();
    const before = `${renderRulingLine({ record: row() })}\n`;
    writeFileSync(file, before);
    const error = unwrapErr(
      appendOrRestore({ file, records: [row({ id: "ruling-bbbbbbbbbbbb" })], write: failsPartWay }),
    );
    expect(error.code).toBe("APPEND_FAILED");
    expect(error.message).toContain("cut back to what it held before");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("removes a register the failed write created", () => {
    const { file } = freshHome();
    const error = unwrapErr(appendOrRestore({ file, records: [row()], write: failsPartWay }));
    expect(error.message).toContain("ENOSPC");
    expect(() => statSync(file)).toThrow("ENOENT");
  });
});

describe("readSeedDecisions and readRulingSource", () => {
  it("refuses a missing decisions file rather than reading it as no decisions", () => {
    const { home } = freshHome();
    const error = unwrapErr(readSeedDecisions({ file: join(home, "absent.jsonl") }));
    expect(error.code).toBe("SEED_DECISIONS_INVALID");
    expect(error.message).toContain("does not exist");
  });

  it("refuses a source document that is not UTF-8", () => {
    const { home } = freshHome();
    const path = join(home, "state.md");
    writeFileSync(path, Buffer.from([0x23, 0xff]));
    expect(unwrapErr(readRulingSource({ file: path })).code).toBe("SOURCE_UNREADABLE");
  });
});
