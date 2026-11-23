/*
 * What a queue card knows beyond the addresses it carries, from the documents the queue reads to the references
 * its sentences resolve against. A plain-text pull request number or Linear ticket id on a card must resolve to its
 * chip in every case. The step and its ask below are records as the verbs printed them.
 */

import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import { NO_LINEAR_REFERENCES } from "../../components/live/readBoardDocument";
import { NO_RECORD_REFERENCES } from "../../components/live/readRecords";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { cardAddresses } from "../../lib/cardAddresses";
import { attestedNumbers, cardReferences, checkoutsOf } from "../../lib/cardReferences";
import { inlineSegments } from "../../lib/inlineCitations";
import { NO_CARD_PEOPLE } from "../../lib/personMentions";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";
import { stepOf } from "./cardKind";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-26T01:15:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** `hand:steer-booking-subject-16406` as `hand list --json` printed it: no cites, a console page for its url. */
const STEP = {
  context: "work",
  id: "steer-booking-subject-16406",
  postedBy: "workspace:93",
  postedIso: "2026-09-25T10:41:03.326Z",
  unblocks: "the older draft pair getting a fate",
  url: "http://localhost:3000/queue?open=ask%3Aacme-booking-draft-16406",
  what: "Decide 16406, the booking seed draft: take it forward with 16400, rebase it alone, or close it",
  where: "the queue page",
  witness: "slopweaver hand done steer-booking-subject-16406 --did 'picked one'",
};

/** The ask it opens, as `handover list --json` printed it — no pull-request address anywhere, and its repository. */
const ASK = {
  blastRadius: "the value-customer e2e persona in packages/seed-fixtures; no production code",
  kind: "ask",
  lean: "go with whatever you decide on the Playwright two-refs page; 16406 only matters if 16400 goes ahead",
  options: [
    {
      letter: "A",
      option: "take 16400 forward (see the Playwright two-refs page), then rebase 16406 onto staging behind it",
      tradeoff: "two rebases and a re-record of the video, then a DX review ask for each",
    },
    {
      letter: "C",
      option: "close it",
      tradeoff: "the finding that local booking works survives in QQQQ-134 and the video URL, and the seed goes unused",
    },
  ],
  ownerWait: "not-waiting",
  prUrls: [],
  priority: "p3",
  problem: "16406 can't land while its base 16400 is a draft, and nobody has read it in weeks",
  reason: "declared ready",
  repo: "/Users/someone/dev/acme-admin",
  repoSlug: "acme/acme-admin",
  risk: "a wrong seed breaks the local e2e specs that read value-customer's bookings or tasks",
  section: "RUN NOW",
  slug: "acme-booking-draft-16406",
  status: "ready",
  stillReal: "slopweaver github landing shows 16406 as a draft, CONFLICTING",
  stillRealIso: "2026-09-25T10:23:40.890Z",
  summary: "16406 (QQQQ-134, seed a booking subject the local availability step can serve)",
};

/** Another ask, parked on the owner, carrying an acme-admin address — what attests how many digits acme-admin's numbers run to. */
const ATTESTING = {
  ...ASK,
  options: [],
  ownerWait: "owner",
  prUrls: ["https://github.com/acme/acme-admin/pull/17648"],
  problem: undefined,
  question: "Land acme-admin 17648 now?",
  repoSlug: undefined,
  slug: "land-17648",
  status: "waiting-on-owner",
};

const CONTEXT = { linearTeamKeys: ["QQQQ"], linearWorkspaceSlug: "acme" };

