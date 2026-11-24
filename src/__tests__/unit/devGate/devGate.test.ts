// The event label list `labelsFromEnv` parsed is retired with it; the live read is tested in prLabels.test.ts.
// deleted-with-code: labelsFromEnv
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import {
  composeGate,
  evidenceHandoffResult,
  type GateCheckResult,
  gateLogLines,
  prFormatResult,
  prFormatUnderOrganisation,
  runDevGate,
} from "../../../devGate/devGate.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { type DependencyBotActors, dependencyBotActors } from "../../../organisation/dependencyBots.js";
import { OrganisationErrors } from "../../../organisation/errors.js";
import { PRE_C3_CONVERSION } from "../../../outbound/github/errors.js";
import { renderPrBody } from "../../../outbound/github/render.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";
import { FIX_BODY, formOf } from "../outbound/github/fixtures.js";

/** Parse a JSONL line to a record, THROWING if it is not one — keeps assertions conditional-free. */
function parseLogLine({ line }: { line: string }): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error("log line is not a JSON object");
  }
  return value;
}

/** A C3 body exactly as the door renders it. */
const conformingBody = unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }));

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** A person's pull request from a branch of this repository. */
const OWNED = {
  author: "octocat",
  bots: GENERIC,
  headRepository: "acme/widgets",
  ownRepository: "acme/widgets",
} as const;

/** A conforming retired table body, the shape a Renovate bump still carries. */
const TABLE_BODY = [
  "![CI](https://img.shields.io/badge/CI-x-2ea44f)",
  "<table><tr><td><strong>Risk</strong></td><td>Low risk.</td></tr><tr><td><strong>Blast radius</strong></td><td>This test.</td></tr><tr><td><strong>Problem</strong></td><td>p <a href='https://linear.app/acme/issue/ABC-1'>ABC-1</a></td></tr>",
  "<tr><td><strong>Solution</strong></td><td>s</td></tr>",
  "<tr><td><strong>Proof</strong></td><td>x</td></tr></table>",
].join("\n");

/** The pr-format result for an owned retired table body: refused, naming the conversion. */
const TABLE_REFUSED: GateCheckResult = {
  name: "pr-format",
  ok: false,
  summary:
    "PRE_C3_SHAPE: the description is a pre-C3 retired-table body. Convert it, which writes an authoring file and " +
    `sends nothing: \`${PRE_C3_CONVERSION}\`.`,
};

/** The pr-format result for a stranger's body the scans found nothing in. */
const STRANGER_CONFORMS: GateCheckResult = {
  name: "pr-format",
  ok: true,
  summary: "PR description conforms (a stranger's pull request: only the security scans ran)",
};

