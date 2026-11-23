import { describe, expect, it } from "vitest";

import {
  boardRowForHead,
  type LandingRegisterDeps,
  performRegistrations,
  plannedRegistrations,
  registrationArgv,
  registrationAsk,
  settledAtThisHead,
} from "../../../../../cli/commands/github/landingRegister.js";
import { REGISTER_CAP } from "../../../../../cli/commands/github/landingUsage.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { Organisation } from "../../../../../organisation/core.js";
import { type OrganisationError, OrganisationErrors } from "../../../../../organisation/errors.js";
import { isLandingRegistrationSlug, registrationSlug } from "../../../../../review/boardAtHead.js";
import type { LandingRow } from "../../../../../review/landing.js";
import type { LandingBoardRow } from "../../../../../review/landingBoard.js";
import { FIRST_ASK_BRIEF } from "../../../../../review/landingDispatchAsk.js";
import { landingRowFake } from "../../../../landingRowFake.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY } from "../../../../organisationFixture.js";

const rebase = (over: Partial<LandingRow> = {}): LandingRow =>
  landingRowFake({
    action: "spawn-ci",
    dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required check(s) failing: build" },
    ...over,
  });

const deps = ({
  exit = 0,
  checkout = "/checkouts/widgets",
  organisation = ok(ACME_ORGANISATION),
}: {
  exit?: number;
  checkout?: string | null;
  /** What the organisation read answers; Acme unless a case drives an install with none written. */
  organisation?: Result<Organisation, OrganisationError>;
} = {}): {
  readonly deps: LandingRegisterDeps;
  readonly argvs: string[][];
  readonly quiets: boolean[];
} => {
  const argvs: string[][] = [];
  const quiets: boolean[] = [];
  // `null` is how a test says NO checkout is declared. Spelled as a branch rather than an operator, because a
  // `?? undefined` here would read as a default for a value the test deliberately withheld.
  const declaredCheckout = (): string | undefined => {
    if (checkout === null) {
      return undefined;
    }
    return checkout;
  };
  return {
    argvs,
    quiets,
    deps: {
      checkoutFor: declaredCheckout,
      now: () => new Date("2026-09-19T12:00:00.000Z"),
      readOrganisation: () => Promise.resolve(organisation),
      registerRow: ({ argv, quiet }) => {
        argvs.push([...argv]);
        quiets.push(quiet);
        return Promise.resolve(exit);
      },
    },
  };
};

describe("registrationSlug", () => {
  it("names the repository, the number and the head this read judged", () => {
    expect(registrationSlug({ row: rebase() })).toBe("land-acme-widgets-16378-1111111");
  });

  it("changes when the head moves, so a settled row cannot hold a moved pull request back", () => {
    expect(registrationSlug({ row: rebase({ headOid: "2222222222222222222222222222222222222222" }) })).toBe(
      "land-acme-widgets-16378-2222222",
    );
  });
});

describe("isLandingRegistrationSlug", () => {
  it("recognises every slug registrationSlug writes, whatever the repository's case or punctuation", () => {
    const slugs = [
      registrationSlug({ row: rebase() }),
      registrationSlug({ row: rebase({ repoSlug: "Acme/acme_admin.v2" }) }),
    ];

    expect(slugs).toEqual(["land-acme-widgets-16378-1111111", "land-acme-acme-admin-v2-16378-1111111"]);
    expect(slugs.map((slug) => isLandingRegistrationSlug({ slug }))).toEqual([true, true]);
  });

  it("refuses a hand-filed narrower row, a longer head, a missing number and an unrelated slug", () => {
    const slugs = [
      "land-acme-widgets-16378-1111111-cr",
      "land-acme-widgets-16378-11111112",
      "land-acme-widgets-1111111",
      "landing-queue-fix",
    ];

    expect(slugs.map((slug) => isLandingRegistrationSlug({ slug }))).toEqual([false, false, false, false]);
  });
});

