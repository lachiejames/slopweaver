/**
 * Which pull requests are dependency bumps, and the ONE act each gets.
 *
 * The `undraft-and-enqueue` cases are the ones worth reading: that act is the whole reason the verb exists, and
 * it is defined against a condition `row.ready` cannot express — a draft whose other five tests all passed.
 */
import { describe, expect, it } from "vitest";

import { dependencyBotActors } from "../../../organisation/dependencyBots.js";
import {
  BUMP_BRANCH_PREFIXES,
  bumpPlanFor,
  bumpPlans,
  bumpSignalFor,
  isBumpTitle,
  isRenovateAuthored,
  selectBumpRows,
} from "../../../review/bumpSelection.js";
import type { LandingTest, LandingTestId, LandingVerdict } from "../../../review/landing.js";
import type { FailingCheckDetail } from "../../../review/prStateDetail.js";
import { landingRowFake } from "../../landingRowFake.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** The configured App's pull request, as the GraphQL fleet read spells it: the bare login, typed a `Bot`. */
const ACME_RENOVATE = { authorIsBot: true, authorLogin: "acme-renovate" } as const;

/** Every one of the six tests passing, which a case then spoils one field of. */
const ALL_PASS: Readonly<Record<LandingTestId, LandingVerdict>> = {
  "ci-green": "pass",
  "codeowners-satisfied": "pass",
  mergeable: "pass",
  "queue-available": "pass",
  "threads-clear": "pass",
  undrafted: "pass",
};

/** The six tests with the named ones spoiled. */
function six(over: Partial<Record<LandingTestId, LandingVerdict>> = {}): readonly LandingTest[] {
  const verdicts = { ...ALL_PASS, ...over };
  const ids: readonly LandingTestId[] = [
    "undrafted",
    "ci-green",
    "mergeable",
    "threads-clear",
    "codeowners-satisfied",
    "queue-available",
  ];
  return ids.map((id) => ({ id, verdict: verdicts[id], why: `${id} said ${verdicts[id]}` }));
}

