/**
 * `consentStops` over a whole form: the replacement key is not read when the ledger record under the live pull
 * request's own locus proves its title and body are this door's last confirmed write, and every drift still demands
 * it, printing the same refusal and the same diff as before.
 *
 * Records are written with the real `confirmPr` into a throwaway home passed explicitly, never the ambient one.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveLocusFor } from "../../../../../cli/commands/github/addressRun.js";
import { parseGithubPrArgs } from "../../../../../cli/commands/github/core.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { consentStops, OWN_WRITE_NOTICE } from "../../../../../cli/commands/github/updateConsent.js";
import { ALLOW_PR_REPLACE } from "../../../../../cli/commands/github/updateCore.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { unifiedPatch } from "../../../../../lib/textDiff.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { confirmPr, ledgerDir } from "../../../../../outbound/github/prLedger.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import type { PrForm } from "../../../../../outbound/github/types.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "replacement-consent-" });
  fixtureDirs.push(home);
  return home;
}

/** The form this door last wrote, and the one the whole-form write previews: same title, so only the body changes. */
const FORM: PrForm = unwrap(
  stampForWrite({
    draft: { ...EXAMPLE_PR_FORM, target: { base: "main", head: "feature", owner: "o", repo: "r" } },
    // The example form's own problem-seen day: the write door refuses a problem seen after today.
    today: "2026-09-28",
  }),
);

/** The description GitHub stored from this door's last write. */
const WRITTEN = "the description this door wrote";

/** The example pull request as read before the door, untouched since that write. */
const LIVE: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: WRITTEN,
  commits: 1,
  draft: false,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1111111111111111111111111111111111111111" },
  htmlUrl: "https://github.com/o/r/pull/42",
  mergedAtIso: undefined,
  nodeId: "PR_42",
  number: 42,
  stack: undefined,
  state: "open",
  title: FORM.title,
  updatedAtIso: "2026-08-15T00:00:00Z",
};

/** The refusal every drifted replacement prints, unchanged by this rule. */
const REFUSED =
  "refused: --form REPLACES the whole description, so anything in the live one that a form cannot carry is " +
  "discarded and GitHub keeps no history of it. The diff above is what would change. To change only some fields " +
  "and keep the rest, use --edit instead. Re-run with SLOPWEAVER_ALLOW_PR_REPLACE=1 if a whole replacement is " +
  "what you want";

const LIVE_RUN = unwrap(parseGithubPrArgs({ argv: ["update", "--form", "{}", "--repo", "o/r", "--number", "42"] }));
const DRY_RUN = unwrap(
  parseGithubPrArgs({ argv: ["update", "--form", "{}", "--repo", "o/r", "--number", "42", "--dry-run"] }),
);

/** The exact patch stderr carries for the write every test previews: the live description replaced by the new one. */
const PATCH = unifiedPatch({ after: "a new body", before: WRITTEN, what: "github://o/r/pull/42/body" });

/**
 * Leave the record a confirmed write of `form` and `storedBody` to pull request `number` would leave.
 *
 * @param locus where the record is keyed, the live pull request's own locus unless a test moves it
 */
function recorded({
  form = FORM,
  home,
  locus = liveLocusFor({ pr: LIVE }),
  number = 42,
  storedBody = WRITTEN,
}: {
  form?: PrForm;
  home: string;
  locus?: string;
  number?: number;
  storedBody?: string;
}): void {
  confirmPr({ form, home, locus, nodeId: "PR_42", number, nowIso: "2026-08-15T00:00:00.000Z", storedBody });
}

/**
 * Run the consent over a changed whole form, capturing stdout, the diff stderr carries, and how many times the
 * replacement key was read from the environment.
 */
function consent({
  args = LIVE_RUN,
  env = {},
  home,
  live = LIVE,
}: {
  args?: typeof LIVE_RUN;
  env?: Readonly<Record<string, string>>;
  home: string;
  live?: WrittenPr;
}): { diff: string[]; keyReads: number; lines: string[]; stops: boolean } {
  const { deps, lines } = harnessDeps({ api: fakeApi({}), env });
  const diff: string[] = [];
  let keyReads = 0;
  const captured: GithubPrDeps = {
    ...deps,
    env: ({ name }) => {
      keyReads += name === ALLOW_PR_REPLACE ? 1 : 0;
      return deps.env({ name });
    },
    err: ({ line }) => diff.push(line),
  };
  const stops = consentStops({ args, body: "a new body", deps: captured, form: FORM, home, live, wholesale: true });
  return { diff, keyReads, lines, stops };
}

describe("consentStops — a changed whole form over this door's own last write", () => {
  it("needs no replacement key, says so, and still prints the diff", () => {
    const home = tempHome();
    recorded({ home });
    const run = consent({ home });
    expect([run.stops, run.lines, run.diff, run.keyReads]).toStrictEqual([false, [OWN_WRITE_NOTICE], [PATCH], 0]);
  });

  it("never spends the key when one is set: the notice prints, never the OVERRIDDEN line", () => {
    const home = tempHome();
    recorded({ home });
    const run = consent({ env: { SLOPWEAVER_ALLOW_PR_REPLACE: "1" }, home });
    expect([run.stops, run.lines, run.keyReads]).toStrictEqual([false, [OWN_WRITE_NOTICE], 0]);
  });
});

