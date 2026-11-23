/**
 * `github pr update` against a settled ask of the owner's: a write that drops the screenshot the ask named the pull
 * request for is refused on every mode, `SLOPWEAVER_ALLOW_PR_REPLACE=1` included, and only a live
 * `pr-evidence-loss` grant lets it through. Driven end-to-end through `runGithubPr` over a temp home holding a
 * real board row, so the board read, the grant journal and the door are the shipped ones.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import { parseGithubPrArgs } from "../../../../../cli/commands/github/core.js";
import { runGithubPr } from "../../../../../cli/commands/github/run.js";
import { consentStops } from "../../../../../cli/commands/github/updateConsent.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap } from "../../../../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { renderPrBody } from "../../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import type { PrFormDraft, ProofSlot } from "../../../../../outbound/github/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { fakeApi, harnessDeps } from "../../../../githubPrHarness.js";
import { grantedEnv } from "../../../../hatchGrantFixture.js";
import { homeDeclaringNoPrivateTerms } from "../../../../privateTermsFixture.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = homeDeclaringNoPrivateTerms({ prefix: "settled-evidence-run-" });
  fixtureDirs.push(home);
  return home;
}

const SHOT = "https://github.com/user-attachments/assets/5d1e2f3a-4b5c-4d6e-8f70-81920a3b4c5d";
const TARGET = { base: "main", head: "feature", owner: "o", repo: "r" };

/** The solution slot as it was before the screenshot was added: a reason, so the proof badge reads not run yet. */
const NOT_RUN: ProofSlot = {
  kind: "reason",
  reason: [{ kind: "text", text: "The export has not been run on this branch yet." }],
};

/** The example draft on the example pull request, as it was before the screenshot was added. */
const PLAIN: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  problemSeen: { by: "agent", kind: "seen", on: "2026-08-01", what: "an exported report was one row short" },
  solutionProof: NOT_RUN,
  target: TARGET,
};

/** The solution proven by the screenshot the settled ask named. */
const PROVEN_BY_SHOT: ProofSlot = {
  image: { alt: "the exported report", kind: "image", url: SHOT },
  kind: "screenshot",
  proves: [{ kind: "text", text: "On this branch, the export keeps the last row." }],
  runBy: "agent",
};

/** The example pull request's description as GitHub holds it: the screenshot drawn as the proof of the solution. */
const LIVE_BODY = unwrap(
  renderPrBody({
    form: unwrap(stampForWrite({ draft: { ...PLAIN, solutionProof: PROVEN_BY_SHOT }, today: "2026-08-14" })),
  }),
);

/** A settled ask of the owner's whose witness is the example pull request, written where the board reads it. */
function settledRow({ home }: { home: string }): void {
  const handovers = stateHomePaths({ home }).handovers;
  mkdirSync(handovers, { recursive: true });
  const row = [
    "---",
    "slug: r-42-gets-before-and-after-proof",
    "kind: ask",
    "status: ready",
    'summary: "r 42 gets before and after proof"',
    "settlement: answered",
    'settlementWitness: "https://github.com/o/r/pull/42"',
    'anchor: "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433"',
    'askedIso: "2026-08-10T02:41:26.704Z"',
    'ownerWords: "it needs before and after proof with screenshots"',
    'ownerWordsAnchor: "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433"',
    'ownerWordsIso: "2026-08-10T02:41:26.704Z"',
    "ownerWordsWhere: session",
    "ownerWordsCut: none",
    "---",
    "",
    "# Row",
  ].join("\n");
  writeFileSync(join(handovers, "r-42-gets-before-and-after-proof.md"), row);
}

/** The example pull request as GitHub returns it. */
const LIVE: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: LIVE_BODY,
  commits: 1,
  draft: false,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1111111111111111111111111111111111111111" },
  htmlUrl: "https://github.com/o/r/pull/42",
  mergedAtIso: undefined,
  nodeId: "PR_42",
  number: 42,
  stack: undefined,
  state: "open",
  title: PLAIN.title,
  updatedAtIso: "2026-08-10T00:00:00Z",
};

/** Every body the verb sent to GitHub, so a refusal is proven by an empty list rather than by silence. */
function recordingApi(): { api: GithubWriteApi; sent: string[] } {
  const sent: string[] = [];
  const api = fakeApi({
    getPr: () => okAsync(LIVE),
    updatePr: ({ body }) => {
      sent.push(body!);
      return okAsync({ ...LIVE, body: body! });
    },
  });
  return { api, sent };
}

/** The `github pr update` argv for the example pull request. */
function updateArgv({ flags, home }: { flags: readonly string[]; home: string }): readonly string[] {
  return ["node", "slopweaver", "github", "pr", "update", ...flags, "--repo", "o/r", "--number", "42", "--home", home];
}

/** An `--edit` putting the solution slot back to its screenshot-less reason — the 17564 rollout's move. */
const EDIT_DROPPING_SHOT = ["--edit", JSON.stringify({ solutionProof: NOT_RUN })];

