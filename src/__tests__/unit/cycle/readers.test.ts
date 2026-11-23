import { describe, expect, it } from "vitest";

import { cycleIssueOf, newestPerIssue } from "../../../cycle/issue.js";
import { pullRequestOutcomeOf, pullRequestStates } from "../../../cycle/pullRequests.js";

const issueLine = ({ updatedAt, tsIso }: { updatedAt: string; tsIso: string }): string =>
  JSON.stringify({
    attrs: { team: "EXA" },
    kind: "issue",
    raw: {
      assignee: { id: "owner" },
      attachments: { nodes: [{ url: "https://github.com/example-org/example-repo/pull/101" }, { title: "no url" }] },
      cycle: { id: "c1", name: "Cycle 1", number: 1 },
      priorityLabel: "Urgent",
      project: { name: "Example project" },
      state: { name: "In Review", type: "started" },
      team: { key: "EXA" },
      title: "a ticket",
      updatedAt,
      url: "https://linear.app/example/issue/exa-1",
    },
    sourceId: "EXA-1",
    tsIso,
  });

describe("cycleIssueOf", () => {
  it("reads every field the classifier judges on", () => {
    const read = cycleIssueOf({
      line: issueLine({ tsIso: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }),
    })!;
    expect(read.identifier).toBe("EXA-1");
    expect(read.assigneeId).toBe("owner");
    expect(read.cycleId).toBe("c1");
    expect(read.stateName).toBe("In Review");
    expect(read.stateType).toBe("started");
    expect(read.priority).toBe("Urgent");
    expect(read.projectName).toBe("Example project");
    expect(read.team).toBe("EXA");
  });

  it("keeps only attachment entries that carry a url", () => {
    const read = cycleIssueOf({
      line: issueLine({ tsIso: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }),
    })!;
    expect(read.attachmentUrls).toEqual(["https://github.com/example-org/example-repo/pull/101"]);
  });

  it("defaults an unstated priority rather than leaving it blank", () => {
    const line = JSON.stringify({
      kind: "issue",
      raw: { state: { name: "Todo", type: "unstarted" }, updatedAt: "2026-08-01T00:00:00.000Z" },
      sourceId: "EXA-2",
      tsIso: "2026-08-01T00:00:00.000Z",
    });
    expect(cycleIssueOf({ line })!.priority).toBe("No priority");
  });

  it("answers undefined for a row that is not an issue", () => {
    expect(cycleIssueOf({ line: JSON.stringify({ kind: "comment", sourceId: "x" }) })).toBe(undefined);
  });

  it("answers undefined rather than throwing on an unparseable line", () => {
    expect(cycleIssueOf({ line: "nope" })).toBe(undefined);
  });
});

describe("newestPerIssue", () => {
  it("keeps the newest row per identifier", () => {
    const older = cycleIssueOf({
      line: issueLine({ tsIso: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }),
    })!;
    const newer = cycleIssueOf({
      line: issueLine({ tsIso: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }),
    })!;
    const kept = newestPerIssue({ issues: [newer, older] });
    expect(kept.length).toBe(1);
    expect(kept[0]!.updatedAt).toBe("2026-08-20T00:00:00.000Z");
  });
});

const prLine = ({ state, tsIso, url }: { state: string; tsIso: string; url: string }): string =>
  JSON.stringify({ attrs: { state }, container: "example-org/example-repo", kind: "pr", sourceId: "#101", tsIso, url });

describe("pullRequestOutcomeOf", () => {
  it("keys on the pull request's url, which is what Linear attaches", () => {
    const url = "https://github.com/example-org/example-repo/pull/101";
    const read = pullRequestOutcomeOf({ line: prLine({ state: "MERGED", tsIso: "2026-08-01T00:00:00Z", url }) })!;
    expect(read.url).toBe(url);
    expect(read.state).toBe("MERGED");
  });

  it("answers undefined for a state outside the vocabulary rather than guessing one", () => {
    const line = prLine({ state: "DRAFT", tsIso: "2026-08-01T00:00:00Z", url: "https://github.com/o/r/pull/1" });
    expect(pullRequestOutcomeOf({ line })).toBe(undefined);
  });

  it("answers undefined for a row that is not a pull request", () => {
    expect(pullRequestOutcomeOf({ line: JSON.stringify({ kind: "review", url: "u" }) })).toBe(undefined);
  });
});

describe("pullRequestStates", () => {
  it("keeps the newest known ending for each url", () => {
    const url = "https://github.com/example-org/example-repo/pull/101";
    const states = pullRequestStates({
      outcomes: [
        { recordTsIso: "2026-08-01T00:00:00Z", state: "OPEN", url },
        { recordTsIso: "2026-08-05T00:00:00Z", state: "MERGED", url },
      ],
    });
    expect(states.get(url)).toBe("MERGED");
  });

  it("is empty when nothing was read", () => {
    expect(pullRequestStates({ outcomes: [] }).size).toBe(0);
  });
});