describe("registrationAsk", () => {
  // The ask is the WHOLE brief: `handover register` takes no body, so a seat reading only the verdict word
  // re-derives the rest — which is how a seat spent four hours reporting "waiting on Quinn re-approval" on
  // a pull request whose merge was held on unresolved self-review threads (`landingRegister.ts`).
  it("leads with the pull request and the act, then its title, then the dispatch's own why", () => {
    expect(registrationAsk({ row: rebase({ title: "add the widget" }) })).toBe(
      "acme/widgets#16378 needs rebase-and-fix: add the widget — required check(s) failing: build",
    );
  });

  it("says the verdict is unknown when the row carries no act, rather than dropping the line", () => {
    const unread = rebase({ dispatch: { kind: "unread", why: "GitHub would not answer" }, title: "add the widget" });
    expect(registrationAsk({ row: unread })).toBe("acme/widgets#16378 needs unknown: add the widget");
  });

  // `landingDispatch.ts`'s `rebase-and-fix` arm joins its clauses and can author nothing at all, and the
  // same em dash printed blind is the defect it records against itself — `rebase-and-fix:  — it is 51
  // commit(s) behind` on a measured acme-admin pull request. The ask must not reproduce it one surface later.
  it("drops the dash with the clause when an act authored no why", () => {
    const bare = rebase({ dispatch: { kind: "act", verdict: "rebase-and-fix", why: "" }, title: "add the widget" });
    expect(registrationAsk({ row: bare })).toBe("acme/widgets#16378 needs rebase-and-fix: add the widget");
  });
});

describe("registrationArgv", () => {
  // Exact arrays rather than `toContain`, because the failure being held down is a producer and a consumer
  // disagreeing: the previous argv was asserted exactly too, and it was exactly wrong. What makes these
  // falsifiable is `subprocess/cli/commands/handover/landingDispatchRegister.test.ts`, which runs this same
  // builder's output through the shipped binary.
  it("declares --dispatch, so the row it writes is work for a seat rather than a question the owner must answer", () => {
    expect(
      registrationArgv({
        organisation: ACME_ORGANISATION,
        askedIso: "2026-09-19T12:00:00.000Z",
        checkout: "/checkouts/widgets",
        home: "/state",
        row: rebase({ title: "add the widget" }),
      }),
    ).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      "acme/widgets#16378 needs rebase-and-fix: add the widget — required check(s) failing: build",
      "--dispatch",
      "--slug",
      "land-acme-widgets-16378-1111111",
      "--branch",
      "feature/one",
      "--workspace",
      "team",
      "--workspace-because",
      "the landing dispatch's pull request is in acme/widgets",
      "--asked-iso",
      "2026-09-19T12:00:00.000Z",
      "--repo",
      "/checkouts/widgets",
      "--home",
      "/state",
    ]);
  });

  it("states the workspace an organisation pull request's repository names, and none for a repository outside it", () => {
    const stated = ({ repoSlug }: { repoSlug: string }): readonly string[] => {
      const argv = registrationArgv({
        organisation: ACME_ORGANISATION,
        askedIso: "2026-09-19T12:00:00.000Z",
        checkout: undefined,
        home: undefined,
        row: rebase({ repoSlug }),
      });
      return argv.slice(argv.indexOf("--branch") + 2, argv.indexOf("--asked-iso"));
    };
    expect([
      stated({ repoSlug: "acme/acme-admin" }),
      stated({ repoSlug: FIXTURE_SELF_REPOSITORY }),
      stated({ repoSlug: "othercompany/widgets" }),
    ]).toEqual([
      ["--workspace", "team", "--workspace-because", "the landing dispatch's pull request is in acme/acme-admin"],
      [
        "--workspace",
        "self",
        "--workspace-because",
        `the landing dispatch's pull request is in ${FIXTURE_SELF_REPOSITORY}`,
      ],
      [],
    ]);
  });

  it("drops --repo alone when no checkout is declared, keeping every other element", () => {
    const argv = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-19T12:00:00.000Z",
      checkout: undefined,
      home: "/state",
      row: rebase({ title: "add the widget" }),
    });
    expect(argv.slice(-4)).toEqual(["--asked-iso", "2026-09-19T12:00:00.000Z", "--home", "/state"]);
    expect(argv).toContain("--dispatch");
  });

  it("drops --home alone when none is passed, so the verb takes the ambient one", () => {
    const argv = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-19T12:00:00.000Z",
      checkout: "/checkouts/widgets",
      home: undefined,
      row: rebase({ title: "add the widget" }),
    });
    expect(argv.slice(-4)).toEqual(["--asked-iso", "2026-09-19T12:00:00.000Z", "--repo", "/checkouts/widgets"]);
  });

  it("carries the ask as ONE element, so a title full of spaces and dashes cannot split into flags", () => {
    const argv = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-19T12:00:00.000Z",
      checkout: undefined,
      home: undefined,
      row: rebase({ title: "add the widget --now, please" }),
    });
    expect(argv[5]).toBe(
      "acme/widgets#16378 needs rebase-and-fix: add the widget --now, please — required check(s) failing: build",
    );
  });

  it("DERIVES the slug from the row, so no caller can register one head's row under another's slug", () => {
    const moved = rebase({ headOid: "2222222222222222222222222222222222222222" });
    const argv = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-19T12:00:00.000Z",
      checkout: undefined,
      home: undefined,
      row: moved,
    });
    expect(argv[argv.indexOf("--slug") + 1]).toBe("land-acme-widgets-16378-2222222");
  });

  it("names NEITHER --finding nor a shape flag, the two things a dispatch row must not become", () => {
    const argv = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-19T12:00:00.000Z",
      checkout: undefined,
      home: undefined,
      row: rebase(),
    });
    expect(
      argv.filter((arg) =>
        [
          "--finding",
          "--evidence",
          "--problem",
          "--options",
          "--lean",
          "--risk",
          "--blast-radius",
          "--still-real",
        ].includes(arg),
      ),
    ).toEqual([]);
  });
});