describe("github pr update over a settled ask naming the pull request", () => {
  it("refuses an --edit that drops the screenshot, names the row and the URL, and sends nothing", async () => {
    const home = tempHome();
    settledRow({ home });
    const { api, sent } = recordingApi();
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubPr({ argv: updateArgv({ flags: EDIT_DROPPING_SHOT, home }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(sent).toStrictEqual([]);
    const printed = lines.join("\n");
    expect(printed).toContain(`settled owner rows: r-42-gets-before-and-after-proof; lost: ${SHOT}`);
    expect(printed).toContain("slopweaver hatch open pr-evidence-loss");
  });

  it("still refuses a whole --form replacement made under SLOPWEAVER_ALLOW_PR_REPLACE=1", async () => {
    const home = tempHome();
    settledRow({ home });
    const { api, sent } = recordingApi();
    const { deps, lines } = harnessDeps({ api, env: { SLOPWEAVER_ALLOW_PR_REPLACE: "1" } });
    const code = await runGithubPr({ argv: updateArgv({ flags: ["--form", JSON.stringify(PLAIN)], home }), deps });
    expect(code).toBe(EXIT_ERROR);
    expect(sent).toStrictEqual([]);
    expect(lines.some((line) => line.startsWith("refused:") && line.includes("pr-evidence-loss"))).toBe(true);
  });

  it("prints a dry run's refusal as a finding and exits 0, sending nothing", async () => {
    const home = tempHome();
    settledRow({ home });
    const { api, sent } = recordingApi();
    const { deps, lines } = harnessDeps({ api });
    const code = await runGithubPr({ argv: updateArgv({ flags: [...EDIT_DROPPING_SHOT, "--dry-run"], home }), deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toStrictEqual([]);
    expect(lines).toContain("dry run finding: a real update would refuse:");
  });

  it("sends the write under a live pr-evidence-loss grant, and says what it waived", async () => {
    const home = tempHome();
    settledRow({ home });
    const env = grantedEnv({ hatchIds: ["pr-evidence-loss"], home, issuedAtIso: "2026-08-14T23:50:00.000Z" });
    const { api, sent } = recordingApi();
    const { deps, lines } = harnessDeps({ api, env });
    const code = await runGithubPr({ argv: updateArgv({ flags: EDIT_DROPPING_SHOT, home }), deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toHaveLength(1);
    expect([LIVE_BODY.includes(SHOT), sent[0]!.includes(SHOT)]).toStrictEqual([true, false]);
    expect(lines.some((line) => line.startsWith("OVERRIDDEN via the journalled pr-evidence-loss grant"))).toBe(true);
  });

  it("sends the same write when no settled ask names the pull request", async () => {
    const home = tempHome();
    const { api, sent } = recordingApi();
    const { deps } = harnessDeps({ api });
    const code = await runGithubPr({ argv: updateArgv({ flags: EDIT_DROPPING_SHOT, home }), deps });
    expect(code).toBe(EXIT_OK);
    expect(sent).toHaveLength(1);
  });

  it("refuses a dropping write over a row that cannot be read, even on a dry run, and passes a keeping one", async () => {
    const home = tempHome();
    // Not a regular file, so the board reports it unreadable rather than blocking on it.
    mkdirSync(join(stateHomePaths({ home }).handovers, "r-42-gets-before-and-after-proof.md"), { recursive: true });
    const dropping = recordingApi();
    const dropped = harnessDeps({ api: dropping.api });
    const droppingCode = await runGithubPr({
      argv: updateArgv({ flags: [...EDIT_DROPPING_SHOT, "--dry-run"], home }),
      deps: dropped.deps,
    });
    expect(droppingCode).toBe(EXIT_ERROR);
    expect(dropped.lines.some((line) => line.includes("holds rows that will not parse"))).toBe(true);

    const keeping = recordingApi();
    const kept = harnessDeps({ api: keeping.api });
    const keepingCode = await runGithubPr({
      argv: updateArgv({ flags: ["--edit", JSON.stringify({ title: "A clearer title" })], home }),
      deps: kept.deps,
    });
    expect(keepingCode).toBe(EXIT_OK);
    expect(keeping.sent).toHaveLength(1);
  });
});

describe("consentStops — the evidence check runs before the replacement key is read", () => {
  const args = unwrap(parseGithubPrArgs({ argv: ["update", "--form", "{}", "--repo", "o/r", "--number", "42"] }));
  const form = unwrap(stampForWrite({ draft: PLAIN, today: "2026-08-15" }));
  const env = { SLOPWEAVER_ALLOW_PR_REPLACE: "1" };

  it("refuses a keyed wholesale write that drops settled evidence, never printing the replacement override", () => {
    const home = tempHome();
    settledRow({ home });
    const { deps, lines } = harnessDeps({ api: fakeApi({}), env });
    expect(consentStops({ args, body: "a new body", deps, form, home, live: LIVE, wholesale: true })).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`refused: slopweaver github pr update blocked because the new description drops`);
  });

  it("takes the replacement key once no settled ask names the pull request", () => {
    const home = tempHome();
    const { deps, lines } = harnessDeps({ api: fakeApi({}), env });
    expect(consentStops({ args, body: "a new body", deps, form, home, live: LIVE, wholesale: true })).toBe(false);
    expect(lines).toStrictEqual([
      "OVERRIDDEN via SLOPWEAVER_ALLOW_PR_REPLACE=1 — replacing the whole description. Say so in the pull request.",
    ]);
  });
});
