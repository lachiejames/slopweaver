/*
 * The census counts what GitHub counts for the OWNER, the witness to the page's rows. The page and GitHub must always
 * show the same numbers, and the badge is the number of the owner's own open pull requests, never the 250 of the
 * organisation's every open one. The census is GitHub's own open list; the count is the part of it the landing's
 * `--author` matches, drafts included, and every one of those no row carries is named with why.
 */
import { describe, expect, it } from "vitest";

import type { LandingCensusPr, LandingRepoCensus, LandingRow } from "../../components/live/readLanding";
import {
  censusFindingsOf,
  censusPictureOf,
  currentCensusOf,
  INLINE_NUMBERS,
  inlineNumbersOf,
  type NotPlacedPr,
  populationOf,
} from "../../lib/pullRequestCensus";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";

const SW = FIXTURE_SELF_REPOSITORY;
const EV = "acme/acme-admin";

const pr = ({
  number,
  author = "octocat",
  draft = false,
}: {
  number: number;
  author?: string;
  draft?: boolean;
}): LandingCensusPr => ({
  author,
  isDraft: draft,
  number,
  title: `pull request ${String(number)}`,
  url: `https://github.com/x/pull/${String(number)}`,
});

const read = ({ repo, prs }: { repo: string; prs: readonly LandingCensusPr[] }): LandingRepoCensus => ({
  kind: "read",
  pullRequests: prs,
  repo,
  startedAtIso: "2026-09-26T13:00:00.000Z",
  totalCount: prs.length,
  viewer: "octocat",
});

/** Only the three fields the reconciliation reads off a row; the rest never enters it. */
const row = ({ repo, number, author = "octocat" }: { repo: string; number: number; author?: string }): LandingRow =>
  ({ authorLogin: author, number, repoSlug: repo }) as unknown as LandingRow;

/** A measured slopweaver shape: one of the owner's placed, seven of their drafts, nine renovate bumps. */
const SLOPWEAVER_17 = read({
  prs: [
    pr({ number: 1361 }),
    ...[1360, 1359, 1358, 1357, 1354, 1352, 1351].map((number) => pr({ draft: true, number })),
    ...[1323, 1322, 1316, 1315, 1314, 1313, 1279, 1278, 1159].map((number) =>
      pr({ author: "renovate", draft: true, number }),
    ),
  ],
  repo: SW,
});

const TICK = { author: "@me", includeDrafts: false, repos: [EV, SW] };

