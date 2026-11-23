/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import { queueCell } from "../../../../../cli/commands/github/landingFacts.js";
import {
  askPeopleOf,
  boardCell,
  ciCell,
  everyLoginSlackIdOf,
  LANDING_HEADER,
  landingDispatchLine,
  landingRowLine,
  landingTable,
  landingTallyLine,
  loginSlackIdsOf,
  whyCell,
} from "../../../../../cli/commands/github/landingReport.js";
import { codeownerTeamRequirement } from "../../../../../review/codeownerTeams.js";
import { githubCodeownerRequirement } from "../../../../../review/githubCodeowners.js";
import type { LandingRow } from "../../../../../review/landing.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const row = (over: Partial<LandingRow> = {}): LandingRow => landingRowFake(over);

/** One trail entry asking `recipients`, the rest of its fields fixed. */
const asked = ({ recipients }: { recipients: readonly string[] }): LandingRow["askTrail"][number] => ({
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-team",
  isDirectMessage: false,
  leg: "corpus",
  messageKey: "C1:1",
  permalink: "https://acme.slack.com/archives/C1/p1",
  recipients,
});

describe("askPeopleOf", () => {
  it("names every recipient the roster names, and leaves out an id it cannot name rather than inventing one", () => {
    const rows = [
      row({ askTrail: [asked({ recipients: ["U0SYN000002", "U0SYN000004"] })] }),
      row({ askTrail: [asked({ recipients: ["U0SYN000002", "S0SYN000011"] })] }),
      row({ askTrail: [] }),
    ];
    const nameForSlackId = new Map([
      ["U0SYN000002", "Rosa Lindqvist"],
      ["U0SYN000004", "  "],
      ["U0SYNUNRELATED", "Somebody Unasked"],
    ]);
    expect(askPeopleOf({ logins: {}, nameForSlackId, rows })).toEqual({ U0SYN000002: { name: "Rosa Lindqvist" } });
  });

  it("also names the Slack ids the document resolved for authors and code owners", () => {
    const nameForSlackId = new Map([["U0OWNER", "Pranav"]]);
    expect(askPeopleOf({ logins: { pranav: "U0OWNER" }, nameForSlackId, rows: [] })).toEqual({
      U0OWNER: { name: "Pranav" },
    });
  });
});

describe("loginSlackIdsOf", () => {
  it("resolves every author and individual code owner the roster knows, never a team", () => {
    const rows = [row({ authorLogin: "OctoCat", blockedOn: ["@acme/security", "@Pranav", "@nobody-known"] })];
    const slackIdForLogin = new Map([
      ["octocat", "U0SYNADAOWN"],
      ["pranav", "U0PRANAV"],
      ["acme/security", "S0TEAM"],
    ]);
    expect(loginSlackIdsOf({ rows, slackIdForLogin })).toEqual({ octocat: "U0SYNADAOWN", pranav: "U0PRANAV" });
  });
});

describe("everyLoginSlackIdOf", () => {
  it("carries every Slack id the roster joins to an author or individual code owner, never a team", () => {
    const rows = [row({ authorLogin: "Alice-GH", blockedOn: ["@acme/security", "@Pranav", "@nobody-known"] })];
    const slackIdsForLogin = new Map<string, readonly string[]>([
      ["alice-gh", ["W0ALICE", "U0ALICE"]],
      ["pranav", ["U0PRANAV"]],
      ["acme/security", ["S0TEAM"]],
    ]);
    expect(everyLoginSlackIdOf({ rows, slackIdsForLogin })).toEqual({
      "alice-gh": ["W0ALICE", "U0ALICE"],
      pranav: ["U0PRANAV"],
    });
  });
});

