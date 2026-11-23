/*
 * The judgment register's order. The property: a pull request whose only missing fact is the owner's word naming a
 * reviewer is drawn FIRST, as the question for that word, ahead of every row the verb refused to dispatch (that
 * draft sits at the top of the owner's queue), unless the verb dispatched it as `draft-first-review-ask`, when the
 * draft its session parks is the one card, or the reviewer reading shows the owner already picked one, when the ask
 * the approval parked is. Driven through the real readers, so a `humanWait` or a
 * `picked` hook a reader drops cannot pass here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readLandingReading } from "../../components/live/readLanding";
import { type Reviewers, readReviewers } from "../../components/live/readReviewers";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";
import { briefingOf } from "./cardKind";

const FIXTURE = fileURLToPath(new URL("../../fixtures/landing-reading/2026-09-20.json", import.meta.url));

/** A register that has not arrived. */
const LOADING = { phase: "loading" } as const;

/** The wait the verb publishes on a row only the owner's word can move. */
const NAMING = {
  next: "name-the-reviewer",
  requestedAtIso: "2026-09-19T23:43:00Z",
  sentence: "Waiting on @acme/platform · requested 2026-09-19 23:43Z · no ask found · stale",
  stale: "yes",
  who: ["@acme/platform"],
};

/** CodeRabbit's thread counts on a row, all zero but what the case sets. */
const BOT_THREADS = { answeredOpen: 0, awaitingUs: 0, open: 1, reviewerLastWord: 0, resolved: 0 };

/**
 * The fixture reading with a first pull request (no verdict) and a second (a needs-judgment verdict) waiting only on the
 * owner's word.
 *
 * @param botAwaiting CodeRabbit also awaits an answer on the first pull request, which makes its provenance the bot's
 * @param firstAsk the verb dispatched the first pull request as `draft-first-review-ask`, so its session drafts the ask, or a
 *   discussion opener where nothing agreed the change and it is no obvious bug
 * @param selection the document's own `selection`; the fixture predates the field
 * @param twinRepo a second repository whose own open pull request of the same number the reading also lists
 * @param renumber939 a number the reading carries in place of the third pull request's, to feed a malformed one
 */
function landing({
  botAwaiting = false,
  firstAsk = false,
  renumber939,
  selection,
  twinRepo,
}: {
  botAwaiting?: boolean;
  firstAsk?: boolean;
  renumber939?: number;
  selection?: Record<string, unknown>;
  twinRepo?: string;
} = {}): LiveState<NonNullable<ReturnType<typeof readLandingReading>>> {
  const reading = JSON.parse(readFileSync(FIXTURE, "utf8")) as { document: { rows: Record<string, unknown>[] } };
  const awaitingUs = botAwaiting ? 1 : 0;
  const twins = reading.document.rows
    .filter((row) => twinRepo !== undefined && row["number"] === 943)
    .map((row): Record<string, unknown> => ({ ...row, repoSlug: twinRepo }));
  const rows = [...reading.document.rows, ...twins].map((row) => ({
    ...row,
    ...(renumber939 !== undefined && row["number"] === 939 && { number: renumber939 }),
    conversations:
      row["number"] === 943
        ? { ...(row["conversations"] as Record<string, unknown>), codeRabbit: { ...BOT_THREADS, awaitingUs } }
        : row["conversations"],
    authorLogin: "acme-owner",
    createdAtIso: "2026-09-19T00:00:00Z",
    humanWait: row["number"] === 943 || row["number"] === 942 ? NAMING : undefined,
    ...(firstAsk && row["number"] === 943
      ? { dispatch: { verdict: "draft-first-review-ask", why: "nobody asked" } }
      : {}),
  }));
  return {
    fixture: undefined,
    observedAtIso: "2026-09-20T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: readLandingReading({
      ...reading,
      document: { ...reading.document, rows, ...(selection && { selection }) },
    })!,
  };
}

/** Every register but the landing reading still loading. */
function onlyLanding({
  renumber939,
  selection,
  twinRepo,
}: {
  renumber939?: number;
  selection: Record<string, unknown>;
  twinRepo?: string;
}): Parameters<typeof rowsOf>[0] {
  return {
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: landing({
      selection,
      ...(twinRepo !== undefined && { twinRepo }),
      ...(renumber939 !== undefined && { renumber939 }),
    }),
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  };
}

