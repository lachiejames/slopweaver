/**
 * `kindAnswerStore` — the shared file half of both kind-answer stores: a record round-trips owner-only, a file that
 * stands is answered for whether or not it reads, and a malformed one is named by key and refused, never applied.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import { MonitorErrors } from "../../../monitor/errors.js";
import { kindAnswerStore } from "../../../monitor/kindAnswerFiles.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kind-answer-files-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const STORE = kindAnswerStore<{ readonly n: number }>({
  label: "test record",
  name: "test-store",
  parse: ({ object, path }) =>
    typeof object["n"] === "number"
      ? ok({ n: object["n"] })
      : err(MonitorErrors.kindAnswerStore({ cause: "n is not a number", path })),
});

describe("kindAnswerStore", () => {
  it("round-trips a record into an owner-only file under hand-steps/<name>", () => {
    expect(STORE.record({ home, key: "aa", value: { n: 1 } }).isOk()).toBe(true);
    expect(STORE.read({ home })).toEqual({ problems: [], records: [{ n: 1 }], unreadable: [] });
    expect(STORE.dir({ home }).endsWith(join("hand-steps", "test-store"))).toBe(true);
    expect(statSync(join(STORE.dir({ home }), "aa.json")).mode & 0o777).toBe(0o600);
  });

  it("reads an absent directory as no records and no problem", () => {
    expect(STORE.read({ home })).toEqual({ problems: [], records: [], unreadable: [] });
  });

  it("answers a torn file as standing, and names it unreadable with the parser's own refusal", () => {
    mkdirSync(STORE.dir({ home }), { recursive: true });
    const path = join(STORE.dir({ home }), "bb.json");
    writeFileSync(path, `${JSON.stringify({ n: "two" })}\n`);
    expect(STORE.stands({ home, key: "bb" })).toBe(true);
    expect(STORE.read({ home })).toEqual({
      problems: [MonitorErrors.kindAnswerStore({ cause: "n is not a number", path })],
      records: [],
      unreadable: ["bb"],
    });
  });

  it("answers a path that can name no entry as not standing — a write there fails the same way, so none was made", () => {
    // ENAMETOOLONG: one component past every platform's 255-byte name limit.
    expect(STORE.stands({ home: join(home, "x".repeat(300)), key: "aa" })).toBe(false);
    // ENOTDIR: the store's directory is a regular file, which a listing of it names as a problem.
    mkdirSync(join(home, "hand-steps"), { recursive: true });
    writeFileSync(STORE.dir({ home }), "not a directory\n");
    expect(STORE.stands({ home, key: "aa" })).toBe(false);
    expect(STORE.read({ home }).problems.length).toBe(1);
  });

  it("forgets a record once, saying whether it stood", () => {
    expect(STORE.record({ home, key: "c", value: { n: 3 } }).isOk()).toBe(true);
    expect(unwrap(STORE.forget({ home, key: "c" }))).toBe(true);
    expect(unwrap(STORE.forget({ home, key: "c" }))).toBe(false);
    expect(STORE.stands({ home, key: "c" })).toBe(false);
  });
});
