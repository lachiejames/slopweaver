/**
 * `github pr update`'s dry-run stop, called directly: it prints the preview, the above-the-fold verdict and its own
 * read-only contract, sends nothing, and fails only when the above-the-fold gate refused. Every edge but the output
 * sink is a landmine that throws, so a dry run that reached for the network or the door would fail here.
 */
import { describe, expect, it } from "vitest";

import type { AboveFoldVerdict } from "../../../../../cli/aboveFoldDoor.js";
import { clearDescriptionReview } from "../../../../../cli/commands/github/descriptionReviewCheck.js";
import type { GithubPrDeps } from "../../../../../cli/commands/github/prDeps.js";
import { printUpdateDryRun } from "../../../../../cli/commands/github/updateDryRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { PrForm } from "../../../../../outbound/github/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { memoryIdentityRosterPort } from "../../../../identityRosterFixture.js";

/** An edge a dry run must never reach — calling one throws, naming it. */
function landmine({ name }: { name: string }): () => never {
  return () => {
    throw new Error(`a dry run must not reach ${name}`);
  };
}

/** Deps whose only live edge is the output sink, and the lines it collected. */
function harness(): { deps: GithubPrDeps; lines: string[] } {
  const lines: string[] = [];
  const deps: GithubPrDeps = {
    autonomy: {
      appendRecord: landmine({ name: "autonomy.appendRecord" }),
      readRecords: landmine({ name: "autonomy.readRecords" }),
    },
    cwd: landmine({ name: "cwd" }),
    descriptionReview: clearDescriptionReview,
    doorLedger: memoryDoorLedger().port,
    identityRoster: memoryIdentityRosterPort(),
    installationIdentifiers: landmine({ name: "installationIdentifiers" }),
    env: landmine({ name: "env" }),
    err: landmine({ name: "err" }),
    makeApi: landmine({ name: "makeApi" }),
    measureAlreadyLanded: landmine({ name: "measureAlreadyLanded" }),
    measureBaseFreshness: landmine({ name: "measureBaseFreshness" }),
    now: landmine({ name: "now" }),
    out: ({ line }) => lines.push(line),
    readFileSource: landmine({ name: "readFileSource" }),
    readForm: landmine({ name: "readForm" }),
    sleep: landmine({ name: "sleep" }),
    token: landmine({ name: "token" }),
    writeFileOut: landmine({ name: "writeFileOut" }),
  };
  return { deps, lines };
}

const FORM: PrForm = { ...EXAMPLE_PR_FORM, draft: true };

const LIVE: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: "old body",
  commits: 1,
  draft: false,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1111111111111111111111111111111111111111" },
  htmlUrl: "https://example.invalid/pr/42",
  mergedAtIso: undefined,
  nodeId: "PR_42",
  number: 42,
  stack: undefined,
  state: "open",
  title: "t",
  updatedAtIso: "2026-10-01T00:00:00Z",
};

/** A verdict with the given refusals and nothing else found. */
function verdict({ refusals }: { refusals: readonly string[] }): AboveFoldVerdict {
  return {
    findings: [],
    lengthCalibration: "uncalibrated",
    lengthWarnings: [],
    refusals,
    surface: "github",
    warnings: [],
  };
}

/** The preview's opening lines for the example form and `body`, ending in the given pr-format line. */
function previewLines({ body, prFormat }: { body: string; prFormat: string }): readonly string[] {
  return [
    "would open: acme/widgets  a-branch -> main  (draft)",
    "title: fix(export): keep the last entry of a sheet",
    "",
    "--- body (exact bytes that would be sent) ---",
    body,
    "--- end body ---",
    "",
    prFormat,
    "",
  ];
}

const UNCALIBRATED =
  "measured length register: NOT CALIBRATED for this surface — the length half of the gate did not run";

const CONTRACT = [
  "would update #42 (o/r#42)",
  "dry run: a token was resolved and the pull request was READ; no door record, no PATCH.",
];

const ACCEPTS = "pr-format: ACCEPTS this title and body (CI's shape check and secret scan)";

describe("printUpdateDryRun", () => {
  it("prints exactly the preview, the gate's verdict and its read-only contract, and exits OK", () => {
    const { deps, lines } = harness();
    const exit = printUpdateDryRun({
      aboveFold: verdict({ refusals: [] }),
      body: "the new body",
      deps,
      form: FORM,
      live: LIVE,
      locus: "o/r#42",
      rendered: { body: "the new body", errors: [], ok: true },
    });
    expect(exit).toBe(EXIT_OK);
    expect(lines).toStrictEqual([
      ...previewLines({ body: "the new body", prFormat: ACCEPTS }),
      "above-the-fold gate: ACCEPTS this body",
      UNCALIBRATED,
      "",
      ...CONTRACT,
    ]);
  });

  it("fails even a dry run when the above-the-fold gate refuses, printing the refusal", () => {
    const { deps, lines } = harness();
    const exit = printUpdateDryRun({
      aboveFold: verdict({ refusals: ["Change: an em dash above the fold"] }),
      body: "the new body",
      deps,
      form: FORM,
      live: LIVE,
      locus: "o/r#42",
      rendered: { body: "the new body", errors: [], ok: true },
    });
    expect(exit).toBe(EXIT_ERROR);
    expect(lines).toStrictEqual([
      ...previewLines({ body: "the new body", prFormat: ACCEPTS }),
      "above-the-fold gate: REFUSES this body:\n  - Change: an em dash above the fold",
      UNCALIBRATED,
      "",
      ...CONTRACT,
    ]);
  });

  it("still exits OK on a pr-format rejection, which the dry run reports rather than gates on", () => {
    const { deps, lines } = harness();
    const exit = printUpdateDryRun({
      aboveFold: verdict({ refusals: [] }),
      body: "",
      deps,
      form: FORM,
      live: LIVE,
      locus: "o/r#42",
      rendered: { body: "", errors: ["missing Problem heading"], ok: false },
    });
    expect(exit).toBe(EXIT_OK);
    expect(lines).toStrictEqual([
      ...previewLines({ body: "", prFormat: "pr-format: REJECTS this title and body:\n  - missing Problem heading" }),
      "above-the-fold gate: ACCEPTS this body",
      UNCALIBRATED,
      "",
      ...CONTRACT,
    ]);
  });
});
