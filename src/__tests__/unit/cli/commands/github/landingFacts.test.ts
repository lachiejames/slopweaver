import { describe, expect, it } from "vitest";

import { compactTitle, landingFacts } from "../../../../../cli/commands/github/landingFacts.js";
import { landingRowFake } from "../../../../landingRowFake.js";

/** One failing check, named and classified. */
const failing = ({ name, required }: { name: string; required: boolean | undefined }) => ({
  kind: "check-run" as const,
  name,
  required,
  state: "failed",
  url: undefined,
});

describe("landingFacts", () => {
  it("prints a green row as its verdict, every clause named, and the title", () => {
    expect(landingFacts({ row: landingRowFake() })).toBe(
      'acme/widgets#16378 merge-now/press · CI green · rabbit green · approved: none · owners: none named · asked: no · "a change"',
    );
  });

  it("names the REQUIRED failing check and the advisory one beside it", () => {
    const row = landingRowFake({
      action: "spawn-ci",
      ci: "red",
      ciFailure: { kind: "red", required: true },
      dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required CI is red" },
      failingChecks: [failing({ name: "unit", required: true }), failing({ name: "lint", required: false })],
    });
    expect(landingFacts({ row })).toBe(
      "acme/widgets#16378 rebase-and-fix/spawn-ci · CI red, REQUIRED: unit; advisory red: lint · rabbit green · " +
        'approved: none · owners: none named · asked: no · "a change"',
    );
  });

  it("never calls an advisory-only red green, and caps that non-blocker list visibly at three", () => {
    const row = landingRowFake({
      ci: "red",
      ciFailure: { kind: "red", required: false },
      failingChecks: ["a", "b", "c", "d", "e"].map((name) => failing({ name, required: false })),
    });
    expect(landingFacts({ row })).toContain(" · required CI clear; advisory red: a, b, c +2 more · ");
  });

  it("calls only a FAILED check red, naming a required one still running apart as pending", () => {
    const row = landingRowFake({
      ci: "red",
      ciFailure: { kind: "red", required: true },
      failingChecks: [
        { ...failing({ name: "build", required: true }), state: "running" },
        failing({ name: "lint", required: false }),
      ],
    });
    expect(landingFacts({ row })).toContain(" · CI red, REQUIRED check pending; advisory red: lint; pending: build · ");
  });

  it("names every REQUIRED failing check, since each blocks, while the advisory list beside them is capped", () => {
    const row = landingRowFake({
      ci: "red",
      ciFailure: { kind: "red", required: true },
      failingChecks: [
        ...["r1", "r2", "r3", "r4"].map((name) => failing({ name, required: true })),
        ...["a", "b", "c", "d"].map((name) => failing({ name, required: false })),
      ],
    });
    expect(landingFacts({ row })).toContain(" · CI red, REQUIRED: r1, r2, r3, r4; advisory red: a, b, c +1 more · ");
  });

  it("says a red's requirement is unknown rather than guessing, and that the list was truncated", () => {
    const row = landingRowFake({
      checksTruncated: true,
      ci: "red",
      ciFailure: { kind: "red", required: undefined },
      failingChecks: [failing({ name: "e2e", required: undefined })],
    });
    expect(landingFacts({ row })).toContain(" · CI red, requirement unknown: e2e (check list truncated) · ");
  });

  it("names the approvers, the code owners split by state, waiting threads and a due chase", () => {
    const row = landingRowFake({
      approvedBy: ["alice", "bob"],
      bump: { eligibleSinceIso: "2026-09-08T00:00:00Z", kind: "due", silentSinceIso: "2026-09-07T00:00:00Z" },
      codeRabbit: "changes-requested",
      conversations: {
        codeRabbit: { answeredOpen: 0, awaitingUs: 1, open: 1, resolved: 0, reviewerLastWord: 1 },
        humans: { answeredOpen: 0, awaitingUs: 2, open: 2, resolved: 0, reviewerLastWord: 2 },
      },
      githubCodeowners: {
        ...landingRowFake().githubCodeowners,
        owners: [
          { kind: "team", state: "approved", token: "@acme/eng" },
          { kind: "user", state: "pending", token: "@carol" },
        ],
      },
      slack: { ...landingRowFake().slack, asked: "yes" },
    });
    expect(landingFacts({ row })).toBe(
      "acme/widgets#16378 merge-now/press · CI green · rabbit CHANGES · approved: alice, bob · " +
        'owners approved @acme/eng; pending @carol · 3 thread(s) awaiting us · asked: yes, chase DUE · "a change"',
    );
  });

  it("names who holds the row and whose threads are waiting, never only a count", () => {
    const row = landingRowFake({
      action: "answer-threads",
      blockedOn: ["@bob"],
      conversations: {
        codeRabbit: { answeredOpen: 0, awaitingUs: 0, open: 0, resolved: 0, reviewerLastWord: 0 },
        humans: { answeredOpen: 0, awaitingUs: 1, open: 1, resolved: 0, reviewerLastWord: 1 },
      },
      dispatch: { kind: "act", verdict: "resolve-then-merge", why: "answer @bob's open thread, then merge" },
      openThreads: [{ login: "bob", open: 1 }],
    });
    expect(landingFacts({ row })).toBe(
      "acme/widgets#16378 resolve-then-merge/answer-threads · held by @bob · CI green · rabbit green · " +
        'approved: none · owners: none named · 1 thread(s) awaiting us: bob (1) · asked: no · "a change"',
    );
  });

  it("names every reviewer waiting on a thread, past three, since each one blocks", () => {
    const row = landingRowFake({
      action: "answer-threads",
      blockedOn: ["@acme/owners"],
      conversations: {
        codeRabbit: { answeredOpen: 0, awaitingUs: 0, open: 0, resolved: 0, reviewerLastWord: 0 },
        humans: { answeredOpen: 0, awaitingUs: 4, open: 4, resolved: 0, reviewerLastWord: 4 },
      },
      openThreads: ["alice", "bob", "carol", "dave"].map((login) => ({ login, open: 1 })),
    });
    expect(landingFacts({ row })).toContain(" · 4 thread(s) awaiting us: alice (1), bob (1), carol (1), dave (1) · ");
  });

  it("names where the pull request stands in the merge queue, and says nothing when it is simply not queued", () => {
    const queued = landingRowFake({
      queue: { kind: "pressed-not-queued", headOid: "abc", pressedAtIso: "2026-10-04T00:00:00Z" },
    });
    expect(landingFacts({ row: queued })).toContain("#16378 merge-now/press · queue: DROPPED · CI green · ");
    expect(landingFacts({ row: landingRowFake() })).not.toContain("queue:");
  });

  it("names the board row already on the pull request, so a live one is never spawned over", () => {
    const row = landingRowFake({ boardRow: { kind: "row", slug: "fix-the-build", status: "in-progress" } });
    expect(landingFacts({ row })).toContain("#16378 merge-now/press · board: fix-the-build in-progress · CI green · ");
  });

  it("never calls the owners none when only the review list was cut, since an approved team owner may be past it", () => {
    expect(landingFacts({ row: landingRowFake({ reviewsTruncated: true }) })).toContain(
      " · owners: unknown (review list truncated) · ",
    );
  });

  it("never reads a cut owner, review or thread list as a complete one", () => {
    const row = landingRowFake({
      githubCodeowners: { ...landingRowFake().githubCodeowners, requestsTruncated: true },
      reviewsTruncated: true,
      threadsTruncated: true,
    });
    expect(landingFacts({ row })).toContain(
      " · approved: none (review list truncated) · owners: unknown (request list and review list truncated) · " +
        "0+ thread(s) awaiting us (thread list truncated) · ",
    );
  });

  it("names every failing check of an unknown requirement, and an unclassified one beside a REQUIRED red", () => {
    const unknown = landingRowFake({
      ci: "red",
      ciFailure: { kind: "red", required: undefined },
      failingChecks: ["a", "b", "c", "d"].map((name) => failing({ name, required: undefined })),
    });
    const mixed = landingRowFake({
      ci: "red",
      ciFailure: { kind: "red", required: true },
      failingChecks: [failing({ name: "unit", required: true }), failing({ name: "e2e", required: undefined })],
    });
    expect(landingFacts({ row: unknown })).toContain(" · CI red, requirement unknown: a, b, c, d · ");
    expect(landingFacts({ row: mixed })).toContain(" · CI red, REQUIRED: unit; requirement unknown: e2e · ");
  });

  it("names every holder and every REQUIRED failing check, never counting a blocker", () => {
    const row = landingRowFake({
      action: "spawn-ci",
      blockedOn: ["@a", "@b", "@c", "@d"],
      ci: "red",
      ciFailure: { kind: "red", required: true },
      failingChecks: ["u1", "u2", "u3", "u4"].map((name) => failing({ name, required: true })),
    });
    expect(landingFacts({ row })).toContain(" · held by @a, @b, @c, @d · CI red, REQUIRED: u1, u2, u3, u4 · ");
  });

  it("names three pending code owners and counts the rest, so a wide diff stays one readable line", () => {
    const row = landingRowFake({
      githubCodeowners: {
        ...landingRowFake().githubCodeowners,
        owners: ["@a", "@b", "@c", "@d", "@e"].map((token) => ({ kind: "user", state: "pending", token }) as const),
      },
    });
    expect(landingFacts({ row })).toContain(" · owners pending @a, @b, @c +2 more · ");
  });

  it("names three approvers and counts the rest visibly, since an approver is never a blocker", () => {
    const row = landingRowFake({ approvedBy: ["alice", "bob", "carol", "dave"] });
    expect(landingFacts({ row })).toContain(" · approved: alice, bob, carol +1 more · ");
  });

  it("names which landing test an unread row could not answer, not the generic unread reason", () => {
    const row = landingRowFake({
      action: "unknown",
      actionDetail: "mergeable could not be answered: GitHub has not computed it",
      dispatch: { kind: "unread", why: "a landing test could not be answered, so there is no honest act to send" },
    });
    expect(landingFacts({ row })).toContain(
      "#16378 unread/unknown (mergeable could not be answered: GitHub has not computed it) · ",
    );
  });

  it("names a required context that never ran when the rollup itself is green", () => {
    const row = landingRowFake({
      action: "spawn-ci",
      actionDetail: "required context integration never ran on this head",
      dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required CI is not green" },
    });
    expect(landingFacts({ row })).toContain(
      "#16378 rebase-and-fix/spawn-ci (required context integration never ran on this head) · CI green · ",
    );
  });

  it("names a required context that never ran beside an advisory red, never pinning REQUIRED on the advisory", () => {
    const row = landingRowFake({
      action: "spawn-ci",
      actionDetail: "required context integration never ran on this head",
      ci: "red",
      ciFailure: { kind: "red", required: true },
      dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required CI is red" },
      failingChecks: [failing({ name: "lint", required: false })],
    });
    expect(landingFacts({ row })).toContain(
      "#16378 rebase-and-fix/spawn-ci (required context integration never ran on this head) · " +
        "CI red, REQUIRED context never ran; advisory red: lint · ",
    );
  });

  it("carries what CodeRabbit objected to, not only its one-word verdict", () => {
    const row = landingRowFake({
      action: "spawn-coderabbit",
      actionDetail: "unsafe SQL interpolation in src/db.ts",
      codeRabbit: "changes-requested",
      dispatch: { kind: "act", verdict: "coderabbit-loop", why: "answer every CodeRabbit thread on this head" },
    });
    expect(landingFacts({ row })).toContain(
      "#16378 coderabbit-loop/spawn-coderabbit (unsafe SQL interpolation in src/db.ts) · CI green · rabbit CHANGES · ",
    );
  });

  it("carries the reason of an act no other clause explains, such as a conflict's paths", () => {
    const row = landingRowFake({
      action: "conflicting",
      actionDetail: "conflicts in src/config.ts",
      dispatch: { kind: "act", verdict: "rebase-and-fix", why: "rebase onto main and resolve the conflict" },
    });
    expect(landingFacts({ row })).toContain("#16378 rebase-and-fix/conflicting (conflicts in src/config.ts) · ");
  });

  it("keeps an unread row's own reason when the act is known, and says a chase is unknown", () => {
    const row = landingRowFake({
      action: "answer-threads",
      actionDetail: "bob is waiting on us",
      bump: { kind: "unknown", why: "could not tell whether they replied" },
      dispatch: { kind: "unread", why: "whether anybody is also owed a chase could not be established" },
      slack: { ...landingRowFake().slack, asked: "yes" },
    });
    const facts = landingFacts({ row });
    expect(facts).toContain(
      "#16378 unread/answer-threads (whether anybody is also owed a chase could not be established; bob is waiting on us) · ",
    );
    expect(facts).toContain(" · asked: yes, chase unknown · ");
  });

  it("carries a non-act's and the owner's verdict's own reason, and never lets either hide the act's own blocker", () => {
    const waiting = landingRowFake({
      action: "queued",
      actionDetail: "it is in the merge queue",
      dispatch: { kind: "waiting", why: "CI is still running" },
    });
    const theirs = landingRowFake({
      action: "conflicting",
      actionDetail: "GitHub reports it CONFLICTING against main in src/config.ts",
      dispatch: { kind: "act", verdict: "needs-owner-judgment", why: "a reviewer asked for a design change" },
    });
    expect(landingFacts({ row: waiting })).toContain(
      "#16378 waiting/queued (CI is still running; it is in the merge queue) · ",
    );
    expect(landingFacts({ row: theirs })).toContain(
      "#16378 NEEDS-OWNER-JUDGMENT/conflicting (a reviewer asked for a design change; GitHub reports it CONFLICTING " +
        "against main in src/config.ts) · ",
    );
  });
});

describe("compactTitle", () => {
  it("keeps a title that fits", () => {
    expect(compactTitle({ maxChars: 10, title: "  short  " })).toBe("short");
  });

  it("marks a cut with an ellipsis inside the bound", () => {
    expect(compactTitle({ maxChars: 10, title: "a much longer title" })).toBe("a much lo…");
  });
});
