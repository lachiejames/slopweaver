import { describe, expect, it } from "vitest";
import { landingInCadenceOf, landingStaleAtOf, pullRequestsLineOf } from "../../lib/fleetDoctrinePulls";
import { unseatableLineOf } from "../../lib/fleetDoctrineRows";
import type { DoctrineLanding } from "../../lib/fleetDoctrineTypes";
import { boardOf, boardRow, landingOf, lists, placedOn, reconcileOf, url } from "./fleetDoctrineFixture";

describe("pullRequestsLineOf", () => {
  // A line withdrawn over its seats still names each open pull request of the owner's it read.
  const uncheckedPr1 = {
    items: [{ href: url({ n: 1 }), key: url({ n: 1 }), text: "acme/app#1 change 1 · CI not read" }],
    label: "yours, open, and whether a seat is on each was not checked",
  };

  it("counts the owner's open pull requests nobody is on, with drafts and CI, and leaves out a colleague's", () => {
    const landing = landingOf({
      prs: [
        { author: "owner", isDraft: true, n: 1 },
        { author: "owner", isDraft: true, n: 2 },
        { author: "owner", isDraft: false, n: 3 },
        { author: "owner", isDraft: false, n: 4 },
        { author: "owner", isDraft: false, n: 5 },
        { author: "colleague", isDraft: false, n: 6 },
      ],
      rows: [
        { boardRowKind: "none-declared", boardRowSlug: undefined, ci: "red", url: url({ n: 1 }) },
        { boardRowKind: "none-declared", boardRowSlug: undefined, ci: "green", url: url({ n: 3 }) },
        { boardRowKind: "row", boardRowSlug: "abc-branch", ci: "red", url: url({ n: 5 }) },
      ],
    });
    const reconcile = reconcileOf({ aligned: [placedOn({ id: "abc-branch" }), placedOn({ id: "abc-named" })] });
    const board = [boardRow({ prUrls: [url({ n: 4 })], slug: "abc-named" })];
    const line = pullRequestsLineOf({
      board: boardOf({ rows: board }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcile },
    });
    // The second pull request has no landing row, so with seats placed whether one is on its branch's row was not checked.
    expect(line.sentence).toBe(
      "At least 2 of your 5 open pull requests have no seat on them: at least 1 draft, at least 1 with CI red; whether a seat is on 1 more was not checked.",
    );
    expect(line.tone).toBe("attention");
    expect(line.groups).toEqual([
      {
        items: [
          { href: url({ n: 1 }), key: url({ n: 1 }), text: "acme/app#1 change 1 · draft · CI red" },
          { href: url({ n: 3 }), key: url({ n: 3 }), text: "acme/app#3 change 3" },
        ],
        label: "yours, open, and no live seat on them",
      },
      {
        items: [{ href: url({ n: 2 }), key: url({ n: 2 }), text: "acme/app#2 change 2 · draft · CI not read" }],
        label: "not checked: no landing row joins its branch to a board row, so a seat on that row was not seen",
      },
    ]);
  });

  it("never counts a pull request with no landing row as unseated while a seat is placed", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrls: [], slug: "draft-branch" })] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: true, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "draft-branch" })] }) },
    });
    expect(line.sentence).toBe(
      "None of the open pull requests looked at is without a seat; whether a seat is on 1 of your 1 open pull request was not checked.",
    );
    expect(line.tone).toBe("unread");
    expect(line.groups.map((group) => group.items.map((item) => item.key))).toEqual([[url({ n: 1 })]]);
  });

  it("reads a board join of a kind outside the verb's two as no join, never as none declared", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrls: [], slug: "x" })] }),
      landing: {
        kind: "read",
        value: landingOf({
          prs: [{ author: "owner", isDraft: false, n: 1 }],
          rows: [{ boardRowKind: "row-v2", boardRowSlug: undefined, ci: "green", url: url({ n: 1 }) }],
        }),
      },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "x" })] }) },
    });
    expect(line.sentence).toBe(
      "None of the open pull requests looked at is without a seat; whether a seat is on 1 of your 1 open pull request was not checked.",
    );
    expect(line.tone).toBe("unread");
  });

  it("prints the red count plainly once every unseated pull request's CI was read", () => {
    const landing = landingOf({
      prs: [
        { author: "owner", isDraft: true, n: 1 },
        { author: "owner", isDraft: false, n: 2 },
      ],
      rows: [
        { boardRowKind: "none-declared", boardRowSlug: undefined, ci: "red", url: url({ n: 1 }) },
        { boardRowKind: "none-declared", boardRowSlug: undefined, ci: "green", url: url({ n: 2 }) },
      ],
    });
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcileOf({}) },
    });
    expect(line.sentence).toBe("2 of your 2 open pull requests have no seat on them: 1 draft, 1 with CI red.");
  });

  it("reads a CI word outside the verb's vocabulary as CI not read, never as not red", () => {
    const landing = landingOf({
      prs: [{ author: "owner", isDraft: false, n: 1 }],
      rows: [{ boardRowKind: "none-declared", boardRowSlug: undefined, ci: "purple", url: url({ n: 1 }) }],
    });
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcileOf({}) },
    });
    expect(line.sentence).toBe(
      "1 of your 1 open pull request has no seat on it: 0 draft, at least 0 with CI red (CI was not read on 1).",
    );
    expect(line.groups[0].items[0].text).toBe("acme/app#1 change 1 · CI not read");
  });

  it("is not read when a seat sits on a row an incomplete board did not show", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [], unreadable: ["abc-hidden.md"] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "abc-hidden" })] }) },
    });
    expect(line).toEqual({
      groups: [uncheckedPr1],
      key: "pull-requests",
      notRead: {
        lead: "Your open pull requests with no seat: not read.",
        reasons: ["a seat is on abc-hidden, which the board did not show, and the board could not read abc-hidden.md"],
      },
      quoted: [],
      sentence:
        "Your open pull requests with no seat: not read (a seat is on abc-hidden, which the board did not show, and the board could not read abc-hidden.md).",
      tone: "unread",
    });
  });

  it("counts in full over a board gap no placed seat sits behind, since a seat comes from the reconcile", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [], unreadable: ["broken-row.md"] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect(line.sentence).toBe(
      "1 of your 1 open pull request has no seat on it: 0 draft, at least 0 with CI red (CI was not read on 1).",
    );
    expect(line.tone).toBe("attention");
  });

  it("is not read over a board gap beside a seat on a shown row, since the unread doc can claim the same slug", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrls: [], slug: "x" })], unreadable: ["hidden.md"] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "x" })] }) },
    });
    expect(line).toEqual({
      groups: [uncheckedPr1],
      key: "pull-requests",
      notRead: {
        lead: "Your open pull requests with no seat: not read.",
        reasons: ["a seat is on x, and the board could not read hidden.md"],
      },
      quoted: [],
      sentence:
        "Your open pull requests with no seat: not read (a seat is on x, and the board could not read hidden.md).",
      tone: "unread",
    });
  });

  it("says every one has a seat when every one does", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrls: [url({ n: 1 })], slug: "abc-named" })] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "abc-named" })] }) },
    });
    expect(line).toEqual({
      groups: [],
      key: "pull-requests",
      quoted: [],
      sentence: "Every one of your 1 open pull request has a seat on it.",
      tone: "ok",
    });
  });

  it("is not read when a placed row's pull requests did not all read, since a seat could hide there", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrlsPartial: true, slug: "abc-named" })] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ unprioritised: [placedOn({ id: "abc-named" })] }) },
    });
    expect(line.sentence).toBe(
      "Your open pull requests with no seat: not read (a seat is on board row abc-named, and the pull requests it names did not all read).",
    );
    expect(line.tone).toBe("unread");
  });

  it("is not read when the reconcile did not see the live fleet, since its placements prove no seat", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrls: [url({ n: 1 })], slug: "abc" })] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ fleet: "unavailable", misaligned: [placedOn({ id: "abc" })] }) },
    });
    expect(line.sentence).toBe(
      "Your open pull requests with no seat: not read (the board reconcile did not see the live fleet (unavailable), so no seat it places was checked (abc)).",
    );
    expect(line.tone).toBe("unread");
  });

  it("reads the rows line not read over an unobserved fleet, since a missed seat lowers the count and no floor holds", () => {
    const reconcile = reconcileOf({
      fleet: "unavailable",
      holds: { kind: "read", lists: lists({ repoless: ["x"] }) },
    });
    const rows = unseatableLineOf({ board: boardOf({ rows: [] }), reconcile: { kind: "read", value: reconcile } });
    // A seat nobody saw could be on x, so x is named rather than only the gap.
    expect(rows).toEqual({
      groups: [
        {
          items: [{ href: undefined, key: "x", text: "x" }],
          label: "no live seat placed, and whether one is on it was not checked",
        },
      ],
      key: "unseatable",
      notRead: {
        lead: "Board rows kept from a seat: not read.",
        reasons: ["the board reconcile did not see the live fleet (unavailable), so no seat it places was checked"],
      },
      quoted: [],
      sentence:
        "Board rows kept from a seat: not read (the board reconcile did not see the live fleet (unavailable), so no seat it places was checked).",
      tone: "unread",
    });
    const older = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcileOf({ fleet: undefined }) },
    });
    expect(older.sentence).toBe(
      "Board rows kept from a seat: not read (the board reconcile predates saying whether it saw the live fleet, so no seat it places was checked).",
    );
  });

  it("names an unread open list and an unobserved fleet together on the pull-request line", () => {
    const landing: DoctrineLanding = { census: [{ kind: "unread", repo: "acme/app", why: "rate limited" }], rows: [] };
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcileOf({ fleet: "unavailable" }) },
    });
    expect([line.sentence, line.quoted]).toEqual([
      "Your open pull requests with no seat: not read (the board reconcile did not see the live fleet (unavailable), so no seat it places was checked).",
      [{ lead: "GitHub's open list for acme/app did not read", why: "rate limited" }],
    ]);
  });

  it("names every other place not checked beside an unobserved fleet, never only the fleet", () => {
    const reconcile = reconcileOf({
      aligned: [placedOn({ id: "abc" })],
      fleet: "unavailable",
      holds: {
        kind: "read",
        lists: lists({ released: { kind: "unread", unreadableIds: ["released-x"], why: "journal unreadable" } }),
      },
    });
    const rows = unseatableLineOf({
      board: boardOf({ rows: [], unreadable: ["hidden.md"] }),
      reconcile: { kind: "read", value: reconcile },
    });
    // The journal's own reason sits beneath the sentence, never inside it (steer 7).
    expect([rows.sentence, rows.quoted]).toEqual([
      "Board rows kept from a seat: not read (the board reconcile did not see the live fleet (unavailable), so no seat it places was checked (abc); the board could not read hidden.md).",
      [{ lead: "released runs were not counted (released-x)", why: "journal unreadable" }],
    ]);
  });

  it("is not read when a placed row published no pull-request list at all, never reading it as naming none", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [boardRow({ prUrlsAbsent: true, slug: "abc" })] }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: { kind: "read", value: reconcileOf({ misaligned: [placedOn({ id: "abc" })] }) },
    });
    expect(line.sentence).toBe(
      "Your open pull requests with no seat: not read (a seat is on board row abc, and the pull requests it names did not all read).",
    );
    expect(line.tone).toBe("unread");
  });

  it("names every placed row it could not check, both kinds, never only the first", () => {
    const line = pullRequestsLineOf({
      board: boardOf({
        rows: [boardRow({ prUrlsPartial: true, slug: "beta" }), boardRow({ prUrlsPartial: true, slug: "alpha" })],
        unreadable: ["gamma.md", "delta.md"],
      }),
      landing: { kind: "read", value: landingOf({ prs: [{ author: "owner", isDraft: false, n: 1 }] }) },
      reconcile: {
        kind: "read",
        value: reconcileOf({
          unprioritised: [
            placedOn({ id: "alpha" }),
            placedOn({ id: "beta" }),
            placedOn({ id: "gamma" }),
            placedOn({ id: "delta" }),
          ],
        }),
      },
    });
    expect(line.sentence).toBe(
      "Your open pull requests with no seat: not read (seats are on alpha, beta, delta, gamma (the board did not show delta, gamma), and the board could not read gamma.md; the board could not read delta.md; seats are on board rows alpha, beta, and the pull requests they name did not all read).",
    );
    expect(line.tone).toBe("unread");
  });

  it("is not read when one repository's open list did not read", () => {
    const landing: DoctrineLanding = { census: [{ kind: "unread", repo: "acme/app", why: "rate limited" }], rows: [] };
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect([line.sentence, line.quoted]).toEqual([
      "Your open pull requests with no seat: not read.",
      [{ lead: "GitHub's open list for acme/app did not read", why: "rate limited" }],
    ]);
  });

  it("names every repository whose open list did not read, never only the first", () => {
    const stack = "Error: socket hang up; retry\n    at TLSSocket.onClose (node:_http_client:1:1)";
    const landing: DoctrineLanding = {
      census: [
        { kind: "unread", repo: "acme/app", why: "HTTP 429 Too Many Requests" },
        { kind: "unread", repo: "acme/other", why: stack },
      ],
      rows: [],
    };
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: landing },
      reconcile: { kind: "read", value: reconcileOf() },
    });
    // Each repository's reason is its own entry, byte for byte, never joined with another's (steer 7).
    expect([line.sentence, line.quoted]).toEqual([
      "Your open pull requests with no seat: not read.",
      [
        { lead: "GitHub's open list for acme/app did not read", why: "HTTP 429 Too Many Requests" },
        { lead: "GitHub's open list for acme/other did not read", why: stack },
      ],
    ]);
    expect(line.tone).toBe("unread");
  });

  it("is not read when the landing reading predates the census", () => {
    const line = pullRequestsLineOf({
      board: boardOf({ rows: [] }),
      landing: { kind: "read", value: { census: undefined, rows: [] } },
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect(line.sentence).toBe(
      "Your open pull requests with no seat: not read (the landing reading predates GitHub's own open list).",
    );
  });
});

