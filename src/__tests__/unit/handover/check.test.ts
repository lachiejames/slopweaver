import { describe, expect, it } from "vitest";

import {
  checkHandoverDoc,
  checkHandoverFrontMatter,
  checkPortedStandardCitesRuling,
  resolveCheckRepo,
} from "../../../handover/check.js";

/** Resolves only the paths a fixture declares real, so every rule is testable without a repository. */
function resolver({ real }: { real: readonly string[] }) {
  return ({ token }: { token: string }): boolean => real.includes(token);
}

describe("checkHandoverDoc", () => {
  it("passes a doc whose references all resolve", () => {
    const findings = checkHandoverDoc({
      resolves: resolver({ real: ["src/a.ts"] }),
      text: "Read `src/a.ts` first.\n",
    });

    expect(findings).toEqual([]);
  });

  it("names a referenced file that is not committed, with its line", () => {
    const findings = checkHandoverDoc({
      resolves: resolver({ real: [] }),
      text: "one\ntwo\nRead `src/ghost.ts`.\n",
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(3);
    expect(findings[0]!.message).toContain("src/ghost.ts");
  });

  /**
   * The failure this whole verb exists for: a hand-rolled grep with a prefix filter skipped `AGENTS.md` and
   * still reported success. No prefix list here — anything file-shaped is checked.
   */
  it("checks a reference that lives at the repository root, not only under src/", () => {
    const findings = checkHandoverDoc({ resolves: resolver({ real: [] }), text: "See `AGENTS.md`.\n" });

    expect(findings.length).toBe(1);
  });

  it("ignores a suffix convention like `.entry.ts`, which is not a path", () => {
    expect(checkHandoverDoc({ resolves: resolver({ real: [] }), text: "add an `.entry.ts` beside it\n" })).toEqual([]);
  });

  it("rejects a hard-coded count and quotes it in full, commas included", () => {
    const findings = checkHandoverDoc({ resolves: resolver({ real: [] }), text: "Baseline is 2,826 tests.\n" });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain('"2,826 tests"');
  });

  it("leaves a baseline stated as a command alone", () => {
    expect(checkHandoverDoc({ resolves: resolver({ real: [] }), text: "Baseline: `yarn validate` exit 0.\n" })).toEqual(
      [],
    );
  });
});

describe("checkHandoverDoc — a launch section naming a base branch", () => {
  it("adds no finding for the base a launch section names, while a later count on the same doc still fires", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: "## Launch\n\nBase: `v2-ada-owner-work-console`.\n\nBaseline is 2,826 tests.\n",
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(5);
    expect(findings[0]!.message).toContain("states a count");
  });
});

describe("checkHandoverDoc — findings from different checks", () => {
  const porting = "We are porting the pr-format standard from slopweaver into acme-admin.";
  const count = "Baseline is 2,826 tests.";

  it("returns them in line order when the ported standard comes first", () => {
    const findings = checkHandoverDoc({ resolves: () => true, text: `${porting}\n\n${count}\n` });

    expect(findings.map((finding) => finding.line)).toEqual([1, 3]);
  });

  it("returns them in line order when the count comes first", () => {
    const findings = checkHandoverDoc({ resolves: () => true, text: `${count}\n\n${porting}\n` });

    expect(findings.map((finding) => finding.line)).toEqual([1, 3]);
  });
});

describe("checkPortedStandardCitesRuling", () => {
  it("flags a doc porting a standard from slopweaver with no ruling cited", () => {
    const findings = checkPortedStandardCitesRuling({
      text: "We are porting the pr-format standard from slopweaver into acme-admin, unchanged.\n",
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(1);
    expect(findings[0]!.message).toContain("owner ruling");
  });

  it("passes once the doc cites the prior owner ruling", () => {
    const findings = checkPortedStandardCitesRuling({
      text:
        "We are porting the pr-format standard from slopweaver into acme-admin. Owner ruling, 29 Aug 2026: " +
        '"open it as a draft against staging" — this doc applies the same rule.\n',
    });

    expect(findings).toEqual([]);
  });

  it("stays silent on a doc that ports nothing", () => {
    expect(
      checkPortedStandardCitesRuling({ text: "This doc adds a new gate, unrelated to any prior work.\n" }),
    ).toEqual([]);
  });
});

describe("checkHandoverFrontMatter", () => {
  const sound = {
    artifact: "https://example.invalid/a",
    problems: [],
    requireStatusSummary: false,
    status: "ready",
    statusSummary: "confidence, blockers, and next step in one line",
    unknownDependencies: [],
  };

  it("passes complete front-matter", () => {
    expect(checkHandoverFrontMatter(sound)).toEqual([]);
  });

  it("reports an unusable status", () => {
    expect(checkHandoverFrontMatter({ ...sound, status: "unknown" })[0]!.message).toContain("no usable `status:`");
  });

  it("reports a dependency no doc claims, because a typo blocks forever", () => {
    expect(checkHandoverFrontMatter({ ...sound, unknownDependencies: ["ghost"] })[0]!.message).toContain("ghost");
  });

  it("reports a missing artifact, because that is what gets re-read days later", () => {
    expect(checkHandoverFrontMatter({ ...sound, artifact: undefined })[0]!.message).toContain("artifact");
  });

  it("passes parse problems through rather than swallowing them", () => {
    expect(checkHandoverFrontMatter({ ...sound, problems: ["declares x twice"] })[0]!.message).toBe("declares x twice");
  });

  describe("--require-status-summary", () => {
    it("stays silent on a missing statusSummary by default — no retroactive requirement", () => {
      expect(checkHandoverFrontMatter({ ...sound, statusSummary: undefined })).toEqual([]);
    });

    it("fails a missing statusSummary once required", () => {
      const findings = checkHandoverFrontMatter({ ...sound, requireStatusSummary: true, statusSummary: undefined });
      expect(findings[0]!.field).toBe("statusSummary");
      expect(findings[0]!.message).toContain("statusSummary");
    });

    it("fails a blank statusSummary once required — whitespace is not content", () => {
      const findings = checkHandoverFrontMatter({ ...sound, requireStatusSummary: true, statusSummary: "   " });
      expect(findings[0]!.field).toBe("statusSummary");
    });

    it("passes a real statusSummary once required", () => {
      expect(checkHandoverFrontMatter({ ...sound, requireStatusSummary: true })).toEqual([]);
    });
  });
});

describe("resolveCheckRepo", () => {
  it("uses the doc's own repo when neither flag nor fallback is asked for", () => {
    const resolution = resolveCheckRepo({
      docRepo: "/repo/acme-admin",
      fallback: "/repo/slopweaver",
      repoFlag: undefined,
    });
    expect(resolution).toEqual({ repo: "/repo/acme-admin", source: "doc" });
  });

  it("prefers an explicit --repo over the doc's own repo", () => {
    const resolution = resolveCheckRepo({
      docRepo: "/repo/acme-admin",
      fallback: "/repo/slopweaver",
      repoFlag: "/repo/override",
    });
    expect(resolution).toEqual({ repo: "/repo/override", source: "flag" });
  });

  it("falls back to the caller's own checkout only when the doc names no repo and no flag was given", () => {
    const resolution = resolveCheckRepo({ docRepo: undefined, fallback: "/repo/slopweaver", repoFlag: undefined });
    expect(resolution).toEqual({ repo: "/repo/slopweaver", source: "fallback" });
  });

  it("prefers --repo even when the doc names no repo at all", () => {
    const resolution = resolveCheckRepo({
      docRepo: undefined,
      fallback: "/repo/slopweaver",
      repoFlag: "/repo/override",
    });
    expect(resolution).toEqual({ repo: "/repo/override", source: "flag" });
  });
});
