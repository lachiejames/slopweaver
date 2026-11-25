/**
 * `github enqueue`'s private-terms preflight over the prospective tree. Each way the landing branch goes unfetched
 * is its own case, driven through the REAL sweep over a home holding loaded SYNTHETIC terms — an unfetched base
 * reads no git, so no case here starts a process, and none of them can answer clean. Plain fakes, no mocks.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseFreshness } from "../../../../../cli/commands/github/baseFreshnessCore.js";
import type { GithubEnqueueArgs } from "../../../../../cli/commands/github/enqueueArgs.js";
import {
  type EnqueuePrivateTermsDeps,
  enqueueLandingBase,
  enqueuePrivateTermsStep,
  prospectiveTreeLine,
} from "../../../../../cli/commands/github/enqueuePrivateTerms.js";
import { GithubVerbErrors, type GithubVerbResult } from "../../../../../cli/commands/github/errors.js";
import {
  PRIVATE_TERMS_UNCHECKED_ACK,
  REASON_NAMES_A_TERM_LINE,
} from "../../../../../cli/commands/github/privateTermsPermit.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../hatch/render.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../hygiene/changeSetPrivateTerms.js";
import { parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../../../hygiene/privateTerms.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { sweepMergePrivateTerms } from "../../../../../outbound/github/privateTermsSweep.js";
import { pr } from "./enqueueRun/fixtures.js";

/** The synthetic private value: every case that says it never prints carries it in its input. */
const SYNTHETIC_VALUE = "acmefixtureword";
const TERMS_TSV = `class\tflags\tpattern\tsource\nowner-address\ti\t${SYNTHETIC_VALUE}\tsynthetic\n`;
const BASE_SHA = "b".repeat(40);

const ARGS: GithubEnqueueArgs = {
  acknowledge: [],
  acknowledgeAll: false,
  dequeue: false,
  dryRun: false,
  home: undefined,
  json: false,
  number: 9,
  owner: "acme",
  reason: undefined,
  repo: "widget",
};
const NAMED = { ...ARGS, acknowledge: [PRIVATE_TERMS_UNCHECKED_ACK], reason: "a fork with no terms" };
const BLANKET = { ...ARGS, acknowledgeAll: true, reason: "everything" };
const MAIN = { branch: "main", kind: "ordinary" } as const;
const NO_ACKNOWLEDGEMENT_LINE =
  "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach " +
  "this hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not " +
  "private, ask the chair to narrow that terms row.";

/** A measurement that fetched `branch` at {@link BASE_SHA}. */
function fetched({ branch }: { branch: string }): GithubVerbResult<BaseFreshness> {
  return ok({
    baseBranch: branch,
    baseSha: BASE_SHA,
    headSha: "cafe1234",
    kind: "fresh",
    remote: "origin",
    reverted: [],
  });
}

// Every home this file minted, removed after each case.
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A state home holding the synthetic terms file at the mode the loader requires. */
function homeWithTerms(): string {
  const home = mkdtempSync(join(tmpdir(), "enqueue-terms-"));
  homes.push(home);
  mkdirSync(join(home, "hygiene"));
  writeFileSync(join(home, "hygiene", "private-terms.tsv"), TERMS_TSV, "utf8");
  chmodSync(join(home, "hygiene", "private-terms.tsv"), 0o600);
  return home;
}

/** Deps over a fixed measurement and the REAL sweep, recording what each edge was handed. */
function realSweepDeps({
  measurement,
  calls,
}: {
  measurement: GithubVerbResult<BaseFreshness>;
  calls: unknown[];
}): EnqueuePrivateTermsDeps {
  return {
    cwd: () => "/w/no-repo-read",
    measureBaseFreshness: (args) => {
      calls.push({ measure: args });
      return measurement;
    },
    sweepPrivateTerms: ({ repoRoot, base, headSha, home }) => {
      calls.push({ sweep: { base, headSha } });
      return sweepMergePrivateTerms({ base, headRef: headSha, home, repo: repoRoot });
    },
  };
}

/** Deps over a fixed verdict, recording what each edge was handed. */
function fixedDeps({
  verdict,
  calls,
}: {
  verdict: ChangeSetPrivateTermsVerdict;
  calls: unknown[];
}): EnqueuePrivateTermsDeps {
  return {
    cwd: () => "/w/repo",
    measureBaseFreshness: (args) => {
      calls.push({ measure: args });
      return fetched({ branch: "main" });
    },
    sweepPrivateTerms: (args) => {
      calls.push({ sweep: args });
      return verdict;
    },
  };
}

