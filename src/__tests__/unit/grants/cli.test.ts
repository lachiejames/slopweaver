import { describe, expect, it } from "vitest";

import {
  grantUsage,
  parseGrantListArgs,
  parseGrantPerformArgs,
  parseGrantRecordArgs,
  parseGrantRefuseArgs,
  parseGrantShowArgs,
} from "../../../cli/commands/grant/core.js";
import { unwrap } from "../../../lib/result.js";

const ANCHOR = "transcript:a0000006-0000-4000-8000-000000000006#22222222-2222-2222-2222-222222222222";
const RECORD = [
  "--target-file",
  "src/config.ts",
  "--change-kind",
  "literal",
  "--change",
  "TIMEOUT = 30",
  "--anchor",
  ANCHOR,
];

describe("parseGrantRecordArgs", () => {
  it("reads a complete row", () => {
    const options = unwrap(parseGrantRecordArgs({ rest: RECORD }));

    expect(options.target).toEqual({ kind: "file", path: "src/config.ts" });
    expect(options.change).toEqual({ kind: "inline", text: "TIMEOUT = 30" });
    expect(options.changeKind).toBe("literal");
    expect(options.anchor).toBe(ANCHOR);
  });

  it("reads a system target", () => {
    const rest = ["--target-system", "linear", "--change-kind", "diff", "--change", "x", "--anchor", ANCHOR];

    expect(unwrap(parseGrantRecordArgs({ rest })).target).toEqual({ kind: "system", name: "linear" });
  });

  it("refuses a row that names both a file and a system", () => {
    const result = parseGrantRecordArgs({ rest: [...RECORD, "--target-system", "linear"] });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().join(" ")).toContain("a row names one thing, not two");
  });

  it("refuses a row with no target", () => {
    const result = parseGrantRecordArgs({ rest: ["--change-kind", "literal", "--change", "x", "--anchor", ANCHOR] });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("--target-file or --target-system is required");
  });

  it("refuses a row with no anchor", () => {
    const result = parseGrantRecordArgs({
      rest: ["--target-file", "src/config.ts", "--change-kind", "literal", "--change", "x"],
    });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("--anchor is required");
  });

  it("refuses a change-kind that would let a paraphrase in", () => {
    const result = parseGrantRecordArgs({
      rest: ["--target-file", "a", "--change-kind", "summary", "--change", "x", "--anchor", ANCHOR],
    });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("never a paraphrase");
  });

  it("refuses both --change and --change-file", () => {
    const result = parseGrantRecordArgs({ rest: [...RECORD, "--change-file", "/tmp/x"] });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("pass the change once");
  });

  it("carries --change-file as a path, so the parse stays free of I/O", () => {
    const rest = ["--target-file", "a", "--change-kind", "diff", "--change-file", "/tmp/x.diff", "--anchor", ANCHOR];

    expect(unwrap(parseGrantRecordArgs({ rest })).change).toEqual({ kind: "file", path: "/tmp/x.diff" });
  });
});

describe("parseGrantShowArgs", () => {
  it("reads the positional id", () => {
    expect(unwrap(parseGrantShowArgs({ rest: ["g-1a2b3c4d"] })).grantId).toBe("g-1a2b3c4d");
  });

  it("refuses no id", () => {
    expect(parseGrantShowArgs({ rest: [] })._unsafeUnwrapErr().join(" ")).toContain("a grant id is required");
  });

  it("refuses two ids, because a row is one change", () => {
    expect(
      parseGrantShowArgs({ rest: ["g-1", "g-2"] })
        ._unsafeUnwrapErr()
        .join(" "),
    ).toContain("one grant id at a time");
  });
});

describe("parseGrantPerformArgs", () => {
  it("reads the id and the read-back", () => {
    const options = unwrap(parseGrantPerformArgs({ rest: ["g-1", "--wrote", "TIMEOUT = 30"] }));

    expect(options.grantId).toBe("g-1");
    expect(options.wrote).toEqual({ kind: "inline", text: "TIMEOUT = 30" });
  });

  it("refuses a performance with no read-back", () => {
    expect(
      parseGrantPerformArgs({ rest: ["g-1"] })
        ._unsafeUnwrapErr()
        .join(" "),
    ).toContain("the read-back is what makes an over-grant findable");
  });
});

describe("parseGrantRefuseArgs — the typed refusal path", () => {
  it("accepts a named check", () => {
    const options = unwrap(
      parseGrantRefuseArgs({ rest: ["g-1", "--check", "RAIL_CROSSED", "--why", "widens access"] }),
    );

    expect(options.check).toBe("RAIL_CROSSED");
    expect(options.why).toBe("widens access");
  });

  it("refuses a code outside the closed set, so an untyped refusal cannot be journalled", () => {
    const result = parseGrantRefuseArgs({ rest: ["g-1", "--check", "I_DONT_BELIEVE_YOU", "--why", "vibes"] });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("no code for disbelieving the sender");
  });

  it("refuses a refusal with no check at all", () => {
    const result = parseGrantRefuseArgs({ rest: ["g-1", "--why", "vibes"] });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("--check must name one of");
  });

  it("refuses a blank reason", () => {
    const result = parseGrantRefuseArgs({ rest: ["g-1", "--check", "ROW_MISSING", "--why", "   "] });

    expect(result._unsafeUnwrapErr().join(" ")).toContain("--why is required");
  });
});

describe("parseGrantListArgs and grantUsage", () => {
  it("defaults to no home and no json", () => {
    const options = unwrap(parseGrantListArgs({ rest: [] }));

    expect(options.home).toBe(undefined);
    expect(options.json).toBe(false);
  });

  it("builds a usage line naming the positional and every flag", () => {
    expect(grantUsage({ verb: "refuse" })).toBe(
      "usage: slopweaver grant refuse <grant-id> [--check <value>] [--home <value>] [--json] [--why <value>]",
    );
  });
});
