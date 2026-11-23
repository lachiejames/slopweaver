import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type LandingClosureDeps,
  performClosures,
  productionLandingClosureDeps,
} from "../../../../../cli/commands/github/landingClosureRun.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { RepoCensus } from "../../../../../live/github/openCensus.js";
import type { PrClosure } from "../../../../../live/github/prClosure.js";
import type { LandingBoardRow } from "../../../../../review/landingBoard.js";
import { closureSettleArgv } from "../../../../../review/landingClosure.js";

const EMPTY_CENSUS: RepoCensus = {
  kind: "read",
  pullRequests: [],
  repo: "acme/widgets",
  startedAtIso: "2026-10-10T06:00:00Z",
  totalCount: 0,
  viewer: "ada",
};

/** Fakes recording every read and every settle argv, over one board branch. */
const fakes = ({
  rows,
  closures,
}: {
  rows: readonly LandingBoardRow[];
  closures: ReadonlyMap<number, PrClosure>;
}): { deps: LandingClosureDeps; asked: number[]; settled: (readonly string[])[] } => {
  const asked: number[] = [];
  const settled: (readonly string[])[] = [];
  const deps: LandingClosureDeps = {
    boardBranches: () => new Map([["feature/gone", rows]]),
    prClosure: ({ number }) => {
      asked.push(number);
      const closure = closures.get(number);
      if (closure === undefined) {
        return Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })));
      }
      return Promise.resolve(ok(closure));
    },
    rowNow: ({ slug }) => {
      const row = rows.find((one) => one.kind === "row" && one.slug === slug);
      return row?.kind === "row" && row.run !== undefined ? { run: row.run, status: row.status } : undefined;
    },
    settleRow: ({ argv }) => {
      settled.push(argv);
      return Promise.resolve(0);
    },
  };
  return { asked, deps, settled };
};

const merged = ({ number }: { number: number }): PrClosure => ({
  mergeCommitOid: "3c92c09714",
  mergedAt: "2026-10-09T20:34:00Z",
  state: "MERGED",
  url: `https://github.com/acme/widgets/pull/${String(number)}`,
});

const readyRow = ({ number }: { number: number }): Extract<LandingBoardRow, { kind: "row" }> => ({
  kind: "row",
  run: "never-started",
  slug: `land-acme-widgets-${String(number)}-5cf03b1`,
  status: "ready",
});

describe("productionLandingClosureDeps().rowNow", () => {
  const homes: string[] = [];
  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });
  const homeWith = ({ files }: { files: Readonly<Record<string, string>> }): string => {
    const home = mkdtempSync(join(tmpdir(), "closure-row-now-"));
    homes.push(home);
    mkdirSync(join(home, "handovers"), { recursive: true });
    mkdirSync(join(home, "runs"), { recursive: true });
    Object.entries(files).forEach(([path, text]) => {
      writeFileSync(join(home, path), text);
    });
    return home;
  };
  const pausedRow =
    '---\nslug: land-a-b-1-abcdef0\nkind: ask\nsummary: "a/b#1 needs a session"\nstatus: paused\n' +
    "askedIso: 2026-10-07T08:07:45.171Z\nbranch: feature/one\nblockedBy: []\nartifact: null\ndoneWhen: []\n" +
    "pausedOn: a codeowner review\npausedSince: 2026-10-08T04:43:22Z\n---\n";
  const readyText = (): string =>
    pausedRow
      .replace("status: paused", "status: ready")
      .replace("pausedOn: a codeowner review\npausedSince: 2026-10-08T04:43:22Z\n", "");

  it("reads the row's DERIVED status and its run off disk", () => {
    const home = homeWith({ files: { "handovers/land-a-b-1-abcdef0.md": pausedRow } });
    expect(productionLandingClosureDeps().rowNow({ home, slug: "land-a-b-1-abcdef0" })).toEqual({
      run: "never-started",
      status: "paused",
    });
  });

  // The re-read in `settleOne` still leaves a gap before the write, so the settle itself asks again.
  it("refuses, under the settle's own lock, a row that reads paused when the settle reaches it", async () => {
    const home = homeWith({ files: { "handovers/land-a-b-1-abcdef0.md": pausedRow } });
    const argv = closureSettleArgv({ home, slug: "land-a-b-1-abcdef0", witness: "a/b#1 merged at 3c92c09714" });
    const code = await productionLandingClosureDeps().settleRow({ argv, quiet: true });
    expect(code).toBe(1);
    expect(readFileSync(join(home, "handovers", "land-a-b-1-abcdef0.md"), "utf8")).toBe(pausedRow);
  });

  // A seat's `handover start` journals without the settle's lock, so the run is read at the write.
  it("refuses a ready row whose run a seat started, read off the journal as the settle writes", async () => {
    const ready = readyText();
    const home = homeWith({ files: { "handovers/land-a-b-1-abcdef0.md": ready } });
    const event = { atIso: "2026-10-10T07:00:00.000Z", branch: "feature/one", docHash: "h", kind: "started" } as const;
    expect(appendRunEvent({ event, runsDir: join(home, "runs"), slug: "land-a-b-1-abcdef0" }).isOk()).toBe(true);
    const argv = closureSettleArgv({ home, slug: "land-a-b-1-abcdef0", witness: "a/b#1 merged at 3c92c09714" });
    expect(await productionLandingClosureDeps().settleRow({ argv, quiet: true })).toBe(1);
    expect(readFileSync(join(home, "handovers", "land-a-b-1-abcdef0.md"), "utf8")).toBe(ready);
  });

  // The control for the refusals above: the same path, over the same row ready and unattended, does write.
  it("settles the same row through the same path when it reads ready and unattended", async () => {
    const ready = readyText();
    const home = homeWith({ files: { "handovers/land-a-b-1-abcdef0.md": ready } });
    const argv = closureSettleArgv({ home, slug: "land-a-b-1-abcdef0", witness: "a/b#1 merged at 3c92c09714" });
    await productionLandingClosureDeps().settleRow({ argv, quiet: true });
    expect(readFileSync(join(home, "handovers", "land-a-b-1-abcdef0.md"), "utf8")).toContain(
      "settlementWitness: a/b#1 merged at 3c92c09714",
    );
  });

  it("answers nothing for a row no longer on the live board", () => {
    expect(productionLandingClosureDeps().rowNow({ home: homeWith({ files: {} }), slug: "land-a-b-1-abcdef0" })).toBe(
      undefined,
    );
  });
});