/** The refusal an unwaived unchecked verdict with `detail` prints after its own line. */
function uncheckedRefusal({ detail }: { detail: string }): readonly string[] {
  return hatchRefusalLines({ detail, hatch: hatchFor({ id: PRIVATE_TERMS_UNCHECKED_ACK }) });
}

describe("enqueueLandingBase", () => {
  it("names the fetched tip when the fetched branch is the landing branch", () => {
    expect(enqueueLandingBase({ landingBranch: "main", measurement: fetched({ branch: "main" }) })).toEqual({
      kind: "fetched",
      sha: BASE_SHA,
    });
  });

  it("names the fetched tip of a base that moved past the head, the moved tip being what lands", () => {
    const moved: GithubVerbResult<BaseFreshness> = ok({
      baseBranch: "main",
      baseSha: BASE_SHA,
      behindBy: 4,
      headSha: "cafe1234",
      kind: "base-moved",
      remote: "origin",
      reverted: [],
    });
    expect(enqueueLandingBase({ landingBranch: "main", measurement: moved })).toEqual({
      kind: "fetched",
      sha: BASE_SHA,
    });
  });

  it("names no base when the fetched branch is the remote's default and the queue lands elsewhere", () => {
    expect(enqueueLandingBase({ landingBranch: "staging", measurement: fetched({ branch: "main" }) })).toEqual({
      detail: "the fetched branch main is not the landing branch staging, so no merged change set exists to read",
      kind: "unfetched",
    });
  });
});

describe("prospectiveTreeLine", () => {
  it("says which tree was read and which was not", () => {
    expect(prospectiveTreeLine({ landingBranch: "main" })).toBe(
      "private terms: prospective tree only — the pinned head merged into main as just fetched; the merge group the queue builds later is not checked",
    );
  });
});

describe("enqueuePrivateTermsStep — every unfetched landing branch is unchecked, never clean", () => {
  const ARMS: readonly { arm: string; measurement: GithubVerbResult<BaseFreshness>; detail: string }[] = [
    {
      arm: "a head branch from a fork",
      detail:
        "the base was not fetched (acme-fork:feature is a fork head — base freshness is not checked for a fork head), so no merged change set exists to read",
      measurement: ok({
        kind: "skipped",
        why: "acme-fork:feature is a fork head — base freshness is not checked for a fork head",
      }),
    },
    {
      arm: "no checkout of this repository",
      detail:
        "the base was not fetched (/w has no readable `origin` remote — not a local checkout of this repository), so no merged change set exists to read",
      measurement: ok({
        kind: "skipped",
        why: "/w has no readable `origin` remote — not a local checkout of this repository",
      }),
    },
    {
      arm: "no local branch for the head",
      detail:
        "the base was not fetched (local branch feature was not found in this checkout), so no merged change set exists to read",
      measurement: ok({ kind: "skipped", why: "local branch feature was not found in this checkout" }),
    },
    {
      arm: "a failed fetch",
      detail: "the base was not measured, so no merged change set exists to read",
      measurement: err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["offline"] })),
    },
    {
      arm: "a fetched branch that is not the landing branch",
      detail: "the fetched branch develop is not the landing branch main, so no merged change set exists to read",
      measurement: fetched({ branch: "develop" }),
    },
  ];

  it.each(ARMS)("refuses $arm unless the subject is named", ({ measurement, detail }) => {
    const step = enqueuePrivateTermsStep({
      args: ARGS,
      deps: realSweepDeps({ calls: [], measurement }),
      home: homeWithTerms(),
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        `private terms: NOT CHECKED — ${detail}`,
        ...uncheckedRefusal({ detail }),
      ],
      refused: true,
    });
  });

  it.each(ARMS)("refuses $arm under --acknowledge-all, which never names the subject", ({ measurement, detail }) => {
    const deps = realSweepDeps({ calls: [], measurement });
    const step = enqueuePrivateTermsStep({
      args: BLANKET,
      deps,
      home: homeWithTerms(),
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        `private terms: NOT CHECKED — ${detail}`,
        ...uncheckedRefusal({ detail }),
      ],
      refused: true,
    });
  });

  it.each(ARMS)("lands $arm named with a reason, handing the waiver to the door", ({ measurement, detail }) => {
    const deps = realSweepDeps({ calls: [], measurement });
    const step = enqueuePrivateTermsStep({
      args: NAMED,
      deps,
      home: homeWithTerms(),
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(step).toEqual({
      acknowledgements: [{ reason: "a fork with no terms", subject: "private-terms-unchecked" }],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        `private terms: NOT CHECKED — ${detail}`,
        "ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork with no terms",
      ],
      refused: false,
    });
  });
});