describe("prFormatResult", () => {
  it("passes an owned C3 body", () => {
    expect(prFormatResult({ body: conformingBody, ...OWNED })).toEqual({
      name: "pr-format",
      ok: true,
      summary: "PR description conforms",
    });
  });

  it("fails an owned missing body (never a skip)", () => {
    const result = prFormatResult({ body: undefined, ...OWNED });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("no PR body provided");
  });

  it("fails an owned body that is not C3, naming the template", () => {
    const result = prFormatResult({ body: "just some prose", ...OWNED });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("The description is not a C3 body.");
    expect(result.summary).toContain(".github/pull_request_template.md");
  });

  it("fails an owned pull request whose labels lack the kind label its title derives", () => {
    const result = prFormatResult({
      body: conformingBody,
      labels: [],
      title: "fix(widgets): refuse an open store",
      ...OWNED,
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('KIND_LABEL_MISSING: the title\'s kind derives the label "bug fix"');
  });

  it("judges a fork's prose by the scans alone, and says so", () => {
    expect(prFormatResult({ ...OWNED, body: "just some prose", headRepository: "someone/widgets" })).toEqual({
      name: "pr-format",
      ok: true,
      summary: "PR description conforms (a stranger's pull request: only the security scans ran)",
    });
  });

  it("lets a stranger leave the body empty", () => {
    expect(prFormatResult({ author: "renovate[bot]", body: undefined, bots: GENERIC }).ok).toBe(true);
  });

  // A synthetic body in the self-hosted Renovate's shape, Mend badges and all, by the author the organisation names.
  it("passes a renovate bump's body as a stranger's", () => {
    const body = readFileSync(
      join(process.cwd(), "src/__tests__/fixtures/prformat/renovate-synthetic-body.txt"),
      "utf8",
    );
    const result = prFormatResult({ author: "acme-renovate[bot]", body, bots: CONFIGURED });
    expect(result).toEqual({
      name: "pr-format",
      ok: true,
      summary: "PR description conforms (a stranger's pull request: only the security scans ran)",
    });
  });

  // A self-hosted Renovate App opens under its own `<name>[bot]`, which is a stranger only once an installation lists it.
  it("judges the same body from an unlisted App the event does not type as owned, and refuses it", () => {
    const body = readFileSync(
      join(process.cwd(), "src/__tests__/fixtures/prformat/renovate-synthetic-body.txt"),
      "utf8",
    );
    const result = prFormatResult({ author: "acme-release-app[bot]", body, bots: CONFIGURED });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(TABLE_REFUSED.summary);
  });

  it("refuses a person's retired table body, naming the conversion", () => {
    expect(prFormatResult({ body: TABLE_BODY, ...OWNED })).toEqual(TABLE_REFUSED);
  });

  it("keeps renovate's table body green, its body coming from renovate.json", () => {
    expect(prFormatResult({ author: "renovate[bot]", body: TABLE_BODY, bots: GENERIC })).toEqual(STRANGER_CONFORMS);
  });

  it("judges a table body as owned when the CI event's author is not supplied, rather than guessing", () => {
    expect(prFormatResult({ body: TABLE_BODY, bots: GENERIC })).toEqual(TABLE_REFUSED);
  });

  it("passes an App's table body with no organisation, on the event's Bot account type", () => {
    const result = prFormatResult({ author: "acme-renovate[bot]", authorType: "Bot", body: TABLE_BODY, bots: GENERIC });
    expect(result).toEqual(STRANGER_CONFORMS);
  });

  it("refuses the public Dependabot's table body even when the event types it a Bot", () => {
    const result = prFormatResult({ author: "dependabot[bot]", authorType: "Bot", body: TABLE_BODY, bots: GENERIC });
    expect(result).toEqual(TABLE_REFUSED);
  });

  it("refuses a gold anchor appended to a C3 body, last in the summary", () => {
    const anchor = "proof-commit: c6b7dbca1f2e3d4b5a6978890abcdef012345678";
    const result = prFormatResult({ body: `${conformingBody}\n${anchor}\n`, ...OWNED });
    expect(result.ok).toBe(false);
    expect(
      result.summary.endsWith(
        "; RETIRED_PUBLICATION: the description publishes a gold anchor, which a C3 description never carries. Remove it",
      ),
    ).toBe(true);
  });

  it("refuses a whitespace-only owned body exactly as a missing one", () => {
    expect(prFormatResult({ body: " \n\t\n", ...OWNED })).toEqual(prFormatResult({ body: undefined, ...OWNED }));
  });

  it("judges a CRLF copy of the C3 body by its content", () => {
    expect(prFormatResult({ body: conformingBody.replaceAll("\n", "\r\n"), ...OWNED })).toEqual({
      name: "pr-format",
      ok: true,
      summary: "PR description conforms",
    });
  });

  it("says nothing extra once the derived kind label is carried", () => {
    const result = prFormatResult({
      body: conformingBody,
      labels: ["bug fix"],
      title: "fix(widgets): refuse an open store",
      ...OWNED,
    });
    expect(result).toEqual({ name: "pr-format", ok: true, summary: "PR description conforms" });
  });

  it("skips the kind-label check when the event carries a title but no labels", () => {
    const result = prFormatResult({ body: conformingBody, title: "fix(widgets): refuse an open store", ...OWNED });
    expect(result).toEqual({ name: "pr-format", ok: true, summary: "PR description conforms" });
  });

  it("still runs the security scans over a stranger's body, naming the line", () => {
    const result = prFormatResult({
      author: "renovate[bot]",
      body: "bump a dependency\nzzfixtureterm here",
      bots: GENERIC,
      denylist: ["zzfixtureterm"],
    });
    expect(result).toEqual({
      name: "pr-format",
      ok: false,
      summary: "PR body contains a denylisted term at line 2 — remove it (the matched text is redacted from this log).",
    });
  });
});

describe("prFormatUnderOrganisation", () => {
  /** The check as the shell runs it: the self-hosted App's prose body. */
  const check = ({ bots }: { bots: DependencyBotActors }): GateCheckResult =>
    prFormatResult({ author: "acme-renovate[bot]", body: "just some prose", bots });

  it("judges with the organisation's own bots and adds nothing to the summary", () => {
    const result = prFormatUnderOrganisation({
      check,
      organisation: ok({ ...ACME_ORGANISATION, dependencyBots: ["acme-renovate"] }),
    });
    expect(result).toEqual({
      name: "pr-format",
      ok: true,
      summary: "PR description conforms (a stranger's pull request: only the security scans ran)",
    });
  });

  it("judges with the generic Renovate alone where nothing is configured, and says so in the summary", () => {
    const result = prFormatUnderOrganisation({
      check,
      organisation: err(OrganisationErrors.notConfigured({ missing: "organisation" })),
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("The description is not a C3 body.");
    expect(
      result.summary.endsWith(
        "; only the generic Renovate (renovate[bot]) and Dependabot (dependabot[bot]) are recognised as dependency " +
          "bots — no organisation is configured in the store — write it once with `slopweaver org set`",
      ),
    ).toBe(true);
  });

  it("fails the check with the code, never judging, when the organisation will not read", () => {
    const result = prFormatUnderOrganisation({
      check,
      organisation: err(OrganisationErrors.invalid({ issues: ["dependencyBots: has a duplicate entry"] })),
    });
    expect(result).toEqual({
      name: "pr-format",
      ok: false,
      summary:
        "ORG_INVALID: which authors are dependency bots could not be read — " +
        "the organisation does not read: dependencyBots: has a duplicate entry",
    });
  });
});

describe("evidenceHandoffResult", () => {
  it("accounts for the frozen handoff: one quoted finding kept, two refused, one shard unanswered", () => {
    const result = evidenceHandoffResult();

    expect(result.name).toBe("evidence-handoff");
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("1 quoted finding kept");
  });

  it("says plainly that it is grounding accounting rather than the retired retrieval measurement", () => {
    // The gate used to report recall@12 against frozen floors. The ranker was deleted that
    // number described, and a replacement check wearing the old name would read as continuity across a
    // mechanism change — so the summary names what it does NOT measure.
    expect(evidenceHandoffResult().summary).toContain("NOT retrieval quality");
  });
});

describe("runDevGate arg rejection", () => {
  it("rejects an unknown flag with EXIT_USAGE before running any check", async () => {
    // argv: [node, cli, dev, gate, --bogus] — parse fails first, so no ledger/check I/O happens.
    expect(await runDevGate(["node", "cli", "dev", "gate", "--bogus"])).toBe(EXIT_USAGE);
  });
});

describe("composeGate", () => {
  const pass: GateCheckResult = { name: "hygiene", ok: true, summary: "clean" };
  const fail: GateCheckResult = { name: "pr-format", ok: false, summary: "bad" };
  const allFour: readonly GateCheckResult[] = [
    pass,
    { name: "pr-format", ok: true, summary: "ok" },
    { name: "evidence-handoff", ok: true, summary: "ok" },
    { name: "answer-quality", ok: true, summary: "ok" },
  ];

  it("passes (exit 0) only when all four checks ran and passed", () => {
    expect(composeGate({ results: allFour })).toEqual({ exit: 0, ok: true });
  });

  it("fails (exit 1) when any check fails", () => {
    expect(composeGate({ results: [pass, fail, allFour[2]!, allFour[3]!] })).toEqual({ exit: 1, ok: false });
  });

  it("fails an empty result list rather than passing it vacuously", () => {
    expect(composeGate({ results: [] })).toEqual({ exit: 1, ok: false });
  });

  it("fails when a check never ran, even with every result that did run green", () => {
    expect(composeGate({ results: allFour.slice(0, 3) })).toEqual({ exit: 1, ok: false });
  });

  it("fails when one check is reported twice in place of another", () => {
    expect(composeGate({ results: [pass, pass, allFour[2]!, allFour[3]!] })).toEqual({ exit: 1, ok: false });
  });
});

describe("gateLogLines", () => {
  it("emits one JSONL line per check with the run id, status, and summary", () => {
    const results: GateCheckResult[] = [
      { name: "hygiene", ok: true, summary: "clean" },
      { name: "pr-format", ok: false, summary: "bad" },
    ];
    const lines = gateLogLines({ results, runId: "run-1", tsIso: "2026-07-14T00:00:00.000Z" });
    expect(lines).toHaveLength(2);
    expect(parseLogLine({ line: lines[0]! })).toEqual({
      check: "hygiene",
      runId: "run-1",
      schemaVersion: 1,
      status: "pass",
      summary: "clean",
      tsIso: "2026-07-14T00:00:00.000Z",
    });
    expect(parseLogLine({ line: lines[1]! })).toEqual({
      check: "pr-format",
      runId: "run-1",
      schemaVersion: 1,
      status: "fail",
      summary: "bad",
      tsIso: "2026-07-14T00:00:00.000Z",
    });
  });
});
