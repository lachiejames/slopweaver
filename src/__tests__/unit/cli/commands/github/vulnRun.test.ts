import { describe, expect, it } from "vitest";

import {
  alertLine,
  type GithubVulnDeps,
  rankAlerts,
  runGithubVuln,
} from "../../../../../cli/commands/github/vulnRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { safeJsonParse } from "../../../../../lib/safeJson.js";
import type { DependabotAlert } from "../../../../../outbound/github/dependabot.js";
import {
  prFormOfVulnerabilityFix,
  type VulnerabilityFixForm,
} from "../../../../../outbound/github/vulnerabilityForm.js";

/** One projected alert; each test overrides only what it is about. */
function alert(over: Partial<DependabotAlert> = {}): DependabotAlert {
  return {
    advisory: {
      cveId: "CVE-2026-1234",
      cvssScore: 8.1,
      cvssVector: "CVSS:3.1/AV:N",
      cweIds: [],
      ghsaId: "GHSA-1111-2222-3333",
      publishedAt: "2026-08-01T00:00:00Z",
      referenceUrls: [],
      severity: "high",
      summary: "Prototype pollution",
      updatedAt: "2026-08-02T00:00:00Z",
      withdrawnAt: undefined,
    },
    createdAt: "2026-09-01T00:00:00Z",
    dependency: {
      ecosystem: "npm",
      manifestPath: "package.json",
      packageName: "lodash",
      relationship: "direct",
      scope: "runtime",
    },
    dismissedAt: undefined,
    dismissedComment: undefined,
    dismissedReason: undefined,
    fixedAt: undefined,
    htmlUrl: "https://github.com/acme/widget/security/dependabot/583",
    number: 583,
    state: "open",
    updatedAt: "2026-09-02T00:00:00Z",
    vulnerableRange: { firstPatchedVersion: "4.17.21", vulnerableVersionRange: "< 4.17.21" },
    ...over,
  };
}

/** The same alert with a different CVSS score. */
function scored({ number, score }: { number: number; score: number }): DependabotAlert {
  const base = alert({ number });
  return { ...base, advisory: { ...base.advisory, cvssScore: score } };
}

describe("rankAlerts", () => {
  it("puts the highest score first", () => {
    const ranked = rankAlerts({
      alerts: [scored({ number: 1, score: 7.5 }), scored({ number: 2, score: 9.8 }), scored({ number: 3, score: 8.1 })],
    });
    expect(ranked.map((row) => row.number)).toEqual([2, 3, 1]);
  });

  it("ranks a low score below a high one rather than by alert number", () => {
    const ranked = rankAlerts({ alerts: [scored({ number: 1, score: 0.1 }), scored({ number: 2, score: 4.3 })] });
    expect(ranked.map((row) => row.number)).toEqual([2, 1]);
  });

  it("breaks a tie by alert number, so the order is stable", () => {
    const ranked = rankAlerts({
      alerts: [scored({ number: 9, score: 8.1 }), scored({ number: 4, score: 8.1 })],
    });
    expect(ranked.map((row) => row.number)).toEqual([4, 9]);
  });

  it("returns an empty list unchanged", () => {
    expect(rankAlerts({ alerts: [] })).toEqual([]);
  });
});

describe("alertLine", () => {
  it("prints the number, state, severity, score, package, relationship, advisory and citation", () => {
    expect(alertLine({ alert: alert() })).toBe(
      "#583  open  high  8.1  lodash  direct  GHSA-1111-2222-3333  " +
        "https://github.com/acme/widget/security/dependabot/583",
    );
  });

  it("prints the score to one decimal place, so a column of them lines up", () => {
    expect(alertLine({ alert: scored({ number: 583, score: 10 }) })).toContain("  10.0  ");
  });

  it("cites the security path, never the pull-request path of the same number", () => {
    expect(alertLine({ alert: alert() })).toContain("/security/dependabot/583");
  });
});