describe("censusPictureOf", () => {
  it("counts the owner's 8 of GitHub's 17, names the 7 drafts the tick's reading could not place, and counts the 9 bumps apart", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 17001 })], repo: EV }), SLOPWEAVER_17],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [row({ number: 17001, repo: EV }), row({ number: 1361, repo: SW })],
      rows: [row({ number: 17001, repo: EV }), row({ number: 1361, repo: SW })],
      selection: TICK,
    });
    expect(picture.kind).toBe("counted");
    const counted = picture as Extract<typeof picture, { kind: "counted" }>;
    expect(
      `${String(counted.open)} open · ${String(counted.placed)} placed · ${String(counted.notPlaced.length)} not · ${String(counted.otherAuthors)} others`,
    ).toBe("8 open · 1 placed · 7 not · 9 others");
    expect(counted.byReason.map((group) => `${String(group.prs.length)} ${group.sentence}`)).toStrictEqual([
      // A renovate DRAFT is outside the owner's population before it is a draft: counted apart, never named not placed.
      "7 draft: this reading was taken without --include-drafts",
    ]);
    expect(counted.placed + counted.notPlaced.length).toBe(counted.open);
    expect(counted.authorFilter).toBe("@me");
    expect(counted.repos).toStrictEqual([SW]);
    expect(counted.closedSince).toBe(0);
  });

  it("counts the owner's 14 under Acme and their 5 under Slopweaver apart from other authors, never the organisation's 250 and 6", () => {
    // An invented shape: acme-admin 250 open, 14 the owner's with 3 drafts; slopweaver 6 open, 5 the owner's with 4 drafts.
    const acmeAdmin = read({
      prs: [
        ...Array.from({ length: 11 }, (_, at) => pr({ number: 18000 + at })),
        ...Array.from({ length: 3 }, (_, at) => pr({ draft: true, number: 18100 + at })),
        ...Array.from({ length: 236 }, (_, at) => pr({ author: `teammate-${String(at % 30)}`, number: 17000 + at })),
      ],
      repo: EV,
    });
    const slopweaver = read({
      prs: [
        pr({ number: 1480 }),
        ...[1481, 1482, 1483, 1484].map((number) => pr({ draft: true, number })),
        pr({ author: "renovate", number: 1323 }),
      ],
      repo: SW,
    });
    const badge = ({ context }: { context: "work" | "slopweaver" }): string => {
      const picture = censusPictureOf({
        census: [acmeAdmin, slopweaver],
        context,
        placer: ACME_PLACER,
        drawn: [],
        rows: [],
        selection: TICK,
      });
      const counted = picture as Extract<typeof picture, { kind: "counted" }>;
      return `${String(counted.open)} of ${String(counted.open + counted.otherAuthors)}`;
    };
    expect([badge({ context: "work" }), badge({ context: "slopweaver" })]).toStrictEqual(["14 of 250", "5 of 6"]);
  });

  it("places the owner's drafts once the reading includes them, and still counts the bumps apart", () => {
    const picture = censusPictureOf({
      census: [SLOPWEAVER_17],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [1361, 1360, 1359, 1358, 1357, 1354, 1352, 1351].map((number) => row({ number, repo: SW })),
      rows: [1361, 1360, 1359, 1358, 1357, 1354, 1352, 1351].map((number) => row({ number, repo: SW })),
      selection: { ...TICK, includeDrafts: true },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.open).toBe(8);
    expect(picture.placed).toBe(8);
    expect(picture.otherAuthors).toBe(9);
    expect(picture.byReason).toStrictEqual([]);
  });

  it("compares @me with the census's own viewer case-insensitively, and a deleted author matches no qualifier", () => {
    const picture = censusPictureOf({
      census: [
        read({
          prs: [pr({ author: "OctoCat", number: 5 }), { ...pr({ number: 6 }), author: undefined }],
          repo: SW,
        }),
      ],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, includeDrafts: true },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.notPlaced.map((one) => `${String(one.number)} ${one.reason}`)).toStrictEqual(["5 not-in-reading"]);
    expect(picture.otherAuthors).toBe(1);
  });

  it("resolves @me to the viewer however it was typed, and says 'your' for it", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ author: "OCTOCAT", number: 1 }), pr({ author: "x", number: 2 })], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, author: "@ME" },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(
      `${String(picture.open)} ${String(picture.otherAuthors)} ${populationOf({ authorFilter: picture.authorFilter })}`,
    ).toBe("1 1 your open pull requests");
  });

  it("words a named author's and an unqualified count without calling either yours", () => {
    expect([populationOf({ authorFilter: "quinn" }), populationOf({ authorFilter: undefined })]).toStrictEqual([
      "open pull requests by quinn",
      "open pull requests",
    ]);
  });

  it("counts only the owner's rows GitHub no longer lists open as closed since, never another author's", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [row({ number: 1, repo: SW }), row({ author: "bob", number: 2, repo: SW })],
      selection: TICK,
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(`${String(picture.open)} open · ${String(picture.closedSince)} closed`).toBe("0 open · 1 closed");
  });

  it("counts a named --author case-insensitively, whoever the token reads as", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ author: "Quinn", number: 1 }), pr({ number: 2 })], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, author: "quinn" },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(`${String(picture.open)} ${String(picture.otherAuthors)} ${String(picture.authorFilter)}`).toBe("1 1 quinn");
  });

  it("counts every author, a deleted account included, when the reading took no --author", () => {
    const picture = censusPictureOf({
      census: [
        read({
          prs: [pr({ number: 1 }), pr({ author: "renovate", number: 2 }), { ...pr({ number: 3 }), author: undefined }],
          repo: SW,
        }),
      ],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, author: undefined },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(`${String(picture.open)} ${String(picture.otherAuthors)} ${String(picture.authorFilter)}`).toBe(
      "3 0 undefined",
    );
  });

  it("never counts another author's row as placed, and never calls it closed since", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 1 }), pr({ author: "renovate", number: 2 })], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [row({ number: 1, repo: SW }), row({ number: 2, repo: SW })],
      rows: [row({ number: 1, repo: SW }), row({ number: 2, repo: SW })],
      selection: TICK,
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(
      `${String(picture.open)} open · ${String(picture.placed)} placed · ${String(picture.closedSince)} closed`,
    ).toBe("1 open · 1 placed · 0 closed");
  });

  it("counts only this context's repositories, so the Acme page never says 19", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 1 }), pr({ number: 2 })], repo: EV }), SLOPWEAVER_17],
      context: "work",
      placer: ACME_PLACER,
      drawn: [row({ number: 1, repo: EV })],
      rows: [row({ number: 1, repo: EV })],
      selection: TICK,
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.open).toBe(2);
    expect(picture.repos).toStrictEqual([EV]);
    expect(picture.notPlaced.map((one) => `${one.repoSlug}#${String(one.number)} ${one.reason}`)).toStrictEqual([
      `${EV}#2 not-in-reading`,
    ]);
  });

  it("joins by repository AND number, so the same number in two repositories is two pull requests", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 7 })], repo: EV }), read({ prs: [pr({ number: 7 })], repo: "acme/other" })],
      context: "work",
      placer: ACME_PLACER,
      drawn: [row({ number: 7, repo: EV })],
      rows: [row({ number: 7, repo: EV })],
      selection: { ...TICK, repos: [EV, "acme/other"] },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.placed).toBe(1);
    expect(picture.notPlaced.map((one) => one.repoSlug)).toStrictEqual(["acme/other"]);
  });

  it("counts a row GitHub no longer lists open as closed since, never as open", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 1 })], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [row({ number: 1, repo: SW }), row({ number: 2, repo: SW })],
      rows: [row({ number: 1, repo: SW }), row({ number: 2, repo: SW })],
      selection: TICK,
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.open).toBe(1);
    expect(picture.closedSince).toBe(1);
  });

  it("names a row the page's own filter hides as filtered here, never as placed below", () => {
    const picture = censusPictureOf({
      census: [SLOPWEAVER_17],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [row({ number: 1361, repo: SW })],
      rows: [1361, 1360].map((number) => row({ number, repo: SW })),
      selection: { ...TICK, includeDrafts: true },
    }) as Extract<ReturnType<typeof censusPictureOf>, { kind: "counted" }>;
    expect(picture.placed).toBe(1);
    expect(picture.byReason.map((group) => `${String(group.prs.length)} ${group.sentence}`)).toContain(
      "1 in this reading but not drawn on this page",
    );
    expect(picture.placed + picture.notPlaced.length).toBe(picture.open);
  });

  it("claims no count from a read census whose reading records no selection to check it against", () => {
    expect(
      censusPictureOf({
        census: [read({ prs: [pr({ number: 1 })], repo: SW })],
        context: "slopweaver",
        placer: ACME_PLACER,
        drawn: [row({ number: 1, repo: SW })],
        rows: [row({ number: 1, repo: SW })],
        selection: undefined,
      }),
    ).toStrictEqual({
      kind: "unavailable",
      why: "this reading records no repository selection, so its census cannot be checked against one and no count is claimed",
    });
  });

  it("claims no count from a reading older than the census", () => {
    expect(
      censusPictureOf({
        census: undefined,
        context: "slopweaver",
        drawn: [],
        placer: ACME_PLACER,
        rows: [],
        selection: TICK,
      }),
    ).toStrictEqual({
      kind: "unavailable",
      why: "this reading predates the verb recording GitHub's own open count, so no count is claimed",
    });
  });

  it("claims no partial count when a repository in this context could not be read", () => {
    expect(
      censusPictureOf({
        census: [{ kind: "unread", repo: SW, why: "GitHub answered 502" }],
        context: "slopweaver",
        placer: ACME_PLACER,
        drawn: [],
        rows: [],
        selection: TICK,
      }),
    ).toStrictEqual({
      kind: "unavailable",
      why: [
        {
          lead: `GitHub's open list for ${SW} could not be read`,
          subject: `GitHub's open list for ${SW}`,
          why: "GitHub answered 502",
        },
      ],
    });
  });

  it("claims no count when the census counts a repository the reading was not taken over", () => {
    expect(
      censusPictureOf({
        census: [SLOPWEAVER_17, read({ prs: [pr({ number: 7 })], repo: "acme/other" })],
        context: "work",
        placer: ACME_PLACER,
        drawn: [],
        rows: [],
        selection: TICK,
      }),
    ).toStrictEqual({
      kind: "unavailable",
      why: "this reading's census counts acme/other, which the reading was not taken over, so no count is claimed",
    });
  });

  it("claims no count when the census leaves out a repository the reading was taken over", () => {
    expect(
      censusPictureOf({
        census: [read({ prs: [pr({ number: 17001 })], repo: EV })],
        context: "slopweaver",
        placer: ACME_PLACER,
        drawn: [],
        rows: [],
        selection: TICK,
      }),
    ).toStrictEqual({
      kind: "unavailable",
      why: `this reading was taken over ${SW} but its census does not count it, so no count is claimed`,
    });
  });
});