/*
 * A dry run never reaches the record's verdict at all: it prints the diff and consents to nothing, so these three
 * cases hold whatever the ledger says, and that independence is the behaviour they pin.
 */
describe("consentStops — a dry run neither waives nor demands the key, whatever the ledger holds", () => {
  it("prints only the diff over a matching record, reading no key", () => {
    const home = tempHome();
    recorded({ home });
    const run = consent({ args: DRY_RUN, home });
    expect([run.stops, run.lines, run.diff, run.keyReads]).toStrictEqual([false, [], [PATCH], 0]);
  });

  it("prints only the diff over a drifted record, reading no key", () => {
    const home = tempHome();
    recorded({ home, storedBody: "the description before someone edited it" });
    const run = consent({ args: DRY_RUN, home });
    expect([run.stops, run.lines, run.diff, run.keyReads]).toStrictEqual([false, [], [PATCH], 0]);
  });

  it("prints only the diff with no record at all, reading no key", () => {
    const home = tempHome();
    const run = consent({ args: DRY_RUN, home });
    expect([run.stops, run.lines, run.diff, run.keyReads]).toStrictEqual([false, [], [PATCH], 0]);
  });
});

describe("consentStops — every drift still demands the replacement key", () => {
  it("refuses body drift: the description was edited on GitHub after the write, and reads the key once", () => {
    const home = tempHome();
    recorded({ home, storedBody: "the description before someone edited it" });
    const run = consent({ home });
    expect([run.stops, run.lines, run.diff, run.keyReads]).toStrictEqual([true, [REFUSED], [PATCH], 1]);
  });

  it("refuses a matching record kept under another locus: a retargeted base finds no record of its own", () => {
    const home = tempHome();
    recorded({ home, locus: liveLocusFor({ pr: { ...LIVE, baseRef: "release" } }) });
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses a stale matching record at a base the pull request came back to after a later write elsewhere", () => {
    const home = tempHome();
    recorded({ home });
    const elsewhere = liveLocusFor({ pr: { ...LIVE, baseRef: "release" } });
    confirmPr({
      form: FORM,
      home,
      locus: elsewhere,
      nodeId: "PR_42",
      number: 42,
      nowIso: "2026-08-16T00:00:00.000Z",
      storedBody: "the description written while based on release",
    });
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses a matching record kept under another head branch's locus", () => {
    const home = tempHome();
    const otherHead = { ...LIVE, head: { ...LIVE.head, label: "o:other", ref: "other" } };
    recorded({ home, locus: liveLocusFor({ pr: otherHead }) });
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses title drift: the title was edited on GitHub after the write", () => {
    const home = tempHome();
    recorded({ form: { ...FORM, title: "The title this door wrote before a retype" }, home });
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses with no ledger record under the live locus", () => {
    const home = tempHome();
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses a record for another pull request number", () => {
    const home = tempHome();
    recorded({ home, number: 41 });
    const run = consent({ home });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
  });

  it("refuses a trailing bot block, and the diff shows the block the write would drop", () => {
    const home = tempHome();
    recorded({ home });
    const live = { ...LIVE, body: `${WRITTEN}\n\nSummary by a review bot` };
    const run = consent({ home, live });
    expect([run.stops, run.lines]).toStrictEqual([true, [REFUSED]]);
    expect(run.diff.join("\n")).toContain("-Summary by a review bot");
  });

  it("refuses a confirmed matching record when another ledger file does not parse, and reads the key once", () => {
    const home = tempHome();
    recorded({ home });
    writeFileSync(join(ledgerDir({ home }), "unparseable.json"), "{ not json");
    const run = consent({ home });
    expect([run.stops, run.lines, run.keyReads]).toStrictEqual([true, [REFUSED], 1]);
  });

  it("with the key set, spends it over a drifted record and only there: the matching record still prints the notice", () => {
    const keyed = { SLOPWEAVER_ALLOW_PR_REPLACE: "1" };
    const matchingHome = tempHome();
    recorded({ home: matchingHome });
    const matching = consent({ env: keyed, home: matchingHome });
    const driftedHome = tempHome();
    recorded({ home: driftedHome, number: 41 });
    const drifted = consent({ env: keyed, home: driftedHome });
    expect([
      matching.stops,
      matching.lines,
      matching.keyReads,
      drifted.stops,
      drifted.lines,
      drifted.keyReads,
    ]).toStrictEqual([
      false,
      [OWN_WRITE_NOTICE],
      0,
      false,
      ["OVERRIDDEN via SLOPWEAVER_ALLOW_PR_REPLACE=1 — replacing the whole description. Say so in the pull request."],
      1,
    ]);
  });
});
