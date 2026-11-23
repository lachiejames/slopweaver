/**
 * `github bump-drive`'s `close-superseded` act over plain recording seams: which of the owner's bumps it closes, the argv
 * it hands `github close`, the ledger row it leaves, and what a failed read or close does instead.
 *
 * Every seam is a plain recording function, not a mock (`.claude/rules/testing.md`).
 */
import { describe, expect, it } from "vitest";

import { AUTONOMY_SLUG_PATTERN } from "../../../../../autonomy/types.js";
import {
  type BumpCloseDeps,
  closeArgv,
  planSupersedeCloses,
  readSupersedePlan,
  runSupersedePass,
  type SupersedeClose,
  supersedeKey,
} from "../../../../../cli/commands/github/bumpDriveClose.js";
import { bumpCloseLedgerRow, repoActionSlug } from "../../../../../cli/commands/github/bumpDriveLedger.js";
import { BUMP_CLOSE_CAP } from "../../../../../cli/commands/github/bumpDriveUsage.js";
import { parseGithubCloseArgs } from "../../../../../cli/commands/github/closeCore.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { dependencyBotActors } from "../../../../../organisation/dependencyBots.js";
import type { MergedRenovatePr, OwnOpenPr, TestMergeReading } from "../../../../../review/bumpSupersede.js";
import { AUTONOMY_FIXTURE_OUTAGE } from "../../../../autonomyLedgerFixture.js";

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** One merged-Renovate search the pass asked for. */
interface MergedAsk {
  readonly authors: readonly string[];
  readonly repoSlug: string;
  readonly sinceIso: string;
}

const HEAD = "1".repeat(40);
const BASE_TIP = "2".repeat(40);

const changing: TestMergeReading = {
  baseTipOid: BASE_TIP,
  baseTipTreeOid: "t".repeat(40),
  mergeTreeOid: "m".repeat(40),
  mergeable: "MERGEABLE",
  parentOids: [BASE_TIP, HEAD],
};

const own = (over: Partial<OwnOpenPr> = {}): OwnOpenPr => ({
  baseRefName: "staging",
  changedPaths: ["yarn.lock"],
  createdAtIso: "2026-10-05T23:00:00Z",
  headOid: HEAD,
  labels: [],
  number: 18243,
  repoSlug: "acme/acme-admin",
  testMerge: changing,
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
  url: "https://github.com/acme/acme-admin/pull/18243",
  ...over,
});

const renovateMerge: MergedRenovatePr = {
  baseRefName: "staging",
  mergedAtIso: "2026-10-06T02:04:26Z",
  number: 16761,
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.124",
  url: "https://github.com/acme/acme-admin/pull/16761",
};

/** A pull request of the owner's whose merge would change nothing, numbered as asked. */
const noDiff = ({ number }: { number: number }): OwnOpenPr =>
  own({
    number,
    testMerge: { ...changing, mergeTreeOid: changing.baseTipTreeOid },
    title: `[SUP-${String(number)}] fix(security): re-resolve joi to 17.13.8`,
    url: `https://github.com/acme/acme-admin/pull/${String(number)}`,
  });

/** What one pass asked its seams for. */
interface Harness {
  readonly deps: BumpCloseDeps;
  readonly closed: string[][];
  readonly mergedAsks: MergedAsk[];
  readonly rows: ReturnType<typeof bumpCloseLedgerRow>[];
  readonly rechecked: number[];
}