describe("currentCensusOf", () => {
  const COUNTED = censusPictureOf({
    census: [SLOPWEAVER_17],
    context: "slopweaver",
    placer: ACME_PLACER,
    drawn: [],
    rows: [],
    selection: TICK,
  });
  const NOW = Date.parse("2026-09-26T14:00:00.000Z");

  it("keeps the count up to the 30-minute cadence and withdraws it a second past", () => {
    expect(currentCensusOf({ nowMs: NOW, observedAtIso: "2026-09-26T13:30:00.000Z", picture: COUNTED })).toBe(COUNTED);
    expect(currentCensusOf({ nowMs: NOW, observedAtIso: "2026-09-26T13:29:59.000Z", picture: COUNTED })).toStrictEqual({
      kind: "unavailable",
      why: "the reading it counts is 30 minutes old, past the 30-minute landing cadence",
    });
  });

  it("keeps a picture's own reason for printing no count, however old the reading", () => {
    const predates = censusPictureOf({
      census: undefined,
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: TICK,
    });
    expect(currentCensusOf({ nowMs: NOW, observedAtIso: "2026-09-20T08:00:00.000Z", picture: predates })).toBe(
      predates,
    );
  });

  it("withdraws the count when the reading's instant cannot be read", () => {
    expect(currentCensusOf({ nowMs: NOW, observedAtIso: "not a date", picture: COUNTED })).toStrictEqual({
      kind: "unavailable",
      why: "this reading's instant cannot be read, so it cannot be shown to be inside the 30-minute landing cadence",
    });
  });
});

