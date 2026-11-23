import { describe, expect, it } from "vitest";
import {
  alertDoorRequest,
  githubDismissedReasonOf,
  parseGithubAlertArgs,
} from "../../../../../cli/commands/github/alertCore.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubAlertArgs", () => {
  it("refuses an unrecognised sub-verb", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubAlertArgs({ argv: ["close", "--repo", "o/r"] })) }),
    ).toEqual(["usage: slopweaver github alert <list|dismiss> [...]"]);
  });

  describe("list", () => {
    it("requires only --repo, with --pr and --state left undefined", () => {
      expect(unwrap(parseGithubAlertArgs({ argv: ["list", "--repo", "o/r"] }))).toEqual({
        dryRun: false,
        home: undefined,
        json: false,
        owner: "o",
        repo: "r",
        pr: undefined,
        state: undefined,
        subVerb: "list",
      });
    });

    it("accepts --pr and --state", () => {
      expect(
        unwrap(parseGithubAlertArgs({ argv: ["list", "--repo", "o/r", "--pr", "95", "--state", "open"] })),
      ).toEqual({
        dryRun: false,
        home: undefined,
        json: false,
        owner: "o",
        repo: "r",
        pr: 95,
        state: "open",
        subVerb: "list",
      });
    });

    it("refuses a missing --repo", () => {
      expect(githubVerbErrorLines({ error: unwrapErr(parseGithubAlertArgs({ argv: ["list"] })) })).toEqual([
        "--repo owner/name is required",
      ]);
    });

    it("refuses a --state outside GitHub's own enum", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(parseGithubAlertArgs({ argv: ["list", "--repo", "o/r", "--state", "closed"] })),
        }),
      ).toEqual(["--state must be one of open, dismissed, fixed"]);
    });

    it("refuses a non-positive --pr", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(parseGithubAlertArgs({ argv: ["list", "--repo", "o/r", "--pr", "0"] })),
        }),
      ).toEqual(["--pr must be a positive whole number"]);
    });

    it("refuses a dismiss-only flag", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(
            parseGithubAlertArgs({ argv: ["list", "--repo", "o/r", "--number", "29", "--reason", "wont_fix"] }),
          ),
        }),
      ).toEqual(["--number is not a `list` flag", "--reason is not a `list` flag"]);
    });
  });

  describe("dismiss", () => {
    const DISMISS_ARGS = [
      "dismiss",
      "--repo",
      "o/r",
      "--number",
      "29",
      "--reason",
      "used_in_tests",
      "--comment",
      "the sensitivity fixture builds the taint on purpose",
    ];

    it("parses a full dismissal", () => {
      expect(unwrap(parseGithubAlertArgs({ argv: DISMISS_ARGS }))).toEqual({
        comment: "the sensitivity fixture builds the taint on purpose",
        dryRun: false,
        home: undefined,
        json: false,
        number: 29,
        owner: "o",
        reason: "used_in_tests",
        repo: "r",
        subVerb: "dismiss",
      });
    });

    it("refuses a reason outside the accepted set", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(
            parseGithubAlertArgs({
              argv: ["dismiss", "--repo", "o/r", "--number", "29", "--reason", "not_a_reason", "--comment", "why"],
            }),
          ),
        }),
      ).toEqual(["--reason must be one of false_positive, wont_fix, used_in_tests"]);
    });

    it("refuses a dismissal with no comment", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(
            parseGithubAlertArgs({ argv: ["dismiss", "--repo", "o/r", "--number", "29", "--reason", "wont_fix"] }),
          ),
        }),
      ).toEqual(["--comment <text> is required"]);
    });

    it("refuses a comment over GitHub's own 280-character dismissal limit", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(
            parseGithubAlertArgs({
              argv: [
                "dismiss",
                "--repo",
                "o/r",
                "--number",
                "29",
                "--reason",
                "wont_fix",
                "--comment",
                "x".repeat(281),
              ],
            }),
          ),
        }),
      ).toEqual([
        "--comment must be at most 280 characters — GitHub's own dismissal comment field refuses more (281 given)",
      ]);
    });

    it("accepts a comment at exactly the 280-character limit", () => {
      const result = parseGithubAlertArgs({
        argv: ["dismiss", "--repo", "o/r", "--number", "29", "--reason", "wont_fix", "--comment", "x".repeat(280)],
      });
      expect(result.isOk()).toBe(true);
    });

    it("refuses a non-positive --number", () => {
      expect(
        githubVerbErrorLines({
          error: unwrapErr(
            parseGithubAlertArgs({
              argv: ["dismiss", "--repo", "o/r", "--number", "0", "--reason", "wont_fix", "--comment", "why"],
            }),
          ),
        }),
      ).toEqual(["--number must be a positive whole number"]);
    });

    it("refuses a list-only flag", () => {
      expect(
        githubVerbErrorLines({ error: unwrapErr(parseGithubAlertArgs({ argv: [...DISMISS_ARGS, "--pr", "95"] })) }),
      ).toEqual(["--pr is not a `dismiss` flag"]);
    });
  });
});

describe("githubDismissedReasonOf", () => {
  it("translates every CLI reason to GitHub's exact enum string", () => {
    expect(githubDismissedReasonOf({ reason: "false_positive" })).toBe("false positive");
    expect(githubDismissedReasonOf({ reason: "wont_fix" })).toBe("won't fix");
    expect(githubDismissedReasonOf({ reason: "used_in_tests" })).toBe("used in tests");
  });
});

describe("alertDoorRequest", () => {
  it("addresses the exact alert as the door artifact and marks the write external", () => {
    expect(
      alertDoorRequest({
        args: {
          comment: "why",
          dryRun: false,
          home: undefined,
          json: false,
          number: 29,
          owner: "o",
          reason: "used_in_tests",
          repo: "r",
          subVerb: "dismiss",
        },
        home: "/tmp/home",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "alert dismiss" },
      artifact: { id: "o/r code-scanning-alert#29" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});
