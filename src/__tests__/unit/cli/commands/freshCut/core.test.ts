/**
 * `fresh-cut`'s flag grammar: each verb refuses a missing required flag, a relative destination, a record id
 * that could name a path and, for `accept`, an owner-address finding without `--as` or any other class without an
 * owner `--anchor`, all before any read. The anchor here is synthetic.
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

/** A synthetic owner anchor: two made-up UUIDs. */
const ANCHOR = "transcript:11111111-0000-4333-8444-555555555555#66666666-0000-4888-9999-aaaaaaaaaaaa";

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

/** A complete owner-address `fresh-cut accept` argv; a flag set to null is dropped. */
const acceptArgv = (over: Readonly<Record<string, string | null>> = {}): readonly string[] => {
  const flags: Record<string, string | null> = {
    as: "placeholder",
    class: "owner-address",
    line: "12",
    path: "src/a.test.ts",
    record: RECORD_ID,
    ...over,
  };
  return Object.entries(flags).flatMap(([name, value]) => (value === null ? [] : [`--${name}`, value]));
};

/** A complete anchored `fresh-cut accept` argv for a topic finding. */
const anchoredArgv = (over: Readonly<Record<string, string | null>> = {}): readonly string[] =>
  acceptArgv({ anchor: ANCHOR, as: null, class: "topic", ...over });

describe("parseAcceptOptions", () => {
  it("reads every flag of an owner-address acceptance, exactly as before", () => {
    expect(unwrap(parseAcceptOptions({ rest: [...acceptArgv(), "--home", "/h", "--json"] }))).toEqual({
      decision: { className: "owner-address", judgement: "placeholder" },
      home: "/h",
      json: true,
      line: 12,
      path: "src/a.test.ts",
      recordId: RECORD_ID,
      source: null,
    });
  });

  it("reads an anchored acceptance of another class", () => {
    expect(unwrap(parseAcceptOptions({ rest: anchoredArgv() }))).toEqual({
      decision: { className: "topic", ownerAnchor: ANCHOR },
      home: undefined,
      json: false,
      line: 12,
      path: "src/a.test.ts",
      recordId: RECORD_ID,
      source: null,
    });
  });

  it("refuses another class with no anchor, before anything is read", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: anchoredArgv({ anchor: null }) }))).toEqual([
      "--anchor is required for topic: transcript:<session>#<turn>, the owner's own turn ruling on it",
    ]);
  });

  it("refuses another class carrying a reader's --as", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: anchoredArgv({ as: "placeholder" }) }))).toEqual([
      "--as is refused for topic: only the owner's anchor accepts that class",
    ]);
  });

  it("refuses an anchor that is not a canonical transcript pointer", () => {
    expect(
      [`${ANCHOR} `, "the owner said so", "transcript:"].map(
        (anchor) => unwrapErr(parseAcceptOptions({ rest: anchoredArgv({ anchor }) }))[0],
      ),
    ).toEqual([
      "--anchor must be a transcript:<session>#<turn> pointer, both halves lower-case UUIDs",
      "--anchor must be a transcript:<session>#<turn> pointer, both halves lower-case UUIDs",
      "--anchor must be a transcript:<session>#<turn> pointer, both halves lower-case UUIDs",
    ]);
  });

  it("refuses an anchor on an owner-address acceptance", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ anchor: ANCHOR }) }))).toEqual([
      "--anchor is refused for owner-address: a reading session judges that class with --as",
    ]);
  });

  it("refuses an owner-address acceptance with no --as", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: acceptArgv({ as: null }) }))).toEqual([
      "--as is required for owner-address: one of placeholder, not-an-address",
    ]);
  });

  it("refuses a class outside the private-term list", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: anchoredArgv({ class: "vibe" }) }))).toEqual([
      "--class vibe is refused: it must be one of owner-name, owner-handle, owner-address, person, organisation, place, health, money, topic",
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
    expect(unwrapErr(parseAcceptOptions({ rest: anchoredArgv({ record: "../x" }) }))).toEqual([
      "--record must be the UUID `fresh-cut produce` printed",
    ]);
  });

  it("refuses a bare run with every missing flag named", () => {
    expect(unwrapErr(parseAcceptOptions({ rest: [] }))).toEqual([
      "--record is required: the record id `fresh-cut produce` printed",
      "--path is required: the file's path as the verify report names it",
      "--line is required: the 1-based line as the verify report names it",
      "--class is required: one of owner-name, owner-handle, owner-address, person, organisation, place, health, money, topic",
    ]);
  });
});

/** The fields both entry shapes share, for {@link acceptLines}. */
const SHARED = {
  entryId: RECORD_ID,
  lineNumberAtReview: 12,
  lineSha256: "f".repeat(64),
  path: "src/quillfeather.ts",
  reviewedAtIso: "2026-11-20T01:02:03.000Z",
  reviewedBySessionId: "session-1",
  reviewedRecordId: RECORD_ID,
  reviewedTreeSha: "a".repeat(40),
};

describe("acceptLines", () => {
  it("prints the entry id, class and judgement and the list's path, never the finding's path or line", () => {
    expect(
      acceptLines({
        entry: { ...SHARED, className: "owner-address", judgement: "not-an-address", schemaVersion: 1 },
        listPath: "/h/fresh-cuts/reviewed-residue.jsonl",
      }),
    ).toEqual([
      `fresh-cut accept: entry ${RECORD_ID} — owner-address, not-an-address`,
      "fresh-cut accept: appended to /h/fresh-cuts/reviewed-residue.jsonl",
    ]);
  });

  it("says an anchored entry rests on an owner anchor without printing the anchor, path or line", () => {
    expect(
      acceptLines({
        entry: { ...SHARED, className: "money", ownerAnchor: ANCHOR, schemaVersion: 2 },
        listPath: "/h/fresh-cuts/reviewed-residue.jsonl",
      }),
    ).toEqual([
      `fresh-cut accept: entry ${RECORD_ID} — money, accepted on an owner anchor`,
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
