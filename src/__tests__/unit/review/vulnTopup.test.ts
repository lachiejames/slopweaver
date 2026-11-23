import { describe, expect, it } from "vitest";

import { packageHasOpenPr, topupRowsInFlight, vulnTopupBatch } from "../../../review/vulnTopup.js";
import { alert, capped, entry, REPO, ruling } from "../../vulnTopupFixture.js";

describe("vulnTopupBatch", () => {
  it("raises every eligible alert, one per package, with no backfill, when the row sets no cap", () => {
    const plan = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 5, firstPatchedVersion: "1.0.0", number: 1, packageName: "low-one" }),
        alert({ cvssScore: 9.8, firstPatchedVersion: "1.0.0", number: 2, packageName: "worst" }),
        alert({ cvssScore: 7.5, firstPatchedVersion: "1.0.0", number: 3, packageName: "middle" }),
        alert({ cvssScore: 6, firstPatchedVersion: "1.0.0", number: 4, packageName: "worst" }),
      ],
      capacity: { kind: "uncapped" },
      entries: [entry({ number: 500, title: "fix(security): bump middle" })],
      notABump: [],
      repo: REPO,
    });

    expect(plan).toMatchObject({ reserve: [], ruledOut: [] });
    expect(plan.batch.map((candidate) => candidate.packageName)).toEqual(["worst", "low-one"]);
  });

  it("takes the worst alerts first, one per package, up to the room under the cap", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 5, firstPatchedVersion: "1.0.0", number: 1, packageName: "low-one" }),
        alert({ cvssScore: 9.8, firstPatchedVersion: "1.0.0", number: 2, packageName: "worst" }),
        alert({ cvssScore: 7.5, firstPatchedVersion: "1.0.0", number: 3, packageName: "middle" }),
      ],
      entries: [],
      capacity: capped({ remaining: 2 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.map((candidate) => candidate.packageName)).toEqual(["worst", "middle"]);
  });

  it("keeps only the WORST alert of a package that has several", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 4, firstPatchedVersion: "1.0.0", number: 10, packageName: "same" }),
        alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 11, packageName: "same" }),
      ],
      entries: [],
      capacity: capped({ remaining: 5 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.length).toBe(1);
    expect(batch[0]!.alertNumber).toBe(11);
  });

  it("excludes a package an open pull request already names in its title", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 1, packageName: "axios" }),
        alert({ cvssScore: 8, firstPatchedVersion: "1.0.0", number: 2, packageName: "hono" }),
      ],
      entries: [entry({ number: 500, title: "fix(security): bump axios 1.13.6 -> 1.19.0" })],
      capacity: capped({ remaining: 5 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.map((candidate) => candidate.packageName)).toEqual(["hono"]);
  });

  it("excludes a package whose name carries punctuation the title word split drops", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({
          cvssScore: 9,
          firstPatchedVersion: "1.0.0",
          number: 1,
          packageName: "org.springframework:spring-webmvc",
        }),
        alert({ cvssScore: 8, firstPatchedVersion: "1.0.0", number: 2, packageName: "hono" }),
      ],
      entries: [entry({ number: 500, title: "fix(security): bump org.springframework:spring-webmvc" })],
      capacity: capped({ remaining: 5 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.map((candidate) => candidate.packageName)).toEqual(["hono"]);
  });

  it("skips an alert GitHub gave no package name for, rather than carrying one nobody can act on", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 9.9, firstPatchedVersion: "1.0.0", number: 1, packageName: undefined }),
        alert({ cvssScore: 8, firstPatchedVersion: "1.0.0", number: 2, packageName: "real" }),
      ],
      entries: [],
      capacity: capped({ remaining: 5 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.map((candidate) => candidate.packageName)).toEqual(["real"]);
  });

  it("plans nothing at all when the cap leaves no room", () => {
    const { batch } = vulnTopupBatch({
      alerts: [alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 1, packageName: "axios" })],
      entries: [],
      capacity: capped({ remaining: 0 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch).toEqual([]);
  });

  it("plans nothing when every open alert is already covered", () => {
    const { batch } = vulnTopupBatch({
      alerts: [alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 1, packageName: "axios" })],
      entries: [entry({ number: 1, title: "fix(security): bump axios" })],
      capacity: capped({ remaining: 5 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch).toEqual([]);
  });

  it("carries the alert's citation and patched floor through to the candidate", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 42, packageName: "axios", severity: "critical" }),
      ],
      entries: [],
      capacity: capped({ remaining: 1 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch[0]!.htmlUrl).toBe("https://github.com/owner/name/security/dependabot/42");
    expect(batch[0]!.ghsaId).toBe("GHSA-42");
    expect(batch[0]!.severity).toBe("critical");
    expect(batch[0]!.firstPatchedVersion).toBe("1.0.0");
  });

  it("reports no patched floor when the advisory names none, rather than inventing one", () => {
    const { batch } = vulnTopupBatch({
      alerts: [alert({ cvssScore: 9, firstPatchedVersion: undefined, number: 7, packageName: "axios" })],
      entries: [],
      capacity: capped({ remaining: 1 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch[0]!.firstPatchedVersion).toBe(undefined);
  });

  it("breaks a CVSS tie by alert number, so two reads of the same world agree", () => {
    const { batch } = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 7.5, firstPatchedVersion: "1.0.0", number: 20, packageName: "later" }),
        alert({ cvssScore: 7.5, firstPatchedVersion: "1.0.0", number: 9, packageName: "earlier" }),
      ],
      entries: [],
      capacity: capped({ remaining: 2 }),
      notABump: [],
      repo: REPO,
    });

    expect(batch.map((candidate) => candidate.packageName)).toEqual(["earlier", "later"]);
  });

  // A batch from `github vuln list --repo acme/acme-admin`: happy-dom first,
  // @fastify/reply-from second, and the seat parked the whole batch asking whether to take the next alert.
  it("skips a package ruled not a bump and backfills its slot from the next-ranked alert", () => {
    const plan = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 8.8, firstPatchedVersion: "20.0.0", number: 1141, packageName: "happy-dom" }),
        alert({ cvssScore: 8.6, firstPatchedVersion: "11.0.0", number: 628, packageName: "@fastify/reply-from" }),
        alert({
          cvssScore: 8.6,
          firstPatchedVersion: "1.24.0",
          number: 1108,
          packageName: "@modelcontextprotocol/sdk",
        }),
        alert({ cvssScore: 8.1, firstPatchedVersion: "5.3.2", number: 1051, packageName: "fastify" }),
        alert({ cvssScore: 8.1, firstPatchedVersion: "1.8.3", number: 1084, packageName: "shell-quote" }),
        alert({ cvssScore: 7.5, firstPatchedVersion: "8.5.0", number: 842, packageName: "find-my-way" }),
      ],
      entries: [],
      capacity: capped({ remaining: 2 }),
      notABump: [ruling({ packageName: "fastify" }), ruling({ packageName: "@fastify/*" })],
      repo: REPO,
    });

    expect(plan.batch.map((candidate) => candidate.packageName)).toEqual(["happy-dom", "@modelcontextprotocol/sdk"]);
    expect(plan.reserve.map((candidate) => candidate.packageName)).toEqual(["shell-quote", "find-my-way"]);
    expect(plan.ruledOut).toEqual(["@fastify/reply-from", "fastify"]);
  });

  it("plans the same batch as before when no ruling covers anything, with the next ones as backfill", () => {
    const plan = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 8.8, firstPatchedVersion: "20.0.0", number: 1141, packageName: "happy-dom" }),
        alert({ cvssScore: 8.6, firstPatchedVersion: "11.0.0", number: 628, packageName: "@fastify/reply-from" }),
        alert({
          cvssScore: 8.6,
          firstPatchedVersion: "1.24.0",
          number: 1108,
          packageName: "@modelcontextprotocol/sdk",
        }),
      ],
      entries: [],
      capacity: capped({ remaining: 2 }),
      notABump: [],
      repo: REPO,
    });

    expect(plan.batch.map((candidate) => candidate.packageName)).toEqual(["happy-dom", "@fastify/reply-from"]);
    expect(plan.reserve.map((candidate) => candidate.packageName)).toEqual(["@modelcontextprotocol/sdk"]);
    expect(plan.ruledOut).toEqual([]);
  });

  it("applies a ruling only in the repository it names", () => {
    const plan = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 8.6, firstPatchedVersion: "11.0.0", number: 628, packageName: "@fastify/reply-from" }),
      ],
      entries: [],
      capacity: capped({ remaining: 1 }),
      notABump: [ruling({ packageName: "@fastify/*", repo: "owner/other" })],
      repo: REPO,
    });

    expect(plan.batch.map((candidate) => candidate.packageName)).toEqual(["@fastify/reply-from"]);
    expect(plan.ruledOut).toEqual([]);
  });

  it("reads an exact ruling as the whole name and a scope ruling as that scope alone", () => {
    const plan = vulnTopupBatch({
      alerts: [
        alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 1, packageName: "fastify" }),
        alert({ cvssScore: 8, firstPatchedVersion: "1.0.0", number: 2, packageName: "fastify-plugin" }),
        alert({ cvssScore: 7, firstPatchedVersion: "1.0.0", number: 3, packageName: "@fastify/cors" }),
        alert({ cvssScore: 6, firstPatchedVersion: "1.0.0", number: 4, packageName: "@fastifyx/core" }),
      ],
      entries: [],
      capacity: capped({ remaining: 5 }),
      notABump: [ruling({ packageName: "fastify" }), ruling({ packageName: "@fastify/*" })],
      repo: REPO,
    });

    expect(plan.batch.map((candidate) => candidate.packageName)).toEqual(["fastify-plugin", "@fastifyx/core"]);
    expect(plan.ruledOut).toEqual(["fastify", "@fastify/cors"]);
  });

  it("plans no backfill and rules nothing out when the cap leaves no room", () => {
    const plan = vulnTopupBatch({
      alerts: [alert({ cvssScore: 9, firstPatchedVersion: "1.0.0", number: 1, packageName: "fastify" })],
      entries: [],
      capacity: capped({ remaining: 0 }),
      notABump: [ruling({ packageName: "fastify" })],
      repo: REPO,
    });

    expect(plan).toEqual({ batch: [], reserve: [], ruledOut: [] });
  });
});

