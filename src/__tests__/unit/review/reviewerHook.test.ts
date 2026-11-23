/*
 * Who a pull request is on the hook with, and who to suggest when nobody usefully is: the fixed hook order,
 * the three suggestion tiers, every exclusion, and the reading the verb takes both from.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { LandingAsk } from "../../../review/askTrail.js";
import { reviewErrorLines } from "../../../review/errors.js";
import { reviewHookOf } from "../../../review/reviewerHook.js";
import { type ReviewerReadingRow, reviewerReadingOf } from "../../../review/reviewerReading.js";
import type { ReviewerAskedRow, ReviewerPickRow } from "../../../review/reviewerRegister.js";
import { suggestReviewer, wantsSuggestion } from "../../../review/reviewerSuggest.js";

const NEWEST: LandingAsk = {
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-alerts",
  isDirectMessage: false,
  leg: "corpus",
  messageKey: "C1:2",
  permalink: "https://acme.slack.com/archives/C1/p2",
  recipients: ["U0ROSA", "S0GROUP"],
};

/** A row as the reading carries it, with `over` laid on top. */
function row({ over = {} }: { over?: Partial<ReviewerReadingRow> } = {}): ReviewerReadingRow {
  return {
    askTrail: [],
    authorLogin: "OctoCat",
    blockedOn: ["@acme/security"],
    bump: undefined,
    draft: false,
    number: 17012,
    repoSlug: "acme/acme-admin",
    slackAsked: "no",
    slackWhy: "",
    stacked: false,
    title: "bump fast-xml-parser",
    url: "https://github.com/acme/acme-admin/pull/17012",
    ...over,
  };
}

/** A pick on a pull request at `atIso`. */
function pick({
  atIso,
  verdict,
  reviewer = "U0PRANAV",
}: {
  atIso: string;
  verdict: "approve" | "decline";
  reviewer?: string;
}): ReviewerPickRow {
  const base = {
    atIso,
    bySession: "work-console",
    kind: "pick",
    number: 17012,
    prKey: "acme/acme-admin#17012",
    repoSlug: "acme/acme-admin",
    reviewer,
    schema: 1,
  } as const;
  if (verdict === "decline") {
    return { ...base, feedback: "on leave", verdict };
  }
  return { ...base, verdict };
}

/** An earlier ask on another pull request. */
function asked({
  number,
  recipients,
  atIso = "2026-09-10T00:00:00.000Z",
  repoSlug = "acme/acme-admin",
  codeOwnerTeams = ["@acme/security"],
}: {
  number: number;
  recipients: readonly string[];
  atIso?: string;
  repoSlug?: string;
  codeOwnerTeams?: readonly string[];
}): ReviewerAskedRow {
  return {
    atIso,
    authorLogin: "octocat",
    channel: "#dev-alerts",
    codeOwnerTeams,
    isDirectMessage: false,
    kind: "asked",
    messageKey: `C1:${String(number)}`,
    names: {},
    number,
    permalink: `https://acme.slack.com/archives/C1/p${String(number)}`,
    prKey: `${repoSlug}#${String(number)}`,
    recipients,
    recordedAtIso: atIso,
    repoSlug,
    schema: 1,
  };
}

describe("reviewHookOf", () => {
  it("reads a draft and a stacked row as not due before anything else", () => {
    const hooks = [row({ over: { askTrail: [NEWEST], draft: true } }), row({ over: { stacked: true } })].map((one) =>
      reviewHookOf({ picks: [], row: one }),
    );
    expect(hooks).toEqual([
      { kind: "not-due", why: "draft" },
      { kind: "not-due", why: "stacked" },
    ]);
  });

  it("names the newest ask's first recipient as the primary, with the bump verdict", () => {
    const bump = { kind: "replied", why: "they have replied" } as const;
    expect(reviewHookOf({ picks: [], row: row({ over: { askTrail: [NEWEST], bump, slackAsked: "yes" } }) })).toEqual({
      asks: 1,
      bump,
      kind: "asked",
      newest: NEWEST,
      primary: "U0ROSA",
    });
  });

  it("reads an approve newer than the newest ask as picked, and an older one as the ask", () => {
    const newer = pick({ atIso: "2026-09-24T00:00:00.000Z", verdict: "approve" });
    const older = pick({ atIso: "2026-09-22T00:00:00.000Z", verdict: "approve" });
    const withAsk = row({ over: { askTrail: [NEWEST] } });
    expect([
      reviewHookOf({ picks: [newer], row: withAsk }).kind,
      reviewHookOf({ picks: [older], row: withAsk }).kind,
    ]).toEqual(["picked", "asked"]);
  });

  it("lets a later decline undo an approve", () => {
    const picks = [
      pick({ atIso: "2026-09-24T00:00:00.000Z", verdict: "approve" }),
      pick({ atIso: "2026-09-24T01:00:00.000Z", verdict: "decline" }),
    ];
    expect(reviewHookOf({ picks, row: row() })).toEqual({ kind: "nobody-asked" });
  });

  it("says nobody only on the verb's own no, and otherwise carries its reason", () => {
    const hooks = [
      row({ over: { askTrail: undefined, slackAsked: "unknown" } }),
      row({ over: { askTrail: undefined, slackAsked: "no" } }),
      row({ over: { slackAsked: "unknown", slackWhy: "the corpus is 3 days stale" } }),
      row({ over: { slackAsked: "unknown" } }),
    ].map((one) => reviewHookOf({ picks: [], row: one }));
    expect(hooks).toEqual([
      { kind: "unknown", why: "this reading predates the ask trail" },
      { kind: "unknown", why: "this reading predates the ask trail" },
      { kind: "unknown", why: "the corpus is 3 days stale" },
      { kind: "unknown", why: "the verb did not say why" },
    ]);
  });
});

