/*
 * What `slopweaver talk call-tools` accepts: one call id, a page start and a page size bounded to fifty rows, each
 * refusal naming what was wrong rather than quietly reading something else.
 */
import { describe, expect, it } from "vitest";

import { parseCallToolsArgs, TALK_CALL_TOOLS_FLAG_NAMES } from "../../../../../cli/commands/talk/callToolsArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const CALL = "8d74b96f-f72d-4135-be24-b78897fa3926";

describe("parseCallToolsArgs", () => {
  it("defaults to the first ten rows", () => {
    expect(unwrap(parseCallToolsArgs({ rest: ["--call", CALL] }))).toEqual({
      callId: CALL,
      from: 0,
      home: undefined,
      json: false,
      limit: 10,
    });
  });

  it("reads every flag it declares", () => {
    const rest = ["--call", CALL, "--from", "20", "--limit", "50", "--home", "/tmp/a-home", "--json"];
    expect(unwrap(parseCallToolsArgs({ rest }))).toEqual({
      callId: CALL,
      from: 20,
      home: "/tmp/a-home",
      json: true,
      limit: 50,
    });
    expect(TALK_CALL_TOOLS_FLAG_NAMES).toEqual(["--call", "--from", "--home", "--json", "--limit"]);
  });

  it("refuses a missing call and one that is not a call id", () => {
    expect(unwrapErr(parseCallToolsArgs({ rest: [] }))).toEqual({
      code: "CALL_TOOLS_ARG_CALL",
      message: "talk call-tools needs --call <uuid>: the call to read",
    });
    expect(unwrapErr(parseCallToolsArgs({ rest: ["--call", "abc"] }))).toEqual({
      code: "CALL_TOOLS_ARG_CALL",
      message: 'talk call-tools --call "abc" is not a call id (a v4 UUID)',
    });
  });

  it("refuses a page past fifty rows, an empty one, and a start that is not a whole number", () => {
    expect(unwrapErr(parseCallToolsArgs({ rest: ["--call", CALL, "--limit", "51"] })).message).toBe(
      "talk call-tools: --limit must be 1 to 50, got 51",
    );
    expect(unwrapErr(parseCallToolsArgs({ rest: ["--call", CALL, "--limit", "0"] })).message).toBe(
      "talk call-tools: --limit must be 1 to 50, got 0",
    );
    expect(unwrapErr(parseCallToolsArgs({ rest: ["--call", CALL, "--from", "-1"] })).message).toBe(
      "talk call-tools: --from must be a non-negative whole number, got -1",
    );
  });

  it("refuses a positional and an unknown flag", () => {
    expect(unwrapErr(parseCallToolsArgs({ rest: [CALL] })).code).toBe("CALL_TOOLS_FLAGS_INVALID");
    expect(unwrapErr(parseCallToolsArgs({ rest: ["--call", CALL, "--all"] })).code).toBe("CALL_TOOLS_FLAGS_INVALID");
  });
});