describe("bumpSignalFor", () => {
  it("selects the organisation's own Renovate App's pull request by its author, whatever its title says", () => {
    const signal = bumpSignalFor({
      bots: CONFIGURED,
      row: landingRowFake({ ...ACME_RENOVATE, headRefName: "wip", title: "something else" }),
    });

    expect(signal).toBe("bot-author");
  });

  it("does not select that App's pull request by its author on an install whose organisation does not name it", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ ...ACME_RENOVATE, headRefName: "wip", title: "something else" }),
    });

    expect(signal).toBe(undefined);
  });

  it("never selects a USER who holds the configured App's bare login", () => {
    const signal = bumpSignalFor({
      bots: CONFIGURED,
      row: landingRowFake({ authorLogin: "acme-renovate", headRefName: "wip", title: "something else" }),
    });

    expect(signal).toBe(undefined);
  });

  it("selects the configured App by its REST login, `[bot]` and all", () => {
    const signal = bumpSignalFor({
      bots: CONFIGURED,
      row: landingRowFake({ authorLogin: "acme-renovate[bot]", headRefName: "wip", title: "something else" }),
    });

    expect(signal).toBe("bot-author");
  });

  // The fleet read is GraphQL, which spells the Renovate App `renovate`, never
  // `renovate[bot]`, so a bump on a branch and title of its own read as a colleague's pull request.
  it.each(GENERIC.bumpGraphqlAppLogins)(
    "selects the %s App by its GraphQL login when GitHub typed it a Bot",
    (authorLogin) => {
      const signal = bumpSignalFor({
        bots: GENERIC,
        row: landingRowFake({
          authorIsBot: true,
          authorLogin,
          headRefName: "deps/lodash",
          title: "deps: lodash 4.17.22",
        }),
      });

      expect(signal).toBe("bot-author");
    },
  );

  // A self-hosted Renovate App opens bumps under its own login, which no registry here names until an installation
  // adds it, so its bump is selected by branch or title, never by author.
  it("never selects an unlisted App by its author", () => {
    const signal = bumpSignalFor({
      bots: CONFIGURED,
      row: landingRowFake({
        authorIsBot: true,
        authorLogin: "acme-release-app",
        headRefName: "wip",
        title: "something else",
      }),
    });

    expect(signal).toBe(undefined);
  });

  it("names only the public Apps in every author registry of an install whose organisation names none", () => {
    expect(GENERIC.bumpGraphqlAppLogins).toEqual(["dependabot", "renovate"]);
    expect(GENERIC.bumpRestLogins).toEqual(["dependabot[bot]", "renovate[bot]"]);
    expect(GENERIC.renovateRestLogins).toEqual(["renovate[bot]"]);
  });

  it("never selects a USER who happens to hold an App's bare login", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ authorLogin: "renovate", headRefName: "deps/lodash", title: "deps: lodash 4.17.22" }),
    });

    expect(signal).toBe(undefined);
  });

  it("selects a human-opened bump by its head-ref prefix when the author is not a bot", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ headRefName: "renovate/typescript-6.x", title: "something else" }),
    });

    expect(signal).toBe("branch-prefix");
  });

  it("matches the prefix case-insensitively, because a head ref is not normalised anywhere upstream", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ headRefName: "Dependabot/npm_and_yarn/zod-4", title: "x" }),
    });

    expect(signal).toBe("branch-prefix");
  });

  it("selects a fleet-opened bump by its title alone", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ headRefName: "chore/bumps", title: "chore(deps): zod 4.1" }),
    });

    expect(signal).toBe("title");
  });

  it("accepts every conventional and provider title form", () => {
    const titles = [
      "chore(deps-dev): vitest 4",
      "fix(deps): patch zod",
      "build(deps): esbuild 0.25",
      "Update dependency typescript to v6",
      "Update vitest monorepo to v4",
      "Bump drizzle-orm from 0.44.0 to 0.45.0",
    ];

    expect(
      titles.filter((title) => bumpSignalFor({ bots: GENERIC, row: landingRowFake({ title }) }) !== "title"),
    ).toEqual([]);
    expect(titles.length).toBeGreaterThan(0);
  });

  it("does not select a pull request that merely mentions a version part-way through its title", () => {
    const signal = bumpSignalFor({
      bots: GENERIC,
      row: landingRowFake({ title: "the docs site pins typescript to v6" }),
    });

    expect(signal).toBe(undefined);
  });

  it("does not select an ordinary fleet pull request on none of the three signals", () => {
    expect(bumpSignalFor({ bots: GENERIC, row: landingRowFake() })).toBe(undefined);
  });

  it("declares both registries non-empty, so a filter over them is not vacuously true", () => {
    expect(GENERIC.bumpRestLogins.length).toBeGreaterThan(0);
    expect(BUMP_BRANCH_PREFIXES).toEqual(["renovate/", "dependabot/"]);
  });
});

describe("isRenovateAuthored", () => {
  it("reads the configured App as Renovate only on the install whose organisation names it", () => {
    const row = landingRowFake(ACME_RENOVATE);
    expect([isRenovateAuthored({ bots: CONFIGURED, row }), isRenovateAuthored({ bots: GENERIC, row })]).toEqual([
      true,
      false,
    ]);
  });

  it("reads the generic Renovate App as Renovate with no organisation at all", () => {
    expect(isRenovateAuthored({ bots: GENERIC, row: landingRowFake({ authorLogin: "renovate[bot]" }) })).toBe(true);
  });

  it("never reads Dependabot, or a user holding the configured login, as Renovate", () => {
    const dependabot = landingRowFake({ authorIsBot: true, authorLogin: "dependabot" });
    const user = landingRowFake({ authorLogin: "acme-renovate" });
    expect([
      isRenovateAuthored({ bots: CONFIGURED, row: dependabot }),
      isRenovateAuthored({ bots: CONFIGURED, row: user }),
    ]).toEqual([false, false]);
  });
});

