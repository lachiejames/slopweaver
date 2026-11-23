/**
 * Builders the vulnerability-fix top-up's unit tests share: one Dependabot alert, one not-a-bump ruling, one roster
 * pull request, a cap's room, one member reading of a previous batch, and one merge-release verdict.
 */
import type { NotABumpRuling } from "../live/vuln/notABumpStore.js";
import type { DependabotAlert } from "../outbound/github/dependabot.js";
import type { TopupCapacity, VulnRosterEntry } from "../review/vulnRoster.js";
import type { TopupGateVerdict, TopupMemberReading } from "../review/vulnTopupGate.js";

/** The repository every alert below is in — the `htmlUrl` {@link alert} writes names it. */
export const REPO = "owner/name";

/**
 * One alert with the fields the planner reads stated, and every other field stated absent.
 *
 * @returns the alert, open, in {@link REPO}
 */
export function alert({
  number,
  packageName,
  cvssScore,
  severity = "high",
  firstPatchedVersion,
}: {
  number: number;
  packageName: string | undefined;
  cvssScore: number;
  severity?: string;
  firstPatchedVersion?: string | undefined;
}): DependabotAlert {
  return {
    advisory: {
      cveId: undefined,
      cvssScore,
      cvssVector: undefined,
      cweIds: [],
      ghsaId: `GHSA-${String(number)}`,
      publishedAt: undefined,
      referenceUrls: [],
      severity,
      summary: "a summary",
      updatedAt: undefined,
      withdrawnAt: undefined,
    },
    createdAt: undefined,
    dependency: {
      ecosystem: "npm",
      manifestPath: "yarn.lock",
      packageName,
      relationship: "transitive",
      scope: "runtime",
    },
    dismissedAt: undefined,
    dismissedComment: undefined,
    dismissedReason: undefined,
    fixedAt: undefined,
    htmlUrl: `https://github.com/owner/name/security/dependabot/${String(number)}`,
    number,
    state: "open",
    updatedAt: undefined,
    // Stated per case, never defaulted: a JS default initialiser is applied to an explicit `undefined` too,
    // so a default here would make the `names none` case untestable through this builder.
    vulnerableRange: { firstPatchedVersion, vulnerableVersionRange: "< 1.0.0" },
  };
}

/**
 * One not-a-bump ruling for {@link REPO}, or another repository when one is named.
 *
 * @returns the ruling, recorded against a fixed knowledge anchor
 */
export function ruling({ packageName, repo = REPO }: { packageName: string; repo?: string }): NotABumpRuling {
  return {
    anchor: "knowledge:p-0000000000009007",
    package: packageName,
    recordedIso: "2026-10-27T03:00:00.000Z",
    repo,
    why: "needs the fastify 5 migration, not a bump",
  };
}

/**
 * One open roster pull request, reduced to the title the exclusion reads.
 *
 * @returns the roster entry, its subject and title both `title`
 */
export function entry({ number, title }: { number: number; title: string }): VulnRosterEntry {
  return {
    authorLogin: "octocat",
    blockedOn: [],
    codeRabbit: "none",
    codeRabbitDetail: "",
    headOid: "",
    labels: [],
    number,
    owedCodeowners: [],
    ready: false,
    subject: title,
    title,
    url: `https://github.com/owner/name/pull/${String(number)}`,
  };
}

/**
 * A cap with `remaining` slots left under it — the planner reads only the room, never the cap itself.
 *
 * @returns a capped capacity whose target equals its room
 */
export function capped({ remaining }: { remaining: number }): TopupCapacity {
  return { kind: "capped", remaining, target: remaining };
}

/**
 * One member reading of a previous batch, its package named after its alert number.
 *
 * @returns the reading, packaged `pkg-<number>`
 */
export function member({
  number,
  state,
  hasOpenPr,
}: {
  number: number;
  state: TopupMemberReading["state"];
  hasOpenPr: boolean;
}): TopupMemberReading {
  return { alertNumber: number, hasOpenPr, packageName: `pkg-${String(number)}`, state };
}

/** One merged member and two still open behind a pull request — a third of a batch of three merged. */
export const ONE_OF_THREE: readonly TopupMemberReading[] = [
  member({ hasOpenPr: false, number: 1, state: "fixed" }),
  member({ hasOpenPr: true, number: 2, state: "open" }),
  member({ hasOpenPr: true, number: 3, state: "open" }),
];

/**
 * A counted verdict over a previous batch `g` at a 34% share, with no dismissals.
 *
 * @returns the allow or idle verdict carrying the counts given
 */
export function gateVerdict({
  kind,
  merged,
  raised,
  requiredMerged,
  withdrawn = 0,
}: {
  kind: "allow" | "idle";
  merged: number;
  raised: number;
  requiredMerged: number;
  withdrawn?: number;
}): Extract<TopupGateVerdict, { kind: "allow" | "idle" }> {
  return {
    dismissed: 0,
    kind,
    merged,
    previousSlug: "g",
    raised,
    releaseAfterMergedPercent: 34,
    requiredMerged,
    withdrawn,
  };
}