describe("wantsSuggestion", () => {
  it("offers a reviewer for nobody, not known, and a due chase — never a live ask or a pick", () => {
    const due = { eligibleSinceIso: "x", kind: "due", silentSinceIso: "y" } as const;
    const live = { asks: 1, bump: undefined, kind: "asked", newest: NEWEST, primary: "U0ROSA" } as const;
    expect(
      [
        { kind: "nobody-asked" } as const,
        { kind: "unknown", why: "w" } as const,
        { ...live, bump: due },
        live,
        { atIso: "t", kind: "picked", reviewer: "U0PRANAV" } as const,
        { kind: "not-due", why: "draft" } as const,
      ].map((hook) => wantsSuggestion({ hook })),
    ).toEqual([true, true, true, false, false, false]);
  });
});

describe("suggestReviewer", () => {
  const logins = new Map([
    ["octocat", "U0SYNADAOWN"],
    ["pranav", "U0PRANAV"],
  ]);
  const excluded = new Set(["U0SYNADAOWN", "U0BOT"]);
  const slackIdsForLogin = new Map<string, readonly string[]>();
  const samePerson = new Map<string, readonly string[]>();

  it("puts a named code owner first, over any history", () => {
    const one = row({ over: { blockedOn: ["@acme/security", "@pranav"] } });
    const asks = [asked({ number: 1, recipients: ["U0ROSA"] }), asked({ number: 2, recipients: ["U0ROSA"] })];
    const set = suggestReviewer({
      asks,
      excluded,
      hook: { kind: "nobody-asked" },
      logins,
      picks: [],
      row: one,
      samePerson,
      slackIdsForLogin,
    })!;
    expect([set.primary.reviewer, set.primary.tier, set.primary.basis]).toEqual([
      "U0PRANAV",
      "named-code-owner",
      "GitHub names them as a code owner on this pull request",
    ]);
    expect(set.alternatives.map((alt) => [alt.reviewer, alt.tier])).toEqual([["U0ROSA", "team-history"]]);
  });

  it("ranks team history by earlier pull requests, then recency, and says it is not ownership", () => {
    const asks = [
      asked({ number: 1, recipients: ["U0A"] }),
      asked({ number: 2, recipients: ["U0A"] }),
      asked({ atIso: "2026-09-20T00:00:00.000Z", number: 3, recipients: ["U0B"] }),
      asked({ atIso: "2026-09-01T00:00:00.000Z", number: 4, recipients: ["U0C"] }),
      asked({ number: 5, recipients: ["U0D"] }),
    ];
    const set = suggestReviewer({
      asks,
      excluded,
      hook: { kind: "nobody-asked" },
      logins,
      picks: [],
      row: row(),
      samePerson,
      slackIdsForLogin,
    })!;
    expect(set.primary).toEqual({
      basis: "you asked them on 2 earlier pull requests owned by @acme/security — history, not ownership",
      earlierPrs: 2,
      lastAskedIso: "2026-09-10T00:00:00.000Z",
      reviewer: "U0A",
      tier: "team-history",
    });
    expect(set.alternatives.map((alt) => alt.reviewer)).toEqual(["U0B", "U0D"]);
  });

  it("falls back to the repository's history when no team matches", () => {
    const asks = [asked({ codeOwnerTeams: ["@acme/other"], number: 1, recipients: ["U0A"] })];
    const set = suggestReviewer({
      asks,
      excluded,
      hook: { kind: "nobody-asked" },
      logins,
      picks: [],
      row: row(),
      samePerson,
      slackIdsForLogin,
    })!;
    expect([set.primary.tier, set.primary.basis]).toEqual([
      "repo-history",
      "you asked them on 1 earlier pull request in acme/acme-admin — history, not ownership",
    ]);
  });

  it("never suggests the owner, the owner's bot, the author, a group, a declined person, or the silent one on a due chase", () => {
    const asks = [asked({ number: 1, recipients: ["U0SYNADAOWN", "U0BOT", "S0GROUP", "U0PRANAV", "U0ROSA", "U0OK"] })];
    const due = { eligibleSinceIso: "x", kind: "due", silentSinceIso: "y" } as const;
    const hook = { asks: 1, bump: due, kind: "asked", newest: NEWEST, primary: "U0ROSA" } as const;
    const set = suggestReviewer({
      asks,
      excluded: new Set(["U0BOT"]),
      hook,
      logins,
      picks: [pick({ atIso: "2026-09-24T00:00:00.000Z", verdict: "decline" })],
      row: row(),
      samePerson,
      slackIdsForLogin,
    })!;
    expect([set.primary.reviewer, set.alternatives]).toEqual(["U0OK", []]);
  });

  it("withholds history when the reading could not join the author to Slack, since it could name the author", () => {
    const stranger = row({ over: { authorLogin: "alice-gh", blockedOn: ["@acme/security", "@pranav"] } });
    const asks = [asked({ number: 400, recipients: ["U0ALICE"] })];
    const hook = { kind: "nobody-asked" } as const;
    const set = suggestReviewer({
      asks,
      excluded,
      hook,
      logins,
      picks: [],
      row: stranger,
      samePerson,
      slackIdsForLogin,
    })!;
    expect([set.primary.reviewer, set.primary.tier, set.alternatives]).toEqual(["U0PRANAV", "named-code-owner", []]);
    const noOwner = row({ over: { authorLogin: "alice-gh" } });
    expect(
      suggestReviewer({ asks, excluded, hook, logins, picks: [], row: noOwner, samePerson, slackIdsForLogin }),
    ).toBe(undefined);
  });

  it("leaves the author out under every Slack id the reading joined to them, not only the one that addresses them", () => {
    const alice = row({ over: { authorLogin: "Alice-GH" } });
    const asks = [asked({ number: 400, recipients: ["U0ALICE"] }), asked({ number: 401, recipients: ["U0A"] })];
    const set = suggestReviewer({
      asks,
      excluded,
      hook: { kind: "nobody-asked" },
      logins: new Map([["alice-gh", "W0ALICE"]]),
      picks: [],
      row: alice,
      samePerson,
      slackIdsForLogin: new Map([["alice-gh", ["W0ALICE", "U0ALICE"]]]),
    })!;
    expect([set.primary.reviewer, set.alternatives]).toEqual(["U0A", []]);
  });

  describe("one person under two Slack ids", () => {
    const withBob = new Map([...logins, ["bob-gh", "W0BOB"]]);
    const bobIds = new Map<string, readonly string[]>([["bob-gh", ["W0BOB", "U0BOB"]]]);
    const owned = row({ over: { blockedOn: ["@acme/security", "@bob-gh"] } });

    it("never offers the person who went silent on a due chase under their other id", () => {
      const due = { eligibleSinceIso: "x", kind: "due", silentSinceIso: "y" } as const;
      const hook = { asks: 1, bump: due, kind: "asked", newest: NEWEST, primary: "U0BOB" } as const;
      const asks = [asked({ number: 1, recipients: ["U0A"] })];
      const set = suggestReviewer({
        asks,
        excluded,
        hook,
        logins: withBob,
        picks: [],
        row: owned,
        samePerson,
        slackIdsForLogin: bobIds,
      })!;
      expect([set.primary.reviewer, set.alternatives]).toEqual(["U0A", []]);
    });

    it("never offers a declined person again under their other id", () => {
      const asks = [asked({ number: 3, recipients: ["U0BOB"] }), asked({ number: 4, recipients: ["U0A"] })];
      const set = suggestReviewer({
        asks,
        excluded,
        hook: { kind: "nobody-asked" },
        logins: withBob,
        picks: [pick({ atIso: "2026-09-24T00:00:00.000Z", reviewer: "W0BOB", verdict: "decline" })],
        row: row(),
        samePerson,
        slackIdsForLogin: bobIds,
      })!;
      expect([set.primary.reviewer, set.alternatives]).toEqual(["U0A", []]);
    });

    it("offers one person once, under the id the code-owner join addresses", () => {
      const asks = [asked({ number: 3, recipients: ["U0BOB"] })];
      const hook = { kind: "nobody-asked" } as const;
      const set = suggestReviewer({
        asks,
        excluded,
        hook,
        logins: withBob,
        picks: [],
        row: owned,
        samePerson,
        slackIdsForLogin: bobIds,
      })!;
      expect([set.primary.reviewer, set.primary.tier, set.alternatives]).toEqual(["W0BOB", "named-code-owner", []]);
    });
  });

  it("leaves out a reviewer under every id the roster holds, though the reading joined them to no login", () => {
    const bob = ["U0BOB", "W0BOB"];
    const roster = new Map<string, readonly string[]>([
      ["U0BOB", bob],
      ["W0BOB", bob],
    ]);
    const asks = [asked({ number: 3, recipients: ["W0BOB"] }), asked({ number: 4, recipients: ["U0A"] })];
    const due = { eligibleSinceIso: "x", kind: "due", silentSinceIso: "y" } as const;
    const silent = { asks: 1, bump: due, kind: "asked", newest: NEWEST, primary: "U0BOB" } as const;
    const declined = [pick({ atIso: "2026-09-24T00:00:00.000Z", reviewer: "U0BOB", verdict: "decline" })];
    const offered = [
      suggestReviewer({
        asks,
        excluded,
        hook: silent,
        logins,
        picks: [],
        row: row(),
        samePerson: roster,
        slackIdsForLogin,
      })!,
      suggestReviewer({
        asks,
        excluded,
        hook: { kind: "nobody-asked" },
        logins,
        picks: declined,
        row: row(),
        samePerson: roster,
        slackIdsForLogin,
      })!,
    ].map((set) => [set.primary.reviewer, set.alternatives]);
    expect(offered).toEqual([
      ["U0A", []],
      ["U0A", []],
    ]);
  });

  it("does not count this pull request's own asks as history, and offers nothing without evidence", () => {
    const own = asked({ number: 17012, recipients: ["U0A"] });
    expect(
      suggestReviewer({
        asks: [own],
        excluded,
        hook: { kind: "nobody-asked" },
        logins,
        picks: [],
        row: row(),
        samePerson,
        slackIdsForLogin,
      }),
    ).toBe(undefined);
  });

  it("offers nothing on a row that does not want a suggestion", () => {
    const asks = [asked({ number: 1, recipients: ["U0A"] })];
    const hook = { kind: "not-due", why: "draft" } as const;
    expect(suggestReviewer({ asks, excluded, hook, logins, picks: [], row: row(), samePerson, slackIdsForLogin })).toBe(
      undefined,
    );
  });
});