function rowsFor({
  asks,
  steps = [STEP],
}: {
  asks: readonly unknown[];
  steps?: readonly unknown[];
}): readonly QueueRow[] {
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: readBoard({ referenceContext: CONTEXT, rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

describe("readBoard's references", () => {
  it("reads each row's repository and the install's Linear workspace", () => {
    const board = readBoard({ referenceContext: CONTEXT, rows: [ASK], unresolved: 0 })!;

    expect(board.rows.map((row) => row.repoSlug)).toEqual(["acme/acme-admin"]);
    expect(board.linear).toEqual({ teamKeys: ["QQQQ"], workspaceSlug: "acme" });
  });

  it("reads a board cut before the field as knowing no Linear facts", () => {
    expect(readBoard({ rows: [], unresolved: 0 })!.linear).toEqual(NO_LINEAR_REFERENCES);
  });

  it("refuses a board whose references will not read", () => {
    expect(readBoard({ referenceContext: { linearTeamKeys: "QQQQ" }, rows: [], unresolved: 0 })).toBeUndefined();
    expect(
      readBoard({ referenceContext: { linearTeamKeys: [], linearWorkspaceSlug: 7 }, rows: [], unresolved: 0 }),
    ).toBeUndefined();
  });
});

describe("an ask's own anchor", () => {
  it("is an address its card resolves against when it is one", () => {
    const anchor = "https://github.com/acme/acme-admin/pull/16406";
    const [row] = rowsFor({ asks: [{ ...ATTESTING, anchor, prUrls: [] }], steps: [] });
    expect(cardAddresses({ row: row })).toEqual([anchor]);
  });
});

describe("cardReferences", () => {
  it("gives the 16406 decision step its ask's repository, the queue's scale and the install's Linear", () => {
    const rows = rowsFor({ asks: [ASK, ATTESTING] });
    const hand = rows.find((row) => row.key === "hand:steer-booking-subject-16406")!;

    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: checkoutsOf({ board: [], rows }),
        attested: attestedNumbers({ board: [], rows }),
        linear: readBoard({ referenceContext: CONTEXT, rows: [], unresolved: 0 })!.linear,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: hand,
      }),
    ).toEqual({
      attested: new Map([["acme/acme-admin", 17648]]),
      boardSlugs: new Set(),
      checkouts: new Set(["acme/acme-admin"]),
      home: "acme/acme-admin",
      linearTeamKeys: ["QQQQ"],
      linearWorkspace: "acme",
      named: [],
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
    });
  });

  it("links every number on the 16406 drawer's title and problem once wired through", () => {
    const rows = rowsFor({ asks: [ASK, ATTESTING] });
    const hand = rows.find((row) => row.key === "hand:steer-booking-subject-16406")!;
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(),
      attested: attestedNumbers({ board: [], rows }),
      linear: { teamKeys: ["QQQQ"], workspaceSlug: "acme" },
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row: hand,
    });
    const cited = [hand.card.question, stepOf({ card: hand.card }).decision!.problem].flatMap((text) =>
      inlineSegments({ references, text }).flatMap((segment) => (segment.kind === "cite" ? [segment.url] : [])),
    );

    expect(cited).toEqual([
      "https://github.com/acme/acme-admin/pull/16406",
      "https://github.com/acme/acme-admin/pull/16400",
      "https://github.com/acme/acme-admin/pull/16406",
      "https://github.com/acme/acme-admin/pull/16400",
    ]);
  });

  it("names the attested repositories an ask's own words name, and not one inside a longer word", () => {
    /** `retire-the-v2-work-console-branch`: a slopweaver checkout whose evidence places the work on acme-admin. */
    const retire = {
      ...ASK,
      lean: "delete, since the one commit past the archive tag (#17594) carries nothing staging or Slopweaver lacks",
      options: [],
      ownerWait: "owner",
      question: "Can I delete v2-ada-owner-work-console from origin?",
      repoSlug: "lachiejames/slopweaver",
      slug: "retire-the-v2-work-console-branch",
      status: "waiting-on-owner",
      stillReal: "git ls-remote shows v2-ada-owner-work-console still on acme/acme-admin at 27cd6c0f",
      summary: "on the queue card for acme-admin-work-console-merge-crossed-the-500-line-doc-budget",
    };
    const rows = rowsFor({ asks: [retire] });
    const row = rows.find((each) => each.key === "ask:retire-the-v2-work-console-branch")!;
    const attested = new Map([
      ["acme/acme-admin", 17926],
      ["lachiejames/slopweaver", 1309],
    ]);
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(),
      attested,
      linear: NO_LINEAR_REFERENCES,
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row,
    });

    expect(references.named).toEqual(["acme/acme-admin", "lachiejames/slopweaver"]);
    expect(inlineSegments({ references, text: retire.lean }).filter((segment) => segment.kind === "cite")).toEqual([
      { kind: "cite", label: "#17594", url: "https://github.com/acme/acme-admin/pull/17594" },
    ]);
    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested,
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: { ...row, hint: "" },
      }).named,
    ).toEqual(["acme/acme-admin", "lachiejames/slopweaver"]);
    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested,
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: rowsFor({
          asks: [{ ...retire, lean: undefined, stillReal: "on v2", summary: "acme-admin-work-console" }],
        }).find((each) => each.key === "ask:retire-the-v2-work-console-branch")!,
      }).named,
    ).toEqual([]);
  });

  it("names a repository the queue has no address for, so a number never falls back past it", () => {
    const migration = {
      ...ASK,
      options: [],
      ownerWait: "owner",
      question: "Which migration goes first?",
      repoSlug: "acme/home",
      slug: "migration-for-another-org",
      status: "waiting-on-owner",
      summary: "Migration for other-org/unattested#12. See #16406, and site/lib/cardReferences.ts",
    };
    const row = rowsFor({ asks: [migration] }).find((each) => each.key === "ask:migration-for-another-org")!;
    const attested = new Map([
      ["acme/home", 1324],
      ["foo/large", 17648],
    ]);
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(["acme/home", "foo/large"]),
      attested,
      linear: NO_LINEAR_REFERENCES,
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row,
    });

    expect(references.named).toEqual(["other-org/unattested"]);
    expect(
      [
        "Migration for other-org/unattested PR 12",
        "https://github.com/other-org/unattested/tree/main",
        "acme/tools",
      ].map(
        (summary) =>
          cardReferences({
            boardSlugs: new Set(),
            checkouts: new Set(),
            attested,
            linear: NO_LINEAR_REFERENCES,
            people: NO_CARD_PEOPLE,
            records: NO_RECORD_REFERENCES,
            row: rowsFor({ asks: [{ ...migration, summary }] }).find(
              (each) => each.key === "ask:migration-for-another-org",
            )!,
          }).named,
      ),
    ).toEqual([["other-org/unattested"], ["other-org/unattested"], ["acme/tools"]]);
    expect(
      inlineSegments({ references, text: migration.summary }).filter((segment) => segment.kind === "cite"),
    ).toEqual([
      { kind: "cite", label: "other-org/unattested#12", url: "https://github.com/other-org/unattested/pull/12" },
    ]);
    expect(
      inlineSegments({ references: { ...references, named: [] }, text: "See #16406" }).filter(
        (segment) => segment.kind === "cite",
      ),
    ).toEqual([{ kind: "cite", label: "#16406", url: "https://github.com/foo/large/pull/16406" }]);
  });

  it("gives a row with no repository of its own the one repository its addresses share, and none for two", () => {
    const one = rowsFor({ asks: [ATTESTING] }).find((row) => row.key === "ask:land-17648")!;
    const two = rowsFor({
      asks: [{ ...ATTESTING, prUrls: [...ATTESTING.prUrls, "https://github.com/lachiejames/slopweaver/pull/1324"] }],
    }).find((row) => row.key === "ask:land-17648")!;

    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested: new Map(),
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: one,
      }).home,
    ).toBe("acme/acme-admin");
    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested: new Map(),
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: two,
      }).home,
    ).toBeUndefined();
  });

  it("gives a row whose only GitHub address is an issue that issue's repository", () => {
    const row = rowsFor({
      asks: [{ ...ATTESTING, prUrls: ["https://github.com/acme/acme-admin/issues/42"] }],
    }).find((each) => each.key === "ask:land-17648")!;
    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested: new Map(),
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row,
      }).home,
    ).toBe("acme/acme-admin");
  });
});