describe("plannedRegistrations", () => {
  it("plans a row carrying one of the dispatchable verdicts", () => {
    expect(plannedRegistrations({ dispatchable: [rebase()] })[0]!.skip).toBeUndefined();
  });

  it("SKIPS `merge-now`, which is enqueued directly — a seat lane is not a thing this fleet has", () => {
    expect(plannedRegistrations({ dispatchable: [landingRowFake()] })[0]!.skip).toBe(
      "every test passed, so it is ENQUEUED rather than seated — a seat lane is not a thing this fleet has " +
        "(`github landing --press`, or `github enqueue`)",
    );
  });

  it("SKIPS a row a LIVE board row already declares, which is the de-duplication across ticks", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "fix-the-build", status: "in-progress" } });
    expect(plannedRegistrations({ dispatchable: [row] })[0]!.skip).toBe(
      "fix-the-build already holds this branch and is in-progress",
    );
  });

  it("plans a row whose board row is DONE, because a settled row over a still-broken pull request must not hold it", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "fix-the-build", status: "done" } });
    expect(plannedRegistrations({ dispatchable: [row] })[0]!.skip).toBeUndefined();
  });

  it("SKIPS a row whose own registration at THIS head already ended, which `handover register` would refuse", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "done" } });
    expect(plannedRegistrations({ dispatchable: [row] })[0]!.skip).toBe(
      "land-acme-widgets-16378-1111111 already ended at this head and is done",
    );
  });

  it("treats a status this build does not know as LIVE, holding the write back rather than duplicating a row", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "fix-the-build", status: "mid-flight" } });
    expect(plannedRegistrations({ dispatchable: [row] })[0]!.skip).toBe(
      "fix-the-build already holds this branch and is mid-flight",
    );
  });

  // `landingDispatch.ts` already keeps this verdict out of `dispatchable`, so this is a second lock on the
  // same door — and it earns its place because the exported input type is an unrestricted `LandingRow[]`:
  // a caller handing over every row must not be able to turn the one verdict that IS the owner's into a row
  // declaring that nobody waits on them.
  it("SKIPS `needs-owner-judgment`, the one verdict that is a card rather than a dispatch row", () => {
    const theirs = rebase({ dispatch: { kind: "act", verdict: "needs-owner-judgment", why: "the owner chooses" } });
    expect(plannedRegistrations({ dispatchable: [theirs] })[0]!.skip).toBe(
      "it is the one verdict that is the OWNER'S — a card, never a dispatch row declaring nobody waits on them",
    );
  });

  it("SKIPS a row carrying no act verdict at all", () => {
    const row = rebase({ dispatch: { kind: "unread", why: "a landing test could not be answered" } });
    expect(plannedRegistrations({ dispatchable: [row] })[0]!.skip).toBe("it carries no dispatch verdict");
  });

  it("keeps fleet order, so what one tick would add is readable top to bottom", () => {
    const planned = plannedRegistrations({
      dispatchable: [rebase({ number: 1 }), landingRowFake({ number: 2 }), rebase({ number: 3 })],
    });
    expect(planned.map((one) => one.row.number)).toEqual([1, 2, 3]);
  });
});

