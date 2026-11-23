import { describe, expect, it } from "vitest";

import { GithubCiRunsUsageIssues } from "../../../../../cli/commands/github/ciRunsErrors.js";

// The only-without-update issue left with the ci-ratchet verb, and its case with it.
// deleted-with-code: onlyWithoutUpdate
describe("GithubCiRunsUsageIssues", () => {
  it("builds a blank-value issue naming the flag it was given for", () => {
    expect(GithubCiRunsUsageIssues.blankFlagValue({ flag: "only-alpha" })).toEqual({
      code: "BLANK_FLAG_VALUE",
      flag: "only-alpha",
      message: "--only-alpha was given with no value",
    });
  });

  it("forwards the shared parser's wording unchanged", () => {
    expect(GithubCiRunsUsageIssues.flagParse({ message: "parser-bravo" })).toEqual({
      code: "FLAG_PARSE",
      message: "parser-bravo",
    });
  });

  it("builds a dash-leading-value issue carrying both the flag and the offending value", () => {
    expect(
      GithubCiRunsUsageIssues.flagValueLooksLikeFlag({ flag: "baseline-charlie", value: "--looks-delta" }),
    ).toEqual({
      code: "FLAG_VALUE_LOOKS_LIKE_FLAG",
      flag: "baseline-charlie",
      message:
        "--baseline-charlie was given --looks-delta, which begins with -- and cannot be written back onto a command line: " +
        "the flag parser refuses any string value starting --, in the spaced and the = spelling alike, so a " +
        "recovery printing it would not run. Pass it as a path that does not lead with dashes instead",
    });
  });

  it("builds the missing-run-id issue", () => {
    expect(GithubCiRunsUsageIssues.runIdMissing()).toEqual({
      code: "RUN_ID_MISSING",
      message: "--run-id is required; inside a workflow pass ${{ github.run_id }}",
    });
  });

  it("builds the non-numeric-run-id issue", () => {
    expect(GithubCiRunsUsageIssues.runIdNotNumeric()).toEqual({
      code: "RUN_ID_NOT_NUMERIC",
      message: "--run-id must be a positive integer; inside a workflow it is $GITHUB_RUN_ID",
    });
  });

  it("builds the out-of-range window issue with the ceiling in both the payload and the message", () => {
    expect(GithubCiRunsUsageIssues.runWindowOutOfRange({ max: 37 })).toEqual({
      code: "RUN_WINDOW_OUT_OF_RANGE",
      max: 37,
      message: "--runs must be an integer from 1 to 37",
    });
  });

  it("builds the unknown-event issue listing every allowed trigger in the order given", () => {
    expect(
      GithubCiRunsUsageIssues.unknownEvent({ allowed: ["push-echo", "schedule-foxtrot", "dispatch-golf"] }),
    ).toEqual({
      allowed: ["push-echo", "schedule-foxtrot", "dispatch-golf"],
      code: "UNKNOWN_EVENT",
      message: "--event must be one of push-echo, schedule-foxtrot, dispatch-golf",
    });
  });
});
