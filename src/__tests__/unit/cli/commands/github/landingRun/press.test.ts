/**
 * The press act of `runGithubLanding --press`: what it presses and refuses by row (caps, bots, opt-out label,
 * code owners, the organisation read), then the press-time re-reads of head and conversation that stop a press
 * over a moved head, a turned conversation or a truncated page, and `performPresses` when the ledger will not read.
 */

import { describe, expect, it } from "vitest";
import { performPresses } from "../../../../../../cli/commands/github/landingPress.js";
import { runGithubLanding } from "../../../../../../cli/commands/github/landingRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { err } from "../../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { dependencyBotActors } from "../../../../../../organisation/dependencyBots.js";
import { OrganisationErrors } from "../../../../../../organisation/errors.js";
import { githubMergeStatus } from "../../../../../../review/githubMergeStatus.js";
import type { LandingBoardRow } from "../../../../../../review/landingBoard.js";
import { landingRowFake } from "../../../../../landingRowFake.js";
import { HEAD, onePage, ownThread, pr } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubLanding --press", () => {
  it("presses nothing and writes nothing under --dry-run", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--dry-run"] });
    expect(h.pressed).toEqual([]);
    expect(h.recorded).toEqual([]);
    expect(h.out.some((line) => line.startsWith("would-press: acme/widgets#16378"))).toBe(true);
  });

  it("presses through `github enqueue`, naming the pull request and repository it owns", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.recorded).toEqual([`acme/widgets#16378@${HEAD}`]);
  });

  // Measured on acme-admin: the queue refuses the ENTRY over an open conversation, so the
  // child `github enqueue` resolves them before its mutation and the press only presses.
  it("leaves our own walkthrough threads to the child enqueue, and its witness names the press alone", async () => {
    const h = harness({
      judgmentNow: pr({ threadCount: 2, threads: [ownThread({}), ownThread({ id: "PRRT_own2" })] }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.autonomyRows[0]!.witness).toBe(
      `slopweaver github landing --press -> enqueued acme/widgets#16378 at head ${HEAD}`,
    );
  });

  it("warns under --author @me about the owner's pull requests with no walkthrough, and not for anybody else's", async () => {
    const mine = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: mine.deps, rest: ["--repo", "acme/widgets", "--author", "@me"] });
    const everyone = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: everyone.deps, rest: ["--repo", "acme/widgets"] });
    expect(mine.out.filter((line) => line.startsWith("⚠ no self-review walkthrough"))).toEqual([
      "⚠ no self-review walkthrough on 1: acme/widgets#16378. Every pull request of the owner's carries inline notes " +
        "guiding the reviewer — post a round with `slopweaver github pr update --self-review -`",
    ]);
    expect(everyone.out.filter((line) => line.startsWith("⚠ no self-review walkthrough"))).toEqual([]);
  });

  it("says under --dry-run that its enqueue would resolve our own threads first", async () => {
    const h = harness({
      judgmentNow: pr({ threadCount: 1, threads: [ownThread({})] }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--dry-run"] });
    expect(h.pressed).toEqual([]);
    expect(
      h.out.some(
        (line) =>
          line.startsWith("would-press: acme/widgets#16378") &&
          line.includes("its enqueue would first resolve 1 of our own open walkthrough thread(s)"),
      ),
    ).toBe(true);
  });

  it("records nothing when `github enqueue` refuses, and says the press failed", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }), pressExit: 1 });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.recorded).toEqual([]);
    expect(h.out.some((line) => line.startsWith("failed: acme/widgets#16378"))).toBe(true);
  });

  it("caps anybody else's rows at three per repository and says which it did not make", async () => {
    const h = harness({
      pages: onePage({ prs: [16378, 16379, 16380, 16381].map((number) => pr({ number })) }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([16378, 16379, 16380].map((n) => `--pr ${String(n)} --repo acme/widgets`));
    expect(
      h.out.some(
        (line) =>
          line.startsWith("failed: acme/widgets#16381") &&
          line.includes("neither the owner's nor a dependency bump, and acme/widgets's cap of 3"),
      ),
    ).toBe(true);
  });

  it("presses EVERY row of an --author @me read in one invocation — the owner's call", async () => {
    const numbers = [16378, 16379, 16380, 16381, 16382, 16383, 16384];
    const h = harness({ pages: onePage({ prs: numbers.map((number) => pr({ number })) }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--author", "@me", "--press"] });
    expect(h.pressed).toEqual(numbers.map((n) => `--pr ${String(n)} --repo acme/widgets`));
    expect(h.recorded).toEqual(numbers.map((n) => `acme/widgets#${String(n)}@${HEAD}`));
    expect(h.autonomyRows.map((row) => row.actionId)).toEqual(
      numbers.map((n) => `enqueue-acme.widgets-${String(n)}-${HEAD}`),
    );
  });

  it("presses a bump beside three colleagues' rows without it spending their allowance", async () => {
    const bump = pr({ headRefName: "chore/deps", number: 16390, title: "chore(deps): bump left-pad to v2" });
    const h = harness({
      pages: onePage({ prs: [...[16378, 16379, 16380].map((number) => pr({ number })), bump] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([16378, 16379, 16380, 16390].map((n) => `--pr ${String(n)} --repo acme/widgets`));
  });

  it("carries GitHub's Bot type from the read to the press", async () => {
    const app = pr({
      authorIsBot: true,
      authorLogin: "renovate",
      headRefName: "deps/lodash",
      number: 16390,
      title: "deps: lodash 4.17.22",
    });
    const h = harness({
      pages: onePage({ prs: [...[16378, 16379, 16380].map((number) => pr({ number })), app] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([16378, 16379, 16380, 16390].map((n) => `--pr ${String(n)} --repo acme/widgets`));
  });

  it("presses on the generic Renovate and Dependabot alone where no organisation is configured, and says so", async () => {
    const h = harness({
      organisation: err(OrganisationErrors.notConfigured({ missing: "organisation" })),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
    expect(h.diagnostics).toContain(
      "github landing --press: only the generic Renovate (renovate[bot]) and Dependabot (dependabot[bot]) are " +
        "recognised as dependency bots — no organisation is configured in the store — write it once with `slopweaver org set`",
    );
  });

  it("presses NOTHING when the organisation will not read, and names why on every row", async () => {
    const h = harness({
      organisation: err(OrganisationErrors.invalid({ issues: ["dependencyBots: has a duplicate entry"] })),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--json"] });
    expect(h.pressed).toEqual([]);
    expect(JSON.parse(h.out[0]!).presses).toEqual([
      {
        detail:
          "not pressed: which authors are dependency bots could not be read — " +
          "the organisation does not read: dependencyBots: has a duplicate entry",
        number: 16378,
        outcome: "failed",
        repoSlug: "acme/widgets",
        url: "https://github.com/acme/widgets/pull/16378",
      },
    ]);
  });

  it("re-reads each row's head and conversation immediately before ITS press, never once for the set", async () => {
    const numbers = [16378, 16379, 16380, 16381];
    const h = harness({ pages: onePage({ prs: numbers.map((number) => pr({ number })) }) });
    const events: string[] = [];
    const deps = {
      ...h.deps,
      headsNow: (args: { home: string | undefined }) => {
        const inner = h.deps.headsNow(args);
        return (read: Parameters<typeof inner>[0]) => {
          events.push(`head ${read.subjects.map((subject) => String(subject.number)).join(",")}`);
          return inner(read);
        };
      },
      judgmentNow: (args: { home: string | undefined }) => {
        const inner = h.deps.judgmentNow(args);
        return (read: { repoSlug: string; number: number }) => {
          events.push(`conversation ${String(read.number)}`);
          return inner(read);
        };
      },
      press: (args: { rest: readonly string[]; quiet: boolean }) => {
        events.push(`press ${args.rest[1]!}`);
        return h.deps.press(args);
      },
    };
    await runGithubLanding({ deps, rest: ["--repo", "acme/widgets", "--author", "@me", "--press"] });
    expect(events).toEqual(
      numbers.flatMap((n) => [`head ${String(n)}`, `conversation ${String(n)}`, `press ${String(n)}`]),
    );
  });

  it("never presses a pull request GitHub has no entry for at this same head", async () => {
    const h = harness({
      pages: onePage({ prs: [pr()] }),
      presses: new Map([["acme/widgets#16378", { atIso: "2026-09-09T12:10:00.000Z", headOid: HEAD }]]),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out[2]).toContain("pressed-not-queued");
  });

  it("never presses a pull request GitHub holds a code-owner request on AND reports BLOCKED", async () => {
    const h = harness({
      pages: onePage({
        prs: [
          pr({
            codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
            githubMergeStatus: githubMergeStatus({ value: "BLOCKED" }),
          }),
        ],
      }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--full"] });
    expect(h.pressed).toEqual([]);
    expect(h.out[2]).toContain("blocked-on");
    expect(h.out[2]).toContain("@acme/eng");
  });

  it("DOES press one whose pending request GitHub itself offers the merge over — owner ruling 291-9x", async () => {
    const h = harness({
      pages: onePage({
        prs: [
          pr({
            codeownerRequests: [{ asCodeOwner: true, kind: "user", name: "quinn" }],
            githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
          }),
        ],
      }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("never presses a pull request carrying the opt-out label", async () => {
    const h = harness({ pages: onePage({ prs: [pr({ labels: ["no-auto-merge"] })] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out[2]).toContain("opted-out");
  });
});

describe("performPresses", () => {
  it("presses nothing, and names the ledger, when the ledger cannot take the row", async () => {
    const h = harness({ ledger: [err("the store could not be opened")], pages: [] });
    const outcomes = await performPresses({
      args: { authoredByOwner: true, dryRun: false, json: false },
      bots: dependencyBotActors({ dependencyBots: [] }),
      deps: h.deps,
      home: undefined,
      rows: [landingRowFake()],
    });
    expect(outcomes).toEqual([
      {
        detail:
          "not pressed: the autonomy ledger could not be read (the store could not be opened), and a " +
          "press the owner's briefing could not show is not made",
        number: 16378,
        outcome: "failed",
        repoSlug: "acme/widgets",
        url: "https://github.com/acme/widgets/pull/16378",
      },
    ]);
    expect(h.pressed).toEqual([]);
  });
});

describe("runGithubLanding", () => {
  it("refuses to press a pull request whose head MOVED since this read judged it", async () => {
    const h = harness({ headsNow: "9999999999999999999999999999999999999999", pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("its head moved from"))).toBe(true);
  });

  it("presses when the re-read spells the SAME head in another case", async () => {
    const head = "abcdef0123456789abcdef0123456789abcdef01";
    const h = harness({
      headsNow: head,
      pages: onePage({
        prs: [pr({ checks: { ...pr().checks, headSha: head.toUpperCase() }, headOid: head.toUpperCase() })],
      }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed.length).toBe(1);
  });

  it("refuses to press when a reviewer took the last word on an open thread while the head stood still", async () => {
    const h = harness({
      // The head is UNCHANGED — that is the whole point. A review built this sequence: the fleet read
      // judges the row `merge-now`, the reviewer replies without pushing a commit, and the head check sees
      // nothing to object to.
      judgmentNow: pr({
        threadCount: 1,
        threads: [
          {
            id: "PRRT_kwDOfake1",
            commentCount: 2,
            isOutdated: false,
            isResolved: false,
            lastCommentAtIso: "2026-09-09T12:29:00Z",
            lastCommentBody: "",
            lastCommentLogin: "a-reviewer",
            line: 12,
            openedAtIso: "2026-09-09T11:00:00Z",
            openedByLogin: "a-reviewer",
            openerBody: "",
            path: "src/app.ts",
          },
        ],
      }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("a reviewer spoke LAST on 1 open thread(s)"))).toBe(true);
    expect(h.out.some((line) => line.includes("that arrived after this read judged it"))).toBe(true);
  });

  it("refuses to press when a standing changes-requested review arrived while the head stood still", async () => {
    const h = harness({
      judgmentNow: pr({
        reviews: [
          {
            commitOid: HEAD,
            login: "a-reviewer",
            onBehalfOf: [],
            state: "CHANGES_REQUESTED",
            submittedAtIso: "2026-09-09T12:29:00Z",
          },
        ],
      }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("has a standing CHANGES_REQUESTED review"))).toBe(true);
  });

  it("refuses to press when a colleague took the last word on a CODERABBIT thread while the head stood still", async () => {
    const h = harness({
      judgmentNow: pr({
        threadCount: 1,
        threads: [
          {
            commentCount: 2,
            id: "PRRT_kwDOfake2",
            isOutdated: false,
            isResolved: false,
            lastCommentAtIso: "2026-09-09T12:29:00Z",
            lastCommentBody: "",
            lastCommentLogin: "a-colleague",
            line: 12,
            openedAtIso: "2026-09-09T11:00:00Z",
            openedByLogin: "coderabbitai",
            openerBody: "",
            path: "src/app.ts",
          },
        ],
      }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("a colleague spoke LAST on 1 open CodeRabbit thread(s)"))).toBe(true);
  });

  it("refuses to press when the press-time conversation read came back TRUNCATED rather than empty", async () => {
    const h = harness({
      // The read succeeds and carries no signal — because the page STOPPED before the thread that has one.
      judgmentNow: pr({ threadCount: 101, threads: [], threadsTruncated: true }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("its review threads did not fit one page"))).toBe(true);
  });

  it("refuses to press when the press-time REVIEW page came back truncated", async () => {
    const h = harness({
      judgmentNow: pr({ reviews: [], reviewsTruncated: true }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("its reviews did not fit one page"))).toBe(true);
  });

  it("refuses to press when the conversation could not be re-read, rather than pressing over an unconfirmed one", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const deps = {
      ...h.deps,
      judgmentNow: () => () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" }))),
    };
    await runGithubLanding({ deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("a conversation this run could not confirm is not made"))).toBe(true);
  });

  it("fails the run, printing no rows, when the base-distance comparison answers one pull request short", async () => {
    const h = harness({ pages: onePage({ prs: [pr({ number: 1 }), pr({ number: 2 })] }) });
    const deps = {
      ...h.deps,
      reviewState: {
        ...h.deps.reviewState,
        baseDistances: () => () =>
          Promise.resolve([{ kind: "read", value: { aheadBy: 1, behindBy: 3, status: "DIVERGED" } }] as const),
      },
    };
    const code = await runGithubLanding({ deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(code).toBe(EXIT_ERROR);
    expect(h.diagnostics).toEqual([
      "the base-distance read answered 1 of 2 pull requests, so no row can be matched to its distance",
    ]);
    expect(h.out).toEqual([]);
    expect(h.pressed).toEqual([]);
  });

  it("reports a dry run HONESTLY when the conversation turned, rather than answering would-press", async () => {
    const h = harness({
      judgmentNow: pr({
        reviews: [
          {
            commitOid: HEAD,
            login: "a-reviewer",
            onBehalfOf: [],
            state: "CHANGES_REQUESTED",
            submittedAtIso: "2026-09-09T12:29:00Z",
          },
        ],
      }),
      pages: onePage({ prs: [pr()] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press", "--dry-run"] });
    expect(h.out.some((line) => line.includes("would-press"))).toBe(false);
    expect(h.out.some((line) => line.includes("has a standing CHANGES_REQUESTED review"))).toBe(true);
  });

  it("refuses to press when the head could not be re-read at all, rather than pressing over an unconfirmed one", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    const deps = {
      ...h.deps,
      headsNow: () => () => Promise.resolve([{ kind: "unread", why: "GitHub answered 502" }] as const),
    };
    await runGithubLanding({ deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual([]);
    expect(h.out.some((line) => line.includes("a press over an unconfirmed head is not made"))).toBe(true);
  });

  it("presses when the head is the one this read judged", async () => {
    const h = harness({ pages: onePage({ prs: [pr()] }) });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--press"] });
    expect(h.pressed).toEqual(["--pr 16378 --repo acme/widgets"]);
  });

  it("names a handover row that DECLARES the branch, and marks an undeclared one `none?`", async () => {
    const h = harness({
      board: new Map([["feature/one", [{ kind: "row", slug: "a-run", status: "ready" } as LandingBoardRow]]]),
      pages: onePage({ prs: [pr(), pr({ headRefName: "feature/two", number: 16379 })] }),
    });
    await runGithubLanding({ deps: h.deps, rest: ["--repo", "acme/widgets", "--full"] });
    expect(h.out[2]).toContain("ready");
    expect(h.out[4]).toContain("none?");
  });
});