describe("a landing reading that is not the owner's pull requests", () => {
  const REPOS = ["acme/slopweaver"];

  it("draws no card off an every-author reading — a bump seat's put a colleague's pull request on the Queue", () => {
    expect(rowsOf(onlyLanding({ selection: { includeDrafts: false, repos: REPOS } }))).toStrictEqual([]);
  });

  it("draws no card off a reading taken over a colleague's login", () => {
    const selection = { author: "acme-colleague", includeDrafts: false, repos: REPOS };
    expect(rowsOf(onlyLanding({ selection }))).toStrictEqual([]);
  });

  it("draws every card off an @me reading, whatever its case", () => {
    const selection = { author: "@ME", includeDrafts: true, repos: REPOS };
    expect(rowsOf(onlyLanding({ selection })).map((row) => row.id)).toStrictEqual([
      "acme.slopweaver.943",
      "acme.slopweaver.942",
      "acme.slopweaver.939",
    ]);
  });

  it("draws two repositories' same-numbered pull request as two cards, each keyed by its own repository — never one shared key", () => {
    const selection = { author: "@me", includeDrafts: true, repos: [...REPOS, "acme/acme-admin"] };
    const keys = rowsOf(onlyLanding({ selection, twinRepo: "acme/acme-admin" })).map((row) => row.key);
    expect(keys.toSorted()).toStrictEqual([
      "pr:acme.acme-admin.943",
      "pr:acme.slopweaver.939",
      "pr:acme.slopweaver.942",
      "pr:acme.slopweaver.943",
    ]);
  });

  it("draws no card for a row whose number would mint another pull request's key", () => {
    // `939.5` in acme/slopweaver would key as pr:acme.slopweaver.939.5 — acme/slopweaver.939's #5.
    const selection = { author: "@me", includeDrafts: true, repos: REPOS };
    const keys = rowsOf(onlyLanding({ renumber939: 939.5, selection })).map((row) => row.key);
    expect(keys.toSorted()).toStrictEqual(["pr:acme.slopweaver.942", "pr:acme.slopweaver.943"]);
  });
});

describe("the judgment register", () => {
  it("draws the rows waiting on the owner's reviewer's name first, each once, then the verb's refusals", () => {
    // The reviewer reading unread: the landing reading's wait is all there is, and every naming card draws.
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing(),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      standing: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(rows.map((row) => [row.id, row.pill])).toStrictEqual([
      ["acme.slopweaver.943", "name-the-reviewer"],
      ["acme.slopweaver.942", "name-the-reviewer"],
      ["acme.slopweaver.939", "conflicting"],
    ]);
    expect(rows[0].card.question).toBe(
      "Who on @acme/platform should review #943 Synthetic pull request 003 about codebase structure?",
    );
    expect(rows[0].card.subject).toBe("acme/slopweaver#943");
    expect(briefingOf({ card: rows[0].card }).lean).toBe(`github landing says name the reviewer: ${NAMING.sentence}`);
    expect(briefingOf({ card: rows[2].card }).lean).toContain("github landing says conflicting");
  });

  it("keeps a naming row team-facing when CodeRabbit also awaits it, outside the work context", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing({ botAwaiting: true }),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      standing: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(rows.map((row) => [row.id, row.provenance, row.tier])).toStrictEqual([
      ["acme.slopweaver.943", "bot", "team-blocked"],
      ["acme.slopweaver.942", "team", "team-blocked"],
      ["acme.slopweaver.939", "team", "team-blocked"],
    ]);
  });

  it("draws a first-ask row as the one draft its session parked, never also as a naming card", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing({ firstAsk: true }),
      placer: ACME_PLACER,
      posts: {
        fixture: undefined,
        observedAtIso: "2026-09-20T12:00:00.000Z",
        phase: "ready",
        stampedByRoute: false,
        value: firstAskPosts(),
      },
      reviewers: LOADING,
      standing: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(rows.map((row) => [row.kind, row.id, row.pill])).toStrictEqual([
      ["post", "sd-943first", "posts as you"],
      ["pr", "acme.slopweaver.942", "name-the-reviewer"],
      ["pr", "acme.slopweaver.939", "conflicting"],
    ]);
  });

  it("draws no naming card on a row whose reviewer the owner already picked", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing(),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: reviewers({ hooks: { 943: PICKED } }),
      reviews: LOADING,
      imports: LOADING,
      standing: LOADING,
    });
    expect(rows.map((row) => [row.id, row.pill])).toStrictEqual([
      ["acme.slopweaver.942", "name-the-reviewer"],
      ["acme.slopweaver.939", "conflicting"],
    ]);
  });

  it("draws a picked row the verb refused as that refusal, under the verb's action", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing(),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: reviewers({ hooks: { 942: PICKED } }),
      reviews: LOADING,
      imports: LOADING,
      standing: LOADING,
    });
    expect(rows.map((row) => [row.id, row.pill])).toStrictEqual([
      ["acme.slopweaver.943", "name-the-reviewer"],
      ["acme.slopweaver.942", "conflicting"],
      ["acme.slopweaver.939", "conflicting"],
    ]);
    expect(briefingOf({ card: rows[1].card }).lean).toContain("github landing says conflicting");
  });

  it("keeps the naming card while the reviewer reading holds no pick on the row", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: landing(),
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: reviewers({ hooks: { 942: PICKED, 943: { kind: "nobody-asked" } } }),
      reviews: LOADING,
      imports: LOADING,
      standing: LOADING,
    });
    expect(rows.map((row) => [row.id, row.pill])).toStrictEqual([
      ["acme.slopweaver.943", "name-the-reviewer"],
      ["acme.slopweaver.942", "conflicting"],
      ["acme.slopweaver.939", "conflicting"],
    ]);
  });
});

