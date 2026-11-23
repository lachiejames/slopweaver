/*
 * Reading a landing document. The advisory-red count has three states: a document from before the verb counted
 * it reads `undefined`, a counted one reads its number, and a present value that is not a number refuses the
 * WHOLE reading, the rule at the top of `readLanding.ts`. A row's human wait reads the same three ways.
 *
 * The ask trail, bump verdict and people: an older document reads as not known, a malformed field refuses the
 * whole reading, and a well-formed one is carried exactly. Every `billing` lane here is a synthetic one rather than
 * the installation's own.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readLanding } from "../../components/live/readLanding";
import { OWNER_JUDGEMENT_VERDICT } from "../../lib/prNeedsOwner";

const FIXTURE = fileURLToPath(new URL("../../fixtures/landing-reading/2026-09-20.json", import.meta.url));

/**
 * The fixture document, with its tally overridden — a capture from before the verb counted advisory reds — and,
 * when given, every row carrying one human wait.
 *
 * Each row gains the two fields the verb added after that capture (`authorLogin`, `createdAtIso`); the capture
 * itself is re-taken rather than hand-edited, so the patch lives here, in memory, and names what it adds.
 */
function documentWith({ tally, humanWait }: { tally: Record<string, unknown>; humanWait?: unknown }): unknown {
  const reading = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    document: { rows: Record<string, unknown>[]; tally: Record<string, unknown> };
  };
  const rows = reading.document.rows.map((each) => ({
    ...each,
    authorLogin: "acme-owner",
    createdAtIso: "2026-09-19T00:00:00Z",
    humanWait,
  }));
  return { ...reading.document, rows, tally: { ...reading.document.tally, ...tally } };
}

describe("readLanding's advisory-red count", () => {
  it("reads undefined on a document from before the verb counted it", () => {
    expect(readLanding(documentWith({ tally: {} }))!.advisoryRedBypassed).toBe(undefined);
  });

  it("reads the verb's own count", () => {
    expect(readLanding(documentWith({ tally: { advisoryRedBypassed: 9 } }))!.advisoryRedBypassed).toBe(9);
  });

  it("refuses the whole reading over a count the verb could not have written", () => {
    expect(readLanding(documentWith({ tally: { advisoryRedBypassed: "nine" } }))).toBe(undefined);
  });
});

/** A wait as the verb serialises one; `JSON.stringify` drops an `undefined` field, so an unread one is absent. */
const WAIT = {
  lastAsk: { atIso: "2026-09-23T09:00:00.000Z", permalink: "https://example.slack.com/archives/C1/p1", to: "U9" },
  next: "bump",
  requestedAtIso: "2026-09-22T05:07:00Z",
  sentence: "Waiting on @acme/platform · requested 2026-09-22 05:07Z · last asked 2026-09-23 09:00Z",
  stale: "yes",
  who: ["@acme/platform"],
};