describe("performRegistrations", () => {
  it("writes one board row, declaring the head BRANCH so the next read joins it", async () => {
    const h = deps();
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase({ title: "add the widget" })],
      dryRun: false,
      home: "/state",
      quiet: false,
    });
    expect(h.argvs).toEqual([
      [
        "node",
        "slopweaver",
        "handover",
        "register",
        "--ask",
        "acme/widgets#16378 needs rebase-and-fix: add the widget — required check(s) failing: build",
        "--dispatch",
        "--slug",
        "land-acme-widgets-16378-1111111",
        "--branch",
        "feature/one",
        "--workspace",
        "team",
        "--workspace-because",
        "the landing dispatch's pull request is in acme/widgets",
        "--asked-iso",
        "2026-09-19T12:00:00.000Z",
        "--repo",
        "/checkouts/widgets",
        "--home",
        "/state",
      ],
    ]);
    expect(outcomes[0]!.outcome).toBe("registered");
  });

  it("fails each write naming the absent organisation, registering nothing, and reads none on a dry run", async () => {
    const notConfigured = OrganisationErrors.notConfigured({ missing: "organisation" });
    const h = deps({ organisation: err(notConfigured) });
    const real = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: false,
      home: undefined,
      quiet: true,
    });
    const dry = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: true,
      home: undefined,
      quiet: true,
    });
    expect([real[0]!.outcome, real[0]!.detail, dry[0]!.outcome, h.argvs]).toEqual([
      "failed",
      notConfigured.message,
      "would-register",
      [],
    ]);
  });

  it("keeps handover register's receipt off stdout when the caller's document owns it", async () => {
    const h = deps();
    await performRegistrations({ deps: h.deps, dispatchable: [rebase()], dryRun: false, home: undefined, quiet: true });
    expect(h.quiets).toEqual([true]);
  });

  it("does NOT pass --finding, because the pull request is already the owner's and already team-facing", async () => {
    const h = deps();
    await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: false,
      home: undefined,
      quiet: false,
    });
    expect(h.argvs[0]!).not.toContain("--finding");
  });

  it("writes NOTHING on a dry run and says what it would have written", async () => {
    const h = deps();
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase({ title: "add the widget" })],
      dryRun: true,
      home: undefined,
      quiet: false,
    });
    expect(h.argvs).toEqual([]);
    expect(outcomes[0]!).toEqual({
      detail: "acme/widgets#16378 needs rebase-and-fix: add the widget — required check(s) failing: build",
      number: 16378,
      outcome: "would-register",
      repoSlug: "acme/widgets",
      slug: "land-acme-widgets-16378-1111111",
      url: "https://github.com/acme/widgets/pull/16378",
    });
  });

  // The detail names the EXIT CODE and nothing about what caused it. The sentence that used to stand here
  // asserted an already-registered head on every failure — so an ask-shape refusal on every row read as
  // benign de-duplication, which is how that refusal stayed invisible. `handover register`
  // also writes the file before `mirrorAfterWrite`, so a nonzero exit does not even establish nothing was
  // written; claiming otherwise is a cause this code never observed.
  it("reports `failed` naming the exit code, never a cause it did not observe", async () => {
    const h = deps({ exit: 1 });
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: false,
      home: undefined,
      quiet: false,
    });
    expect(outcomes[0]!.outcome).toBe("failed");
    expect(outcomes[0]!.detail).toBe(
      "`handover register` exited 1 — its own lines are printed above and name the cause",
    );
  });

  it("names exit 2 as exit 2, which is what the ask-shape refusal returns", async () => {
    const h = deps({ exit: 2 });
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: false,
      home: undefined,
      quiet: false,
    });
    expect(outcomes[0]!.detail).toBe(
      "`handover register` exited 2 — its own lines are printed above and name the cause",
    );
  });

  it("still registers when no checkout is declared, and NAMES the gap rather than dropping the row", async () => {
    const h = deps({ checkout: null });
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: [rebase()],
      dryRun: false,
      home: undefined,
      quiet: false,
    });
    expect(h.argvs[0]!).not.toContain("--repo");
    expect(outcomes[0]!.detail).toBe(
      "registered at head 1111111, with NO checkout declared for acme/widgets — a seated session has no tree to cut from",
    );
  });

  it("stops at the cap and says the next read takes the rest, rather than growing the board without bound", async () => {
    const h = deps();
    const many = Array.from({ length: REGISTER_CAP + 2 }, (_unused, index) =>
      rebase({ headOid: String(index).repeat(40).slice(0, 40), headRefName: String(index), number: 100 + index }),
    );
    const outcomes = await performRegistrations({
      deps: h.deps,
      dispatchable: many,
      dryRun: false,
      home: undefined,
      quiet: false,
    });
    expect(h.argvs).toHaveLength(REGISTER_CAP);
    expect(outcomes.filter((one) => one.outcome === "skipped").map((one) => one.detail)).toEqual([
      `this invocation's cap of ${String(REGISTER_CAP)} board rows was already reached — the next read takes it`,
      `this invocation's cap of ${String(REGISTER_CAP)} board rows was already reached — the next read takes it`,
    ]);
  });

  it("does not spend the cap on a row it skipped, so one merge-now cannot cost a registration", async () => {
    const h = deps();
    const many = [
      landingRowFake({ number: 1 }),
      ...Array.from({ length: REGISTER_CAP }, (_unused, index) =>
        rebase({ headOid: String(index).repeat(40).slice(0, 40), headRefName: String(index), number: 100 + index }),
      ),
    ];
    await performRegistrations({ deps: h.deps, dispatchable: many, dryRun: false, home: undefined, quiet: false });
    expect(h.argvs).toHaveLength(REGISTER_CAP);
  });
});

