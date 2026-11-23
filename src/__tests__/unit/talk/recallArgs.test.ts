/*
 * `talk recall`'s two rungs: `--words` searches and `--open` opens a pointer, exactly one per invocation, and a flag
 * that belongs to the other rung is refused rather than ignored.
 */
import { describe, expect, it } from "vitest";

import { parseRecallArgs } from "../../../cli/commands/talk/recallArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { RECALL_MAX_BYTES } from "../../../talk/recall.js";

describe("parseRecallArgs", () => {
  it("parses a search narrowed to two days of steers", () => {
    expect(
      unwrap(parseRecallArgs({ rest: ["--words", "xero steer", "--days", "2", "--source", "steers", "--json"] })),
    ).toEqual({
      days: 2,
      home: undefined,
      json: true,
      maxBytes: RECALL_MAX_BYTES,
      mode: "search",
      now: undefined,
      source: "steers",
      words: "xero steer",
    });
  });

  it("parses an open at a later page", () => {
    expect(unwrap(parseRecallArgs({ rest: ["--open", "talk:abc", "--from", "4000"] }))).toEqual({
      from: 4000,
      home: undefined,
      json: false,
      maxBytes: RECALL_MAX_BYTES,
      mode: "open",
      pointer: "talk:abc",
    });
  });

  it("needs exactly one rung", () => {
    expect(unwrapErr(parseRecallArgs({ rest: [] }))).toEqual([
      "talk recall needs exactly one of --words <words> (search) or --open <pointer> (open one hit)",
    ]);
    expect(unwrapErr(parseRecallArgs({ rest: ["--words", "xero", "--open", "talk:abc"] }))[0]).toContain("exactly one");
  });

  it("refuses a flag from the other rung", () => {
    expect(unwrapErr(parseRecallArgs({ rest: ["--words", "xero", "--from", "3"] }))).toEqual([
      "talk recall --from pages an --open, not a search",
    ]);
    expect(unwrapErr(parseRecallArgs({ rest: ["--open", "talk:abc", "--days", "2"] }))).toEqual([
      "talk recall --days narrows a search, not an --open",
    ]);
  });

  it("refuses an unknown source, a zero window and a cap above the tool's", () => {
    expect(
      unwrapErr(
        parseRecallArgs({ rest: ["--words", "xero", "--source", "slack", "--days", "0", "--max-bytes", "99999"] }),
      ),
    ).toEqual([
      `talk recall --max-bytes is 8192 to ${String(RECALL_MAX_BYTES)}: the answer's fixed fields need the floor, the console's tool cap sets the ceiling`,
      "talk recall --days is 1 to 3650; leave it off to search all time",
      "talk recall --source is one of calls, steers, rulings, knowledge, got slack",
    ]);
  });
});