describe("readLanding's human wait", () => {
  it("reads a row with no wait as undefined", () => {
    expect(readLanding(documentWith({ tally: {} }))!.rows[0].humanWait).toBe(undefined);
  });

  it("reads the verb's five facts off a waiting row", () => {
    expect(readLanding(documentWith({ humanWait: WAIT, tally: {} }))!.rows[0].humanWait).toStrictEqual({
      lastAskAtIso: "2026-09-23T09:00:00.000Z",
      lastAskPermalink: "https://example.slack.com/archives/C1/p1",
      next: "bump",
      requestedAtIso: "2026-09-22T05:07:00Z",
      sentence: WAIT.sentence,
      slackThroughIso: undefined,
      stale: "yes",
      who: ["@acme/platform"],
    });
  });

  it("reads the Slack watermark a sync-slack wait carries", () => {
    const stale = { ...WAIT, next: "sync-slack", slackThroughIso: "2026-09-25T11:40:22.000Z" };
    const wait = readLanding(documentWith({ humanWait: stale, tally: {} }))!.rows[0].humanWait!;
    expect([wait.next, wait.slackThroughIso]).toStrictEqual(["sync-slack", "2026-09-25T11:40:22.000Z"]);
  });

  it("reads an unread request time and no ask as undefined, never as a refusal", () => {
    const bare = { next: WAIT.next, sentence: WAIT.sentence, stale: WAIT.stale, who: WAIT.who };
    const wait = readLanding(documentWith({ humanWait: bare, tally: {} }))!.rows[0].humanWait!;
    expect([wait.requestedAtIso, wait.lastAskAtIso, wait.lastAskPermalink]).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("refuses the whole reading over a wait the verb could not have written", () => {
    expect(readLanding(documentWith({ humanWait: { ...WAIT, next: 3 }, tally: {} }))).toBe(undefined);
    expect(readLanding(documentWith({ humanWait: { ...WAIT, lastAsk: "yesterday" }, tally: {} }))).toBe(undefined);
    expect(readLanding(documentWith({ humanWait: { ...WAIT, requestedAtIso: 17 }, tally: {} }))).toBe(undefined);
    expect(readLanding(documentWith({ humanWait: { ...WAIT, slackThroughIso: 17 }, tally: {} }))).toBe(undefined);
    for (const slackThroughIso of ["not-a-date", "2026-02-30T00:00:00.000Z", "2026-09-25T00:30:00+10:00"]) {
      expect(readLanding(documentWith({ humanWait: { ...WAIT, slackThroughIso }, tally: {} }))).toBe(undefined);
    }
  });
});

const ASK = {
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-alerts",
  isDirectMessage: false,
  leg: "corpus",
  messageKey: "C0SYN000101:1790138766.748499",
  permalink: "https://acme.slack.com/archives/C0SYN000101/p1790138766748499",
  recipients: ["U0SYN000101"],
};

/** One row as `github landing --json` prints it, with `extra` laid over. */
function row({ extra = {} }: { extra?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    action: "blocked-on",
    actionDetail: "waiting on a review",
    authorLogin: "acme-owner",
    baseRefName: "main",
    blockedOn: ["@acme/security"],
    boardRow: { kind: "declared" },
    ci: "green",
    conversations: { codeRabbit: { awaitingUs: 0, open: 0 }, humans: { awaitingUs: 0, open: 0 } },
    createdAtIso: "2026-09-22T00:00:00.000Z",
    failingChecks: [],
    headOid: "abc",
    headRefName: "bump-fast-xml-parser",
    labels: [],
    number: 17012,
    openThreads: [],
    repoSlug: "acme/acme-admin",
    slack: { asked: "yes", bounded: true, why: "" },
    stack: { stacked: false },
    tests: [{ id: "undrafted", verdict: "pass", why: "not a draft" }],
    title: "bump fast-xml-parser",
    updatedAtIso: "2026-09-23T05:00:00.000Z",
    url: "https://github.com/acme/acme-admin/pull/17012",
    ...extra,
  };
}

/** A whole document around `rows`, with `extra` laid over. */
function doc({
  rows,
  extra = {},
}: {
  rows: readonly Record<string, unknown>[];
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    residue: [],
    rows,
    tally: { byAction: [{ action: "blocked-on", count: rows.length }], ready: 0, total: rows.length },
    ...extra,
  };
}

describe("readLanding — ask trail, bump and people", () => {
  it("carries the trail, the bump verdict, the bound and the names exactly", () => {
    const bump = { eligibleSinceIso: "2026-09-24T04:46:00.000Z", kind: "due", silentSinceIso: ASK.atIso };
    const landing = readLanding(
      doc({
        extra: { people: { U0SYN000101: { name: "Quinn" } } },
        rows: [row({ extra: { askTrail: [ASK], bump } })],
      }),
    )!;
    expect(landing.rows[0].askTrail).toEqual([ASK]);
    expect(landing.rows[0].bump).toEqual(bump);
    expect(landing.rows[0].slackBounded).toBe(true);
    expect([...landing.people]).toEqual([["U0SYN000101", { handle: undefined, name: "Quinn" }]]);
  });

  it("reads a stored dispatch verdict as the owner-neutral one", () => {
    const verdictOf = (verdict: string): string | undefined =>
      readLanding(doc({ rows: [row({ extra: { dispatch: { kind: "act", verdict, why: "a person must judge" } } })] }))!
        .rows[0].verdict;
    expect(verdictOf(OWNER_JUDGEMENT_VERDICT)).toBe("needs-owner-judgment");
  });

  it("reads a document older than the fields as not known, never as an empty trail", () => {
    const landing = readLanding(doc({ rows: [row({ extra: { slack: { asked: "unknown" } } })] }))!;
    expect(landing.rows[0].askTrail).toBe(undefined);
    expect(landing.rows[0].bump).toBe(undefined);
    expect(landing.rows[0].slackBounded).toBe(undefined);
    expect(landing.people.size).toBe(0);
  });

  it("reads each bump arm the verb prints", () => {
    const arms = [
      { eligibleAtIso: "2026-09-24T04:46:00.000Z", kind: "too-soon", why: "asked 24h ago is the bar" },
      { kind: "replied", why: "they have replied, so there is nothing to chase" },
      { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
    ];
    const read = arms.map((bump) => readLanding(doc({ rows: [row({ extra: { bump } })] }))!.rows[0].bump);
    expect(read).toEqual(arms);
  });

  it("refuses the whole reading over a trail entry that names nobody", () => {
    expect(readLanding(doc({ rows: [row({ extra: { askTrail: [{ ...ASK, recipients: [] }] } })] }))).toBe(undefined);
  });

  it("refuses the whole reading over a trail entry missing its permalink", () => {
    const { permalink: _dropped, ...noLink } = ASK;
    expect(readLanding(doc({ rows: [row({ extra: { askTrail: [noLink] } })] }))).toBe(undefined);
  });

  it("refuses a bump arm it does not know, and a due verdict missing its instant", () => {
    const unknownArm = doc({ rows: [row({ extra: { bump: { kind: "later", why: "x" } } })] });
    const dueNoInstant = doc({ rows: [row({ extra: { bump: { kind: "due", silentSinceIso: ASK.atIso } } })] });
    expect([readLanding(unknownArm), readLanding(dueNoInstant)]).toEqual([undefined, undefined]);
  });

  it("refuses a people entry with no name, and a bound that is not a boolean", () => {
    const namelessPerson = doc({ extra: { people: { U1: { handle: "x" } } }, rows: [row()] });
    const badBound = doc({ rows: [row({ extra: { slack: { asked: "no", bounded: "yes" } } })] });
    expect([readLanding(namelessPerson), readLanding(badBound)]).toEqual([undefined, undefined]);
  });
});

/** One failing check as the verb prints it; `JSON.stringify` drops an unknown `required`, so it is omitted. */
const FAILED = { name: "Advisory local browser E2E (billing)", state: "failed", url: "https://github.com/x/actions/1" };

describe("readLanding — what a red rollup is red on", () => {
  it("carries the verb's classification exactly, required, advisory and unknown", () => {
    const shapes = [{ required: true }, { required: false }, {}].map(
      (shape) =>
        readLanding(doc({ rows: [row({ extra: { ci: "red", ciFailure: { kind: "red", ...shape } } })] }))!.rows[0]
          .ciFailure,
    );
    expect(shapes).toStrictEqual([
      { kind: "red", required: true },
      { kind: "red", required: false },
      { kind: "red", required: undefined },
    ]);
  });

  it("reads a red row from before the verb classified it as unknown, never advisory, and a green one as not red", () => {
    const red = readLanding(doc({ rows: [row({ extra: { ci: "red" } })] }))!.rows[0].ciFailure;
    const green = readLanding(doc({ rows: [row()] }))!.rows[0].ciFailure;
    expect([red, green]).toStrictEqual([{ kind: "red", required: undefined }, { kind: "not-red" }]);
  });

  it("refuses a classification the verb could not have written, or one contradicting the rollup", () => {
    const refused = [
      { ci: "red", ciFailure: { kind: "red", required: "no" } },
      { ci: "red", ciFailure: { kind: "advisory" } },
      { ci: "green", ciFailure: { kind: "red", required: false } },
      { ci: "red", ciFailure: { kind: "not-red" } },
      { ci: "red", ciFailure: "red" },
    ].map((extra) => readLanding(doc({ rows: [row({ extra })] })));
    expect(refused).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads an omitted check requirement as unknown, and refuses one that is present and not a boolean", () => {
    const omitted = readLanding(doc({ rows: [row({ extra: { ci: "red", failingChecks: [FAILED] } })] }))!;
    const malformed = doc({ rows: [row({ extra: { ci: "red", failingChecks: [{ ...FAILED, required: "no" }] } })] });
    expect(omitted.rows[0].failingChecks).toStrictEqual([{ ...FAILED, required: undefined }]);
    expect(readLanding(malformed)).toBe(undefined);
  });
});

describe("readLanding — the board row a branch joins", () => {
  it("carries the slug of a row join, so an act card can join its ledger row to the pull request", () => {
    const boardRow = { kind: "row", slug: "the-run", status: "ready" };
    expect(readLanding(doc({ rows: [row({ extra: { boardRow } })] }))!.rows[0].boardRowSlug).toBe("the-run");
  });

  it("carries no slug on a join that names no row", () => {
    const boardRow = { kind: "none-declared", why: "no handover row declares this branch" };
    expect(readLanding(doc({ rows: [row({ extra: { boardRow } })] }))!.rows[0].boardRowSlug).toBe(undefined);
  });

  it("refuses the whole reading over a row join whose slug the verb could not have written", () => {
    const shapes = [{ kind: "row" }, { kind: "row", slug: " " }, { kind: "row", slug: 7 }];
    expect(shapes.map((boardRow) => readLanding(doc({ rows: [row({ extra: { boardRow } })] })))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("readLanding — GitHub's own open census", () => {
  const CENSUS = [
    {
      kind: "read",
      pullRequests: [
        { author: "renovate", isDraft: true, number: 1323, title: "a bump", url: "https://github.com/x/pull/1323" },
        { isDraft: false, number: 1, title: "a deleted author's", url: "https://github.com/x/pull/1" },
      ],
      repo: "acme/slopweaver",
      startedAtIso: "2026-09-26T13:00:00.000Z",
      totalCount: 2,
      viewer: "acme-owner",
    },
    { kind: "unread", repo: "acme/acme-admin", why: "GitHub answered 502" },
  ];

  /** A document carrying `census`, taken over exactly the repositories it names — the verb's own shape. */
  const withCensus = ({ census }: { census: readonly { repo: string }[] }): Record<string, unknown> => ({
    ...(documentWith({ tally: {} }) as Record<string, unknown>),
    census,
    selection: { author: "@me", includeDrafts: true, repos: [...new Set(census.map((one) => one.repo))] },
  });

  it("reads a document older than the census as not known, never as zero", () => {
    expect(readLanding(documentWith({ tally: {} }))!.census).toBe(undefined);
  });

  it("carries a read census and an unread one exactly, a deleted author as absent", () => {
    const document = withCensus({ census: CENSUS });
    expect(readLanding(document)!.census).toStrictEqual([
      {
        kind: "read",
        pullRequests: [
          { author: "renovate", isDraft: true, number: 1323, title: "a bump", url: "https://github.com/x/pull/1323" },
          {
            author: undefined,
            isDraft: false,
            number: 1,
            title: "a deleted author's",
            url: "https://github.com/x/pull/1",
          },
        ],
        repo: "acme/slopweaver",
        startedAtIso: "2026-09-26T13:00:00.000Z",
        totalCount: 2,
        viewer: "acme-owner",
      },
      { kind: "unread", repo: "acme/acme-admin", why: "GitHub answered 502" },
    ]);
  });

  it("reads a census that disagrees with the reading's selection as unread, both ways, so the page retakes it", () => {
    const selection = { author: "@me", includeDrafts: false, repos: ["acme/slopweaver", "acme/other"] };
    const document = { ...(documentWith({ tally: {} }) as Record<string, unknown>), census: CENSUS, selection };
    expect(readLanding(document)!.census!.map((one) => `${one.repo} ${one.kind}`)).toStrictEqual([
      "acme/slopweaver read",
      "acme/acme-admin unread",
      "acme/other unread",
    ]);
  });

  it("reads a recorded census with no start instant as unread, since its age cannot be bounded", () => {
    const { startedAtIso: _dropped, ...unstarted } = CENSUS[0];
    const document = withCensus({ census: [unstarted] });
    expect(readLanding(document)!.census).toStrictEqual([
      {
        kind: "unread",
        repo: "acme/slopweaver",
        why: "the recorded census carries no instant its first page was asked for",
      },
    ]);
  });

  it("refuses the whole reading when a census pull request is missing its number", () => {
    const broken = [{ ...CENSUS[0], pullRequests: [{ isDraft: false, title: "no number", url: "u" }] }];
    const document = withCensus({ census: broken });
    expect(readLanding(document)).toBe(undefined);
  });

  it("reads a recorded census whose count its list does not add up to as unread, so no count names fewer than it claims", () => {
    const short = [{ ...CENSUS[0], totalCount: 3 }];
    const document = withCensus({ census: short });
    expect(readLanding(document)!.census).toStrictEqual([
      {
        kind: "unread",
        repo: "acme/slopweaver",
        why: "the recorded census lists 2 distinct pull request(s) in 2 against a count of 3",
      },
    ]);
  });

  it("reads a census with no recorded selection as unread, since what it should cover cannot be checked", () => {
    const document = { ...(documentWith({ tally: {} }) as Record<string, unknown>), census: [CENSUS[0]] };
    expect(readLanding(document)!.census).toStrictEqual([
      {
        kind: "unread",
        repo: "acme/slopweaver",
        why: "the reading records no repository selection, so its census cannot be checked against one",
      },
    ]);
  });

  it("believes neither entry when one repository is recorded twice", () => {
    const twice = [CENSUS[0], CENSUS[0]];
    const document = withCensus({ census: twice });
    expect(readLanding(document)!.census).toStrictEqual([
      { kind: "unread", repo: "acme/slopweaver", why: "the recorded census lists this repository twice" },
    ]);
  });
});

describe("readLanding — shared with a channel, nobody named", () => {
  const SHARE = {
    badge: "waiting for engagement",
    asOfIso: "2026-09-27T15:19:32.000Z",
    businessDaysSincePost: 0,
    channel: "#dev-team",
    lastReplyAtIso: undefined,
    messageKey: "C0SYN000101:1790508621.312739",
    permalink: "https://acme.slack.com/archives/C0SYN000101/p1790508621312739",
    postedAtIso: "2026-09-27T11:30:21.000Z",
    asksThroughIso: "2026-09-27T15:19:32.000Z",
    redAfterBusinessDays: 3,
    replies: 0,
    repliesThroughIso: "2026-09-27T20:17:00.000Z",
    seen: "asks seen through 2026-09-27 15:19Z (the Slack corpus), replies seen through 2026-09-27 20:17Z (the whole thread)",
    tone: "green",
    why: "no reply yet, 0 business days into the first business day",
  };

  it("carries the verb's channel share exactly", () => {
    const landing = readLanding(doc({ rows: [row({ extra: { channelShare: SHARE } })] }))!;
    expect(landing.rows[0].channelShare).toEqual({
      badge: SHARE.badge,
      asOfIso: "2026-09-27T15:19:32.000Z",
      channel: "#dev-team",
      permalink: SHARE.permalink,
      postedAtIso: SHARE.postedAtIso,
      replies: 0,
      seen: SHARE.seen,
      tone: "green",
      why: SHARE.why,
    });
  });

  it("reads a row without one as undefined — an older document, or a row it does not apply to", () => {
    expect(readLanding(doc({ rows: [row({})] }))!.rows[0].channelShare).toBe(undefined);
  });

  it("refuses the whole reading over a share with no post to cite, or a tone it cannot draw", () => {
    const { permalink: _dropped, ...noPost } = SHARE;
    expect(readLanding(doc({ rows: [row({ extra: { channelShare: noPost } })] }))).toBe(undefined);
    expect(readLanding(doc({ rows: [row({ extra: { channelShare: { ...SHARE, tone: "purple" } } })] }))).toBe(
      undefined,
    );
  });
});