describe("the #dev-team draft's drawer", () => {
  /** `post:sd-a0615cb5` as `slack draft list --json` printed it: a Linear key and a PR number, no Linear address. */
  const DRAFTS = {
    items: [
      {
        draft: {
          advisory: [],
          authorId: "U0SYN000001",
          channel: "C0SYN000002",
          channelName: "dev-team",
          digest: "4ea0be976e7106c822c5a718d24341b3",
          id: "sd-a0615cb5",
          mentions: [],
          payload: {
            text: "hey all, heads up that the local E2Es are about to run on every PR\n\n<https://github.com/acme/acme-admin/pull/17941|ci(QQQQ-178): run the advisory local E2E suite on every PR #17941>",
          },
          shape: "top-level",
          tsIso: "2026-09-26T03:27:24.834Z",
          why: "QQQQ-178: tell engineering the local E2Es now run on every PR (advisory), before 17941 merges",
        },
        id: "sd-a0615cb5",
        release: {
          command: "slopweaver slack post --as me --draft sd-a0615cb5 --approve 4ea0be976e7106c822c5a718d24341b3",
          kind: "send",
        },
        state: "held",
      },
    ],
    people: [],
  };

  // A hovered pull request number showed its chip while the Linear key beside it did not.
  it("links QQQQ-178 to its Linear issue beside 17941 once the board carries the install's Linear", () => {
    const board = readBoard({ referenceContext: CONTEXT, rows: [], unresolved: 0 })!;
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: board }),
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: ready({ value: readParkedDrafts(DRAFTS)! }),
      reviews: LOADING,
      imports: LOADING,
    });
    const post = rows.find((row) => row.key === "post:sd-a0615cb5")!;
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(),
      attested: attestedNumbers({ board: board.rows, rows }),
      linear: board.linear,
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row: post,
    });
    const cited = inlineSegments({
      known: cardAddresses({ row: post }),
      references,
      text: post.card.what!.whole,
    }).filter((segment) => segment.kind === "cite");

    expect(cited).toEqual([
      { kind: "cite", label: "QQQQ-178", url: "https://linear.app/acme/issue/QQQQ-178" },
      { kind: "cite", label: "17941", url: "https://github.com/acme/acme-admin/pull/17941" },
    ]);
  });

  it("leaves QQQQ-178 words and still links 17941 on a board cut without the install's Linear", () => {
    const board = readBoard({ rows: [], unresolved: 0 })!;
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: board }),
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: ready({ value: readParkedDrafts(DRAFTS)! }),
      reviews: LOADING,
      imports: LOADING,
    });
    const post = rows.find((row) => row.key === "post:sd-a0615cb5")!;
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(),
      attested: attestedNumbers({ board: board.rows, rows }),
      linear: board.linear,
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row: post,
    });
    const cited = inlineSegments({
      known: cardAddresses({ row: post }),
      references,
      text: post.card.what!.whole,
    }).filter((segment) => segment.kind === "cite");

    expect(cited).toEqual([{ kind: "cite", label: "17941", url: "https://github.com/acme/acme-admin/pull/17941" }]);
  });
});