describe("queueCell", () => {
  it("prints the position and state of a queued pull request", () => {
    expect(queueCell({ row: row({ queue: { kind: "queued", position: 2, state: "AWAITING_CHECKS" } }) })).toBe(
      "#2 awaiting_checks",
    );
  });

  it("shouts DROPPED, because a silent drop is the state this register exists to make visible", () => {
    expect(
      queueCell({
        row: row({
          queue: {
            headOid: "1111111111111111111111111111111111111111",
            kind: "pressed-not-queued",
            pressedAtIso: "2026-09-09T12:10:00.000Z",
          },
        }),
      }),
    ).toBe("DROPPED");
  });

  it("distinguishes a base with no queue from one this run did not read", () => {
    expect(queueCell({ row: row({ queue: { kind: "no-queue" } }) })).toBe("no queue");
    expect(queueCell({ row: row({ queue: { kind: "unread", why: "GitHub answered 502" } }) })).toBe("unread");
  });
});

describe("boardCell", () => {
  it("prints the row's status when a handover row declares the branch", () => {
    expect(boardCell({ row: row({ boardRow: { kind: "row", slug: "a-run", status: "ready" } }) })).toBe("ready");
  });

  it("prints `none?` when no row DECLARED the branch, which is not the same as no row existing", () => {
    expect(boardCell({ row: row() })).toBe("none?");
  });
});

describe("ciCell", () => {
  it("splits a red rollup into REQUIRED, advisory and RED? by the row's own classification", () => {
    const red = ({ required }: { required: boolean | undefined }): string =>
      ciCell({ row: row({ ci: "red", ciFailure: { kind: "red", required } }) });
    expect([red({ required: true }), red({ required: false }), red({ required: undefined })]).toStrictEqual([
      "REQUIRED",
      "advisory",
      "RED?",
    ]);
  });

  it("keeps the rollup's own word for every verdict that is not red", () => {
    const cells = (["green", "running", "none"] as const).map((ci) => ciCell({ row: row({ ci }) }));
    expect(cells).toStrictEqual(["green", "running", "none"]);
  });
});

describe("whyCell", () => {
  it("names the REQUIRED failing check on a spawn-ci row, not every red one", () => {
    const built = row({
      action: "spawn-ci",
      ci: "red",
      ciFailure: { kind: "red", required: true },
      failingChecks: [
        { kind: "check-run", name: "lint", required: false, state: "failed", url: undefined },
        { kind: "check-run", name: "build", required: true, state: "failed", url: undefined },
      ],
    });
    expect(whyCell({ row: built })).toBe("required check failing: build · a change");
  });

  it("says advisory, and names every failing check, on a spawn-ci row whose red is advisory only", () => {
    const built = row({
      action: "spawn-ci",
      ci: "red",
      ciFailure: { kind: "red", required: false },
      failingChecks: [
        {
          kind: "check-run",
          name: "Advisory local browser E2E (billing)",
          required: false,
          state: "failed",
          url: undefined,
        },
      ],
    });
    expect(whyCell({ row: built })).toBe("advisory check failing: Advisory local browser E2E (billing) · a change");
  });

  it("says the requirement is unknown rather than advisory when the read could not tell", () => {
    const built = row({
      action: "spawn-ci",
      ci: "red",
      ciFailure: { kind: "red", required: undefined },
      failingChecks: [{ kind: "check-run", name: "e2e", required: undefined, state: "failed", url: undefined }],
    });
    expect(whyCell({ row: built })).toBe("failing check requirement unknown: e2e · a change");
  });

  it("says the requirement is unknown with no checks to name on a red rollup that reported none", () => {
    const built = row({ action: "spawn-ci", ci: "red", ciFailure: { kind: "red", required: undefined } });
    expect(whyCell({ row: built })).toBe("failing check requirement unknown · a change");
  });

  it("says the OWNER's words on a blocked-on row, and still names every owner, because the names alone said nothing", () => {
    const built = row({
      action: "blocked-on",
      actionDetail: "waiting on a human review — GitHub still holds a code-owner request out to @acme/eng",
      blockedOn: ["@acme/eng", "@a-colleague"],
    });

    expect(whyCell({ row: built })).toBe(
      "waiting on a human review — GitHub still holds a code-owner request out to @acme/eng · a change",
    );
  });

  it("still names the reviewers alone on an answer-threads row, where the names ARE the information", () => {
    expect(whyCell({ row: row({ action: "answer-threads", blockedOn: ["@acme/eng", "@a-colleague"] }) })).toBe(
      "@acme/eng, @a-colleague · a change",
    );
  });

  it("falls back to the act's own sentence when nobody is named", () => {
    expect(whyCell({ row: row() })).toContain("press 'Merge when ready'");
  });
});

