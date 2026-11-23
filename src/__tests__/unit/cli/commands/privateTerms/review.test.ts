/**
 * The review verbs over a throwaway home and a real packet repository: `review-prepare` commits a held write's
 * packet and prints the steps, and `review-record` binds a Codex pass to it and stores one receipt. Its exit says
 * CLEAN or BROKEN, and it never prints the reviewer's summary, which may quote a term. Every term here is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type PrivateTermsReviewDeps,
  runPrivateTermsReviewPrepare,
  runPrivateTermsReviewRecord,
} from "../../../../../cli/commands/privateTerms/review.js";
import type { CodexArtifactRecord } from "../../../../../codex/types.js";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../../hygiene/forbiddenIdentifiers.js";
import {
  PRIVATE_TERMS_HEADER_V2,
  parsePrivateTerms,
  WITHHELD_REFUSAL_LINE,
} from "../../../../../hygiene/privateTerms.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { CALENDAR_DESTINATION } from "../../../../../outbound/calendar/writePrivacyPayload.js";
import type { PrivacyPolicy } from "../../../../../outbound/privacyCheck.js";
import { decidePrivateTermWrite, writeFindingsOf } from "../../../../../outbound/privateTermReview/hold.js";
import { privateTermPacketFacts } from "../../../../../outbound/privateTermReview/packet.js";
import { readPreparationAtRoot, releaseOrHold } from "../../../../../outbound/privateTermReview/store.js";
import {
  PRIVATE_TERM_REVIEW_PROPERTY,
  PRIVATE_TERM_REVIEW_PROPERTY_ID,
  type PrivateTermWriteDraft,
} from "../../../../../outbound/privateTermReview/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { FIXTURE_REVIEW_SCOPE, fixtureCodexRecord } from "../../../../pageReviewFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "private-terms-review-"));
  homes.push(home);
  return home;
}

const POLICY: PrivacyPolicy = {
  denylist: [],
  identifierRules: FORBIDDEN_IDENTIFIER_RULES,
  privateTerms: unwrap(
    parsePrivateTerms({
      text: `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta colleague at acme\t\trelay:acme-row\n`,
    }),
  ),
};

/** The draft a meant match in one calendar insert is held as. */
function heldDraft(): PrivateTermWriteDraft {
  const write = {
    command: "calendar calendar.events.insert",
    contents: [{ locus: "calendar calendar.events.insert summary", text: "lunch with Quillfeather" }],
    destination: "the owner's Google Calendar",
    family: "google-calendar" as const,
    request: { body: { summary: "lunch with Quillfeather" }, operation: "calendar.events.insert", target: {} },
  };
  const findings = writeFindingsOf({ contents: write.contents, destination: CALENDAR_DESTINATION, policy: POLICY });
  const decision = decidePrivateTermWrite({
    findings,
    policy: POLICY,
    privacyDestination: CALENDAR_DESTINATION,
    write,
  });
  if (decision.kind !== "review") {
    throw new Error(`expected a review, got ${decision.kind}`);
  }
  return decision.draft;
}

/** Hold the fixture write under `home`, as a session with no visible id would. */
function holdIn({ home }: { home: string }): PrivateTermWriteDraft {
  const draft = heldDraft();
  unwrap(
    releaseOrHold({
      draft,
      heldBy: null,
      home,
      newHoldId: () => "ph-00000000000a",
      nowIso: "2026-11-22T00:00:00.000Z",
    }),
  );
  return draft;
}

