/**
 * `github bump-drive`'s parsing, its three independent caps, and the exact argv each act runs.
 *
 * The argv cases are the ones that matter most here: they are what actually reaches `github enqueue`,
 * `github ready`, `github pr update` and `handover register`, and a transposed or missing pair there is an
 * unattended write against the wrong pull request.
 */
import { describe, expect, it } from "vitest";

import {
  bumpEnqueueArgv,
  bumpReadyArgv,
  bumpRegisterArgv,
  bumpRegistrationAsk,
  bumpRewriteArgv,
  GITHUB_BUMP_DRIVE_FLAG_NAMES,
  parseGithubBumpDriveArgs,
  RENOVATE_SEAT_CLAUSE,
  scheduleBumpActs,
} from "../../../../../cli/commands/github/bumpDriveCore.js";
import {
  BUMP_ENQUEUE_CAP,
  BUMP_REWRITE_CAP,
  BUMP_SEAT_CAP,
  githubBumpDriveUsage,
} from "../../../../../cli/commands/github/bumpDriveUsage.js";
import { unwrap } from "../../../../../lib/result.js";
import { safeJsonParse } from "../../../../../lib/safeJson.js";
import { dependencyBotActors } from "../../../../../organisation/dependencyBots.js";
import { prFormOfBump } from "../../../../../outbound/github/bumpBodyForm.js";
import { prFormWriteSchema } from "../../../../../outbound/github/writeSchema.js";
import type { BumpAct, BumpPlan, BumpSignal } from "../../../../../review/bumpSelection.js";
import { landingRowFake } from "../../../../landingRowFake.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** One plan, with only the fields a case is about stated. */
function plan({ act, number = 1, why = "because" }: { act: BumpAct; number?: number; why?: string }): BumpPlan {
  return { act, row: landingRowFake({ number }), signal: "bot-author", why };
}

/** A `seat` plan for a bump a board row already declares, at the given status. */
function heldSeat({ number, status }: { number: number; status: string }): BumpPlan {
  const row = landingRowFake({ number });
  return {
    act: "seat",
    row: { ...row, boardRow: { kind: "row", slug: `land-acme-widgets-${String(number)}`, status } },
    signal: "bot-author",
    why: "behind its base",
  };
}