describe("boardRowForHead", () => {
  const head = { headOid: "1111111111111111111111111111111111111111", number: 16378, repoSlug: "acme/widgets" };
  const thisHead: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "done" };
  const olderHead: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-16378-0000000", status: "done" };
  const live: LandingBoardRow = { kind: "row", slug: "fix-the-build", status: "in-progress" };

  it("reports none-declared when no row declares the branch", () => {
    expect(boardRowForHead({ head, rows: undefined }).kind).toBe("none-declared");
    expect(boardRowForHead({ head, rows: [] }).kind).toBe("none-declared");
  });

  it("picks a LIVE row over any terminal one, because somebody is on the branch", () => {
    expect(boardRowForHead({ head, rows: [thisHead, live] })).toEqual(live);
  });

  // A pull request rebased twice has two landing rows on one branch; which one the join reported used to be
  // whichever the board scan read last.
  it("picks the row registered at THIS head over one at an older head, whatever the scan order", () => {
    expect(boardRowForHead({ head, rows: [olderHead, thisHead] })).toEqual(thisHead);
  });

  it("falls to the first terminal row when none is live and none is this head's", () => {
    expect(boardRowForHead({ head, rows: [olderHead] })).toEqual(olderHead);
  });

  // A branch name is not unique across repositories. A live row another repository filed on the
  // same branch name used to win the join and keep this repository's settled pull request dispatchable.
  it("ignores a live row that resolves to another repository, in either scan order", () => {
    const settled: LandingBoardRow = { ...thisHead, repoSlug: "acme/widgets" };
    const elsewhere: LandingBoardRow = { ...live, repoSlug: "acme/gadgets" };
    expect(boardRowForHead({ head, rows: [elsewhere, settled] })).toEqual(settled);
    expect(boardRowForHead({ head, rows: [settled, elsewhere] })).toEqual(settled);
  });

  it("compares the resolved repository without regard to case", () => {
    const live2: LandingBoardRow = { ...live, repoSlug: "Acme/Widgets" };
    expect(boardRowForHead({ head, rows: [thisHead, live2] })).toEqual(live2);
  });

  it("reports none-declared when every row declaring the branch is another repository's", () => {
    const elsewhere: LandingBoardRow = { ...live, repoSlug: "acme/gadgets" };
    expect(boardRowForHead({ head, rows: [elsewhere] }).kind).toBe("none-declared");
  });

  it("keeps a row whose repo resolved to nothing, as the branch-only join always did", () => {
    expect(boardRowForHead({ head, rows: [thisHead, live] })).toEqual(live);
  });
});