describe("performClosures", () => {
  it("never reads GitHub for a held row, and says why it was held", async () => {
    const { asked, deps, settled } = fakes({
      closures: new Map(),
      rows: [{ ...readyRow({ number: 2027 }), run: "active" }],
    });
    const outcomes = await performClosures({
      census: [EMPTY_CENSUS],
      deps,
      dryRun: false,
      home: undefined,
      quiet: false,
      repos: ["acme/widgets"],
    });
    expect(asked).toEqual([]);
    expect(settled).toEqual([]);
    expect(outcomes).toEqual([
      {
        detail: "its run is active, and that run ends it",
        number: 2027,
        outcome: "held",
        repoSlug: "acme/widgets",
        slug: "land-acme-widgets-2027-5cf03b1",
      },
    ]);
  });

  it("settles the first twenty and skips the rest, naming the cap", async () => {
    const numbers = Array.from({ length: 21 }, (_, index) => 3000 + index);
    const { asked, deps, settled } = fakes({
      closures: new Map(numbers.map((number) => [number, merged({ number })])),
      rows: numbers.map((number) => readyRow({ number })),
    });
    const outcomes = await performClosures({
      census: [EMPTY_CENSUS],
      deps,
      dryRun: false,
      home: "/tmp/home",
      quiet: true,
      repos: ["acme/widgets"],
    });
    expect(asked).toHaveLength(20);
    expect(settled).toHaveLength(20);
    expect(settled[0]).toEqual([
      "node",
      "slopweaver",
      "handover",
      "settle",
      "land-acme-widgets-3000-5cf03b1",
      "--as",
      "answered",
      "--witness",
      "https://github.com/acme/widgets/pull/3000 merged at 3c92c09714 (2026-10-09T20:34:00Z)",
      "--home",
      "/tmp/home",
    ]);
    expect(outcomes.at(-1)).toEqual({
      detail: "this invocation's cap of 20 reads was already reached — the next read takes it",
      number: 3020,
      outcome: "skipped",
      repoSlug: "acme/widgets",
      slug: "land-acme-widgets-3020-5cf03b1",
    });
  });

  it("names a failed read and settles nothing over it", async () => {
    const { deps, settled } = fakes({ closures: new Map(), rows: [readyRow({ number: 2027 })] });
    const outcomes = await performClosures({
      census: [EMPTY_CENSUS],
      deps,
      dryRun: false,
      home: undefined,
      quiet: false,
      repos: ["acme/widgets"],
    });
    expect(settled).toEqual([]);
    expect(outcomes.map((one) => [one.outcome, one.detail])).toEqual([
      ["failed", "could not read it: GitHub answered 502"],
    ]);
  });
});