describe("parseGithubBumpDriveArgs", () => {
  it("defaults to the opt-out label `github landing` uses, and to no repository", () => {
    const args = unwrap(parseGithubBumpDriveArgs({ rest: [] }));

    expect(args.optOutLabels).toEqual(["no-auto-merge"]);
    expect(args.repos).toEqual([]);
    expect(args.limit).toBe(100);
    expect(args.dryRun).toBe(false);
    expect(args.json).toBe(false);
    expect(args.home).toBe(undefined);
  });

  it("lower-cases every opt-out label, because a GitHub label's case is the author's choice", () => {
    const args = unwrap(parseGithubBumpDriveArgs({ rest: ["--opt-out-label", "Hold, DO-NOT-MERGE"] }));

    expect(args.optOutLabels).toEqual(["hold", "do-not-merge"]);
  });

  it("refuses a repository that is not an owner/name slug, by name", () => {
    const parsed = parseGithubBumpDriveArgs({ rest: ["--repo", "widgets"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--repo takes one or more comma-separated owner/name slugs"]);
  });

  it("refuses a limit that is not a positive whole number", () => {
    const parsed = parseGithubBumpDriveArgs({ rest: ["--limit", "-1"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--limit must be a positive whole number"]);
  });

  it("carries every typed option through", () => {
    const args = unwrap(
      parseGithubBumpDriveArgs({
        rest: ["--repo", "acme/widgets,acme/gadgets", "--limit", "9", "--dry-run", "--json", "--home", "/tmp/home"],
      }),
    );

    expect(args).toEqual({
      dryRun: true,
      home: "/tmp/home",
      json: true,
      limit: 9,
      optOutLabels: ["no-auto-merge"],
      repos: ["acme/widgets", "acme/gadgets"],
    });
  });

  it("names every flag the parser accepts in its usage, so the help cannot drift from the spec", () => {
    const usage = githubBumpDriveUsage();

    expect(GITHUB_BUMP_DRIVE_FLAG_NAMES.filter((flag) => !usage.includes(flag))).toEqual([]);
    expect(GITHUB_BUMP_DRIVE_FLAG_NAMES).toEqual([
      "--repo",
      "--limit",
      "--opt-out-label",
      "--home",
      "--json",
      "--dry-run",
    ]);
  });

  it("names the act that is the verb's whole reason, so a reader of `--help` learns it exists", () => {
    expect(githubBumpDriveUsage()).toContain("undraft-and-enqueue");
  });
});

describe("scheduleBumpActs", () => {
  it("counts the caps SEPARATELY, so a backlog of seats cannot eat the pass's enqueues", () => {
    const plans: readonly BumpPlan[] = [
      ...Array.from({ length: BUMP_SEAT_CAP }, (_, index) => plan({ act: "seat", number: 100 + index })),
      plan({ act: "enqueue", number: 200 }),
    ];

    const scheduled = scheduleBumpActs({ plans });

    expect(scheduled.filter((entry) => entry.capped)).toEqual([]);
    expect(scheduled.at(-1)!.plan.row.number).toBe(200);
  });

  it("caps the enqueues past the ceiling and leaves the earlier ones alone", () => {
    const plans = Array.from({ length: BUMP_ENQUEUE_CAP + 2 }, (_, index) =>
      plan({ act: "enqueue", number: 300 + index }),
    );

    const scheduled = scheduleBumpActs({ plans });

    expect(scheduled.filter((entry) => !entry.capped).length).toBe(BUMP_ENQUEUE_CAP);
    expect(scheduled.filter((entry) => entry.capped).map((entry) => entry.plan.row.number)).toEqual([
      300 + BUMP_ENQUEUE_CAP,
      301 + BUMP_ENQUEUE_CAP,
    ]);
  });

  it("counts an undraft-and-enqueue against the ENQUEUE cap, because it queues one too", () => {
    const plans = Array.from({ length: BUMP_ENQUEUE_CAP + 1 }, (_, index) =>
      plan({ act: "undraft-and-enqueue", number: 400 + index }),
    );

    expect(scheduleBumpActs({ plans }).filter((entry) => entry.capped).length).toBe(1);
  });

  it("counts the description rewrites on their OWN cap, which neither of the other two can spend", () => {
    const plans: readonly BumpPlan[] = [
      ...Array.from({ length: BUMP_ENQUEUE_CAP }, (_, index) => plan({ act: "enqueue", number: 700 + index })),
      ...Array.from({ length: BUMP_REWRITE_CAP + 1 }, (_, index) => plan({ act: "rewrite-body", number: 800 + index })),
    ];

    const scheduled = scheduleBumpActs({ plans });

    expect(scheduled.filter((entry) => entry.capped).map((entry) => entry.plan.row.number)).toEqual([
      800 + BUMP_REWRITE_CAP,
    ]);
  });

  it("caps the board rows past the ceiling", () => {
    const plans = Array.from({ length: BUMP_SEAT_CAP + 1 }, (_, index) => plan({ act: "seat", number: 500 + index }));

    expect(
      scheduleBumpActs({ plans })
        .filter((entry) => entry.capped)
        .map((entry) => entry.plan.row.number),
    ).toEqual([500 + BUMP_SEAT_CAP]);
  });

  it("spends no seat budget on a bump the board already holds, so a repeat firing seats the NEXT bumps", () => {
    const live = Array.from({ length: BUMP_SEAT_CAP }, (_, index) =>
      heldSeat({ number: 1000 + index, status: "claimed" }),
    );
    const fresh = Array.from({ length: BUMP_SEAT_CAP + 1 }, (_, index) => plan({ act: "seat", number: 1100 + index }));

    const scheduled = scheduleBumpActs({ plans: [...live, ...fresh] });

    expect(scheduled.filter((entry) => entry.capped).map((entry) => entry.plan.row.number)).toEqual([
      1100 + BUMP_SEAT_CAP,
    ]);
  });

  it("still counts a seat whose board row already ENDED at another head, since that pass registers a fresh one", () => {
    const ended = Array.from({ length: BUMP_SEAT_CAP + 1 }, (_, index) =>
      heldSeat({ number: 1200 + index, status: "done" }),
    );

    expect(
      scheduleBumpActs({ plans: ended })
        .filter((entry) => entry.capped)
        .map((entry) => entry.plan.row.number),
    ).toEqual([1200 + BUMP_SEAT_CAP]);
  });

  it("never caps a `review-withheld`, which writes nothing, even past a full seat budget", () => {
    const plans = [
      ...Array.from({ length: BUMP_SEAT_CAP }, (_, index) => plan({ act: "seat", number: 900 + index })),
      ...Array.from({ length: BUMP_SEAT_CAP + 1 }, (_, index) => plan({ act: "review-withheld", number: 950 + index })),
    ];

    expect(
      scheduleBumpActs({ plans })
        .filter((entry) => entry.capped)
        .map((entry) => entry.plan.row.number),
    ).toEqual([]);
  });

  it("never caps a `nothing` or a `held`, since neither writes anything", () => {
    const plans = Array.from({ length: BUMP_ENQUEUE_CAP + BUMP_SEAT_CAP + 5 }, (_, index) =>
      plan({ act: index % 2 === 0 ? "nothing" : "held", number: 600 + index }),
    );

    expect(scheduleBumpActs({ plans }).filter((entry) => entry.capped)).toEqual([]);
  });

  it("schedules nothing out of no plans", () => {
    expect(scheduleBumpActs({ plans: [] })).toEqual([]);
  });
});

describe("the argv each act runs", () => {
  it("presses a bump a SESSION opened with no acknowledgement at all, so every finding still refuses", () => {
    expect(bumpEnqueueArgv({ home: "/tmp/home", row: landingRowFake({ number: 951 }), signal: "title" })).toEqual([
      "--pr",
      "951",
      "--repo",
      "acme/widgets",
      "--home",
      "/tmp/home",
    ]);
  });

  it("omits `--home` entirely when none was typed, rather than passing an empty one", () => {
    expect(bumpEnqueueArgv({ home: undefined, row: landingRowFake({ number: 951 }), signal: "branch-prefix" })).toEqual(
      ["--pr", "951", "--repo", "acme/widgets"],
    );
  });

  it("acknowledges the pairing floor for a BOT's bump, and names exactly that one finding", () => {
    const argv = bumpEnqueueArgv({ home: undefined, row: landingRowFake({ number: 661 }), signal: "bot-author" });

    expect(argv.slice(0, 5)).toEqual(["--pr", "661", "--repo", "acme/widgets", "--acknowledge"]);
    expect(argv[5]).toBe("codex-loop-incomplete");
    expect(argv[6]).toBe("--reason");
    expect(argv[7]).toContain("authored by no session");
    expect(argv).toHaveLength(8);
  });

  it("acknowledges the pairing floor for a bot even alongside `--home`, which stays last", () => {
    const argv = bumpEnqueueArgv({ home: "/tmp/home", row: landingRowFake({ number: 661 }), signal: "bot-author" });

    expect(argv.slice(-2)).toEqual(["--home", "/tmp/home"]);
    expect(argv.filter((entry) => entry === "--acknowledge")).toEqual(["--acknowledge"]);
  });

  it("never acknowledges a finding other than the pairing floor, whichever signal selected the bump", () => {
    const signals: readonly BumpSignal[] = ["bot-author", "branch-prefix", "title"];
    const acknowledged = signals.flatMap((signal) => {
      const argv = bumpEnqueueArgv({ home: undefined, row: landingRowFake({ number: 1 }), signal });
      return argv.filter((_entry, index) => argv[index - 1] === "--acknowledge");
    });

    expect(signals).toHaveLength(3);
    expect(acknowledged).toEqual(["codex-loop-incomplete"]);
  });

  it("undrafts with `github ready`'s own flag names, which are `--number` rather than `--pr`", () => {
    expect(bumpReadyArgv({ home: undefined, row: landingRowFake({ number: 662 }) })).toEqual([
      "--repo",
      "acme/widgets",
      "--number",
      "662",
    ]);
  });

  it("registers a board row naming the bump, what holds it and how far behind it is", () => {
    const argv = bumpRegisterArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-20T00:00:00.000Z",
      bots: GENERIC,
      checkout: "/checkouts/widgets",
      home: "/tmp/home",
      plan: { ...plan({ act: "seat", number: 662, why: "a session is needed for mergeable" }) },
      slug: "land-acme-widgets-662-1111111",
      withheld: false,
    });

    expect(argv).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      "acme/widgets#662 is a dependency bump that needs a session (a session is needed for mergeable; 3 behind): a change",
      "--dispatch",
      "--slug",
      "land-acme-widgets-662-1111111",
      "--branch",
      "feature/one",
      "--workspace",
      "team",
      "--workspace-because",
      "the dependency bump's pull request is in acme/widgets",
      "--asked-iso",
      "2026-09-20T00:00:00.000Z",
      "--repo",
      "/checkouts/widgets",
      "--home",
      "/tmp/home",
    ]);
  });

  it("states the workspace an organisation bump's repository names, before the asked instant", () => {
    const seat = plan({ act: "seat", number: 662 });
    const argv = bumpRegisterArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-20T00:00:00.000Z",
      bots: GENERIC,
      checkout: undefined,
      home: undefined,
      plan: { ...seat, row: { ...seat.row, repoSlug: "acme/acme-admin" } },
      slug: "land-acme-acme-admin-662-1111111",
      withheld: false,
    });

    expect(argv.slice(argv.indexOf("--branch") + 2)).toEqual([
      "--workspace",
      "team",
      "--workspace-because",
      "the dependency bump's pull request is in acme/acme-admin",
      "--asked-iso",
      "2026-09-20T00:00:00.000Z",
    ]);
  });

  it("says `? behind` rather than a number when the base distance was not read", () => {
    const ask = bumpRegistrationAsk({
      bots: GENERIC,
      plan: {
        act: "seat",
        row: landingRowFake({ baseDistance: { kind: "unread", why: "not asked" }, number: 7 }),
        signal: "title",
        why: "a session is needed for ci-green",
      },
      withheld: false,
    });

    expect(ask).toBe(
      "acme/widgets#7 is a dependency bump that needs a session (a session is needed for ci-green; ? behind): a change",
    );
  });

  it("leads with the URL, carrying neither name nor title, when the register's unrooted-path gate would refuse", () => {
    const ask = bumpRegistrationAsk({
      bots: GENERIC,
      plan: {
        act: "seat",
        row: landingRowFake({ number: 9901, title: "chore(deps): update datadog/agent docker tag to v7.60.0" }),
        signal: "title",
        why: "a session is needed for ci-green",
      },
      withheld: true,
    });

    expect(ask).toBe(
      "https://github.com/acme/widgets/pull/16378 is a dependency bump that needs a session " +
        "(a session is needed for ci-green; 3 behind): its name and title are withheld, as they read as a state-home path",
    );
  });
});

