/*
 * The pull-request page's one state selector: every state is derived from the verb's own
 * per-row act and wait, Everything is the default, and the highest-priority work is drawn first.
 */
import { describe, expect, it } from "vitest";

import type { LandingRow } from "../../components/live/readLanding";
import {
  inPrView,
  PR_ACTION_ORDER,
  PR_VIEWS,
  prKeyOf,
  prRowsForView,
  prViewCounts,
  prViewLabel,
  prViewOf,
  prViewReadsPicks,
  withPrView,
} from "../../lib/prViews";
import { landingRow as row, WAIT } from "./landingRowFixture";

/** No pull request the owner has picked a reviewer for. */
const UNPICKED: ReadonlySet<string> = new Set();

/** A `blocked-on` row whose wait is at `next`, owed by `owners`. */
const blocked = ({
  number,
  next,
  owners,
}: {
  number: number;
  next: NonNullable<LandingRow["humanWait"]>["next"];
  owners: readonly string[];
}): LandingRow => ({
  ...row({ action: "blocked-on", number }),
  blockedOn: owners,
  humanWait: { ...WAIT, next },
});

describe("PR_VIEWS", () => {
  it("lists the owner's six first, in their order, then every other act once", () => {
    expect(PR_VIEWS.length).toBeGreaterThan(0);
    expect(PR_VIEWS.slice(0, 6).map((each) => each.label)).toEqual([
      "Everything",
      "Waiting on review",
      "Waiting on code owner",
      "Waiting on platform",
      "Waiting on CI",
      "In the merge queue",
    ]);
    expect(PR_VIEWS.length).toBe(3 + PR_ACTION_ORDER.length);
    expect(new Set(PR_VIEWS.map((each) => each.view)).size).toBe(PR_VIEWS.length);
  });

  it("offers a state for every act the page orders", () => {
    expect(PR_ACTION_ORDER.length).toBeGreaterThan(0);
    const views = new Set<string>(PR_VIEWS.map((each) => each.view));
    expect(PR_ACTION_ORDER.filter((entry) => !views.has(entry.action))).toEqual([]);
  });
});

describe("inPrView", () => {
  it("holds a code-owner wait under review only once somebody was asked or a channel has it", () => {
    expect(
      (["wait", "wait-on-channel", "bump", "read-the-messages", "ask", "name-the-reviewer", "sync-slack"] as const).map(
        (next) => inPrView({ picked: UNPICKED, row: blocked({ next, number: 1, owners: [] }), view: "review" }),
      ),
    ).toEqual([true, true, true, true, false, false, false]);
  });

  it("leaves a row the owner picked a reviewer for out of review, as its card is tagged ask", () => {
    const waiting = blocked({ next: "wait", number: 18247, owners: [] });
    const picked = new Set([prKeyOf({ row: waiting })]);
    expect([
      inPrView({ picked, row: waiting, view: "review" }),
      inPrView({ picked, row: waiting, view: "blocked-on" }),
    ]).toEqual([false, true]);
    expect(prKeyOf({ row: waiting })).toBe("lachiejames/slopweaver#18247");
  });

  it("holds a row under platform only when the platform team is a named owner", () => {
    const platform = blocked({ next: "ask", number: 1, owners: ["@acme/platform"] });
    const dx = blocked({ next: "ask", number: 2, owners: ["@acme/dx", "@platform"] });
    const unblocked: LandingRow = { ...row({ action: "press", number: 3 }), blockedOn: ["@acme/platform"] };
    expect(
      [platform, dx, unblocked].map((each) => inPrView({ picked: UNPICKED, row: each, view: "platform" })),
    ).toEqual([true, false, false]);
  });

  it("holds every row under Everything and a row under its own act only", () => {
    const ci = row({ action: "spawn-ci", number: 1 });
    expect([
      inPrView({ picked: UNPICKED, row: ci, view: "all" }),
      inPrView({ picked: UNPICKED, row: ci, view: "spawn-ci" }),
    ]).toEqual([true, true]);
    expect(inPrView({ picked: UNPICKED, row: ci, view: "queued" })).toBe(false);
  });
});

describe("prViewReadsPicks", () => {
  it("is true for Waiting on review only, the one state a pick changes", () => {
    expect(PR_VIEWS.length).toBeGreaterThan(0);
    const reading = PR_VIEWS.filter((each) => prViewReadsPicks({ view: each.view })).map((each) => each.view);
    expect(reading).toEqual(["review"]);
  });

  it("matches inPrView: a pick moves a row out of review and nowhere else", () => {
    const waiting = blocked({ next: "wait", number: 7, owners: ["acme/reviewers"] });
    const picked = new Set([prKeyOf({ row: waiting })]);
    const changed = PR_VIEWS.filter(
      (each) =>
        inPrView({ picked, row: waiting, view: each.view }) !==
        inPrView({ picked: UNPICKED, row: waiting, view: each.view }),
    ).map((each) => each.view);
    expect(changed).toEqual(["review"]);
  });
});

