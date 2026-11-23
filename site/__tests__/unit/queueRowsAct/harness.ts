/*
 * The ledger, board and landing documents the act-row test files share, each read through its real reader, and the
 * act rows `rowsOf` joins from them. They moved here when `queueRowsAct.test.ts` was split by what each file proves:
 * an act's links, a finding act's looked-up pull request, and a pattern of finding acts.
 */
import { type Board, readBoard } from "../../../components/live/read";
import { type AutonomyRow, readAutonomy } from "../../../components/live/readAutonomy";
import { type LandingReading, readLandingReading } from "../../../components/live/readLanding";
import type { LiveState } from "../../../components/live/useLive";
import type { ActCardForm } from "../../../lib/queueActRow";
import { ACT_BOARD_SUBJECT } from "../../../lib/queueCardActLinks";
import { type QueueRow, rowsOf } from "../../../lib/queueRows";
import { ACME_PLACER } from "../../organisationFixture";
import { briefingOf } from "../cardKind";

/** A live read still in flight, for every source a case does not set. */
export const LOADING = { phase: "loading" } as const;
/** The finding's board slug, which is also the branch its pull request was opened from. */
export const SLUG = "the-bot-s-own-posts-into-the-ada";
/** The address every pull request here shares up to its number. */
export const PULL_BASE = "https://github.com/lachiejames/slopweaver/pull/";
/** The pull request the settled board row names. */
export const PR = `${PULL_BASE}6`;
/** The open pull request on the finding's branch in the owner's landing reading. */
export const PR_OPEN = `${PULL_BASE}7`;
/** What a finding card says before its lookup has read the pull request. */
export const PENDING = {
  kind: "refused",
  why: `The pull request opened from branch ${SLUG} is read when this card opens; until then there is nothing to draw.`,
} as const;
/** An act's links with neither notice, for a case that sets the links itself. */
export const ACT_LINKED = { boardNotice: undefined, kind: "linked", landingNotice: undefined } as const;
/** The notice an act's links carry while the board is still loading. */
export const BOARD_LOADING = { read: { phase: "loading" }, subject: ACT_BOARD_SUBJECT };

/**
 * A live read that has landed.
 *
 * @returns the value, stamped as read at one fixed instant
 */
export function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-23T08:40:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/**
 * The finding act as the ledger printed it, one steered act beside it.
 *
 * @returns the read ledger rows
 */
export function acts(): readonly AutonomyRow[] {
  const read = readAutonomy([
    {
      action: {
        actionId: "finding-pr.the-bot-s-own-posts-into-the-ada",
        doneIso: "2026-09-22T11:00:00.000Z",
        kind: "open-internal-finding-pull-request",
        run: SLUG,
        said: "I opened a pull request for a problem the fleet found itself.",
        subject: SLUG,
        why: "an unruled fleet finding",
        witness: "open a pull request on main: finding gate",
      },
    },
    {
      action: {
        actionId: "steered-one",
        doneIso: "2026-09-22T10:00:00.000Z",
        kind: "press-merge-when-ready",
        subject: PR,
        why: "green",
      },
      latestSteer: { steer: "right call" },
    },
  ]);
  if (read === undefined) {
    throw new Error("the fixture ledger did not read");
  }
  return read;
}

/**
 * The board as `handover list --json` published it, the finding's row settled and naming its pull request.
 *
 * @returns the read board
 */
export function board(): Board {
  const read = readBoard({
    rows: [
      {
        kind: "ask",
        ownerWait: "settled",
        prUrls: [PR],
        reason: `merged ${PR}`,
        section: "DONE",
        slug: SLUG,
        status: "done",
      },
    ],
    unresolved: 0,
  });
  if (read === undefined) {
    throw new Error("the fixture board did not read");
  }
  return read;
}

/**
 * The owner's open pull requests as `reading last --producer "github landing" --json` printed them, one on the finding's slug.
 *
 * @returns the read landing reading
 */
export function landing(): LandingReading {
  const read = readLandingReading({
    by: "sync-now",
    document: {
      residue: [],
      rows: [
        {
          action: "blocked-on",
          actionDetail: "waiting on a review",
          authorLogin: "octocat",
          baseRefName: "main",
          blockedOn: [],
          boardRow: { kind: "none-declared", why: "no handover row declares this branch" },
          ci: "green",
          conversations: { codeRabbit: { awaitingUs: 0, open: 0 }, humans: { awaitingUs: 0, open: 0 } },
          createdAtIso: "2026-09-26T09:45:00.000Z",
          failingChecks: [],
          headOid: "abc",
          headRefName: SLUG,
          labels: [],
          number: 7,
          openThreads: [],
          repoSlug: "lachiejames/slopweaver",
          slack: { asked: "unknown" },
          stack: { stacked: false },
          tests: [{ id: "undrafted", verdict: "pass", why: "not a draft" }],
          title: "No Codex Slopweaver starts can launch the ChatGPT app's browser",
          updatedAtIso: "2026-09-26T11:00:00.000Z",
          url: PR_OPEN,
        },
      ],
      tally: { byAction: [{ action: "blocked-on", count: 1 }], ready: 0, total: 1 },
    },
    observedAtIso: "2026-09-26T11:00:00.000Z",
    readingId: "r1",
    recordedAtIso: "2026-09-26T11:00:00.000Z",
  });
  if (read === undefined) {
    throw new Error("the fixture landing reading did not read");
  }
  return read;
}

/**
 * The owner's landing reading once the finding's pull request has merged: no open pull request of theirs at all.
 *
 * @returns the read landing reading
 */
export function mergedLanding(): LandingReading {
  const read = readLandingReading({
    by: "sync-now",
    document: { residue: [], rows: [], tally: { byAction: [], ready: 0, total: 0 } },
    observedAtIso: "2026-09-26T12:00:00.000Z",
    readingId: "r2",
    recordedAtIso: "2026-09-26T12:00:00.000Z",
  });
  if (read === undefined) {
    throw new Error("the fixture landing reading did not read");
  }
  return read;
}

/**
 * The act rows `rowsOf` yields for this board and landing state.
 *
 * @returns the act rows alone
 */
export function actRows({
  boardState,
  landingState = LOADING,
}: {
  boardState: LiveState<Board>;
  landingState?: LiveState<LandingReading>;
}): readonly QueueRow[] {
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: ready({ value: acts() }),
    board: boardState,
    drafts: LOADING,
    hands: LOADING,
    landing: landingState,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  }).filter((row) => row.kind === "act");
}

/**
 * The act row's card form, refusing any other register.
 *
 * @returns the act's card form
 */
export function formOf({ row }: { row: QueueRow }): ActCardForm {
  if (row.record.kind !== "act") {
    throw new Error(`${row.key} is not an act row`);
  }
  return row.record.form;
}

/**
 * The drawn stakes' pull-request status, refusing any other stakes.
 *
 * @returns the status in words
 */
export function statusOf({ row }: { row: QueueRow }): string {
  const stakes = briefingOf({ card: row.card }).stakes;
  if (stakes?.kind !== "pull-request") {
    throw new Error(`${row.key} draws no pull-request stakes`);
  }
  return stakes.status;
}