// The owner's rulings: a Renovate bump's review is the owner's, never a colleague's, and the owner is withholding
// it — so a seat ends with no card and no ask.
describe("the brief a Renovate bump's row carries", () => {
  const heldForEng = landingRowFake({
    authorIsBot: true,
    authorLogin: "acme-renovate",
    number: 16624,
    tests: [{ id: "codeowners-satisfied", verdict: "fail", why: "waiting on a human review" }],
    title: "chore(deps): update dependency qs to v6.16.0 [security]",
  });
  const seatHeld: BumpPlan = {
    act: "seat",
    row: heldForEng,
    signal: "bot-author",
    why: "a session is needed for ci-green",
  };

  it("tells a SEATED Renovate bump with a code owner pending that the owner's review is withheld, so no card and no ask", () => {
    const ask = bumpRegistrationAsk({ bots: CONFIGURED, plan: seatHeld, withheld: false });

    expect(ask.endsWith(`. ${RENOVATE_SEAT_CLAUSE}`)).toBe(true);
    expect(RENOVATE_SEAT_CLAUSE).toContain("with no Queue card for the owner and never a review ask to a colleague");
  });

  it("does not count the organisation's own Renovate App as Renovate where no organisation names it", () => {
    const ask = bumpRegistrationAsk({ bots: GENERIC, plan: seatHeld, withheld: false });

    expect(ask).toBe(
      "acme/widgets#16624 is a dependency bump that needs a session (a session is needed for ci-green; 3 behind): " +
        "chore(deps): update dependency qs to v6.16.0 [security]",
    );
  });

  it("registers the clause from the bots the pass resolved, never a constant", () => {
    const argv = ({ dependencyBots }: { dependencyBots: readonly string[] }): readonly string[] =>
      bumpRegisterArgv({
        askedIso: "2026-09-20T00:00:00.000Z",
        bots: dependencyBotActors({ dependencyBots }),
        checkout: undefined,
        home: undefined,
        organisation: ACME_ORGANISATION,
        plan: seatHeld,
        slug: "land-acme-widgets-16624-1111111",
        withheld: false,
      });
    const askOf = ({ built }: { built: readonly string[] }): string => built[built.indexOf("--ask") + 1]!;

    expect([
      askOf({ built: argv({ dependencyBots: ["acme-renovate"] }) }).endsWith(RENOVATE_SEAT_CLAUSE),
      askOf({ built: argv({ dependencyBots: [] }) }).endsWith(RENOVATE_SEAT_CLAUSE),
    ]).toEqual([true, false]);
  });

  it("adds nothing to a seated Renovate bump no code owner holds, nor to a Dependabot bump that one does", () => {
    const clear = landingRowFake({ authorIsBot: true, authorLogin: "acme-renovate", number: 5 });
    const dependabot = landingRowFake({
      authorLogin: "dependabot[bot]",
      number: 6,
      tests: heldForEng.tests,
      title: heldForEng.title,
    });
    const asks = [clear, dependabot].map((row) =>
      bumpRegistrationAsk({
        bots: CONFIGURED,
        plan: { act: "seat", row, signal: "bot-author", why: "w" },
        withheld: false,
      }),
    );

    expect(asks).toEqual([
      "acme/widgets#5 is a dependency bump that needs a session (w; 3 behind): a change",
      "acme/widgets#6 is a dependency bump that needs a session (w; 3 behind): " +
        "chore(deps): update dependency qs to v6.16.0 [security]",
    ]);
  });
});

describe("bumpRewriteArgv", () => {
  it("addresses the pull request by NUMBER and carries the whole form as one inline argument", () => {
    const row = landingRowFake({ number: 661, repoSlug: "acme/widgets" });
    const form = prFormOfBump({ draft: true, observedIso: "2026-09-20T02:00:00.000Z", row });

    const argv = bumpRewriteArgv({ form, home: "/tmp/home", row });

    expect(argv.slice(0, 6)).toEqual(["node", "slopweaver", "github", "pr", "update", "--form"]);
    expect(argv.slice(7)).toEqual(["--repo", "acme/widgets", "--number", "661", "--home", "/tmp/home"]);
    expect(prFormWriteSchema.parse(safeJsonParse({ label: "the argv's form", text: argv[6]! })).title).toBe(row.title);
  });

  it("omits the --home pair when none was given, so the resolved home is used", () => {
    const row = landingRowFake({ number: 661 });
    const argv = bumpRewriteArgv({
      form: prFormOfBump({ draft: false, observedIso: "2026-09-20T02:00:00.000Z", row }),
      home: undefined,
      row,
    });

    expect(argv.includes("--home")).toBe(false);
    expect(argv.at(-1)).toBe("661");
  });
});
