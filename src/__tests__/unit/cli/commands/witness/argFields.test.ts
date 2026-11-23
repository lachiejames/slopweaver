/**
 * The `witness` field readers: each records what is wrong rather than stopping, so a parse reports every reason.
 */
import { describe, expect, it } from "vitest";

import { keyOf, requiredOf, witnessIdOfPositionals } from "../../../../../cli/commands/witness/argFields.js";

describe("witnessIdOfPositionals", () => {
  it.each<[readonly string[], string | undefined, readonly string[]]>([
    [["w-0123456789abcdef"], "w-0123456789abcdef", []],
    [[], undefined, []],
    [["w-0123456789abcdef", "w-fedcba9876543210"], undefined, ["one witness id at a time"]],
    [["W1"], undefined, ['"W1" is not a witness id — they look like w-0123456789abcdef (slopweaver witness list)']],
  ])("%j", (positionals, id, expected) => {
    const problems: string[] = [];
    expect([witnessIdOfPositionals({ positionals, problems }), problems]).toEqual([id, expected]);
  });
});

describe("requiredOf", () => {
  it("records a blank value as missing, naming why the flag is needed", () => {
    const problems: string[] = [];
    const value = requiredOf({ name: "wrong", problems, values: { wrong: "  " }, why: "the claim's exact words" });
    expect([value, problems]).toEqual([undefined, ["--wrong is required — the claim's exact words"]]);
  });
});

describe("keyOf", () => {
  it("is absent with no problem when none of the triple is given and none is required", () => {
    const problems: string[] = [];
    expect([keyOf({ problems, required: false, values: {} }), problems]).toEqual([undefined, []]);
  });

  it("names a malformed ts and the missing one together", () => {
    const problems: string[] = [];
    const key = keyOf({ problems, required: false, values: { channel: "C0SYN000000001", "thread-ts": "nope" } });
    expect([key, problems]).toEqual([
      undefined,
      [
        '--thread-ts must be a Slack ts like 1789000000.000100, got "nope"',
        "--message-ts is required — the witnessed message's own ts",
      ],
    ]);
  });
});
