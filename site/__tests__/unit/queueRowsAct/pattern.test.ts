/*
 * A pattern of finding acts on one queue card: one row for every act sharing its plain-words line, drawn from the
 * newest act's looked-up pull request and naming it the newest of the pattern.
 */

import { describe, expect, it } from "vitest";

import { readAutonomy } from "../../../components/live/readAutonomy";
import type { ReadPullRequest } from "../../../lib/findingActCard";
import { withLookedUpPull } from "../../../lib/queueActRow";
import { type QueueRow, rowsOf } from "../../../lib/queueRows";
import { ACME_PLACER } from "../../organisationFixture";
import { briefingOf } from "../cardKind";
import { LOADING, mergedLanding, PENDING, PULL_BASE, ready, SLUG } from "./harness";

// A 64-subject finding card that draws only the constant plain-words line and a link leaves the owner unable to tell what problem
// it found or why it matters until they read the pull request on GitHub, so the card draws the newest one's own words.
describe("a pattern of finding acts, which all share one plain-words line", () => {
  const OLDER = "an-older-finding-branch";
  const SAID = "I opened a pull request for a problem the fleet found itself.";
  const NEWEST_PULL: ReadPullRequest = {
    boardRowSlug: undefined,
    form: {
      blastRadius: "`slopweaver hand post` only.",
      kind: "parsed",
      problem: "Asked where to start, the voice led with a dogfood step.",
      risk: "Low risk. One refusal added to `hand post`.",
    },
    headRefName: SLUG,
    mergedAt: "2026-09-29T02:00:00Z",
    number: 5,
    readAtIso: "2026-09-29T03:00:00.000Z",
    repoSlug: "lachiejames/slopweaver",
    state: "merged",
    title: "A hand step states whether it blocks work or is a check-in",
    url: `${PULL_BASE}5`,
  };

  /** The pattern's one row: the newest finding on {@link SLUG}, an older one on another branch, one said. */
  function patternRow(): QueueRow {
    const read = readAutonomy(
      [SLUG, OLDER].map((branch, at) => ({
        action: {
          actionId: `finding-pr.${branch}`,
          doneIso: `2026-09-2${String(9 - at)}T02:00:00.000Z`,
          kind: "open-internal-finding-pull-request",
          run: branch,
          said: SAID,
          subject: branch,
          why: "an unruled fleet finding",
        },
      })),
    );
    if (read === undefined) {
      throw new Error("the fixture ledger did not read");
    }
    const rows = rowsOf({
      acts: ready({ value: read }),
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: ready({ value: mergedLanding() }),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      standing: LOADING,
      reviews: LOADING,
      imports: LOADING,
    }).filter((row) => row.kind === "act");
    expect(rows.length).toBe(1);
    return rows[0];
  }

  it("is one card that looks its newest act's pull request up, and waits on it", () => {
    const row = patternRow();
    expect([row.card.subject, row.record]).toEqual([
      "2 subjects",
      { ...row.record, form: PENDING, lookupBranch: SLUG, subjects: [SLUG, OLDER] },
    ]);
  });

  it("draws the newest pull request's Problem, Risk and Blast radius, naming it the newest of the pattern", () => {
    const drawn = withLookedUpPull({
      lookup: { branch: SLUG, phase: "ready", pulls: [NEWEST_PULL], unchecked: 0 },
      row: patternRow(),
    });
    const card = briefingOf({ card: drawn.card });
    expect([drawn.card.subject, drawn.card.question, card.what!.whole, card.problem]).toEqual([
      "2 subjects",
      "Was open internal finding pull request on these 2 subjects the right call?",
      "2 subjects: the newest, #5, merged: A hand step states whether it blocks work or is a check-in. The fleet opened it without asking, on a problem it found itself: Asked where to start, the voice led with a dogfood step.",
      "Asked where to start, the voice led with a dogfood step.",
    ]);
    expect(card.stakes).toEqual({
      blastRadius: "`slopweaver hand post` only.",
      checkedIso: "2026-09-29T03:00:00.000Z",
      kind: "pull-request",
      risk: "Low risk. One refusal added to `hand post`.",
      status: "merged",
    });
    expect(drawn.record.form).toEqual({ kind: "drawn" });
  });

  it("still names the pull request the newest when its blank Risk leaves the card a problem and no stakes", () => {
    const blankRisk: ReadPullRequest = {
      ...NEWEST_PULL,
      form: { ...NEWEST_PULL.form, risk: " " } as ReadPullRequest["form"],
    };
    const drawn = withLookedUpPull({
      lookup: { branch: SLUG, phase: "ready", pulls: [blankRisk], unchecked: 0 },
      row: patternRow(),
    });
    const card = briefingOf({ card: drawn.card });
    expect([card.stakes, card.what!.whole]).toEqual([
      undefined,
      "2 subjects: the newest, #5, merged: A hand step states whether it blocks work or is a check-in. The fleet opened it without asking, on a problem it found itself: Asked where to start, the voice led with a dogfood step.",
    ]);
  });

  it("keeps the pattern's count on a card its lookup refuses", () => {
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "loading" }, row: patternRow() });
    expect([drawn.card.subject, drawn.card.what!.whole]).toEqual(["2 subjects", `2 subjects: ${SAID}`]);
  });
});