describe("prRowsForView", () => {
  const NONE = new Map<string, string>();

  it("draws by act order when the board has not read, each act in the reading's own order", () => {
    const rows = [
      row({ action: "draft", number: 1 }),
      row({ action: "queued", number: 2 }),
      row({ action: "press", number: 3 }),
      row({ action: "queued", number: 4 }),
    ];
    expect(prRowsForView({ picked: UNPICKED, priorities: NONE, rows, view: "all" }).map((each) => each.number)).toEqual(
      [3, 2, 4, 1],
    );
  });

  it("draws the highest board priority first, ahead of the act order, and a row no band covers last", () => {
    const rows: LandingRow[] = [
      { ...row({ action: "press", number: 1 }), boardRowSlug: undefined },
      { ...row({ action: "draft", number: 2 }), boardRowSlug: "urgent" },
      { ...row({ action: "queued", number: 3 }), boardRowSlug: "later" },
      { ...row({ action: "press", number: 4 }), boardRowSlug: "unbanded" },
    ];
    const priorities = new Map([
      ["urgent", "p0"],
      ["later", "p2"],
      ["unbanded", "someday"],
    ]);
    expect(prRowsForView({ picked: UNPICKED, priorities, rows, view: "all" }).map((each) => each.number)).toEqual([
      2, 3, 1, 4,
    ]);
  });

  it("draws only the rows the state holds", () => {
    const rows = [row({ action: "spawn-ci", number: 1 }), row({ action: "press", number: 2 })];
    expect(
      prRowsForView({ picked: UNPICKED, priorities: NONE, rows, view: "spawn-ci" }).map((each) => each.number),
    ).toEqual([1]);
    expect(prRowsForView({ picked: UNPICKED, priorities: NONE, rows: [], view: "all" })).toEqual([]);
  });

  it("draws an act the page has no entry for after every known one, never dropping it", () => {
    const rows = [row({ action: "brand-new", number: 1 }), row({ action: "draft", number: 2 })];
    expect(prRowsForView({ picked: UNPICKED, priorities: NONE, rows, view: "all" }).map((each) => each.number)).toEqual(
      [2, 1],
    );
  });
});

describe("prViewCounts", () => {
  const ROWS = [
    row({ action: "press", number: 1 }),
    row({ action: "spawn-ci", number: 2 }),
    row({ action: "draft", number: 3 }),
    blocked({ next: "wait", number: 4, owners: ["@acme/platform"] }),
  ];

  const draftsOf = (counts: ReturnType<typeof prViewCounts>): number | undefined =>
    counts.find((each) => each.view === "draft")!.count;

  it("counts each state over the rows it is given, in the selector's order, Everything first", () => {
    const counts = prViewCounts({ measured: true, picked: UNPICKED, rows: ROWS });
    expect(counts.length).toBe(PR_VIEWS.length);
    expect(counts.slice(0, 6).map((each) => each.count)).toEqual([4, 1, 1, 1, 1, 0]);
    expect(draftsOf(counts)).toBe(1);
  });

  it("knows no count at all, Everything included, when the population is not measured", () => {
    const undrafted = ROWS.filter((each) => each.action !== "draft");
    const counts = prViewCounts({ measured: false, picked: UNPICKED, rows: undrafted });
    expect(counts.length).toBe(PR_VIEWS.length);
    expect(counts.filter((each) => each.count !== undefined)).toEqual([]);
  });

  it("counts a measured zero when the population is measured but the work context shows none", () => {
    const undrafted = ROWS.filter((each) => each.action !== "draft");
    expect(draftsOf(prViewCounts({ measured: true, picked: UNPICKED, rows: undrafted }))).toBe(0);
    expect(prViewCounts({ measured: true, picked: UNPICKED, rows: [] })[0].count).toBe(0);
  });
});

describe("the address", () => {
  it("opens on Everything with no state, or one that is not a state", () => {
    expect([prViewOf({ value: null }), prViewOf({ value: "nonsense" }), prViewOf({ value: "queued" })]).toEqual([
      "all",
      "all",
      "queued",
    ]);
  });

  it("writes a state into the query string beside every other parameter, and Everything drops it", () => {
    expect(withPrView({ search: "?open=12&fixture=f", view: "spawn-ci" })).toBe("?open=12&fixture=f&view=spawn-ci");
    expect(withPrView({ search: "?view=queued&open=12", view: "all" })).toBe("?open=12");
    expect(withPrView({ search: "", view: "all" })).toBe("");
  });

  it("names each state in the selector's own words", () => {
    expect([prViewLabel({ view: "all" }), prViewLabel({ view: "platform" }), prViewLabel({ view: "draft" })]).toEqual([
      "Everything",
      "Waiting on platform",
      "Drafts",
    ]);
  });
});
