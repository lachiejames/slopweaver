/**
 * The database steps' pure halves: reading `psql -At` output back into extensions and a target's shape, and
 * quoting an extension's statement. The `docker exec` around them is not run here.
 */
import { describe, expect, it } from "vitest";

import {
  createExtensionStatement,
  parseExtensions,
  parseTargetShape,
  restoreArgs,
} from "../../../store/backup/stackDatabase.js";

describe("parseExtensions", () => {
  it("reads one extension per line with its schema, skipping blank lines", () => {
    expect(parseExtensions({ out: "pg_trgm\tpublic\n\nvector\textensions" })).toEqual([
      { name: "pg_trgm", schema: "public" },
      { name: "vector", schema: "extensions" },
    ]);
  });

  it("reads no output as no extensions", () => {
    expect(parseExtensions({ out: "" })).toEqual([]);
  });
});

describe("createExtensionStatement", () => {
  it("quotes both names, doubling an embedded quote", () => {
    expect(createExtensionStatement({ extension: { name: 'odd"ext', schema: "public" } })).toBe(
      'create extension if not exists "odd""ext" with schema "public"',
    );
  });
});

describe("parseTargetShape", () => {
  it("reads the table count and whether storage exists", () => {
    expect(parseTargetShape({ out: "43\t1" })).toEqual({ hasStorageSchema: true, publicTables: 43 });
    expect(parseTargetShape({ out: "0\t0" })).toEqual({ hasStorageSchema: false, publicTables: 0 });
  });
});

describe("restoreArgs", () => {
  it("replays an empty target without cleaning", () => {
    expect(restoreArgs({ container: "c1", database: "d1", listPath: "/tmp/l", mode: "empty" })).toEqual([
      "exec",
      "-i",
      "c1",
      "pg_restore",
      "-U",
      "postgres",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "-L",
      "/tmp/l",
      "-d",
      "d1",
    ]);
  });

  it("cleans a fresh stack's objects first", () => {
    expect(restoreArgs({ container: "c1", database: "d1", listPath: "/tmp/l", mode: "stack" }).slice(8, 11)).toEqual([
      "--exit-on-error",
      "--clean",
      "--if-exists",
    ]);
  });
});