describe("reviewerReadingOf", () => {
  const document = {
    loginSlackIds: { pranav: ["U0PRANAV", "W0PRANAV"] },
    logins: { pranav: "U0PRANAV" },
    people: { U0PRANAV: { name: "Pranav" } },
    rows: [
      {
        askTrail: [NEWEST],
        authorLogin: "octocat",
        blockedOn: [],
        number: 17012,
        repoSlug: "acme/acme-admin",
        slack: { asked: "yes", why: "" },
        stack: { stacked: false },
        tests: [{ id: "undrafted", verdict: "fail", why: "draft" }],
        title: "t",
        url: "u",
      },
    ],
  };

  it("reads the rows, names and logins, and a failed undrafted test as a draft", () => {
    const reading = unwrap(reviewerReadingOf({ document }));
    expect([reading.rows[0]!.draft, reading.rows[0]!.askTrail, reading.rows[0]!.bump]).toEqual([
      true,
      [NEWEST],
      undefined,
    ]);
    expect([[...reading.people], [...reading.logins]]).toEqual([[["U0PRANAV", "Pranav"]], [["pranav", "U0PRANAV"]]]);
    expect([...reading.slackIdsForLogin]).toEqual([["pranav", ["U0PRANAV", "W0PRANAV"]]]);
  });

  it("reads a reading that predates every-id as joining nobody to a second id", () => {
    const older = { logins: document.logins, people: document.people, rows: document.rows };
    expect(unwrap(reviewerReadingOf({ document: older })).slackIdsForLogin.size).toBe(0);
  });

  it("refuses a malformed row, naming where", () => {
    const bad = { ...document, rows: [{ ...document.rows[0], slack: { asked: "maybe", why: "" } }] };
    const error = unwrapErr(reviewerReadingOf({ document: bad }));
    expect(error.code).toBe("REVIEWER_READING_MALFORMED");
    expect(reviewErrorLines({ error })).toEqual([
      "the last github landing reading is not one this build reads: rows.0.slack.asked is malformed",
    ]);
  });
});
