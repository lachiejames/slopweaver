import { describe, expect, it } from "vitest";

import { closeThisProposals, type PullRequestState, staleCandidates } from "../../../cycle/classify.js";
import type { CycleIssue } from "../../../cycle/issue.js";
import type { ReleaseInstants } from "../../../cycle/releases.js";

const CYCLE = "c1";
const CYCLE_START = "2026-08-25T00:00:00.000Z";
const NOW = "2026-09-01T00:00:00.000Z";
const IDS: ReadonlySet<string> = new Set([CYCLE]);

const issue = (over: Partial<CycleIssue> = {}): CycleIssue => ({
  assigneeId: "owner",
  attachmentUrls: [],
  cycleId: CYCLE,
  identifier: "EXA-1",
  priority: "Medium",
  projectId: undefined,
  projectName: undefined,
  recordTsIso: "2026-08-01T00:00:00.000Z",
  stateName: "In Review",
  stateType: "started",
  team: "EXA",
  title: "a ticket",
  updatedAt: "2026-08-01T00:00:00.000Z",
  url: "https://linear.app/example/issue/exa-1",
  ...over,
});

const MERGED = "https://github.com/example-org/example-repo/pull/101";
const CLOSED = "https://github.com/example-org/example-repo/pull/102";
const OPEN = "https://github.com/example-org/example-repo/pull/103";
const states: ReadonlyMap<string, PullRequestState> = new Map([
  [MERGED, "MERGED"],
  [CLOSED, "CLOSED"],
  [OPEN, "OPEN"],
]);

const run = ({ issues, releases = new Map() }: { issues: readonly CycleIssue[]; releases?: ReleaseInstants }) =>
  closeThisProposals({
    cycleStartsAt: CYCLE_START,
    currentCycleIds: IDS,
    issues,
    nowIso: NOW,
    pullRequestStates: states,
    releases,
  }).proposals;

