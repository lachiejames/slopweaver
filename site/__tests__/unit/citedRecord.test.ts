/*
 * What a citation chip's hover card reads about a pull request or Linear ticket: which addresses name one, the
 * landing row it joins, the verbs the route runs, the two verbs' answers narrowed, and the page-life cache. A card
 * that drew another pull request's checks, a guessed ticket state, or ran a verb built from an arbitrary address is
 * caught here without a browser.
 */

import { describe, expect, it } from "vitest";

import type { LandingRow } from "../../components/live/readLanding";
import {
  type CitedRecord,
  type CitedState,
  canonicalCitedAddress,
  citedCache,
  citedPullOf,
  citedReadArgvs,
  citedRecordFor,
  citedRecordOf,
  citedStateOf,
  citedTicketOf,
  landingRowFor,
  ticketStatusOf,
} from "../../lib/citedRecord";
import { tagOf } from "../../lib/reviewHook";

const PULL: Extract<CitedRecord, { kind: "pull" }> = {
  kind: "pull",
  number: 17640,
  repoSlug: "acme/acme-admin",
  url: "https://github.com/acme/acme-admin/pull/17640",
};

const TICKET: Extract<CitedRecord, { kind: "ticket" }> = { key: "SUP-9811", kind: "ticket", team: "SUP" };

const row = ({ number, repoSlug }: { number: number; repoSlug: string }): LandingRow => ({
  action: "blocked-on",
  actionDetail: "detail",
  askTrail: [],
  authorLogin: "octocat",
  baseRefName: "main",
  blockedOn: [],
  boardRowKind: "declared",
  boardRowSlug: undefined,
  boardRowWhy: undefined,
  bump: undefined,
  channelShare: undefined,
  ci: "green",
  ciFailure: { kind: "not-red" },
  codeRabbit: { awaitingUs: 0, open: 0 },
  createdAtIso: "2026-09-23T10:00:00.000Z",
  dispatchKind: undefined,
  dispatchWhy: undefined,
  draft: false,
  failingChecks: [],
  headOid: "abc",
  headRefName: "branch",
  humanWait: undefined,
  humans: { awaitingUs: 0, open: 0 },
  labels: [],
  number,
  repoSlug,
  slackAsked: "none",
  slackBounded: undefined,
  slackWhy: undefined,
  stackPosition: undefined,
  stackSize: undefined,
  stacked: false,
  tests: [],
  title: `pull request ${String(number)}`,
  updatedAtIso: "2026-09-23T11:00:00.000Z",
  url: `https://github.com/${repoSlug}/pull/${String(number)}`,
  verdict: undefined,
  waitingOn: [],
});

