/**
 * `fresh-cut`'s flag grammar: each verb refuses a missing required flag, a relative destination, a record id
 * that could name a path and, for `accept`, any class but owner-address, all before any read.
 */
import { describe, expect, it } from "vitest";

import {
  acceptLines,
  parseAcceptOptions,
  parseProduceOptions,
  parseVerifyOptions,
} from "../../../../../cli/commands/freshCut/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const RECORD_ID = "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f";

describe("parseProduceOptions", () => {
  it("reads every flag", () => {
    expect(
      unwrap(
        parseProduceOptions({
          rest: ["--commit", "7adba73", "--out", "/private/tmp/cut", "--source", "/src", "--home", "/h", "--json"],
        }),
      ),
    ).toEqual({ commit: "7adba73", home: "/h", json: true, out: "/private/tmp/cut", source: "/src" });
  });

  it("leaves the source and home unset when they are not passed", () => {
    expect(unwrap(parseProduceOptions({ rest: ["--commit", "7adba73", "--out", "/c"] }))).toEqual({
      commit: "7adba73",
      home: undefined,
      json: false,
      out: "/c",
      source: null,
    });
  });

  it("refuses a bare run with both missing flags named", () => {
    expect(unwrapErr(parseProduceOptions({ rest: [] }))).toEqual([
      "--commit is required: the full or abbreviated hexadecimal id of a commit on main",
      "--out is required: an absolute path for the new repository, outside every checkout",
    ]);
  });

  it("refuses a relative destination", () => {
    expect(unwrapErr(parseProduceOptions({ rest: ["--commit", "7adba73", "--out", "cut"] }))).toEqual([
      "--out must be an absolute path",
    ]);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseProduceOptions({ rest: ["--commit", "7adba73", "--out", "/c", "--push"] })).length).toBe(1);
  });
});

/** A complete `fresh-cut accept` argv, with one flag replaceable. */
const acceptArgv = (over: Readonly<Record<string, string>> = {}): readonly string[] => {
  const flags: Record<string, string> = {
    as: "placeholder",
    class: "owner-address",
    line: "12",
    path: "src/a.test.ts",
    record: RECORD_ID,
    ...over,
  };
  return Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]);
};

describe("parseAcceptOptions", () => {
  it("reads every flag", () => {
    expect(unwrap(parseAcceptOptions({ rest: [...acceptArgv(), "--home", "/h", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      judgement: "placeholder",
      line: 12,
      path: "src/a.test.ts",
      recordId: RECORD_ID,
      source: null,
    });
  });

  it("refuses every class but owner-address, before anything is read", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ class: "topic" }) }))).toEqual([
      "--class topic is refused: only owner-address findings may be accepted; every other class waits on the owner",
    ]);
  });

  it("refuses a judgement outside the closed set", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ as: "fine" }) }))).toEqual([
      "--as must be one of placeholder, not-an-address",
    ]);
  });

  it("refuses a line that is not a positive whole number", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ line: "0" }) }))).toEqual([
      "--line must be a positive whole number",
    ]);
  });

  it("refuses a record id that is not a UUID", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ record: "../x" }) }))).toEqual([
      "--record must be the UUID `fresh-cut produce` printed",
    ]);
  });

  it("refuses a bare run with every missing flag named", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: [] }))).toEqual([
      "--record is required: the record id `fresh-cut produce` printed",
      "--path is required: the file's path as the verify report names it",
      "--line is required: the 1-based line as the verify report names it",
      "--class is required, and only owner-address is accepted",
      "--as is required: one of placeholder, not-an-address",
    ]);
  });
});

describe("acceptLines", () => {
  it("prints the entry id, class and judgement and the list's path, never the finding's path or line", () => {
    expect(
      acceptLines({
        entryId: RECORD_ID,
        judgement: "not-an-address",
        listPath: "/h/fresh-cuts/reviewed-residue.jsonl",
      }),
    ).toEqual([
      `fresh-cut accept: entry ${RECORD_ID} — owner-address, not-an-address`,
      "fresh-cut accept: appended to /h/fresh-cuts/reviewed-residue.jsonl",
    ]);
  });
});

describe("parseVerifyOptions", () => {
  it("reads the record id and optional flags", () => {
    expect(unwrap(parseVerifyOptions({ rest: ["--record", RECORD_ID, "--source", "/src"] }))).toEqual({
      home: undefined,
      json: false,
      recordId: RECORD_ID,
      source: "/src",
    });
  });

  it("refuses a missing record", () => {
    expect(unwrapErr(parseVerifyOptions({ rest: [] }))).toEqual([
      "--record is required: the record id `fresh-cut produce` printed",
    ]);
  });

  it("refuses a record id that is not a UUID, so it can never name a path", () => {
    expect(unwrapErr(parseVerifyOptions({ rest: ["--record", "../../etc"] }))).toEqual([
      "--record must be the UUID `fresh-cut produce` printed",
    ]);
  });
});