describe("closeThisProposals", () => {
  it("proposes a close when the attached pull request merged and the ticket stayed open", () => {
    const [proposal] = run({ issues: [issue({ attachmentUrls: [MERGED] })] });
    expect(proposal!.action).toBe("close-with-comment");
    expect(proposal!.evidence[0]!.url).toBe(MERGED);
    expect(proposal!.oneWordReplies).toEqual(["close", "keep", "later"]);
  });

  it("carries the ticket's own title, so a row says what it is without the reader opening the link", () => {
    // A key alone makes the owner open every link, so each row carries its title.
    const [proposal] = run({
      issues: [issue({ attachmentUrls: [MERGED], title: "Export Prisma connection-pool metrics to OTel" })],
    });
    expect(proposal!.subject).toBe("EXA-1");
    expect(proposal!.title).toBe("Export Prisma connection-pool metrics to OTel");
  });

  it("proposes a TRACE, never a close, when every attached pull request was closed unmerged", () => {
    const [proposal] = run({ issues: [issue({ attachmentUrls: [CLOSED] })] });
    expect(proposal!.action).toBe("trace");
    expect(proposal!.evidence[0]!.fact).toBe(
      "this pull request was closed without merging, so it is not evidence the work happened, only that somebody closed it",
    );
    expect(proposal!.headline).toBe("EXA-1 needs a look: every pull request on it was closed without merging.");
  });

  it("emits no em dash anywhere in a proposal, because the owner's own voice rules ban one", () => {
    const proposals = run({
      issues: [
        issue({ attachmentUrls: [CLOSED] }),
        issue({ attachmentUrls: ["https://github.com/o/r/pull/9"], identifier: "EXA-2" }),
        issue({ identifier: "EXA-3" }),
        issue({ attachmentUrls: [MERGED], identifier: "EXA-4" }),
        issue({ identifier: "EXA-5", stateName: "Merged" }),
      ],
    });
    const prose = proposals.flatMap((p) => [p.headline, ...p.evidence.map((e) => e.fact)]).join(" ");
    expect(prose).not.toContain("\u2014");
    expect(proposals.length).toBe(5);
  });

  it("says the state is UNKNOWN rather than absent when the corpus has never seen the pull request", () => {
    const unseen = "https://github.com/example-org/example-repo/pull/999";
    const [proposal] = run({ issues: [issue({ attachmentUrls: [unseen] })] });
    expect(proposal!.action).toBe("trace");
    expect(proposal!.headline).toBe("EXA-1 has a pull request this corpus cannot see the state of.");
    expect(proposal!.evidence[0]!.url).toBe(unseen);
  });

  it("distinguishes an unresolvable pull request from a ticket with nothing attached", () => {
    const [proposal] = run({ issues: [issue({ attachmentUrls: [] })] });
    expect(proposal!.headline).toBe("EXA-1 has not moved for 31 days and has no pull request attached.");
  });

  it("ignores an attachment that is not a pull request", () => {
    const doc = "https://example.com/a-design-doc";
    const [proposal] = run({ issues: [issue({ attachmentUrls: [doc] })] });
    expect(proposal!.headline).toBe("EXA-1 has not moved for 31 days and has no pull request attached.");
  });

  it("proposes nothing at all while a pull request is still open", () => {
    expect(run({ issues: [issue({ attachmentUrls: [OPEN] })] })).toEqual([]);
  });

  it("prefers the merged pull request when a ticket carries both a merged and a closed one", () => {
    const [proposal] = run({ issues: [issue({ attachmentUrls: [CLOSED, MERGED] })] });
    expect(proposal!.action).toBe("close-with-comment");
  });

  it("proposes a close for a terminal-in-practice state Linear's own type calls unfinished", () => {
    const [proposal] = run({ issues: [issue({ stateName: "Merged", updatedAt: "2026-08-30T00:00:00.000Z" })] });
    expect(proposal!.action).toBe("close-with-comment");
    expect(proposal!.headline).toBe('EXA-1 sits in "Merged" and is still counted as open work.');
  });

  it("proposes NOTHING for a duplicate, which is already where it belongs", () => {
    // A duplicate's underlying ticket is not done, so it is never marked done. A
    // `Duplicate` needs no further move, so proposing a close offered the one action the owner rules out on a
    // row that could never leave the list. `Merged` is NOT the same case and still proposes, above.
    const duplicate = issue({ stateName: "Duplicate", stateType: "duplicate", updatedAt: "2026-06-01T00:00:00.000Z" });

    expect(run({ issues: [duplicate] })).toEqual([]);
  });

  it("keeps a duplicate out of the stale candidates too, not only out of the closes", () => {
    const duplicate = issue({ stateName: "Duplicate", stateType: "duplicate", updatedAt: "2026-06-01T00:00:00.000Z" });

    expect(staleCandidates({ cycleStartsAt: CYCLE_START, currentCycleIds: IDS, issues: [duplicate] })).toEqual([]);
  });

  it("proposes nothing for work that moved inside the cycle", () => {
    expect(run({ issues: [issue({ attachmentUrls: [CLOSED], updatedAt: "2026-08-28T00:00:00.000Z" })] })).toEqual([]);
  });

  it("proposes nothing for a ticket already completed or cancelled", () => {
    expect(run({ issues: [issue({ stateName: "Done", stateType: "completed" })] })).toEqual([]);
    expect(run({ issues: [issue({ stateName: "Cancelled", stateType: "canceled" })] })).toEqual([]);
  });

  it("proposes nothing for a ticket outside every current cycle", () => {
    expect(run({ issues: [issue({ cycleId: "an-old-cycle" })] })).toEqual([]);
    expect(run({ issues: [issue({ cycleId: undefined })] })).toEqual([]);
  });

  it("ranks the longest-stalled first", () => {
    const older = issue({ identifier: "EXA-9", updatedAt: "2026-07-01T00:00:00.000Z" });
    const newer = issue({ identifier: "EXA-8", updatedAt: "2026-08-10T00:00:00.000Z" });
    expect(run({ issues: [newer, older] }).map((proposal) => proposal.subject)).toEqual(["EXA-9", "EXA-8"]);
  });

  it("carries Linear's own priority through rather than inferring one", () => {
    const [proposal] = run({ issues: [issue({ priority: "Urgent" })] });
    expect(proposal!.priority).toBe("Urgent");
  });
});

