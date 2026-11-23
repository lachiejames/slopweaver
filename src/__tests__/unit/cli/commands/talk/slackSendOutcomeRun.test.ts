/**
 * `talk slack-send-outcome`'s verb shell: the paths decided before any Slack read. The rules it reads by are
 * `src/talk/slackSendOutcome.ts`'s and are tested there; a token in the environment could reach Slack, so no path
 * past the argument parse runs here.
 */
import { describe, expect, it } from "vitest";

import { runTalkSlackSendOutcome } from "../../../../../cli/commands/talk/slackSendOutcomeRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** The argv a verb sees before its own flags. */
const PREFIX = ["node", "slopweaver", "talk", "slack-send-outcome"] as const;

describe("runTalkSlackSendOutcome", () => {
  it("prints its usage for --help and reads nothing", async () => {
    expect(await runTalkSlackSendOutcome([...PREFIX, "--help"])).toBe(EXIT_OK);
  });

  it("refuses a call missing the link or the instant as a usage error, before any read", async () => {
    expect([
      await runTalkSlackSendOutcome([...PREFIX, "--since", "2026-10-07T05:52:56.000Z"]),
      await runTalkSlackSendOutcome([
        ...PREFIX,
        "--url",
        "https://acme.slack.com/archives/C0SYN000001/p1791351441819519",
      ]),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE]);
  });
});
