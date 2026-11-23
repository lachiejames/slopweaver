import { describe, expect, it } from "vitest";

import type { RunDisposition } from "../../../handover/boardTypes.js";
import type { RepoCensus } from "../../../live/github/openCensus.js";
import { registrationSlug } from "../../../review/boardAtHead.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import {
  closureCandidates,
  closureSettleArgv,
  closureWitness,
  registrationOf,
} from "../../../review/landingClosure.js";

const REPOS = ["octo-self/slopweaver", "acme/acme-admin"];

/** A read census listing exactly these open numbers. */
const census = ({ repo, open }: { repo: string; open: readonly number[] }): RepoCensus => ({
  kind: "read",
  pullRequests: open.map((number) => ({
    author: "ada",
    isDraft: false,
    number,
    title: "open",
    url: `https://github.com/${repo}/pull/${String(number)}`,
  })),
  repo,
  startedAtIso: "2026-10-10T06:00:00Z",
  totalCount: open.length,
  viewer: "ada",
});

const row = ({
  slug,
  status = "ready",
  run = "never-started",
}: {
  slug: string;
  status?: string;
  run?: RunDisposition["kind"];
}): LandingBoardRow => ({ kind: "row", run, slug, status });

describe("registrationOf", () => {
  it("reads back exactly the repository and number registrationSlug wrote", () => {
    const slug = registrationSlug({
      row: { headOid: "5cf03b1aaaaaaaaa", number: 2027, repoSlug: "octo-self/slopweaver" },
    });
    expect(registrationOf({ repos: REPOS, slug })).toEqual({ number: 2027, repoSlug: "octo-self/slopweaver" });
  });

  it("leaves a hand-filed narrower row alone, which keeps the prefix and adds its own word", () => {
    expect(registrationOf({ repos: REPOS, slug: "land-acme-acme-admin-16339-4d43359-cr" })).toBe(undefined);
  });

  it("leaves a slug of a repository this read did not select alone", () => {
    expect(registrationOf({ repos: ["acme/acme-admin"], slug: "land-octo-self-slopweaver-2027-5cf03b1" })).toBe(
      undefined,
    );
  });

  it("refuses to guess between two selected repositories whose kebab runs collide", () => {
    expect(registrationOf({ repos: ["a/b-c", "a-b/c"], slug: "land-a-b-c-12-abcdef0" })).toBe(undefined);
  });
});

