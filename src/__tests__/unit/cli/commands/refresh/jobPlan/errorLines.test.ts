/**
 * `refreshJobErrorLines`: how each job-planning refusal prints, one line per GitHub reason and one message for
 * every other kind.
 */
import { describe, expect, it } from "vitest";
import { RefreshErrors } from "../../../../../../cli/commands/refresh/errors.js";
import { refreshJobErrorLines } from "../../../../../../cli/commands/refresh/jobPlan.js";

describe("refreshJobErrorLines", () => {
  it("prints a GitHub refusal as the builder's own lines, one per reason, not the joined message", () => {
    const lines = refreshJobErrorLines({
      error: RefreshErrors.githubJobUnbuildable({ reasons: ["first-reason-kilo", "second-reason-lima"] }),
    });

    expect(lines).toStrictEqual(["first-reason-kilo", "second-reason-lima"]);
  });

  it("prints a self refusal as its one message", () => {
    expect(refreshJobErrorLines({ error: RefreshErrors.selfNotFetchable() })).toStrictEqual([
      "refresh: self is not a fetchable source — use --self (a full local re-scan, no cursor)",
    ]);
  });

  it.each([
    { line: "refresh: gmail was requested but this build has no mail ingest lane wired", source: "gmail" as const },
    {
      line: "refresh: calendar was requested but this build has no diary ingest lane wired",
      source: "calendar" as const,
    },
    {
      line: "refresh: fathom was requested but this build has no recorded-call ingest lane wired",
      source: "fathom" as const,
    },
    {
      line: "refresh: chatgpt was requested but this build has no chat-history ingest lane wired",
      source: "chatgpt" as const,
    },
    {
      line: "refresh: outlook-calendar was requested but this build has no Outlook diary ingest lane wired",
      source: "outlook-calendar" as const,
    },
  ])("prints an unwired $source lane as its one message", ({ source, line }) => {
    expect(refreshJobErrorLines({ error: RefreshErrors.laneNotWired({ source }) })).toStrictEqual([line]);
  });
});
