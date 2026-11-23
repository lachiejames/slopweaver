/*
 * Which standing rule took which check-in off the owner's list: `readAutonomy` names the rule only when a class — never a
 * word on the act — settled it, re-checking kind and scope; a settled card is built exactly as the check-in it
 * replaced; and the tally counts CARDS per rule, largest first.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { readAutonomy } from "../../components/live/readAutonomy";
import type { LiveState } from "../../components/live/useLive";
import { groupActs } from "../../lib/actGroups";
import { rowsOf } from "../../lib/queueRows";
import { placementFoldKey } from "../../lib/registerPlacement";
import { settledActRowsOf, settledByStandingRules } from "../../lib/standingRules";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const DM = "https://acme.slack.com/archives/D0SYN000001/";
const CHANNEL = "https://acme.slack.com/archives/C0SYN000002/p1";
const PR = `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1336`;
const IN_DM = {
  actionId: "class-scoped.post-as-owner-in-own-dm",
  anchor: "owner-turn-240-6",
  bySession: "supervisor",
  kinds: "slack.post.as-me",
  steer: "post as me in my own DM with the bot",
  steeredIso: "2026-09-28T08:00:00.000Z",
  subjectPrefix: DM,
};
const REBASE = {
  actionId: "class.clear-own-prs",
  anchor: "transcript:c3fd48ad#6d5d4a39",
  bySession: "supervisor",
  kinds: "rebase,fix-red-ci",
  steer: "clear failing CI, merge conflicts and rebases on my pull requests",
  steeredIso: "2026-09-28T08:00:00.000Z",
};

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-28T08:10:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** One act as the ledger prints it, newest first by the order given. */
function entry({
  actionId,
  kind,
  subject,
  extra = {},
}: {
  actionId: string;
  kind: string;
  subject: string;
  extra?: Record<string, unknown>;
}) {
  return { action: { actionId, doneIso: "2026-09-28T06:00:00.000Z", kind, subject, why: "done" }, ...extra };
}

const read = readAutonomy([
  entry({ actionId: "p-dm-2", extra: { classSteer: IN_DM }, kind: "slack.post.as-me", subject: `${DM}p2` }),
  entry({ actionId: "p-dm-1", extra: { classSteer: IN_DM }, kind: "slack.post.as-me", subject: `${DM}p1` }),
  entry({ actionId: "p-channel", extra: { classSteer: IN_DM }, kind: "slack.post.as-me", subject: CHANNEL }),
  entry({ actionId: "r-new", extra: { classSteer: REBASE }, kind: "rebase", subject: PR }),
  entry({ actionId: "r-old", extra: { classSteer: REBASE }, kind: "rebase", subject: PR }),
  entry({ actionId: "c-red", extra: { classSteer: REBASE }, kind: "fix-red-ci", subject: PR }),
  entry({
    actionId: "c-worded",
    extra: { classSteer: REBASE, latestSteer: { steer: "not that one" } },
    kind: "fix-red-ci",
    subject: `${PR}0`,
  }),
  entry({ actionId: "f-finding", kind: "open-internal-finding-pull-request", subject: PR }),
])!;