describe("closureCandidates", () => {
  it("names a ready row whose pull request a read census no longer lists", () => {
    const answer = closureCandidates({
      census: [census({ open: [1998], repo: "octo-self/slopweaver" })],
      repos: REPOS,
      rows: [row({ slug: "land-octo-self-slopweaver-2027-5cf03b1" })],
    });
    expect(answer.candidates).toEqual([
      { number: 2027, repoSlug: "octo-self/slopweaver", slug: "land-octo-self-slopweaver-2027-5cf03b1" },
    ]);
    expect(answer.held).toEqual([]);
  });

  it("never names a row whose pull request is still open, whatever head it was filed at", () => {
    const answer = closureCandidates({
      census: [census({ open: [2027], repo: "octo-self/slopweaver" })],
      repos: REPOS,
      rows: [row({ slug: "land-octo-self-slopweaver-2027-0000000" })],
    });
    expect(answer).toEqual({ candidates: [], held: [] });
  });

  it("names nothing for a repository whose census is unread, since absence from it proves nothing", () => {
    const answer = closureCandidates({
      census: [{ kind: "unread", repo: "octo-self/slopweaver", why: "GitHub answered 502" }],
      repos: REPOS,
      rows: [row({ slug: "land-octo-self-slopweaver-2027-5cf03b1" })],
    });
    expect(answer).toEqual({ candidates: [], held: [] });
  });

  it("skips a terminal row and collapses one row seen on two branches", () => {
    const ready = row({ slug: "land-octo-self-slopweaver-2027-5cf03b1" });
    const answer = closureCandidates({
      census: [census({ open: [], repo: "octo-self/slopweaver" })],
      repos: REPOS,
      rows: [ready, ready, row({ slug: "land-octo-self-slopweaver-1997-3260cf4", status: "done" })],
    });
    expect(answer.candidates.map((one) => one.slug)).toEqual(["land-octo-self-slopweaver-2027-5cf03b1"]);
  });

  it("holds a paused and an in-progress row, saying why, rather than settling under a person or a seat", () => {
    const answer = closureCandidates({
      census: [census({ open: [], repo: "acme/acme-admin" })],
      repos: REPOS,
      rows: [
        row({ slug: "land-acme-acme-admin-18152-3180389", status: "paused" }),
        row({ slug: "land-acme-acme-admin-18010-b25dc94", status: "in-progress" }),
      ],
    });
    expect(answer.candidates).toEqual([]);
    expect(answer.held.map((one) => [one.slug, one.why])).toEqual([
      ["land-acme-acme-admin-18152-3180389", "it is paused on a person, and that is a state rather than a countdown"],
      [
        "land-acme-acme-admin-18010-b25dc94",
        "it is in-progress, not ready, so nothing here is sure the row is unattended",
      ],
    ]);
  });

  // `handover start` leaves the authored `ready` in place, so status alone let a settle
  // run under a live seat.
  it("holds a READY row whose run is active, and one whose run nobody read", () => {
    const answer = closureCandidates({
      census: [census({ open: [], repo: "octo-self/slopweaver" })],
      repos: REPOS,
      rows: [
        row({ run: "active", slug: "land-octo-self-slopweaver-2027-5cf03b1" }),
        { kind: "row", slug: "land-octo-self-slopweaver-1997-3260cf4", status: "ready" },
        row({ run: "orphaned", slug: "land-octo-self-slopweaver-1940-6383b28" }),
      ],
    });
    expect(answer.candidates).toEqual([]);
    expect(answer.held.map((one) => one.why)).toEqual([
      "its run is active, and that run ends it",
      "its run was not read, so nothing here is sure the row is unattended",
      "its run is orphaned, which a settle would have to judge — left for a session",
    ]);
  });

  it("settles over a run that finished its own cycle", () => {
    const answer = closureCandidates({
      census: [census({ open: [], repo: "octo-self/slopweaver" })],
      repos: REPOS,
      rows: [row({ run: "finished", slug: "land-octo-self-slopweaver-2027-5cf03b1" })],
    });
    expect(answer.candidates.map((one) => one.number)).toEqual([2027]);
  });
});

describe("closureWitness", () => {
  it("names the merge commit and instant of a merged pull request", () => {
    expect(
      closureWitness({
        closure: {
          mergeCommitOid: "3c92c09714",
          mergedAt: "2026-10-09T20:34:00Z",
          state: "MERGED",
          url: "https://github.com/octo-self/slopweaver/pull/2027",
        },
      }),
    ).toBe("https://github.com/octo-self/slopweaver/pull/2027 merged at 3c92c09714 (2026-10-09T20:34:00Z)");
  });

  it("names the close instant of a pull request closed unmerged", () => {
    expect(
      closureWitness({
        closure: { closedAt: "2026-10-08T01:00:00Z", state: "CLOSED", url: "https://github.com/a/b/pull/1" },
      }),
    ).toBe("https://github.com/a/b/pull/1 closed unmerged at 2026-10-08T01:00:00Z");
  });

  it("names nothing while GitHub still reads it open", () => {
    expect(closureWitness({ closure: { state: "OPEN", url: "https://github.com/a/b/pull/1" } })).toBe(undefined);
  });
});

describe("closureSettleArgv", () => {
  it("settles answered with the witness, and carries --home when given", () => {
    expect(closureSettleArgv({ home: "/tmp/home", slug: "land-a-b-1-abcdef0", witness: "w" })).toEqual([
      "node",
      "slopweaver",
      "handover",
      "settle",
      "land-a-b-1-abcdef0",
      "--as",
      "answered",
      "--witness",
      "w",
      "--home",
      "/tmp/home",
    ]);
  });
});