describe("isBumpTitle", () => {
  it("reads a Renovate update title as a bump", () => {
    expect(isBumpTitle({ title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119" })).toBe(true);
  });

  it("does not read a feature title as a bump", () => {
    expect(isBumpTitle({ title: "feat(JJJJ-1715): log an error as Datadog's error.*" })).toBe(false);
  });
});

describe("selectBumpRows", () => {
  it("keeps only the bumps, in the order the read returned them, each with its signal", () => {
    const selected = selectBumpRows({
      bots: GENERIC,
      rows: [
        landingRowFake({ number: 1 }),
        landingRowFake({ authorLogin: "dependabot[bot]", number: 2 }),
        landingRowFake({ number: 3, title: "Update dependency zod to v4" }),
      ],
    });

    expect(selected.map((entry) => entry.row.number)).toEqual([2, 3]);
    expect(selected.map((entry) => entry.signal)).toEqual(["bot-author", "title"]);
  });

  it("selects nothing out of an empty fleet read", () => {
    expect(selectBumpRows({ bots: GENERIC, rows: [] })).toEqual([]);
  });
});

describe("bumpPlanFor", () => {
  it("undrafts and enqueues a draft whose other five tests all passed — the act `landing` had no word for", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ ...ACME_RENOVATE, ready: false, tests: six({ undrafted: "fail" }) }),
        signal: "bot-author",
      },
      optOutLabels: ["no-auto-merge"],
    });

    expect(plan.act).toBe("undraft-and-enqueue");
    expect(plan.why).toBe("every test but the draft flag passed");
  });

  it("seats a draft that is ALSO conflicted rather than undrafting it, naming both failures", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ ready: false, tests: six({ mergeable: "fail", undrafted: "fail" }) }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for undrafted, mergeable");
  });

  it("does not undraft on an UNKNOWN test, because an unread verdict is not a passed one", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ ready: false, tests: six({ "ci-green": "unknown", undrafted: "fail" }) }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for undrafted, ci-green");
  });

  it("enqueues a bump that passed all six", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: { row: landingRowFake({ ready: true, tests: six() }), signal: "title" },
      optOutLabels: [],
    });

    expect(plan.act).toBe("enqueue");
    expect(plan.why).toBe("every landing test passed");
  });

  it("does nothing to one GitHub already holds a queue entry for, and names the position", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ queue: { kind: "queued", position: 2, state: "AWAITING_CHECKS" }, tests: six() }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("nothing");
    expect(plan.why).toBe("GitHub already holds entry 2 for it");
  });

  it("holds an opt-out label AHEAD of every other arm, including a queued one", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          labels: ["No-Auto-Merge"],
          queue: { kind: "queued", position: 2, state: "AWAITING_CHECKS" },
          tests: six(),
        }),
        signal: "bot-author",
      },
      optOutLabels: ["no-auto-merge"],
    });

    expect(plan.act).toBe("held");
    expect(plan.why).toBe("label No-Auto-Merge opts it out of any act");
  });

  it("carries the signal through onto the plan, so a title-only selection is visible in the report", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: { row: landingRowFake({ tests: six() }), signal: "title" },
      optOutLabels: [],
    });

    expect(plan.signal).toBe("title");
    expect(plan.row.number).toBe(16378);
  });
});

/*
 * The `rewrite-body` rung. Its criterion is four conditions that hold together, so each case below spoils
 * exactly one of them and expects a seat — the ladder above it is unchanged and must stay that way.
 */

/** One failing check by name, in the shape a landing row carries them. */
function red({ name }: { name: string }): FailingCheckDetail {
  return {
    kind: "check-run",
    name,
    required: true,
    state: "failed",
    url: `https://github.com/acme/widgets/runs/${name}`,
  };
}