describe("landingRowLine and landingTable", () => {
  it("puts the act in the second column, where the header says it is", () => {
    expect(LANDING_HEADER).toContain("ACT");
    expect(landingRowLine({ row: row() }).startsWith("#16378    press")).toBe(true);
  });

  it("groups the table one repository at a time, each with its own header", () => {
    const lines = landingTable({
      rows: [row(), row({ number: 501, repoSlug: "acme/other" })],
    });
    expect(lines[0]).toBe("acme/widgets — 1 open");
    expect(lines[5]).toBe("acme/other — 1 open");
  });

  it("gives every pull request a SECOND line, so the ACT column above still scans unbroken", () => {
    const lines = landingTable({ rows: [row()] });
    expect(lines[2]).toBe(landingRowLine({ row: row() }));
    expect(lines[2]!.slice(0, 15)).toBe("#16378    press");
    expect(lines[3]).toBe(
      "          merge-now: every test passed and it is not queued · cr 0 open (0↤ 0↦ 0↩) 0 done · " +
        "hu 0 open (0↤ 0↦ 0↩) 0 done · base +1/-3 · " +
        "ask in Slack: no, chase unknown",
    );
  });
});

describe("landingTallyLine", () => {
  it("leads with the totals and then every act that occurred", () => {
    expect(
      landingTallyLine({
        tally: {
          byAction: [
            { action: "blocked-on", count: 16 },
            { action: "press", count: 3 },
          ],
          advisoryRedBypassed: 0,
          byDispatch: [],
          ready: 3,
          total: 29,
        },
      }),
    ).toBe("29 open · 3 ready · blocked-on 16 · press 3");
  });

  it("names the advisory-only reds the read no longer holds, so passing them is never silent", () => {
    expect(
      landingTallyLine({
        tally: {
          advisoryRedBypassed: 9,
          byAction: [{ action: "blocked-on", count: 24 }],
          byDispatch: [],
          ready: 0,
          total: 24,
        },
      }),
    ).toBe("24 open · 0 ready · blocked-on 24 · advisory-only red, not holding 9");
  });
});

describe("landingDispatchLine", () => {
  it("counts both session acts that keep nothing of the owner's stale, and cards only the owner's judgement", () => {
    const line = landingDispatchLine({
      spawnable: 7,
      tally: {
        advisoryRedBypassed: 0,
        byAction: [],
        byDispatch: [
          { count: 6, verdict: "finish-or-card-close" },
          { count: 1, verdict: "draft-first-review-ask" },
          { count: 2, verdict: "needs-owner-judgment" },
        ],
        ready: 0,
        total: 9,
      },
    });
    expect(line).toBe(
      "dispatch: finish-or-card-close 6 · draft-first-review-ask 1 · needs-owner-judgment 2 — 7 to spawn, 2 to card",
    );
  });

  it("says no row carried a verdict when none did", () => {
    const tally = { advisoryRedBypassed: 0, byAction: [], byDispatch: [], ready: 0, total: 0 };
    expect(landingDispatchLine({ spawnable: 0, tally })).toBe("dispatch: no row carried a dispatch verdict");
  });
});

describe("the codeowner answer the report leans on", () => {
  it("is GitHub's own, so a team approval clears an owner the CODEOWNERS reading would call unknown", () => {
    const answer = githubCodeownerRequirement({
      requests: [],
      requestsTruncated: false,
      reviews: [{ login: "a-colleague", onBehalfOf: ["acme/eng"], state: "APPROVED" }],
      reviewsTruncated: false,
    });
    expect(answer.owners.filter((owner) => owner.state !== "approved")).toEqual([]);
    expect(codeownerTeamRequirement({ rules: [] }).teams).toEqual([]);
  });
});