describe("packageHasOpenPr", () => {
  it("finds a colon-named package its own open title names, which the word split alone misses", () => {
    const entries = [entry({ number: 1, title: "fix(security): bump org.springframework:spring-webmvc" })];

    expect(packageHasOpenPr({ entries, packageName: "org.springframework:spring-webmvc" })).toBe(true);
  });

  it("does not read a longer package's title as covering a shorter name inside it", () => {
    const entries = [entry({ number: 1, title: "fix(security): bump lodash-es" })];

    expect(packageHasOpenPr({ entries, packageName: "lodash" })).toBe(false);
  });

  it.each([
    ["fix(security): bump pkg-2. Please review", true],
    ["fix(security): bump pkg-2: patched in 2.1", true],
    ["fix(security): bump pkg-2.", true],
    ["fix(security): bump pkg-2.5", false],
    ["fix(security): bump pkg-2.merge", false],
  ] as const)("reads a sentence's closing punctuation after the name as its end: %s", (title, named) => {
    const entries = [entry({ number: 1, title })];

    expect(packageHasOpenPr({ entries, packageName: "pkg-2" })).toBe(named);
  });

  it.each(["fix(security): bump ms:extra", "fix(security): bump ms from 2.1.2 to 2.1.3"])(
    "keeps a two-letter package its own open title names: %s",
    (title) => {
      const entries = [entry({ number: 1, title })];

      expect(packageHasOpenPr({ entries, packageName: "ms" })).toBe(true);
    },
  );

  it("answers false for a package no open title names", () => {
    const entries = [entry({ number: 1, title: "fix(security): bump axios" })];

    expect(packageHasOpenPr({ entries, packageName: "hono" })).toBe(false);
  });
});