describe("landingInCadenceOf", () => {
  // The census in `landingOf` starts at the fixture's census instant, before the reading's own instant, so it is what the age runs from.
  const reading = {
    kind: "read",
    value: { landing: landingOf({ prs: [] }), observedAtIso: "2026-11-03T06:02:00.000Z" },
  } as const;

  it("counts a reading inside the landing cadence, aged from its oldest census", () => {
    const nowMs = Date.parse("2026-11-03T06:30:00.000Z");
    expect(landingInCadenceOf({ nowMs, reading })).toEqual({ kind: "read", value: landingOf({ prs: [] }) });
  });

  it("names the instant a reading passes the cadence, aged from its oldest census", () => {
    expect(landingStaleAtOf({ reading })).toBe(Date.parse("2026-11-03T06:30:00.000Z"));
    expect(landingStaleAtOf({ reading: { kind: "unread", why: "loading" } })).toBe(undefined);
  });

  it("refuses a reading even a fraction of a minute past the cadence", () => {
    const nowMs = Date.parse("2026-11-03T06:30:30.000Z");
    expect(landingInCadenceOf({ nowMs, reading })).toEqual({
      kind: "unread",
      why: "the landing reading is 30m 30s old, past the 30-minute landing cadence",
    });
  });

  it("refuses a reading past the landing cadence, however cleanly it re-reads", () => {
    const nowMs = Date.parse("2026-11-04T00:00:00.000Z");
    expect(landingInCadenceOf({ nowMs, reading })).toEqual({
      kind: "unread",
      why: "the landing reading is 1080m 0s old, past the 30-minute landing cadence",
    });
  });

  it("passes an unread reading through, and refuses one whose instant does not read", () => {
    const unread = { kind: "unread", why: "the landing reading is still loading", pending: true } as const;
    expect(landingInCadenceOf({ nowMs: 0, reading: unread })).toEqual(unread);
    const bad = { kind: "read", value: { landing: { census: undefined, rows: [] }, observedAtIso: "soon" } } as const;
    expect(landingInCadenceOf({ nowMs: 0, reading: bad })).toEqual({
      kind: "unread",
      why: "the landing reading's instant did not read (soon)",
    });
  });
});