describe("inlineNumbersOf", () => {
  const many: NotPlacedPr[] = Array.from({ length: INLINE_NUMBERS + 3 }, (_, at) => ({
    ...pr({ number: at + 1 }),
    reason: "not-in-reading",
    repoSlug: EV,
  }));

  it("names every number up to the inline bound", () => {
    expect(inlineNumbersOf({ multiRepo: false, prs: many.slice(0, 2) })).toBe("#1, #2");
  });

  it("names the bound and counts the rest, which the fold lists whole", () => {
    expect(inlineNumbersOf({ multiRepo: false, prs: many })).toBe("#1, #2, #3, #4, #5, #6, #7, #8, #9, #10 and 3 more");
  });

  it("prefixes the repository when the context counts more than one", () => {
    expect(inlineNumbersOf({ multiRepo: true, prs: many.slice(0, 1) })).toBe("acme-admin#1");
  });
});

describe("censusFindingsOf — a census-only pull request no workspace owns is counted as a finding", () => {
  const NEXT = "vercel/next.js";

  it("names one finding for a repository outside acme that only the census carries, in self alone by the default rule", () => {
    const findingsIn = ({ context }: { context: "work" | "slopweaver" }): readonly string[] => {
      const picture = censusPictureOf({
        census: [read({ prs: [pr({ number: 7 })], repo: NEXT })],
        context,
        placer: ACME_PLACER,
        drawn: [],
        rows: [],
        selection: { ...TICK, repos: [NEXT] },
      });
      return censusFindingsOf({ picture, placer: ACME_PLACER }).map((placement) => placement.kind);
    };
    expect(findingsIn({ context: "slopweaver" })).toStrictEqual(["unplaced"]);
    expect(findingsIn({ context: "work" })).toStrictEqual([]);
  });

  it("names none for a pull request a landing row carries, nor for one in a workspace's own repository", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [pr({ number: 7 })], repo: NEXT }), read({ prs: [pr({ number: 1361 })], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [row({ number: 7, repo: NEXT })],
      selection: { ...TICK, repos: [NEXT, SW] },
    });
    expect(picture.kind).toBe("counted");
    expect(censusFindingsOf({ picture, placer: ACME_PLACER })).toStrictEqual([]);
  });

  it("claims no census in either workspace while one of its repositories is unread, as main never sums a part", () => {
    const WEBSITE = "acme/website";
    const census = [
      read({ prs: [pr({ number: 10 })], repo: EV }),
      { kind: "unread" as const, repo: WEBSITE, why: "GitHub answered 502" },
    ];
    const picture = censusPictureOf({
      census,
      context: "work",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, repos: [EV, WEBSITE] },
    });
    expect(picture).toStrictEqual({
      kind: "unavailable",
      why: [
        {
          lead: "GitHub's open list for acme/website could not be read",
          subject: "GitHub's open list for acme/website",
          why: "GitHub answered 502",
        },
      ],
    });
    expect(censusFindingsOf({ picture, placer: ACME_PLACER })).toStrictEqual([]);
  });

  it("places a census pull request by the repository whose list carries it, never by its link", () => {
    const picture = censusPictureOf({
      census: [read({ prs: [{ ...pr({ number: 7 }), url: "https://github.com/acme/acme-admin/pull/7" }], repo: SW })],
      context: "slopweaver",
      placer: ACME_PLACER,
      drawn: [],
      rows: [],
      selection: { ...TICK, repos: [SW] },
    });
    expect(picture.kind).toBe("counted");
    expect(censusFindingsOf({ picture, placer: ACME_PLACER })).toStrictEqual([]);
  });
});