/** Deps recording both streams, minting the given ids in order, resolving the given Codex passes by id. */
function depsOf({
  ids,
  passes = {},
}: {
  ids: readonly string[];
  passes?: Readonly<Record<string, CodexArtifactRecord>>;
}): { deps: PrivateTermsReviewDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const queue = [...ids];
  return {
    deps: {
      env: {},
      newId: () => queue.shift()!,
      nowIso: () => "2026-11-22T00:01:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      readPass: ({ artifactId }) => ok(passes[artifactId]),
      scanFallback: async () =>
        ok({
          foreign: 0,
          foreignModes: [],
          foreignReceipts: [],
          pending: 0,
          pendingPlans: 0,
          planReceipts: [],
          problems: [],
          receipts: [],
          unboundReceipts: [],
          unreadable: 0,
        }),
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

const argvOf = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "private-terms",
  verb,
  ...rest,
];

/** Prepare the held write's packet and answer the Codex pass a reviewer of it would leave. */
function preparedPass({ home, verdict }: { home: string; verdict: "CLEAN" | "BROKEN" }): {
  pass: CodexArtifactRecord;
  repoRoot: string;
} {
  const prepare = depsOf({ ids: ["prep-0001"] });
  expect(
    runPrivateTermsReviewPrepare({
      argv: argvOf({ rest: ["--hold", "ph-00000000000a", "--home", home], verb: "review-prepare" }),
      deps: prepare.deps,
    }),
  ).toBe(0);
  const repoRoot = prepare.out[0]!.split(": ").at(-1)!;
  const preparation = unwrap(readPreparationAtRoot({ home, repoRoot }))!;
  const facts = unwrap(
    privateTermPacketFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
  );
  const property = { id: PRIVATE_TERM_REVIEW_PROPERTY_ID, statement: PRIVATE_TERM_REVIEW_PROPERTY };
  const record = fixtureCodexRecord({
    artifactId: "pass-0001",
    outcome: {
      answer: {
        counterexample: "",
        evidence: "read write/contexts.md",
        propertyId: PRIVATE_TERM_REVIEW_PROPERTY_ID,
        summary: "match 1 names Quillfeather in the owner's own calendar",
        verdict,
      },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    scope: {
      ...FIXTURE_REVIEW_SCOPE,
      baseRef: preparation.baseSha,
      baseSha: preparation.baseSha,
      diffSha256: facts.diffSha256,
      headSha: preparation.headSha,
      property,
    },
    verdict,
  });
  return { pass: { ...record, repoRoot }, repoRoot };
}

describe("private-terms review-prepare", () => {
  it("commits the packet and prints every step by id and path, never the term", () => {
    const home = freshHome();
    holdIn({ home });
    const run = depsOf({ ids: ["prep-0001"] });
    expect(
      runPrivateTermsReviewPrepare({
        argv: argvOf({ rest: ["--hold", "ph-00000000000a", "--home", home], verb: "review-prepare" }),
        deps: run.deps,
      }),
    ).toBe(0);
    expect(run.out.length).toBe(6);
    expect(run.out[0]).toContain("packet prep-0001 for hold ph-00000000000a: ");
    expect(run.out[3]).toContain("  then record it:  slopweaver private-terms review-record --review ");
    expect(run.out[3]!.endsWith(` --home ${home}`)).toBe(true);
    expect(run.out[4]).toBe(
      "  a Claude fallback receipt cannot release it: it records no session id, so Codex capped leaves it held",
    );
    expect(run.out.join("\n").toLowerCase()).not.toContain("quillfeather");
  });

  it("withholds every printed line a term in the home's own file matches, its path included", () => {
    const home = mkdtempSync(join(tmpdir(), "zephyrine-home-"));
    homes.push(home);
    mkdirSync(dirname(stateHomePaths({ home }).privateTerms), { recursive: true });
    writeFileSync(
      stateHomePaths({ home }).privateTerms,
      `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000b\tperson\ti\tzephyrine\ta synthetic name\t\trelay:acme-row\n`,
      { mode: 0o600 },
    );
    holdIn({ home });
    const run = depsOf({ ids: ["prep-0001"] });
    expect(
      runPrivateTermsReviewPrepare({
        argv: argvOf({ rest: ["--hold", "ph-00000000000a", "--home", home], verb: "review-prepare" }),
        deps: run.deps,
      }),
    ).toBe(0);
    expect(run.out.length).toBe(6);
    expect([run.out[0], run.out[2], run.out[3]]).toStrictEqual([
      WITHHELD_REFUSAL_LINE,
      WITHHELD_REFUSAL_LINE,
      WITHHELD_REFUSAL_LINE,
    ]);
    expect(run.out[1]).toContain("a fresh reviewer");
    expect(run.out.join("\n").toLowerCase()).not.toContain("zephyrine");
  });

  it("withholds the help and usage lines a term matches, before any parse has run", async () => {
    const home = mkdtempSync(join(tmpdir(), "usage-guard-"));
    homes.push(home);
    mkdirSync(dirname(stateHomePaths({ home }).privateTerms), { recursive: true });
    writeFileSync(
      stateHomePaths({ home }).privateTerms,
      `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000c\tperson\t-\tusage\tthe help prefix\t\trelay:acme-row\n`,
      { mode: 0o600 },
    );
    const help = depsOf({ ids: [] });
    const helped = runPrivateTermsReviewRecord({
      argv: argvOf({ rest: [`--home=${home}`, "--help"], verb: "review-record" }),
      deps: help.deps,
    });
    const usage = depsOf({ ids: [] });
    expect(
      runPrivateTermsReviewPrepare({
        argv: argvOf({ rest: ["--home", home], verb: "review-prepare" }),
        deps: usage.deps,
      }),
    ).toBe(2);
    expect(await helped).toBe(0);
    expect(help.out).toStrictEqual([WITHHELD_REFUSAL_LINE]);
    expect(usage.diagnostics.join("\n")).not.toContain("usage");
    expect(usage.diagnostics.length).toBeGreaterThan(0);
  });

  it("refuses a hold id no write was held under", () => {
    const home = freshHome();
    const run = depsOf({ ids: ["prep-0001"] });
    expect(
      runPrivateTermsReviewPrepare({
        argv: argvOf({ rest: ["--hold", "ph-0000000000ff", "--home", home], verb: "review-prepare" }),
        deps: run.deps,
      }),
    ).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "hold ph-0000000000ff cannot be used: no write under this home was held under that id",
    ]);
  });

  it("refuses a missing --hold with the usage line", () => {
    const run = depsOf({ ids: [] });
    expect(runPrivateTermsReviewPrepare({ argv: argvOf({ rest: [], verb: "review-prepare" }), deps: run.deps })).toBe(
      2,
    );
    expect(run.diagnostics.at(-1)).toContain("slopweaver private-terms review-prepare");
  });
});

describe("private-terms review-record", () => {
  it("stores a CLEAN Codex receipt that releases the held write once", async () => {
    const home = freshHome();
    const draft = holdIn({ home });
    const { pass } = preparedPass({ home, verdict: "CLEAN" });
    const run = depsOf({ ids: ["rc-0001"], passes: { "pass-0001": pass } });
    expect(
      await runPrivateTermsReviewRecord({
        argv: argvOf({ rest: ["--review", "pass-0001", "--home", home], verb: "review-record" }),
        deps: run.deps,
      }),
    ).toBe(0);
    expect(run.out).toStrictEqual([
      "receipt rc-0001: CLEAN from codex (review pass-0001) for hold ph-00000000000a",
      "  run the held write again, unchanged: this receipt releases exactly that write, once",
    ]);
    const resent = releaseOrHold({
      draft,
      heldBy: null,
      home,
      newHoldId: () => "ph-00000000000b",
      nowIso: "2026-11-22T00:02:00.000Z",
    });
    expect(unwrap(resent)).toStrictEqual({ kind: "released", receiptId: "rc-0001" });
  });

  it("exits 1 on a BROKEN receipt and keeps the summary out of its JSON", async () => {
    const home = freshHome();
    holdIn({ home });
    const { pass } = preparedPass({ home, verdict: "BROKEN" });
    const run = depsOf({ ids: ["rc-0002"], passes: { "pass-0001": pass } });
    expect(
      await runPrivateTermsReviewRecord({
        argv: argvOf({ rest: ["--review", "pass-0001", "--home", home, "--json"], verb: "review-record" }),
        deps: run.deps,
      }),
    ).toBe(1);
    expect(run.out.length).toBe(1);
    expect(run.out[0]).toContain('"verdict":"BROKEN"');
    expect(run.out[0]!.toLowerCase()).not.toContain("quillfeather");
    expect(run.out[0]).not.toContain('"summary"');
  });

  it("refuses an id naming no Codex pass and no fallback receipt", async () => {
    const home = freshHome();
    const run = depsOf({ ids: [] });
    expect(
      await runPrivateTermsReviewRecord({
        argv: argvOf({ rest: ["--review", "pass-none", "--home", home], verb: "review-record" }),
        deps: run.deps,
      }),
    ).toBe(1);
    expect(run.diagnostics).toStrictEqual([
      "review pass-none cannot be recorded: it names no Codex pass and no Claude fallback receipt",
    ]);
  });

  it("refuses a second receipt of the same review", async () => {
    const home = freshHome();
    holdIn({ home });
    const { pass } = preparedPass({ home, verdict: "CLEAN" });
    const argv = argvOf({ rest: ["--review", "pass-0001", "--home", home], verb: "review-record" });
    expect(
      await runPrivateTermsReviewRecord({
        argv,
        deps: depsOf({ ids: ["rc-0001"], passes: { "pass-0001": pass } }).deps,
      }),
    ).toBe(0);
    const again = depsOf({ ids: ["rc-0002"], passes: { "pass-0001": pass } });
    expect(await runPrivateTermsReviewRecord({ argv, deps: again.deps })).toBe(1);
    expect(again.diagnostics).toStrictEqual(["review pass-0001 is already receipt rc-0001; one review is one receipt"]);
  });
});