function harness({
  prs,
  merged = [renovateMerge],
  ownFails = false,
  mergedFails = false,
  closeExit = 0,
  recheck = "same",
}: {
  prs: readonly OwnOpenPr[];
  merged?: readonly MergedRenovatePr[];
  ownFails?: boolean;
  mergedFails?: boolean;
  closeExit?: number;
  /** What the close-time re-read answers: the pull request as listed, gone, a failure, or another reading. */
  recheck?: "same" | "gone" | "fails" | OwnOpenPr;
}): Harness {
  const rechecked: number[] = [];
  const closed: string[][] = [];
  const mergedAsks: MergedAsk[] = [];
  const rows: ReturnType<typeof bumpCloseLedgerRow>[] = [];
  const deps: BumpCloseDeps = {
    closePr: ({ rest }) => {
      closed.push([...rest]);
      return Promise.resolve(closeExit);
    },
    mergedRenovatePrs: ({ authors, repoSlug, sinceIso }) => {
      mergedAsks.push({ authors, repoSlug, sinceIso });
      return Promise.resolve(mergedFails ? err(["GitHub answered 502"]) : ok(merged));
    },
    now: () => new Date("2026-10-08T08:30:00.000Z"),
    ownOpenPrs: () => Promise.resolve(ownFails ? err(["Bad credentials"]) : ok(prs)),
    recheckPr: ({ number }) => {
      rechecked.push(number);
      if (recheck === "fails") {
        return Promise.resolve(err(["GitHub answered 502"]));
      }
      if (recheck === "gone") {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(ok(recheck === "same" ? prs.find((pr) => pr.number === number) : recheck));
    },
    recordAutonomy: ({ row }) => {
      rows.push(row);
      return Promise.resolve(undefined);
    },
    sessionRef: () => "workspace:bump-close",
  };
  return { closed, deps, mergedAsks, rechecked, rows };
}

const pass = ({ run, dryRun = false }: { run: Harness; dryRun?: boolean }) =>
  runSupersedePass({
    bots: CONFIGURED,
    deps: run.deps,
    dryRun,
    home: undefined,
    optOutLabels: ["do-not-merge"],
    quiet: false,
    repos: ["acme/acme-admin"],
  });

describe("planSupersedeCloses", () => {
  it("closes the owner's bump on Renovate's merge of a newer version", () => {
    const closes = planSupersedeCloses({ merged: [renovateMerge], optOutLabels: [], own: [own()] });
    expect(closes).toEqual([{ capped: false, evidence: { by: renovateMerge, kind: "renovate-merged" }, own: own() }]);
  });

  it("holds back a pull request carrying an opt-out label, whatever its case", () => {
    expect(
      planSupersedeCloses({
        merged: [renovateMerge],
        optOutLabels: ["do-not-merge"],
        own: [own({ labels: ["Do-Not-Merge"] })],
      }),
    ).toEqual([]);
  });

  it("caps the pass oldest number first, marking every close past the cap", () => {
    const prs = Array.from({ length: BUMP_CLOSE_CAP + 2 }, (_, at) => noDiff({ number: 500 - at }));
    const closes = planSupersedeCloses({ merged: [], optOutLabels: [], own: prs });
    expect(closes.map((close) => close.own.number).slice(0, 2)).toEqual([489, 490]);
    expect(closes.filter((close) => close.capped).map((close) => close.own.number)).toEqual([499, 500]);
  });
});

describe("readSupersedePlan", () => {
  it("asks for every Renovate identity's merges since the owner's OLDEST open pull request, and names what it read", async () => {
    const run = harness({ prs: [own({ createdAtIso: "2026-10-07T00:00:00Z", number: 2 }), own()] });
    const plan = await readSupersedePlan({
      bots: CONFIGURED,
      deps: run.deps,
      home: undefined,
      optOutLabels: [],
      repoSlug: "acme/acme-admin",
    });
    expect(run.mergedAsks).toEqual([
      {
        authors: ["app/renovate", "app/acme-renovate"],
        repoSlug: "acme/acme-admin",
        sinceIso: "2026-10-05T23:00:00Z",
      },
    ]);
    expect(plan.notes).toEqual([
      "acme/acme-admin: 2 open bump(s) of the owner's, 2 changing only dependency files, of 2 open pull request(s) read whole; 1 superseded",
    ]);
  });

  it("closes nothing and says why when the owner's open list cannot be read", async () => {
    const run = harness({ ownFails: true, prs: [] });
    const plan = await readSupersedePlan({
      bots: CONFIGURED,
      deps: run.deps,
      home: undefined,
      optOutLabels: [],
      repoSlug: "acme/acme-admin",
    });
    expect(plan).toEqual({ closes: [], notes: ["acme/acme-admin: closed nothing superseded — Bad credentials"] });
    expect(run.mergedAsks).toEqual([]);
  });

  it("keeps the no-diff arm when Renovate's merges cannot be read, and says only that arm ran", async () => {
    const run = harness({ mergedFails: true, prs: [own(), noDiff({ number: 7 })] });
    const plan = await readSupersedePlan({
      bots: CONFIGURED,
      deps: run.deps,
      home: undefined,
      optOutLabels: [],
      repoSlug: "acme/acme-admin",
    });
    expect(plan.closes.map((close) => close.own.number)).toEqual([7]);
    expect(plan.notes[1]).toBe(
      "acme/acme-admin: Renovate's merges could not be read, so only the no-diff arm ran — GitHub answered 502",
    );
  });

  it("asks nothing more when the owner has no open pull request there", async () => {
    const run = harness({ prs: [] });
    const plan = await readSupersedePlan({
      bots: CONFIGURED,
      deps: run.deps,
      home: undefined,
      optOutLabels: [],
      repoSlug: "acme/acme-admin",
    });
    expect(run.mergedAsks).toEqual([]);
    expect(plan.notes).toEqual([
      "acme/acme-admin: 0 open bump(s) of the owner's, 0 changing only dependency files, of 0 open pull request(s) read whole; 0 superseded",
    ]);
  });
});

describe("closeArgv", () => {
  const close: SupersedeClose = { capped: false, evidence: { by: renovateMerge, kind: "renovate-merged" }, own: own() };

  it("is argv the real `github close` parser accepts, carrying the comment as --why and the judged head", () => {
    const parsed = unwrap(parseGithubCloseArgs({ rest: closeArgv({ close, home: "/homes/one" }) }));
    expect(parsed).toEqual({
      dryRun: false,
      expectHead: HEAD,
      home: "/homes/one",
      json: false,
      number: 18243,
      owner: "acme",
      repo: "acme-admin",
      why:
        "Superseded by #16761 (chore(deps): update dependency @ai-sdk/openai to v3.0.124), which Renovate merged into " +
        "`staging` at 2026-10-06T02:04:26Z, so `staging` already carries this bump. Closed by the bump drive; reopen " +
        "it if this is wrong.",
    });
  });

  it("passes no --home when the pass has none", () => {
    expect(closeArgv({ close, home: undefined }).includes("--home")).toBe(false);
  });
});

describe("runSupersedePass", () => {
  it("closes the superseded bump through `github close` and records one ledger row naming it", async () => {
    const run = harness({ prs: [own()] });
    const result = await pass({ run });
    expect(run.closed).toHaveLength(1);
    expect(run.closed[0]!.slice(0, 4)).toEqual(["--repo", "acme/acme-admin", "--number", "18243"]);
    expect(result.outcomes.map((outcome) => [outcome.act, outcome.outcome, outcome.detail])).toEqual([
      [
        "close-superseded",
        "acted",
        "closed it with a comment: superseded by Renovate's #16761, merged 2026-10-06T02:04:26Z",
      ],
    ]);
    expect(run.rows.map((row) => [row.actionId, row.kind, row.subject])).toEqual([
      ["acme-admin-18243-bump-close", "close-superseded-pull-request", "https://github.com/acme/acme-admin/pull/18243"],
    ]);
    expect([...result.closing]).toEqual(["acme/acme-admin#18243"]);
  });

  it("closes nothing and writes nothing on --dry-run, and says what it would have done", async () => {
    const run = harness({ prs: [own()] });
    const result = await pass({ dryRun: true, run });
    expect(run.closed).toEqual([]);
    expect(run.rows).toEqual([]);
    expect(result.outcomes[0]!.outcome).toBe("would-act");
    expect(result.outcomes[0]!.detail).toBe(
      "would close: superseded by Renovate's #16761, merged 2026-10-06T02:04:26Z",
    );
  });

  it("writes no ledger row when `github close` refused, but still keeps the ladder off the pull request", async () => {
    const run = harness({ closeExit: 1, prs: [own()] });
    const result = await pass({ run });
    expect(run.rows).toEqual([]);
    expect(result.outcomes[0]!.outcome).toBe("failed");
    expect([...result.closing]).toEqual(["acme/acme-admin#18243"]);
  });

  it("skips a close past the cap without closing it, and still keeps the ladder off it", async () => {
    const prs = Array.from({ length: BUMP_CLOSE_CAP + 1 }, (_, at) => noDiff({ number: 100 + at }));
    const run = harness({ merged: [], prs });
    const result = await pass({ run });
    expect(run.closed).toHaveLength(BUMP_CLOSE_CAP);
    expect(result.outcomes.at(-1)!.outcome).toBe("skipped");
    expect(result.outcomes.at(-1)!.detail).toBe(
      `this pass's cap of ${String(BUMP_CLOSE_CAP)} close(s) was already reached — the next firing takes it`,
    );
    expect(result.closing.has(`acme/acme-admin#${String(100 + BUMP_CLOSE_CAP)}`)).toBe(true);
  });

  it("re-reads the pull request before closing it, and not on --dry-run", async () => {
    const acting = harness({ prs: [own()] });
    await pass({ run: acting });
    expect(acting.rechecked).toEqual([18243]);
    const dry = harness({ prs: [own()] });
    await pass({ dryRun: true, run: dry });
    expect(dry.rechecked).toEqual([]);
  });

  it("closes nothing when the owner's head moved between the pass's read and the close", async () => {
    const run = harness({ prs: [own()], recheck: own({ headOid: "9".repeat(40) }) });
    const result = await pass({ run });
    expect(run.closed).toEqual([]);
    expect(run.rows).toEqual([]);
    expect([result.outcomes[0]!.outcome, result.outcomes[0]!.detail]).toEqual([
      "skipped",
      "not closed — superseded on the pass's read, but its head moved since the pass read it",
    ]);
    expect([...result.closing]).toEqual(["acme/acme-admin#18243"]);
  });

  it("closes nothing when the base moved so its merge would change something again", async () => {
    const run = harness({
      merged: [],
      prs: [noDiff({ number: 7 })],
      recheck: { ...noDiff({ number: 7 }), testMerge: changing },
    });
    const result = await pass({ run });
    expect(run.closed).toEqual([]);
    expect(result.outcomes[0]!.detail).toBe(
      "not closed — superseded on the pass's read, but the evidence no longer holds on a fresh read",
    );
  });

  it("closes nothing when the pull request is no longer open on the re-read", async () => {
    const run = harness({ prs: [own()], recheck: "gone" });
    const result = await pass({ run });
    expect(run.closed).toEqual([]);
    expect(result.outcomes[0]!.detail).toBe("not closed — superseded on the pass's read, but it is no longer open");
  });

  it("closes nothing and reports a failure when the re-read itself fails", async () => {
    const run = harness({ prs: [own()], recheck: "fails" });
    const result = await pass({ run });
    expect(run.closed).toEqual([]);
    expect([result.outcomes[0]!.outcome, result.outcomes[0]!.detail]).toEqual([
      "failed",
      "not closed — the close-time re-read failed: GitHub answered 502",
    ]);
  });

  it("still reports the close when the ledger write fails, naming the failure", async () => {
    const run = harness({ prs: [own()] });
    const result = await pass({
      run: { ...run, deps: { ...run.deps, recordAutonomy: () => Promise.resolve(AUTONOMY_FIXTURE_OUTAGE.message) } },
    });
    expect(result.outcomes[0]!.detail).toBe(
      "closed it (superseded by Renovate's #16761, merged 2026-10-06T02:04:26Z), but the AUTONOMY ledger row could not " +
        `be written (${AUTONOMY_FIXTURE_OUTAGE.message})`,
    );
  });
});

describe("supersedeKey", () => {
  it("folds the repository's case, so the ladder's spelling and the viewer read's match", () => {
    expect(supersedeKey({ number: 7, repoSlug: "Acme/ACME-Admin" })).toBe(
      supersedeKey({ number: 7, repoSlug: "acme/acme-admin" }),
    );
  });
});

describe("bumpCloseLedgerRow", () => {
  it("keys the row by repository and number under a legal ledger slug", () => {
    const row = bumpCloseLedgerRow({
      atIso: "2026-10-08T08:30:00.000Z",
      bySession: "workspace:bump-close",
      close: { capped: false, evidence: { by: renovateMerge, kind: "renovate-merged" }, own: own() },
      why: "superseded by Renovate's #16761",
    });
    expect(row.actionId).toBe("acme-admin-18243-bump-close");
    expect(AUTONOMY_SLUG_PATTERN.test(row.actionId)).toBe(true);
    expect(row.witness).toBe(
      "slopweaver github bump-drive -> closed acme/acme-admin#18243 at head 1111111 with a comment naming the evidence, through github close",
    );
  });

  it("slugs a repository name carrying characters a ledger id may not", () => {
    expect(repoActionSlug({ repoSlug: "Acme/My_Repo--Two" })).toBe("my-repo-two");
  });
});