describe("cardReferences for a step naming no repository", () => {
  /** `hand:try-voice-relay-steer`: a number, no address, no ask — only the context it states. */
  const RELAY = {
    context: "slopweaver",
    id: "try-voice-relay-steer",
    postedBy: "workspace:12",
    postedIso: "2026-09-25T08:00:00.000Z",
    unblocks: "your read on the relay fix from 1262",
    what: "Start a voice call and say one steer out loud",
    where: "the console",
    witness: "slopweaver hand done try-voice-relay-steer --did 'said one'",
  };
  const attested = new Map([
    ["acme/acme-admin", 17648],
    ["lachiejames/slopweaver", 1324],
  ]);

  it("homes a step stating the slopweaver context on the one attested slopweaver repository", () => {
    const row = rowsFor({ asks: [], steps: [RELAY] }).find((each) => each.key === "hand:try-voice-relay-steer")!;
    const references = cardReferences({
      boardSlugs: new Set(),
      checkouts: new Set(),
      attested,
      linear: NO_LINEAR_REFERENCES,
      people: NO_CARD_PEOPLE,
      records: NO_RECORD_REFERENCES,
      row,
    });

    expect(references.home).toBe("lachiejames/slopweaver");
    expect(
      inlineSegments({ known: [], references, text: RELAY.unblocks }).filter((segment) => segment.kind === "cite"),
    ).toEqual([{ kind: "cite", label: "1262", url: "https://github.com/lachiejames/slopweaver/pull/1262" }]);
  });

  it("homes no step whose only word for its workspace is its prose — words never place a row", () => {
    const { context: _stated, ...unstated } = RELAY;
    const placed = { ...unstated, where: "the slopweaver console" };
    const rowOf = (step: unknown): QueueRow =>
      rowsFor({ asks: [], steps: [step] }).find((each) => each.key === "hand:try-voice-relay-steer")!;

    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested,
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: rowOf(placed),
      }).home,
    ).toBeUndefined();
    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested,
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row: rowOf(unstated),
      }).home,
    ).toBeUndefined();
  });

  it("gives a work-context step no home, since that context covers more than one repository", () => {
    const row = rowsFor({ asks: [], steps: [{ ...RELAY, context: "work" }] }).find(
      (each) => each.key === "hand:try-voice-relay-steer",
    )!;

    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested,
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row,
      }).home,
    ).toBeUndefined();
  });

  it("gives a slopweaver-context step no home when no slopweaver address attests the repository", () => {
    const row = rowsFor({ asks: [], steps: [RELAY] }).find((each) => each.key === "hand:try-voice-relay-steer")!;

    expect(
      cardReferences({
        boardSlugs: new Set(),
        checkouts: new Set(),
        attested: new Map([["acme/acme-admin", 17648]]),
        linear: NO_LINEAR_REFERENCES,
        people: NO_CARD_PEOPLE,
        records: NO_RECORD_REFERENCES,
        row,
      }).home,
    ).toBeUndefined();
  });
});