describe("topupRowsInFlight", () => {
  const PREFIX = "vulnfix-topup-owner-name";

  it("counts an open row of this repository's own top-up", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ settlement: undefined, slug: `${PREFIX}-1`, status: "ready", workerGone: false }],
    });

    expect(flight).toEqual({ inFlight: [`${PREFIX}-1`], parked: [], released: [] });
  });

  it("never counts an archived row as in flight, whatever its fields still say (Codex review)", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ archived: true, settlement: undefined, slug: `${PREFIX}-1`, status: "ready", workerGone: false }],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("does NOT count a row an ask settlement already ended, whatever its status still says", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ settlement: "declined", slug: `${PREFIX}-1`, status: "ready", workerGone: false }],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("does not count a row whose own status is terminal", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { settlement: undefined, slug: `${PREFIX}-1`, status: "done", workerGone: false },
        { settlement: undefined, slug: `${PREFIX}-2`, status: "cancelled", workerGone: false },
        { settlement: undefined, slug: `${PREFIX}-3`, status: "rejected", workerGone: false },
      ],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("ignores another repository's top-up, and every row that is not one at all", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { settlement: undefined, slug: "vulnfix-topup-other-repo-1", status: "ready", workerGone: false },
        { settlement: undefined, slug: "something-else-entirely", status: "in-progress", workerGone: false },
      ],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("names every generation it found, so a refusal says which rows are holding it", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { settlement: undefined, slug: `${PREFIX}-1`, status: "ready", workerGone: false },
        { settlement: undefined, slug: `${PREFIX}-2`, status: "in-progress", workerGone: false },
      ],
    });

    expect(flight).toEqual({ inFlight: [`${PREFIX}-1`, `${PREFIX}-2`], parked: [], released: [] });
  });

  it("answers empty on an empty board", () => {
    expect(topupRowsInFlight({ prefix: PREFIX, rows: [] })).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("RELEASES an open row whose worker is gone, and names it — a two-day silence", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ settlement: undefined, slug: `${PREFIX}-1789633808900`, status: "ready", workerGone: true }],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [`${PREFIX}-1789633808900`] });
  });

  it("keeps a row whose worker could NOT be judged in flight, never released", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ settlement: undefined, slug: `${PREFIX}-1`, status: "ready", workerGone: undefined }],
    });

    expect(flight).toEqual({ inFlight: [`${PREFIX}-1`], parked: [], released: [] });
  });

  it("a settled row with a dead worker is neither in flight nor released — it already ended", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [{ settlement: "declined", slug: `${PREFIX}-1`, status: "ready", workerGone: true }],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("reports a live generation and a dead one from one board, each in its own list", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { settlement: undefined, slug: `${PREFIX}-1`, status: "ready", workerGone: true },
        { settlement: undefined, slug: `${PREFIX}-2`, status: "in-progress", workerGone: false },
      ],
    });

    expect(flight).toEqual({ inFlight: [`${PREFIX}-2`], parked: [], released: [`${PREFIX}-1`] });
  });

  it("splits a PARKED generation out of the in-flight list — a week of idle", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        {
          parkedAtIso: "2026-10-09T17:38:52.584Z",
          settlement: undefined,
          slug: `${PREFIX}-1791275573506`,
          status: "ready",
          workerGone: undefined,
        },
      ],
    });

    expect(flight).toEqual({
      inFlight: [],
      parked: [{ parkedAtIso: "2026-10-09T17:38:52.584Z", slug: `${PREFIX}-1791275573506` }],
      released: [],
    });
  });

  it("splits a generation never seated out of the in-flight list, to be reseated beside a parked one", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { settlement: undefined, slug: `${PREFIX}-1`, status: "ready", unseated: true, workerGone: false },
        {
          parkedAtIso: "2026-10-09T00:00:00.000Z",
          settlement: undefined,
          slug: `${PREFIX}-2`,
          status: "ready",
          workerGone: undefined,
        },
      ],
    });

    expect(flight).toEqual({
      inFlight: [],
      parked: [
        { slug: `${PREFIX}-1`, unseated: true },
        { parkedAtIso: "2026-10-09T00:00:00.000Z", slug: `${PREFIX}-2` },
      ],
      released: [],
    });
  });

  it("keeps a released row released even when it also carries a park instant", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        {
          parkedAtIso: "2026-10-09T00:00:00.000Z",
          settlement: undefined,
          slug: `${PREFIX}-1`,
          status: "ready",
          workerGone: true,
        },
      ],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [`${PREFIX}-1`] });
  });

  it("puts a parked row that is settled, terminal, archived or another repository's in no list at all", () => {
    const parkedAtIso = "2026-10-09T00:00:00.000Z";
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        { parkedAtIso, settlement: "answered", slug: `${PREFIX}-1`, status: "ready", workerGone: undefined },
        { parkedAtIso, settlement: undefined, slug: `${PREFIX}-2`, status: "done", workerGone: undefined },
        { archived: true, parkedAtIso, settlement: undefined, slug: `${PREFIX}-3`, status: "ready", workerGone: true },
        {
          parkedAtIso,
          settlement: undefined,
          slug: "vulnfix-topup-other-repo-4",
          status: "ready",
          workerGone: undefined,
        },
      ],
    });

    expect(flight).toEqual({ inFlight: [], parked: [], released: [] });
  });

  it("reports a live, a parked and a dead generation from one board, each in its own list, in board order", () => {
    const flight = topupRowsInFlight({
      prefix: PREFIX,
      rows: [
        {
          parkedAtIso: "2026-10-09T00:00:00.000Z",
          settlement: undefined,
          slug: `${PREFIX}-1`,
          status: "ready",
          workerGone: false,
        },
        { settlement: undefined, slug: `${PREFIX}-2`, status: "ready", workerGone: undefined },
        { settlement: undefined, slug: `${PREFIX}-3`, status: "ready", workerGone: true },
        {
          parkedAtIso: "2026-10-10T00:00:00.000Z",
          settlement: undefined,
          slug: `${PREFIX}-4`,
          status: "ready",
          workerGone: undefined,
        },
      ],
    });

    expect(flight).toEqual({
      inFlight: [`${PREFIX}-2`],
      parked: [
        { parkedAtIso: "2026-10-09T00:00:00.000Z", slug: `${PREFIX}-1` },
        { parkedAtIso: "2026-10-10T00:00:00.000Z", slug: `${PREFIX}-4` },
      ],
      released: [`${PREFIX}-3`],
    });
  });
});
