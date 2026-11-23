/**
 * `talk file`'s parser: a mode, its target flag, and the verb's own defaults when a number is left out.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CODE_BUDGET } from "../../../cli/commands/talk/args.js";
import { DEFAULT_LIST_LIMIT, parseFileArgs, TalkFileArgsErrors } from "../../../cli/commands/talk/fileArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseFileArgs", () => {
  it("parses a read with its window flags", () => {
    expect(
      unwrap(parseFileArgs({ rest: ["read", "--path", "~/a.txt", "--from", "10", "--budget", "400", "--json"] })),
    ).toEqual({
      budget: 400,
      from: 10,
      home: undefined,
      json: true,
      limit: DEFAULT_LIST_LIMIT,
      mode: "read",
      target: "~/a.txt",
      words: false,
    });
  });

  it("reads --words as asking for a page's words", () => {
    expect(unwrap(parseFileArgs({ rest: ["read", "--path", "~/p/index.html", "--words"] })).words).toBe(true);
  });

  it("parses a list, leaving the numbers at the verb's defaults", () => {
    expect(unwrap(parseFileArgs({ rest: ["list", "--dir", "/tmp"] }))).toEqual({
      budget: DEFAULT_CODE_BUDGET,
      from: 0,
      home: undefined,
      json: false,
      limit: DEFAULT_LIST_LIMIT,
      mode: "list",
      target: "/tmp",
      words: false,
    });
  });

  it("refuses a missing mode, a missing target and a bad number, each by its own code", () => {
    expect(unwrapErr(parseFileArgs({ rest: ["--path", "/tmp/a"] })).code).toBe("MODE_MISSING");
    expect(unwrapErr(parseFileArgs({ rest: ["read", "--dir", "/tmp"] }))).toEqual(
      TalkFileArgsErrors.targetMissing({ mode: "read" }),
    );
    expect(TalkFileArgsErrors.targetMissing({ mode: "list" }).message).toBe(
      "talk file list needs --dir <absolute|~/path>",
    );
    expect(unwrapErr(parseFileArgs({ rest: ["read", "--path", "/tmp/a", "--from", "x"] })).code).toBe("FLAGS_UNPARSED");
  });
});