describe("attestedNumbers", () => {
  it("keeps the largest number per repository across every row", () => {
    const rows = rowsFor({
      asks: [ATTESTING, { ...ATTESTING, prUrls: ["https://github.com/acme/acme-admin/pull/16000"], slug: "x" }],
    });

    expect(attestedNumbers({ board: [], rows })).toEqual(new Map([["acme/acme-admin", 17648]]));
  });

  it("counts a board row's addresses when the queue carries none for that repository", () => {
    const landed = {
      ...ATTESTING,
      ownerWait: "not-waiting",
      prUrls: ["https://github.com/lachiejames/slopweaver/pull/1309"],
      question: undefined,
      slug: "landed-1309",
      status: "done",
    };
    const board = readBoard({ referenceContext: CONTEXT, rows: [landed], unresolved: 0 })!.rows;

    expect(attestedNumbers({ board, rows: rowsFor({ asks: [ATTESTING] }) })).toEqual(
      new Map([
        ["acme/acme-admin", 17648],
        ["lachiejames/slopweaver", 1309],
      ]),
    );
  });

  it("is empty for no rows", () => {
    expect(attestedNumbers({ board: [], rows: [] }).size).toBe(0);
  });
});

describe("checkoutsOf", () => {
  it("reads every checkout a board row or queue ask names, and never a repository its prose quotes", () => {
    const quoting = {
      ...ATTESTING,
      prUrls: ["https://github.com/acme/widgets/pull/42"],
      repoSlug: "LachieJames/Slopweaver",
      slug: "a-pull-address-path-keeps-rfc-3986-sub-delims",
    };
    const board = readBoard({ referenceContext: CONTEXT, rows: [quoting], unresolved: 0 })!.rows;

    expect(checkoutsOf({ board, rows: rowsFor({ asks: [ASK, ATTESTING] }) })).toEqual(
      new Set(["lachiejames/slopweaver", "acme/acme-admin"]),
    );
    expect(attestedNumbers({ board, rows: [] }).has("acme/widgets")).toBe(true);
  });

  it("is empty for no rows", () => {
    expect(checkoutsOf({ board: [], rows: [] }).size).toBe(0);
  });
});