/** Plain-function deps for a verb run that never touches GitHub; each test replaces only the edge it is about. */
function vulnHarness({ over = {} }: { over?: Partial<GithubVulnDeps> } = {}): {
  readonly deps: GithubVulnDeps;
  readonly diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const deps: GithubVulnDeps = {
    deriveSurfaces: () => {
      throw new Error("the derivation must not run when the checkout could not be listed");
    },
    home: () => "/nowhere/home",
    listCheckout: () => [],
    makeApi: () => {
      throw new Error("no GitHub client is needed here");
    },
    out: () => undefined,
    readCheckoutFile: () => undefined,
    readInput: () => "{}",
    token: () => undefined,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOutput: () => undefined,
    ...over,
  };
  return { deps, diagnostics };
}

const VULN_PREFIX = ["node", "slopweaver", "github", "vuln"];

describe("runGithubVuln: a failed read is a failure, not a usage error", () => {
  it("exits EXIT_ERROR when `surfaces` cannot list the checkout", async () => {
    const { deps, diagnostics } = vulnHarness({
      over: {
        listCheckout: () => {
          throw new Error("fatal: not a git repository");
        },
      },
    });
    const code = await runGithubVuln({
      argv: [...VULN_PREFIX, "surfaces", "--package", "lodash", "--checkout", "/nowhere/checkout"],
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual(["could not list /nowhere/checkout: fatal: not a git repository"]);
  });

  it("exits EXIT_ERROR when `body` cannot read its --file", async () => {
    const { deps, diagnostics } = vulnHarness({
      over: {
        readInput: () => {
          throw new Error("ENOENT: no such file or directory, open '/nowhere/form.json'");
        },
      },
    });
    const code = await runGithubVuln({ argv: [...VULN_PREFIX, "body", "--file", "/nowhere/form.json"], deps });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual(["ENOENT: no such file or directory, open '/nowhere/form.json'"]);
  });

  it("still exits EXIT_USAGE when the form it read is not JSON", async () => {
    const { deps } = vulnHarness({ over: { readInput: () => "this is not json" } });
    expect(await runGithubVuln({ argv: [...VULN_PREFIX, "body", "--file", "/nowhere/form.json"], deps })).toBe(
      EXIT_USAGE,
    );
  });
});

/** A complete, valid vulnerability-fix form, the input `body` compiles. */
const VULN_FORM: VulnerabilityFixForm = {
  alerts: [583],
  blastRadius: {
    kind: "surfaces",
    surfaces: [
      {
        check: "open a report and confirm the summary table still renders",
        regressionCover: "covered by report/__tests__/format.test.ts",
        where: "the customer report screen",
      },
    ],
  },
  delta: { deprecatedWeUse: [], obsoleteWorkarounds: [], removedWeUse: [] },
  draft: true,
  ecosystem: "npm",
  ghsaId: "GHSA-1111-2222-3333",
  notValidated: "The signing path is exercised only by an integration suite this branch did not run.",
  packageName: "lodash",
  resolution: { after: "lodash@npm:4.17.21", before: "lodash@npm:4.17.20", command: "yarn why lodash" },
  risk: "A deep merge that relied on the old behaviour could drop keys.",
  rung: { from: "4.17.20", kind: "direct", to: "4.17.21" },
  seenBy: "agent",
  seenOn: "2026-09-30",
  severity: "high",
  target: { base: "main", head: "fix/lodash", owner: "acme", repo: "widget" },
  title: "fix(ABC-9010): clear the lodash prototype-pollution advisory from the customer report (CVSS 7.5)",
  usage: { sites: ["src/report/format.ts:12"], used: true },
};

describe("runGithubVuln body — compiles a form to the pull-request form, and says nothing about a grade", () => {
  it("prints the compiled form on stdout and writes no diagnostic, since the description carries no grade", async () => {
    const printed: string[] = [];
    const { deps, diagnostics } = vulnHarness({
      over: { out: (line) => printed.push(line), readInput: () => JSON.stringify(VULN_FORM) },
    });
    const code = await runGithubVuln({ argv: [...VULN_PREFIX, "body", "--file", "/nowhere/form.json"], deps });
    expect(code).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(safeJsonParse({ label: "the printed form", text: printed.join("\n") })).toStrictEqual(
      prFormOfVulnerabilityFix({ form: VULN_FORM }),
    );
  });
});