describe("enqueuePrivateTermsStep — what it reads, and when it reads nothing", () => {
  it("fetches the landing branch and sweeps the pinned head into it", () => {
    const calls: unknown[] = [];
    const clean: ChangeSetPrivateTermsVerdict = { accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 3 };
    const step = enqueuePrivateTermsStep({
      args: ARGS,
      deps: fixedDeps({ calls, verdict: clean }),
      home: "/h",
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(calls).toEqual([
      {
        measure: {
          cwd: "/w/repo",
          remote: "origin",
          target: { base: "main", head: "feature", owner: "acme", repo: "widget" },
        },
      },
      { sweep: { base: { kind: "fetched", sha: BASE_SHA }, headSha: "cafe1234", home: "/h", repoRoot: "/w/repo" } },
    ]);
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        "private terms: applied to the 3 changed text file(s) this landing would merge (0 binary skipped, 0 accepted line(s) set aside) — none stands",
      ],
      refused: false,
    });
  });

  it("reads nothing on --dequeue, or when the queue verdict does not proceed", () => {
    const calls: unknown[] = [];
    const deps = realSweepDeps({ calls, measurement: fetched({ branch: "main" }) });
    const none = { acknowledgements: [], lines: [], refused: false };
    const dequeue = { ...ARGS, dequeue: true };
    expect(
      enqueuePrivateTermsStep({ args: dequeue, deps, home: "/h", pr: pr(), proceeds: true, target: MAIN }),
    ).toEqual(none);
    expect(enqueuePrivateTermsStep({ args: ARGS, deps, home: "/h", pr: pr(), proceeds: false, target: MAIN })).toEqual(
      none,
    );
    expect(calls).toEqual([]);
  });

  it("refuses a hold under every acknowledgement, printing no private value", () => {
    const hold: ChangeSetPrivateTermsVerdict = {
      hits: [{ className: "owner-address", line: 2, locus: `src/${SYNTHETIC_VALUE}.ts` }],
      kind: "hold",
      reasons: [`a reason naming ${SYNTHETIC_VALUE}`],
      terms: unwrap(parsePrivateTerms({ text: TERMS_TSV })),
    };
    const step = enqueuePrivateTermsStep({
      args: { ...NAMED, acknowledgeAll: true },
      deps: fixedDeps({ calls: [], verdict: hold }),
      home: "/h",
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        "private terms: HOLD — this landing is refused",
        WITHHELD_REFUSAL_LINE,
        WITHHELD_REFUSAL_LINE,
        NO_ACKNOWLEDGEMENT_LINE,
      ],
      refused: true,
    });
    expect(step.lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("hands the door no waiver whose reason a loaded term matches, and prints no private value", () => {
    const step = enqueuePrivateTermsStep({
      args: { ...NAMED, reason: `a fork near ${SYNTHETIC_VALUE}` },
      deps: realSweepDeps({ calls: [], measurement: fetched({ branch: "develop" }) }),
      home: homeWithTerms(),
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    const detail = "the fetched branch develop is not the landing branch main, so no merged change set exists to read";
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        `private terms: NOT CHECKED — ${detail}`,
        REASON_NAMES_A_TERM_LINE,
        ...uncheckedRefusal({ detail }),
      ],
      refused: true,
    });
    expect(step.lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("records no waiver when the subject is named over a clean sweep, since nothing was waived", () => {
    const clean: ChangeSetPrivateTermsVerdict = { accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 1 };
    const step = enqueuePrivateTermsStep({
      args: NAMED,
      deps: fixedDeps({ calls: [], verdict: clean }),
      home: "/h",
      pr: pr(),
      proceeds: true,
      target: MAIN,
    });
    expect(step).toEqual({
      acknowledgements: [],
      lines: [
        prospectiveTreeLine({ landingBranch: "main" }),
        "private terms: applied to the 1 changed text file(s) this landing would merge (0 binary skipped, 0 accepted line(s) set aside) — none stands",
      ],
      refused: false,
    });
  });
});