describe("staleCandidates", () => {
  const args = { cycleStartsAt: CYCLE_START, currentCycleIds: IDS };

  it("selects exactly the tickets whose pull-request state decides the card", () => {
    const stale = issue({ attachmentUrls: [MERGED], identifier: "EXA-1" });
    const moved = issue({ identifier: "EXA-2", updatedAt: "2026-08-28T00:00:00.000Z" });
    const done = issue({ identifier: "EXA-3", stateType: "completed" });
    const elsewhere = issue({ cycleId: "other", identifier: "EXA-4" });
    const terminal = issue({ identifier: "EXA-5", stateName: "Merged" });
    const picked = staleCandidates({ ...args, issues: [stale, moved, done, elsewhere, terminal] });
    expect(picked.map((candidate) => candidate.identifier)).toEqual(["EXA-1"]);
  });

  it("selects nothing from an empty set", () => {
    expect(staleCandidates({ ...args, issues: [] })).toEqual([]);
  });
});

describe("a Merged ticket waits for a release before it is the owner's to close", () => {
  const REPO = "example-org/example-repo";
  const mergedAt = "2026-08-30T00:00:00.000Z";
  const merged = issue({ attachmentUrls: [MERGED], stateName: "Merged", updatedAt: mergedAt });

  it("holds the row back while no release has shipped since it merged", () => {
    const releases: ReleaseInstants = new Map([[REPO, ["2026-08-29T00:00:00.000Z"]]]);
    expect(run({ issues: [merged], releases }).length).toBe(0);
  });

  it("proposes the close once a release has shipped past it, and says so on the row", () => {
    const releases: ReleaseInstants = new Map([[REPO, ["2026-08-29T00:00:00.000Z", "2026-08-31T00:00:00.000Z"]]]);
    const [proposal] = run({ issues: [merged], releases });
    expect(proposal!.headline).toBe('EXA-1 sits in "Merged" and is still counted as open work.');
    expect(proposal!.evidence[0]!.fact).toContain(
      "a release has shipped since it merged, so the job that moves Merged to Done has already run past it",
    );
  });

  it("proposes when the repository publishes no releases at all, rather than hiding it forever", () => {
    const [proposal] = run({ issues: [merged], releases: new Map() });
    expect(proposal!.evidence[0]!.fact).toContain(
      "no release history is published for its repository, so a release cannot be what it is waiting for",
    );
  });

  it("reads only the repositories the ticket's own pull requests live in", () => {
    const releases: ReleaseInstants = new Map([["other-org/other-repo", ["2026-08-31T00:00:00.000Z"]]]);
    const [proposal] = run({ issues: [merged], releases });
    expect(proposal!.evidence[0]!.fact).toContain("no release history is published for its repository");
  });

  it("leaves a ticket with no attached pull request proposing, because it has no repository to wait on", () => {
    const noTrail = issue({ stateName: "Merged", updatedAt: mergedAt });
    expect(run({ issues: [noTrail], releases: new Map([[REPO, ["2026-08-29T00:00:00.000Z"]]]) }).length).toBe(1);
  });
});

describe("the held-back count is stated, never silently dropped", () => {
  const REPO = "example-org/example-repo";
  const held = ({ releases }: { releases: ReleaseInstants }) =>
    closeThisProposals({
      cycleStartsAt: CYCLE_START,
      currentCycleIds: IDS,
      issues: [issue({ attachmentUrls: [MERGED], stateName: "Merged", updatedAt: "2026-08-30T00:00:00.000Z" })],
      nowIso: NOW,
      pullRequestStates: states,
      releases,
    });

  it("counts a ticket it held back", () => {
    const outcome = held({ releases: new Map([[REPO, ["2026-08-29T00:00:00.000Z"]]]) });
    expect(outcome.heldForRelease).toBe(1);
    expect(outcome.proposals.length).toBe(0);
  });

  it("counts nothing when the release shipped and the row is shown", () => {
    const outcome = held({ releases: new Map([[REPO, ["2026-08-31T00:00:00.000Z"]]]) });
    expect(outcome.heldForRelease).toBe(0);
    expect(outcome.proposals.length).toBe(1);
  });
});
