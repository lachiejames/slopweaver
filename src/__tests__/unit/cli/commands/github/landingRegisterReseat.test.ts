import { describe, expect, it } from "vitest";

import {
  boardRowForHead,
  type LandingRegisterDeps,
  performRegistrations,
  plannedRegistrations,
} from "../../../../../cli/commands/github/landingRegister.js";
import { ok } from "../../../../../lib/result.js";
import type { LandingRow } from "../../../../../review/landing.js";
import type { LandingBoardRow } from "../../../../../review/landingBoard.js";
import { landingRowFake } from "../../../../landingRowFake.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

/** The row that held a pull request for days: live, its run active, its seat closed at rest, and no wake. */
const ORPHANED: LandingBoardRow = {
  kind: "row",
  parked: "no-wake",
  run: "active",
  slug: "knowledge-redaction-flag",
  status: "ready",
};

/** A draft of the owner's, dispatched to be finished, joined to the given board row. */
const draft = ({ boardRow }: { boardRow: LandingBoardRow }): LandingRow =>
  landingRowFake({
    action: "draft",
    boardRow,
    dispatch: { kind: "act", verdict: "finish-or-card-close", why: "an orphaned draft" },
  });

/** A register whose every write is counted, so a case can prove none happened. */
const countingDeps = (): { readonly deps: LandingRegisterDeps; readonly argvs: string[][] } => {
  const argvs: string[][] = [];
  return {
    argvs,
    deps: {
      checkoutFor: () => "/checkouts/widgets",
      now: () => new Date("2026-11-03T07:00:00.000Z"),
      readOrganisation: () => Promise.resolve(ok(ACME_ORGANISATION)),
      registerRow: ({ argv }) => {
        argvs.push([...argv]);
        return Promise.resolve(0);
      },
    },
  };
};

describe("plannedRegistrations — a draft whose row's seat closed at rest with no wake", () => {
  it("skips registering, naming the existing row's reseat rather than filing a second row", () => {
    const planned = plannedRegistrations({ dispatchable: [draft({ boardRow: ORPHANED })] });
    expect(planned.map((entry) => entry.skip)).toEqual([
      "knowledge-redaction-flag already holds this branch but is parked at rest with its seat closed and no " +
        "wake — register no duplicate; reseat it with `slopweaver cmux spawn knowledge-redaction-flag` during the fill",
    ]);
  });

  it("keeps the plain live-row hold over an open seat, so no reseat is offered for a working session", () => {
    const { parked: _parked, ...open } = ORPHANED;
    const planned = plannedRegistrations({ dispatchable: [draft({ boardRow: open })] });
    expect(planned.map((entry) => entry.skip)).toEqual([
      "knowledge-redaction-flag already holds this branch and is ready",
    ]);
  });
});

describe("plannedRegistrations — one pass files one row per branch", () => {
  it("skips a second pull request on a branch the pass already plans, naming the first", () => {
    const shared = ({ number }: { number: number }): LandingRow =>
      landingRowFake({
        action: "draft",
        dispatch: { kind: "act", verdict: "finish-or-card-close", why: "an unheld draft" },
        headRefName: "feature/shared",
        number,
      });
    const planned = plannedRegistrations({ dispatchable: [shared({ number: 7 }), shared({ number: 8 })] });
    expect(planned.map((entry) => [entry.row.number, entry.skip])).toEqual([
      [7, undefined],
      [8, "#7 already plans a row on feature/shared this pass — one row per branch"],
    ]);
  });
});

describe("boardRowForHead — an orphaned row never masks a live row that holds the branch", () => {
  const head = { headOid: "1111111111111111111111111111111111111111", number: 7, repoSlug: "acme/widgets" };
  const working: LandingBoardRow = { kind: "row", run: "active", slug: "the-working-seat", status: "ready" };

  it.each([
    ["read first", [ORPHANED, working]],
    ["read second", [working, ORPHANED]],
  ])("joins the working row whether the orphan was %s, so no reseat lands beside it", (_order, rows) => {
    expect(boardRowForHead({ head, rows })).toStrictEqual(working);
  });

  it("joins the orphan when it is the only live row, so its reseat is named", () => {
    const ended: LandingBoardRow = { kind: "row", slug: "an-old-run", status: "done" };
    expect(boardRowForHead({ head, rows: [ended, ORPHANED] })).toStrictEqual(ORPHANED);
  });
});

describe("performRegistrations — a draft never takes a cap slot a non-draft wanted", () => {
  it("registers ten non-drafts read after a draft, and leaves the draft to the next read", async () => {
    const { argvs, deps } = countingDeps();
    const unheld = draft({ boardRow: { kind: "none-declared", why: "no row" } });
    const ready = Array.from({ length: 10 }, (_, index) =>
      landingRowFake({
        action: "spawn-ci",
        dispatch: { kind: "act", verdict: "rebase-and-fix", why: "red CI" },
        headRefName: `feature/${String(index)}`,
        number: 100 + index,
      }),
    );
    const outcomes = await performRegistrations({
      deps,
      dispatchable: [{ ...unheld, number: 99 }, ...ready],
      dryRun: true,
      home: undefined,
      quiet: true,
    });
    expect(outcomes.filter((o) => o.outcome === "would-register").map((o) => o.number)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]);
    expect(outcomes.filter((o) => o.outcome === "skipped").map((o) => o.number)).toEqual([99]);
    expect(argvs).toEqual([]);
  });
});

describe("performRegistrations — an orphaned draft writes nothing", () => {
  it("reports the row skipped and never calls the register", async () => {
    const { argvs, deps } = countingDeps();
    const outcomes = await performRegistrations({
      deps,
      dispatchable: [draft({ boardRow: ORPHANED })],
      dryRun: false,
      home: undefined,
      quiet: true,
    });
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["skipped"]);
    expect(argvs).toEqual([]);
  });
});