describe("citedRecordOf", () => {
  it("reads a pull request, its diff tab and a query or fragment to one canonical address", () => {
    expect([
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/17640" }),
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/17640/files" }),
      citedRecordOf({ url: "https://www.github.com/acme/acme-admin/pull/17640?w=1#discussion_r1" }),
    ]).toEqual([PULL, PULL, PULL]);
  });

  it("reads a Linear issue key and its team, whatever slug follows it", () => {
    expect([
      citedRecordOf({ url: "https://linear.app/acme/issue/SUP-9811/code-the-shared-surface" }),
      citedRecordOf({ url: "https://linear.app/acme/issue/SUP-9811" }),
    ]).toEqual([TICKET, TICKET]);
  });

  it("refuses an issue, a malformed number, a port, credentials, plain http and another host", () => {
    expect([
      citedRecordOf({ url: "https://github.com/acme/acme-admin/issues/12" }),
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/0" }),
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/12abc" }),
      citedRecordOf({ url: "https://github.com:8443/acme/acme-admin/pull/12" }),
      citedRecordOf({ url: "https://me:pw@github.com/acme/acme-admin/pull/12" }),
      citedRecordOf({ url: "http://github.com/acme/acme-admin/pull/12" }),
      citedRecordOf({ url: "https://gitlab.com/acme/acme-admin/pull/12" }),
      citedRecordOf({ url: "https://linear.app/acme/issue/sup-3811" }),
      citedRecordOf({ url: "https://linear.app/acme/project/plugins" }),
      citedRecordOf({ url: "/workstreams?row=a-row" }),
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("refuses a number too long for Number to keep exactly, rather than reading it as Infinity", () => {
    expect([
      citedRecordOf({ url: `https://github.com/acme/acme-admin/pull/${"9".repeat(400)}` }),
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/1234567890" }),
      citedRecordOf({ url: "https://linear.app/acme/issue/SUP-1234567890" }),
      citedRecordOf({ url: "https://github.com/acme/acme-admin/pull/999999999" }),
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      {
        kind: "pull",
        number: 999_999_999,
        repoSlug: "acme/acme-admin",
        url: "https://github.com/acme/acme-admin/pull/999999999",
      },
    ]);
  });

  it("reads a record only from an address, never a board row, queue card or talk turn", () => {
    expect([
      citedRecordFor({ reference: { kind: "address", url: PULL.url } }),
      citedRecordFor({ reference: { kind: "board-row", slug: "a-row" } }),
      citedRecordFor({ reference: { kind: "queue-card", key: "ask:a-row" } }),
      citedRecordFor({ reference: { kind: "talk-turn", id: "t1" } }),
    ]).toEqual([PULL, undefined, undefined, undefined]);
  });
});

describe("canonicalCitedAddress", () => {
  it("gives each record one address that reads back to the same record", () => {
    const addresses = [PULL, TICKET].map((record) => canonicalCitedAddress({ record }));
    expect(addresses).toEqual(["https://github.com/acme/acme-admin/pull/17640", "https://linear.app/issue/SUP-9811"]);
    expect(addresses.map((url) => citedRecordOf({ url }))).toEqual([PULL, TICKET]);
  });
});

describe("landingRowFor", () => {
  const rows = [
    row({ number: 17640, repoSlug: "lachiejames/slopweaver" }),
    row({ number: 17640, repoSlug: "acme/acme-admin" }),
  ];

  it("joins on repository AND number, the repository without case", () => {
    expect(landingRowFor({ landing: { rows }, pull: PULL })).toBe(rows[1]);
    expect(landingRowFor({ landing: { rows }, pull: { number: 17640, repoSlug: "Acme/ACME-Admin" } })).toBe(rows[1]);
  });

  it("answers nothing for a pull request the reading does not hold", () => {
    expect(landingRowFor({ landing: { rows }, pull: { number: 17641, repoSlug: "acme/acme-admin" } })).toBe(undefined);
    expect(landingRowFor({ landing: { rows: [] }, pull: PULL })).toBe(undefined);
  });

  it("draws the page's own next act off the joined row", () => {
    expect(tagOf({ row: landingRowFor({ landing: { rows }, pull: PULL })!, wait: undefined })).toBe("blocked-on");
  });
});

describe("citedReadArgvs", () => {
  it("runs one summary for a pull request and a read plus an unrecorded states read for a ticket", () => {
    expect(citedReadArgvs({ record: PULL }).map((one) => one.argv)).toEqual([
      ["github", "pr", "summary", "https://github.com/acme/acme-admin/pull/17640", "--json"],
    ]);
    expect(citedReadArgvs({ record: TICKET }).map((one) => one.argv)).toEqual([
      ["linear", "read", "SUP-9811", "--json"],
      ["linear", "states", "--team", "SUP", "--no-record", "--json"],
    ]);
  });
});

describe("citedPullOf", () => {
  const summary = { number: 17640, state: "merged", title: "fix: code the throws", url: PULL.url };

  it("reads the title and lifecycle of the pull request asked about", () => {
    expect(citedPullOf({ payload: summary, record: PULL })).toEqual({
      kind: "pull",
      lifecycle: "merged",
      title: "fix: code the throws",
      url: PULL.url,
    });
  });

  it("refuses another pull request's answer, an unknown lifecycle and a missing title", () => {
    expect([
      citedPullOf({ payload: { ...summary, url: "https://github.com/acme/acme-admin/pull/1" }, record: PULL }),
      citedPullOf({ payload: { ...summary, state: "queued" }, record: PULL }),
      citedPullOf({ payload: { ...summary, title: 7 }, record: PULL }),
      citedPullOf({ payload: [], record: PULL }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("citedTicketOf", () => {
  const read = { data: { identifier: "SUP-9811", state: { id: "s-review" }, title: "Code the clusters" } };
  const states = {
    states: [
      { id: "s-todo", name: "Todo", type: "unstarted" },
      { id: "s-review", name: "In Review", type: "started" },
    ],
    team: { id: "t", key: "SUP" },
  };

  it("names the ticket's state by joining its id to the team's states", () => {
    expect(citedTicketOf({ read, record: TICKET, states })).toEqual({
      key: "SUP-9811",
      kind: "ticket",
      state: "In Review",
      stateType: "started",
      title: "Code the clusters",
    });
  });

  it("refuses a state id the team does not hold, another ticket, and another team's states", () => {
    expect([
      citedTicketOf({ read: { data: { ...read.data, state: { id: "s-gone" } } }, record: TICKET, states }),
      citedTicketOf({ read: { data: { ...read.data, identifier: "SUP-1" } }, record: TICKET, states }),
      citedTicketOf({ read, record: TICKET, states: { ...states, team: { id: "t", key: "INFR" } } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("ticketStatusOf", () => {
  it("draws a state by Linear's category, never its name", () => {
    expect(
      ["completed", "canceled", "duplicate", "started", "unstarted", "backlog", "triage"].map((stateType) =>
        ticketStatusOf({ stateType }),
      ),
    ).toEqual(["done", "cancelled", "cancelled", "inProgress", "open", "open", "open"]);
  });
});

describe("citedStateOf", () => {
  it("reads a pull request and a ticket the route answered", () => {
    const pull = { kind: "pull", lifecycle: "open", title: "t", url: PULL.url };
    const ticket = { key: "SUP-9811", kind: "ticket", state: "Todo", stateType: "unstarted", title: "t" };
    expect([
      citedStateOf({ body: { observedAtIso: "2026-09-28T00:00:00Z", ok: true, read: pull } }),
      citedStateOf({ body: { observedAtIso: "2026-09-28T00:00:00Z", ok: true, read: ticket } }),
    ]).toEqual([
      { observedAtIso: "2026-09-28T00:00:00Z", phase: "ready", read: pull },
      { observedAtIso: "2026-09-28T00:00:00Z", phase: "ready", read: ticket },
    ]);
  });

  it("carries the route's own reason, and names a shape it does not read", () => {
    expect([
      citedStateOf({ body: { notMeasured: "linear read timed out", observedAtIso: "x", ok: false } }),
      citedStateOf({ body: "nope" }),
      citedStateOf({ body: { observedAtIso: "x", ok: true, read: { kind: "pull", title: "t" } } }),
    ]).toEqual([
      { phase: "not-measured", why: "linear read timed out" },
      { phase: "not-measured", why: "/api/cited answered something that is not its own shape" },
      { phase: "not-measured", why: "/api/cited answered a pull request missing its fields" },
    ]);
  });
});

describe("citedCache", () => {
  const ready: Extract<CitedState, { phase: "ready" }> = {
    observedAtIso: "2026-09-28T00:00:00Z",
    phase: "ready",
    read: { kind: "pull", lifecycle: "open", title: "t", url: PULL.url },
  };

  it("rides one read in flight and keeps a ready answer", async () => {
    const asked: string[] = [];
    const cache = citedCache({
      lookup: async (url) => {
        asked.push(url);
        return ready;
      },
    });
    const [first, second] = await Promise.all([cache.read(PULL.url), cache.read(PULL.url)]);
    expect(asked).toEqual([PULL.url]);
    expect([first, second, cache.kept(PULL.url)]).toEqual([ready, ready, ready]);
  });

  it("keeps the last ready answer over a later failed read, answering it stale with the failure's reason", async () => {
    const answers: Exclude<CitedState, { phase: "loading" }>[] = [ready, { phase: "not-measured", why: "gone" }];
    const cache = citedCache({ lookup: async () => answers.shift()! });
    await cache.read(PULL.url);
    const failed = await cache.read(PULL.url);
    expect([failed, cache.kept(PULL.url)]).toEqual([{ ...ready, stale: { why: "gone" } }, ready]);
  });

  it("answers a failure as itself when no earlier read was ready", async () => {
    const cache = citedCache({ lookup: async () => ({ phase: "not-measured", why: "gone" }) });
    expect([await cache.read(PULL.url), cache.kept(PULL.url)]).toEqual([
      { phase: "not-measured", why: "gone" },
      undefined,
    ]);
  });

  it("answers a newer ready read over a stale one, clearing the mark", async () => {
    const newer = { ...ready, observedAtIso: "2026-09-29T00:00:00Z" };
    const answers: Exclude<CitedState, { phase: "loading" }>[] = [ready, { phase: "not-measured", why: "gone" }, newer];
    const cache = citedCache({ lookup: async () => answers.shift()! });
    await cache.read(PULL.url);
    await cache.read(PULL.url);
    expect([await cache.read(PULL.url), cache.kept(PULL.url)]).toEqual([newer, newer]);
  });
});