describe("settledAtThisHead", () => {
  it("holds for this head's own registration once it has ended", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "rejected" } });
    expect(settledAtThisHead({ row })).toBe(true);
  });

  // A landing row was one of the ten settled rows measured: a seat
  // filed it by hand about the same head, keeping the registration slug and adding its own word.
  it("holds for a row filed by hand about this head, the registration slug plus a suffix", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-1111111-cr", status: "done" } });
    expect(settledAtThisHead({ row })).toBe(true);
  });

  it("does not hold for a slug that only shares characters with this head's, with no separator", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-11111119", status: "done" } });
    expect(settledAtThisHead({ row })).toBe(false);
  });

  it("does not hold while this head's registration is still live", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "ready" } });
    expect(settledAtThisHead({ row })).toBe(false);
  });

  it("does not hold for a terminal row filed at an OLDER head, because the head moved", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "land-acme-widgets-16378-0000000", status: "done" } });
    expect(settledAtThisHead({ row })).toBe(false);
  });

  it("does not hold for a terminal row some other doc filed about the branch", () => {
    const row = rebase({ boardRow: { kind: "row", slug: "fix-the-build", status: "done" } });
    expect(settledAtThisHead({ row })).toBe(false);
  });

  // The measured case: a rebase-and-fix seat moves the head it was registered at, then settles naming the
  // head it left behind, as the pull request URL followed by `@` and the abbreviated old head.
  it("holds for a row filed at an older head whose settlement witness names THIS head", () => {
    const row = rebase({
      boardRow: {
        kind: "row",
        settlementWitness: "https://github.com/acme/widgets/pull/16378 @ 1111111111: rebased onto staging",
        slug: "land-acme-widgets-16378-0000000",
        status: "done",
      },
    });
    expect(settledAtThisHead({ row })).toBe(true);
  });

  it("does not hold when the witness names an older head, because the head moved after the settle", () => {
    const row = rebase({
      boardRow: {
        kind: "row",
        settlementWitness: "PR #16378 head 28c1d717a2: rebased on staging",
        slug: "land-acme-widgets-16378-0000000",
        status: "done",
      },
    });
    expect(settledAtThisHead({ row })).toBe(false);
  });

  it("does not hold when the witness names no commit at all", () => {
    const row = rebase({
      boardRow: {
        kind: "row",
        settlementWitness: "https://github.com/acme/widgets/pull/16378",
        slug: "land-acme-widgets-16378-0000000",
        status: "done",
      },
    });
    expect(settledAtThisHead({ row })).toBe(false);
  });
});