describe("the rewrite-body rung", () => {
  it("rewrites a bot's DRAFT whose one red check is dev-gate, since its description can never pass", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail", "codeowners-satisfied": "fail", undrafted: "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("rewrite-body");
    expect(plan.why).toBe("dev-gate is the only failing check, and this bot's description can never satisfy it");
  });

  it("rewrites an already-undrafted one too, so the act does not depend on the draft flag", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("rewrite-body");
  });

  // Standing rule: a renovate-authored pull request keeps renovate's own description, both repos.
  it.each(CONFIGURED.renovateRestLogins)("never rewrites a body %s opened, and seats it instead", (authorLogin) => {
    const plan = bumpPlanFor({
      bots: CONFIGURED,
      bump: {
        row: landingRowFake({
          authorLogin,
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail", "codeowners-satisfied": "fail", undrafted: "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });

  it("never rewrites a body the Renovate App opened, spelled as GraphQL spells it", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          authorIsBot: true,
          authorLogin: "renovate",
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });

  it("never rewrites a body the organisation's own Renovate App opened, as GraphQL spells it", () => {
    const plan = bumpPlanFor({
      bots: CONFIGURED,
      bump: {
        row: landingRowFake({
          ...ACME_RENOVATE,
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });

  it("still rewrites a dependabot body, which the renovate rule does not cover", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          authorLogin: "dependabot[bot]",
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("rewrite-body");
  });

  it("seats it when a SECOND check is also red, because that one is about the dependency", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" }), red({ name: "build" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for ci-green");
  });

  it("seats it when ci-green failed with NO failing check, since that check never RAN", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ failingChecks: [], ready: false, tests: six({ "ci-green": "fail" }) }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });

  it("seats it when something other than the body and the draft flag is also blocking", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail", mergeable: "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for ci-green, mergeable");
  });

  it("seats the same row when the signal is a BRANCH PREFIX, because only a declared bot proves nobody typed it", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" })],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "branch-prefix",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });

  it("holds an opt-out label ahead of a rewrite, exactly as it does ahead of every other act", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          failingChecks: [red({ name: "dev-gate" })],
          labels: ["bump-hold"],
          ready: false,
          tests: six({ "ci-green": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: ["bump-hold"],
    });

    expect(plan.act).toBe("held");
  });
});

describe("bumpPlans", () => {
  it("plans every bump independently, in selection order", () => {
    const plans = bumpPlans({
      bots: GENERIC,
      bumps: [
        { row: landingRowFake({ number: 1, ready: true, tests: six() }), signal: "bot-author" },
        { row: landingRowFake({ number: 2, ready: false, tests: six({ undrafted: "fail" }) }), signal: "bot-author" },
        { row: landingRowFake({ number: 3, ready: false, tests: six({ "ci-green": "fail" }) }), signal: "title" },
      ],
      optOutLabels: [],
    });

    expect(plans.map((plan) => plan.act)).toEqual(["enqueue", "undraft-and-enqueue", "seat"]);
  });

  it("plans nothing for an empty selection", () => {
    expect(bumpPlans({ bots: GENERIC, bumps: [], optOutLabels: [] })).toEqual([]);
  });
});

// Standing rules: a Renovate bump's review is the owner's, never a colleague's, and the owner withholds it —
// no card, no row, no colleague ask.
describe("a Renovate bump whose only hold is a code owner", () => {
  const heldForEng = {
    blockedOn: ["@acme/acme-eng"],
    ready: false,
    tests: six({ "codeowners-satisfied": "fail" }),
  };

  it.each(CONFIGURED.renovateRestLogins)(
    "has its review withheld, never asked of a colleague, when %s opened it",
    (authorLogin) => {
      const plan = bumpPlanFor({
        bots: CONFIGURED,
        bump: { row: landingRowFake({ ...heldForEng, authorLogin }), signal: "bot-author" },
        optOutLabels: [],
      });

      expect(plan.act).toBe("review-withheld");
      expect(plan.why).toBe(
        "a Renovate bump GitHub holds for @acme/acme-eng — the owner's review is withheld on Renovate pull requests, " +
          "so no card and never a colleague ask",
      );
    },
  );

  it("reads the Renovate App by its GraphQL login only when GitHub typed it a Bot", () => {
    const app = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ ...heldForEng, authorIsBot: true, authorLogin: "renovate" }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });
    const user = bumpPlanFor({
      bots: GENERIC,
      bump: { row: landingRowFake({ ...heldForEng, authorLogin: "renovate" }), signal: "branch-prefix" },
      optOutLabels: [],
    });

    expect([app.act, user.act]).toEqual(["review-withheld", "awaiting-human-review"]);
  });

  it("waits on the named code owner for the organisation's App on an install that does not name it", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: { row: landingRowFake({ ...heldForEng, ...ACME_RENOVATE }), signal: "branch-prefix" },
      optOutLabels: [],
    });

    expect(plan.act).toBe("awaiting-human-review");
  });

  it("keeps a Dependabot bump waiting on the named code owner, since the ruling names Renovate", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: { row: landingRowFake({ ...heldForEng, authorLogin: "dependabot[bot]" }), signal: "bot-author" },
      optOutLabels: [],
    });

    expect(plan.act).toBe("awaiting-human-review");
  });

  it("seats a Renovate bump whose CI is ALSO red, because that half is work a session can start", () => {
    const plan = bumpPlanFor({
      bots: CONFIGURED,
      bump: {
        row: landingRowFake({
          ...heldForEng,
          ...ACME_RENOVATE,
          tests: six({ "ci-green": "fail", "codeowners-satisfied": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
  });
});

describe("a bump whose only hold is a human review", () => {
  it("waits on the named code owner in the OWNER's words when Renovate did not open the bump, and writes nothing", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          ready: false,
          tests: six({ "codeowners-satisfied": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("awaiting-human-review");
    expect(plan.why).toBe("waiting on a human review from @acme/acme-eng — it is pressed the pass that approval lands");
  });

  it("answers the same for a bump a SESSION opened, because the approval is the same colleague's either way", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          ready: false,
          tests: six({ "codeowners-satisfied": "fail" }),
        }),
        signal: "title",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("awaiting-human-review");
  });

  it("presses the same row the moment that approval lands, with no state carried between passes", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ blockedOn: [], ready: true, tests: six() }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("enqueue");
    expect(plan.why).toBe("every landing test passed");
  });

  it("seats rather than waits when CI is ALSO red, because that half is work a session can start", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          ready: false,
          tests: six({ "ci-green": "fail", "codeowners-satisfied": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for ci-green, codeowners-satisfied");
  });

  it("seats rather than waits on an UNKNOWN codeowners verdict, which is unread evidence and not a person", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          ready: false,
          tests: six({ "codeowners-satisfied": "unknown" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for codeowners-satisfied");
  });

  it("seats rather than waits when the test failed and GitHub named nobody, so no sentence can name one", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({ blockedOn: [], ready: false, tests: six({ "codeowners-satisfied": "fail" }) }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for codeowners-satisfied");
  });

  it("never UNDRAFTS a bump into the review it is waiting on — two blocking tests, so it seats", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          ready: false,
          tests: six({ "codeowners-satisfied": "fail", undrafted: "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: [],
    });

    expect(plan.act).toBe("seat");
    expect(plan.why).toBe("a session is needed for undrafted, codeowners-satisfied");
  });

  it("holds an opt-out label AHEAD of the wait, because a human has already settled that row", () => {
    const plan = bumpPlanFor({
      bots: GENERIC,
      bump: {
        row: landingRowFake({
          blockedOn: ["@acme/acme-eng"],
          labels: ["no-auto-merge"],
          ready: false,
          tests: six({ "codeowners-satisfied": "fail" }),
        }),
        signal: "bot-author",
      },
      optOutLabels: ["no-auto-merge"],
    });

    expect(plan.act).toBe("held");
  });
});