describe("the rule readAutonomy names as an act's witness", () => {
  it("names a class only where it admits the act, and never over a word on the act itself", () => {
    expect(read.map((row) => row.standing?.classId)).toEqual([
      "post-as-owner-in-own-dm",
      "post-as-owner-in-own-dm",
      undefined,
      "clear-own-prs",
      "clear-own-prs",
      "clear-own-prs",
      undefined,
      undefined,
    ]);
    expect(read.map((row) => row.steer)).toEqual([
      IN_DM.steer,
      IN_DM.steer,
      undefined,
      REBASE.steer,
      REBASE.steer,
      REBASE.steer,
      "not that one",
      undefined,
    ]);
  });

  it("fails closed on a scoped id with no scope and on a scope riding an unscoped id", () => {
    const { subjectPrefix: _dropped, ...noScope } = IN_DM;
    const forged = readAutonomy([
      entry({ actionId: "a", extra: { classSteer: noScope }, kind: "slack.post.as-me", subject: `${DM}p1` }),
      entry({
        actionId: "b",
        extra: { classSteer: { ...REBASE, subjectPrefix: PR } },
        kind: "rebase",
        subject: PR,
      }),
    ])!;
    expect(forged.map((row) => [row.standing, row.steer])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe("the cards a standing rule settled", () => {
  const acts = ready({ value: read });
  // A board that has read and holds no row: nothing for an act to join, so each is placed by its own subject.
  const BOARD = ready({ value: readBoard({ rows: [], unresolved: 0 })! });

  it("groups one card per kind and subject, the newest first with the earlier beneath it", () => {
    const groups = groupActs({ acts: read });
    expect(groups.map((group) => [group.act.actionId, group.earlier.map((was) => was.actionId)])).toEqual([
      ["p-dm-2", []],
      ["p-dm-1", []],
      ["p-channel", []],
      ["r-new", ["r-old"]],
      ["c-red", []],
      ["c-worded", []],
      ["f-finding", []],
    ]);
  });

  it("builds a settled card exactly as the check-in it replaced, and the two lists partition the unworded acts", () => {
    const settled = settledActRowsOf({ acts, board: BOARD, landing: LOADING, placer: ACME_PLACER });
    const listed = rowsOf({
      acts,
      board: BOARD,
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      standing: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(settled.map((row) => [row.key, row.aliases, row.tier])).toEqual([
      ["act:p-dm-2", [], "check-in"],
      ["act:p-dm-1", [], "check-in"],
      ["act:r-new", ["act:r-old"], "check-in"],
      ["act:c-red", [], "check-in"],
    ]);
    expect(listed.map((row) => row.key).toSorted()).toEqual(["act:f-finding", "act:p-channel"]);
  });

  it("tallies cards, not acts, per rule, largest first and the class name breaking a tie", () => {
    const rules = settledByStandingRules({
      rows: settledActRowsOf({ acts, board: BOARD, landing: LOADING, placer: ACME_PLACER }),
    });
    expect(rules.map((rule) => [rule.classId, rule.count, rule.anchor])).toEqual([
      ["clear-own-prs", 2, REBASE.anchor],
      ["post-as-owner-in-own-dm", 2, IN_DM.anchor],
    ]);
  });

  it("settles nothing before the ledger has arrived, and tallies nothing from nothing", () => {
    expect(settledActRowsOf({ acts: LOADING, board: BOARD, landing: LOADING, placer: ACME_PLACER })).toEqual([]);
    expect(settledByStandingRules({ rows: [] })).toEqual([]);
  });

  it("places each settled card in its own workspace, as the check-in it replaced would be", () => {
    const settled = settledActRowsOf({ acts, board: BOARD, landing: LOADING, placer: ACME_PLACER });
    expect(settled.map((row) => [row.key, placementFoldKey({ placement: row.placement })])).toEqual([
      ["act:p-dm-2", "placed:team"],
      ["act:p-dm-1", "placed:team"],
      ["act:r-new", "placed:self"],
      ["act:c-red", "placed:self"],
    ]);
  });

  it("draws and counts no settled card while the board its placement joins is still loading", () => {
    expect(settledActRowsOf({ acts, board: BOARD, landing: LOADING, placer: ACME_PLACER }).length).toBe(4);
    expect(settledActRowsOf({ acts, board: LOADING, landing: LOADING, placer: ACME_PLACER })).toEqual([]);
  });

  it("never folds a settled act into a newer one placed in the other workspace", () => {
    const split = readAutonomy([
      entry({ actionId: "new", extra: { classSteer: REBASE }, kind: "rebase", subject: PR }),
      entry({
        actionId: "old",
        extra: { classSteer: REBASE },
        kind: "rebase",
        subject: "https://github.com/acme/acme-admin/pull/1",
      }),
      entry({ actionId: "older", extra: { classSteer: REBASE }, kind: "rebase", subject: PR }),
    ])!;
    const settled = settledActRowsOf({
      acts: ready({ value: split }),
      board: BOARD,
      landing: LOADING,
      placer: ACME_PLACER,
    });
    expect(settled.map((row) => [row.key, row.aliases, placementFoldKey({ placement: row.placement })])).toEqual([
      ["act:new", ["act:older"], "placed:self"],
      ["act:old", [], "placed:team"],
    ]);
  });
});