describe("the two acts that keep nothing of the owner's stale", () => {
  const firstAskWhy =
    "GitHub still holds a code-owner request out to @acme/eng, and the Slack corpus reaches far enough to say " +
    `nobody has been asked at all — ${FIRST_ASK_BRIEF}`;
  const finishWhy =
    "it is a draft and no board row states its branch — read the linked Linear ticket's current state, look " +
    "for a merged pull request that supersedes it, and read the branch at 1111111; if the work is still wanted, " +
    "finish it unasked: clear CodeRabbit, make the required checks green, then undraft it; if the evidence says " +
    "it is dead, record a shaped card proposing the close with `handover ask --action` and never close it " +
    "yourself — its age is never evidence either way";
  const firstAsk = landingRowFake({
    action: "blocked-on",
    dispatch: { kind: "act", verdict: "draft-first-review-ask", why: firstAskWhy },
    title: "add the widget",
  });
  const unheldDraft = landingRowFake({
    action: "draft",
    dispatch: { kind: "act", verdict: "finish-or-card-close", why: finishWhy },
    title: "add the widget",
  });

  it("carries the whole first-ask brief, never-send included, as the row's one-line ask", () => {
    expect(registrationAsk({ row: firstAsk })).toBe(
      `acme/widgets#16378 needs draft-first-review-ask: add the widget — ${firstAskWhy}`,
    );
  });

  it("carries the whole draft brief, never-close and no-age included, as the row's one-line ask", () => {
    expect(registrationAsk({ row: unheldDraft })).toBe(
      `acme/widgets#16378 needs finish-or-card-close: add the widget — ${finishWhy}`,
    );
  });

  it.each([
    ["draft-first-review-ask", firstAsk, firstAskWhy],
    ["finish-or-card-close", unheldDraft, finishWhy],
  ] as const)("registers %s as an ordinary --dispatch row, never an --action ask", (verdict, row, why) => {
    expect(
      registrationArgv({
        organisation: ACME_ORGANISATION,
        askedIso: "2026-09-26T03:00:00.000Z",
        checkout: undefined,
        home: "/state",
        row,
      }),
    ).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      `acme/widgets#16378 needs ${verdict}: add the widget — ${why}`,
      "--dispatch",
      "--slug",
      "land-acme-widgets-16378-1111111",
      "--branch",
      "feature/one",
      "--workspace",
      "team",
      "--workspace-because",
      "the landing dispatch's pull request is in acme/widgets",
      "--asked-iso",
      "2026-09-26T03:00:00.000Z",
      "--home",
      "/state",
    ]);
  });

  it("plans both, so each reaches the board for a seat", () => {
    // One pass each: both share a branch, and one pass files one row per branch.
    expect([firstAsk, unheldDraft].map((row) => plannedRegistrations({ dispatchable: [row] })[0]!.skip)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("SKIPS a draft a live board row already declares — the second lock beside dispatch's own waiting", () => {
    const held = landingRowFake({
      ...unheldDraft,
      boardRow: { kind: "row", slug: "finish-the-widget", status: "in-progress" },
    });
    expect(plannedRegistrations({ dispatchable: [held] })[0]!.skip).toBe(
      "finish-the-widget already holds this branch and is in-progress",
    );
  });
});