/** The reviewer reading's hook once the owner approved a suggested reviewer and no ask to them is seen since. */
const PICKED = { atIso: "2026-09-20T11:30:00.000Z", kind: "picked", reviewer: "U0SYN0101" };

/**
 * The reviewer reading, read by the real reader so a `picked` hook the reader drops cannot pass here.
 *
 * @param hooks each pull request's hook, by number
 */
function reviewers({ hooks }: { hooks: Record<number, Record<string, string>> }): LiveState<Reviewers> {
  const value = readReviewers({
    observedAtIso: "2026-09-20T12:00:00.000Z",
    people: { U0SYN0101: "Rowan" },
    readingId: "2026-09-20",
    registerAsks: 0,
    rows: Object.entries(hooks).map(([number, hook]) => ({
      hook,
      number: Number(number),
      repoSlug: "acme/slopweaver",
    })),
  });
  if (value === undefined) {
    throw new Error("the fixture reviewer reading did not read");
  }
  return {
    fixture: undefined,
    observedAtIso: "2026-09-20T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/**
 * The drafts register once the first pull request's dispatched session, finding the discussion that agreed the change,
 * has drafted the first review ask and parked it for the owner's yes
 * with `slack draft record`: one parked post, carrying the exact message and where it would go.
 */
function firstAskPosts(): readonly ParkedDraft[] {
  const parked = readParkedDrafts({
    items: [
      {
        draft: {
          advisory: [],
          authorId: "U0SYN000005",
          channel: "D0SYN0101",
          digest: "5b1e0c7d9a2f4e63",
          mentions: [{ key: "U0SYN0101", kind: "person", target: "U0SYN0101" }],
          payload: {
            text: "<@U0SYN0101> #943 is ready for a review — the codebase structure change is ready.",
          },
          shape: "top-level",
          tsIso: "2026-09-20T11:00:00.000Z",
          why: "the first review ask on #943",
        },
        id: "sd-943first",
        release: {
          command: "slopweaver slack post --as me --draft sd-943first --approve 5b1e0c7d9a2f4e63",
          kind: "send",
        },
        state: "held",
      },
    ],
    people: [{ bot: false, handle: "rowan.example", name: "Rowan", nativeId: "U0SYN0101" }],
  });
  if (parked === undefined) {
    throw new Error("the fixture drafts register did not read");
  }
  return parked;
}
