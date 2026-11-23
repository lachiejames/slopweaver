import { describe, expect, it } from "vitest";

import { memberLoopAcknowledgementsFrom } from "../../../../../cli/commands/github/lapBatchArgs.js";
import { parseGithubLapArgs } from "../../../../../cli/commands/github/lapCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const BATCH = ["--repo", "o/r", "--number", "7,8,9", "--land"];

describe("--codex-loop-incomplete", () => {
  it("carries each member's own reason, in the order given, onto the batch", () => {
    const rest = [
      ...BATCH,
      "--codex-loop-incomplete",
      "8=cap Codex review at two passes, yes, 11 Nov: r1-02 left",
      "--codex-loop-incomplete=7=capped: r3-01 left",
    ];
    expect(unwrap(parseGithubLapArgs({ rest })).memberLoop).toEqual([
      { number: 8, reason: "cap Codex review at two passes, yes, 11 Nov: r1-02 left" },
      { number: 7, reason: "capped: r3-01 left" },
    ]);
  });

  it("gives a batch with none an empty list, and a single lap no field at all", () => {
    expect(unwrap(parseGithubLapArgs({ rest: BATCH })).memberLoop).toEqual([]);
    expect(unwrap(parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land"] }))).toEqual({
      acknowledge: undefined,
      dryRun: false,
      home: undefined,
      land: true,
      landOnly: false,
      number: 7,
      owner: "o",
      repo: "r",
    });
  });

  it("refuses it on a single lap, which names the subject with --acknowledge", () => {
    expect(
      unwrapErr(
        parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land", "--codex-loop-incomplete", "7=x"] }),
      ),
    ).toEqual(["--codex-loop-incomplete is a batch member's; a single lap names it with --acknowledge and --reason"]);
  });

  it("refuses it without --land, a member outside the batch, a member named twice and a malformed value", () => {
    expect(
      memberLoopAcknowledgementsFrom({ land: false, members: [7, 8], values: ["9=a", "7=b", "7=c", "8=", "x"] }),
    ).toEqual({
      acknowledgements: [],
      errors: [
        "--codex-loop-incomplete is for --land's merges, and a lap without --land merges nothing",
        "--codex-loop-incomplete names #9, which is not a member of this batch",
        "--codex-loop-incomplete names #7 twice; one member takes one reason",
        "--codex-loop-incomplete 8=: write it as <member>=<reason>, the reason not empty",
        "--codex-loop-incomplete x: write it as <member>=<reason>, the reason not empty",
      ],
    });
  });

  it("keeps a reason that itself holds an equals sign and a comma whole", () => {
    expect(memberLoopAcknowledgementsFrom({ land: true, members: [7, 8], values: ["8=a=b, c"] })).toEqual({
      acknowledgements: [{ number: 8, reason: "a=b, c" }],
      errors: [],
    });
  });
});
